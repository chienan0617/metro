import { describe, expect, it } from "vitest";
import { dist } from "../core/math.ts";
import { Rng } from "../core/rng.ts";
import type { World } from "../core/types.ts";
import { WORLD_CONFIG } from "../game/config.ts";
import { pickGeographyStyle, terrainAtPoint } from "./terrain.ts";
import { cityDisplayName, generateWorld } from "./worldgen.ts";

const SEED = 20261030;

function terrainChecksum(world: World): number {
  let sum = 0;
  for (let i = 0; i < world.grid.data.length; i++) {
    sum = (sum + (world.grid.data[i] as number) * (i % 7 + 1)) % 1_000_000_007;
  }
  return sum;
}

interface GeographyProbe {
  kind: "island" | "mainland" | "strait";
  landRatio: number;
  edgeLandCells: number;
  landComponents: number;
}

/** 判斷一張地圖的地理特徵：邊緣是否有陸地、陸塊數量與比例。 */
function probeGeography(world: World): GeographyProbe {
  const grid = world.grid;
  const { cols, rows, data } = grid;
  let land = 0;
  let edgeLand = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const isLand = (data[row * cols + col] as number) !== 0;
      if (!isLand) {
        continue;
      }
      land++;
      if (row === 0 || row === rows - 1 || col === 0 || col === cols - 1) {
        edgeLand++;
      }
    }
  }

  // 4 連通洪水填充計算陸塊數量與大小。
  const visited = new Uint8Array(data.length);
  const sizes: number[] = [];
  const queue: number[] = [];
  for (let start = 0; start < data.length; start++) {
    if ((data[start] as number) === 0 || visited[start] === 1) {
      continue;
    }
    let size = 0;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++] as number;
      size++;
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      const neighbors: number[] = [];
      if (row > 0) {
        neighbors.push(idx - cols);
      }
      if (row < rows - 1) {
        neighbors.push(idx + cols);
      }
      if (col > 0) {
        neighbors.push(idx - 1);
      }
      if (col < cols - 1) {
        neighbors.push(idx + 1);
      }
      for (const n of neighbors) {
        if ((data[n] as number) !== 0 && visited[n] === 0) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }
    sizes.push(size);
  }
  sizes.sort((a, b) => b - a);

  const biggest = sizes[0] ?? 0;
  const second = sizes[1] ?? 0;
  let kind: GeographyProbe["kind"];
  if (edgeLand > 0) {
    kind = "mainland";
  } else if (second > biggest * 0.25 && second > land * 0.15) {
    kind = "strait";
  } else {
    kind = "island";
  }

  return {
    kind,
    landRatio: land / data.length,
    edgeLandCells: edgeLand,
    landComponents: sizes.length,
  };
}

describe("worldgen", () => {
  it("同一 seed 產生完全相同的世界", () => {
    const a = generateWorld(SEED);
    const b = generateWorld(SEED);
    expect(terrainChecksum(a)).toBe(terrainChecksum(b));
    expect(a.cities).toEqual(b.cities);
    expect(a.stations).toEqual(b.stations);
  });

  it("不同 seed 產生不同世界", () => {
    const a = generateWorld(SEED);
    const b = generateWorld(SEED + 1);
    expect(a.cities).not.toEqual(b.cities);
  });

  it("城市數量位於設定範圍內", () => {
    const world = generateWorld(SEED);
    const [min, max] = WORLD_CONFIG.cityCountRange;
    expect(world.cities.length).toBeGreaterThanOrEqual(min);
    expect(world.cities.length).toBeLessThanOrEqual(max);
  });

  it("城市之間保持最小距離", () => {
    const world = generateWorld(SEED);
    for (let i = 0; i < world.cities.length; i++) {
      for (let j = i + 1; j < world.cities.length; j++) {
        const a = world.cities[i];
        const b = world.cities[j];
        if (!a || !b) {
          continue;
        }
        expect(dist(a.position, b.position)).toBeGreaterThanOrEqual(
          WORLD_CONFIG.minCityDistance - 0.001,
        );
      }
    }
  });

  it("所有城市都在陸地上且位於地圖範圍內", () => {
    const world = generateWorld(SEED);
    for (const city of world.cities) {
      expect(terrainAtPoint(world.grid, city.position)).not.toBe("water");
      expect(city.position.x).toBeGreaterThanOrEqual(0);
      expect(city.position.y).toBeGreaterThanOrEqual(0);
      expect(city.position.x).toBeLessThanOrEqual(world.width);
      expect(city.position.y).toBeLessThanOrEqual(world.height);
    }
  });

  it("城市名稱不重複，且每座城市都有車站", () => {
    const world = generateWorld(SEED);
    const names = new Set(world.cities.map((c) => c.name));
    expect(names.size).toBe(world.cities.length);
    for (const city of world.cities) {
      expect(city.stationIds.length).toBe(1);
      const station = world.stations.find((s) => s.id === city.stationIds[0]);
      expect(station).toBeDefined();
      expect(station?.cityId).toBe(city.id);
      expect(station?.name).toBe(`${city.name}站`);
    }
  });

  it("存在核心城市與可早期連接的城市群", () => {
    const world = generateWorld(SEED);
    const capitals = world.cities.filter((c) => c.cityType === "capital" || c.cityType === "port");
    expect(capitals.length).toBeGreaterThanOrEqual(3);
    // 至少一座核心城市周圍有 2 座以上城市（形成可開始遊玩的群落）。
    const hasCluster = capitals.some((core) => {
      const nearby = world.cities.filter(
        (c) => c.id !== core.id && dist(c.position, core.position) < 780,
      );
      return nearby.length >= 2;
    });
    expect(hasCluster).toBe(true);
  });

  it("地理樣式多樣：不同 seed 會產生海島、大陸或海峽地形", () => {
    const probes = [SEED, 11, 22, 33, 44, 55, 66, 77].map((seed) => probeGeography(generateWorld(seed)));
    // 至少出現兩種不同的地理特徵（以陸地比例與邊緣陸地判定）。
    const kinds = new Set(probes.map((p) => p.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(2);
    // 每張地圖都要有足夠的陸地與水域。
    for (const probe of probes) {
      expect(probe.landRatio).toBeGreaterThan(0.3);
      expect(probe.landRatio).toBeLessThan(0.97);
    }
  });

  it("大陸樣式的地圖在部分邊緣是陸地（不是四面環海）", () => {
    // 找出至少一個「邊緣有陸地」的世界（大陸或海峽樣式）。
    const hasMainlandish = [SEED, 11, 22, 33, 44, 55].some((seed) => {
      const probe = probeGeography(generateWorld(seed));
      return probe.edgeLandCells > 0;
    });
    expect(hasMainlandish).toBe(true);
  });

  it("內陸大陸：陸地比例高、存在遠離水域的內陸城市", () => {
    for (const seed of [SEED, 111, 333]) {
      const world = generateWorld(seed, "continent");
      const probe = probeGeography(world);
      // 內陸大陸仍可能有大內灣與湖泊，但陸地比例遠高於海島。
      expect(probe.landRatio).toBeGreaterThan(0.6);

      // 至少有一批城市距離水域很遠（真正的「廣闊內陸」）。
      const inlandCities = world.cities.filter((city) => {
        const offsets = [
          { x: 0, y: 0 },
          { x: 320, y: 0 },
          { x: -320, y: 0 },
          { x: 0, y: 320 },
          { x: 0, y: -320 },
          { x: 320, y: 320 },
          { x: -320, y: -320 },
        ];
        return offsets.every((o) => {
          const point = { x: city.position.x + o.x, y: city.position.y + o.y };
          if (point.x < 0 || point.y < 0 || point.x > world.width || point.y > world.height) {
            return true;
          }
          return terrainAtPoint(world.grid, point) !== "water";
        });
      });
      expect(inlandCities.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("指定樣式與自動抽到相同樣式時，世界完全一致", () => {
    const seed = SEED;
    const autoStyle = pickGeographyStyle(new Rng(seed).fork("terrain"));
    const auto = generateWorld(seed);
    const explicit = generateWorld(seed, autoStyle);
    expect(explicit.cities).toEqual(auto.cities);
    expect(explicit.stations).toEqual(auto.stations);
  });

  it("指定樣式可重現且與其他樣式不同", () => {
    const a = generateWorld(SEED, "continent");
    const b = generateWorld(SEED, "continent");
    expect(a.cities).toEqual(b.cities);

    const island = generateWorld(SEED, "island");
    const continentProbe = probeGeography(a);
    const islandProbe = probeGeography(island);
    expect(continentProbe.landRatio).toBeGreaterThan(islandProbe.landRatio);
    expect(islandProbe.edgeLandCells).toBe(0);
  });

  it("城市顯示名稱包含市／鎮後綴", () => {
    const world = generateWorld(SEED);
    const town = world.cities.find((c) => c.cityType === "town");
    if (town) {
      expect(cityDisplayName(town).endsWith("鎮")).toBe(true);
    }
    const capital = world.cities.find((c) => c.cityType === "capital");
    if (capital) {
      expect(cityDisplayName(capital).endsWith("市")).toBe(true);
    }
  });
});
