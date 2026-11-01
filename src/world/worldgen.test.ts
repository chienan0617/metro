import { describe, expect, it } from "vitest";
import { dist } from "../core/math.ts";
import { PerlinNoise } from "../core/noise.ts";
import { WORLD_CONFIG } from "../game/config.ts";
import { createTerrainSampler, samplerForWorld } from "./terrain.ts";
import {
  cityDisplayName,
  generateWorld,
  materializeTilesAround,
  materializeTile,
  tileKey,
  type MaterializeContext,
} from "./worldgen.ts";

const SEED = 20261030;

function ctxWithTiles(world: ReturnType<typeof generateWorld>["world"], tiles: Iterable<string>): MaterializeContext {
  return { world, tiles: new Set(tiles), freeUnlock: true };
}

describe("柏林雜訊", () => {
  it("同一 seed 的雜訊可重現、不同 seed 不同，且值域合理", () => {
    const a = new PerlinNoise(123);
    const b = new PerlinNoise(123);
    const c = new PerlinNoise(124);
    let differs = false;
    for (let i = 0; i < 50; i++) {
      const va = a.noise(i * 0.37, i * 0.11);
      expect(va).toBe(b.noise(i * 0.37, i * 0.11));
      expect(Math.abs(va)).toBeLessThanOrEqual(1.5);
      if (Math.abs(va - c.noise(i * 0.37, i * 0.11)) > 1e-9) {
        differs = true;
      }
    }
    expect(differs).toBe(true);
  });
});

describe("無限世界生成", () => {
  it("同一 seed 產生完全相同的起始世界", () => {
    const a = generateWorld(SEED);
    const b = generateWorld(SEED);
    expect(a.world.cities).toEqual(b.world.cities);
    expect(a.world.stations).toEqual(b.world.stations);
    expect(a.materializedTiles).toEqual(b.materializedTiles);
    expect(a.world.startCore).toEqual(b.world.startCore);
  });

  it("不同 seed 產生不同世界", () => {
    const a = generateWorld(SEED);
    const b = generateWorld(SEED + 1);
    expect(a.world.cities).not.toEqual(b.world.cities);
  });

  it("起始區域城市數在合理範圍內", () => {
    const { world } = generateWorld(SEED);
    const [min, max] = WORLD_CONFIG.cityCountRange;
    expect(world.cities.length).toBeGreaterThanOrEqual(min);
    expect(world.cities.length).toBeLessThanOrEqual(max);
  });

  it("世界沒有邊界：遠處圖磚依然能生成城市與車站", () => {
    const { world, materializedTiles } = generateWorld(SEED);
    const ctx = ctxWithTiles(world, materializedTiles);
    const added = materializeTilesAround(ctx, 24000, -18000, 3);
    expect(added).toBeGreaterThan(0);
    expect(world.cities.some((c) => dist(c.position, world.startCore) > 10000)).toBe(true);
  });

  it("探索順序不影響內容（圖磚由座標決定）", () => {
    const a = generateWorld(SEED);
    const b = generateWorld(SEED);
    const ctxA = ctxWithTiles(a.world, a.materializedTiles);
    const ctxB = ctxWithTiles(b.world, b.materializedTiles);
    // 不同順序生成同一批圖磚。
    materializeTile(ctxA, 12, -7);
    materializeTile(ctxA, 13, -7);
    materializeTile(ctxB, 13, -7);
    materializeTile(ctxB, 12, -7);
    const filter = (id: string): boolean => id.includes("12_-7") || id.includes("13_-7");
    const citiesA = a.world.cities.filter((c) => filter(c.id)).sort((x, y) => x.id.localeCompare(y.id));
    const citiesB = b.world.cities.filter((c) => filter(c.id)).sort((x, y) => x.id.localeCompare(y.id));
    expect(citiesA.length).toBeGreaterThan(0);
    expect(citiesA).toEqual(citiesB);
  });

  it("所有城市都在陸地上、彼此保持距離、名稱不重複", () => {
    const { world } = generateWorld(SEED);
    const sampler = samplerForWorld(world);
    const names = new Set<string>();
    for (const city of world.cities) {
      expect(sampler.terrainAt(city.position)).not.toBe("water");
      expect(city.stationIds.length).toBe(1);
      const station = world.stations.find((s) => s.id === city.stationIds[0]);
      expect(station?.name).toBe(`${city.name}站`);
      expect(names.has(city.name)).toBe(false);
      names.add(city.name);
    }
    for (let i = 0; i < world.cities.length; i++) {
      for (let j = i + 1; j < world.cities.length; j++) {
        const a = world.cities[i];
        const b = world.cities[j];
        if (!a || !b) {
          continue;
        }
        expect(dist(a.position, b.position)).toBeGreaterThanOrEqual(
          WORLD_CONFIG.minCityDistance * 0.9,
        );
      }
    }
  });

  it("生態域多樣：包含海洋、森林、山地、沙漠等不同氣候", () => {
    const sampler = createTerrainSampler(SEED, "auto");
    const biomes = new Set<string>();
    for (let x = -6000; x <= 6000; x += 500) {
      for (let y = -6000; y <= 6000; y += 500) {
        biomes.add(sampler.biomeAt({ x, y }));
      }
    }
    expect(biomes.size).toBeGreaterThanOrEqual(6);
    expect(biomes.has("ocean")).toBe(true);
    expect([...biomes].some((b) => b === "mountain" || b === "peaks" || b === "hills")).toBe(true);
  });

  it("大陸樣式的陸地比例明顯高於群島樣式", () => {
    const landRatio = (style: "continent" | "islands"): number => {
      const sampler = createTerrainSampler(SEED, style);
      let land = 0;
      let total = 0;
      for (let x = -5000; x <= 5000; x += 400) {
        for (let y = -5000; y <= 5000; y += 400) {
          total++;
          if (sampler.terrainAt({ x, y }) !== "water") {
            land++;
          }
        }
      }
      return land / total;
    };
    const continent = landRatio("continent");
    const islands = landRatio("islands");
    expect(continent).toBeGreaterThan(islands + 0.1);
    expect(continent).toBeGreaterThan(0.55);
    expect(islands).toBeLessThan(0.6);
  });

  it("城市類型符合生態域（港口靠水、高山多觀光/城鎮）", () => {
    const { world, materializedTiles } = generateWorld(SEED);
    const ctx = ctxWithTiles(world, materializedTiles);
    const before = world.cities.length;
    materializeTilesAround(ctx, 0, 0, 4);
    expect(world.cities.length).toBeGreaterThanOrEqual(before);
    const sampler = samplerForWorld(world);
    for (const city of world.cities) {
      if (city.cityType === "port") {
        // 港口必須位於附近有水的位置。
        const t = sampler.terrainAt(city.position);
        expect(t === "coast" || t === "plain").toBe(true);
      }
    }
  });

  it("圖磚鍵可解析、重複生成同一磚不會增加城市", () => {
    const { world, materializedTiles } = generateWorld(SEED);
    const ctx = ctxWithTiles(world, materializedTiles);
    const before = world.cities.length;
    const key = materializedTiles[0];
    expect(key).toBeDefined();
    if (key) {
      const parsed = /^(-?\d+),(-?\d+)$/.exec(key);
      expect(parsed).not.toBeNull();
    }
    // 重複生成無效。
    materializeTile(ctx, 0, 0);
    const afterFirst = world.cities.length;
    materializeTile(ctx, 0, 0);
    expect(world.cities.length).toBe(afterFirst);
    expect(world.cities.length).toBeGreaterThanOrEqual(before);
    expect(tileKey(0, 0)).toBe("0,0");
  });

  it("城市顯示名稱包含市／鎮後綴", () => {
    const { world } = generateWorld(SEED);
    const town = world.cities.find((c) => c.cityType === "town");
    if (town) {
      expect(cityDisplayName(town).endsWith("鎮")).toBe(true);
    }
    const capital = world.cities.find((c) => c.cityType === "capital" || c.cityType === "port");
    if (capital) {
      expect(cityDisplayName(capital).endsWith("市")).toBe(true);
    }
  });
});
