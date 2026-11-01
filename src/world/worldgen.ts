/**
 * 無限世界生成。
 * 世界被切成固定大小的「圖磚」；每個圖磚的城市完全由（seed、圖磚座標）決定，
 * 玩家探索（相機移動、路線延伸）時逐步生成，內容永久穩定、可重現。
 */

import { dist } from "../core/math.ts";
import { hashString, Rng } from "../core/rng.ts";
import { emptyStationStats } from "../core/types.ts";
import type {
  BiomeId,
  City,
  CityType,
  GeographyChoice,
  ID,
  Point,
  Station,
  TerrainType,
  World,
} from "../core/types.ts";
import { CITY_TYPE_PARAMS, CITY_UNLOCK_TIERS, STATION_CONFIG, WORLD_CONFIG } from "../game/config.ts";
import { BIOME_CITY_WEIGHTS, type MapStyle } from "./biomes.ts";
import { generateCityName } from "./cityNames.ts";
import { createTerrainSampler, findLandNear, type TerrainSampler } from "./terrain.ts";

export const TILE_SIZE = WORLD_CONFIG.tileSize;

export function tileKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

export function parseTileKey(key: string): { tx: number; ty: number } | null {
  const match = /^(-?\d+),(-?\d+)$/.exec(key);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  return { tx: Number.parseInt(match[1], 10), ty: Number.parseInt(match[2], 10) };
}

/* ------------------------------ 圖磚內容 ------------------------------ */

interface TileCity {
  index: number;
  position: Point;
  biome: BiomeId;
  terrain: TerrainType;
  cityType: CityType;
  name: string;
  population: number;
  demandMultiplier: number;
  growthRate: number;
  developmentLevel: number;
}

/** 純函式：產生單一圖磚的城市內容（不含命名去重），相同輸入永遠得到相同結果。 */
function generateTileCities(
  seed: number,
  style: MapStyle,
  tx: number,
  ty: number,
  excludedNames?: ReadonlySet<string>,
): TileCity[] {
  const rng = new Rng(hashString(`${seed}|tile|${tx}|${ty}`));
  const sampler = createTerrainSampler(seed, style);
  const baseX = tx * TILE_SIZE;
  const baseY = ty * TILE_SIZE;

  // 以 5×5 網格估計陸地比例，決定這塊圖磚的城市數量。
  let landProbes = 0;
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const p = {
        x: baseX + ((i + 0.5) / 5) * TILE_SIZE,
        y: baseY + ((j + 0.5) / 5) * TILE_SIZE,
      };
      if (sampler.terrainAt(p) !== "water") {
        landProbes++;
      }
    }
  }
  const landRatio = landProbes / 25;
  if (landRatio < 0.1) {
    return [];
  }
  const count = Math.min(
    WORLD_CONFIG.maxCitiesPerTile,
    Math.max(0, Math.round(landRatio * rng.range(WORLD_CONFIG.citiesPerTileRange[0], WORLD_CONFIG.citiesPerTileRange[1]))),
  );

  const inset = TILE_SIZE * WORLD_CONFIG.tileInsetRatio;
  const cities: TileCity[] = [];
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 28; attempt++) {
      const p = {
        x: baseX + inset + rng.range(0, TILE_SIZE - inset * 2),
        y: baseY + inset + rng.range(0, TILE_SIZE - inset * 2),
      };
      const snapped = findLandNear(sampler, p, 100);
      if (!snapped) {
        continue;
      }
      if (cities.some((c) => dist(c.position, snapped) < WORLD_CONFIG.minCityDistance)) {
        continue;
      }
      const sample = sampler.sampleAt(snapped);
      const weights = BIOME_CITY_WEIGHTS[sample.biome];
      const types = Object.keys(weights) as CityType[];
      if (types.length === 0) {
        continue;
      }
      let cityType = types[rng.weightedIndex(types.map((t) => weights[t] ?? 0))] as CityType;
      if (cityType === undefined) {
        continue;
      }
      // 港口必須真的靠水。
      if (cityType === "port" && sample.terrain !== "coast") {
        cityType = rng.chance(0.5) ? "tourism" : "town";
      }

      // 命名（可選的去重集合：由呼叫端提供鄰近圖磚的名稱）。
      let name = generateCityName(rng, sample.biome);
      for (let tries = 0; tries < 24; tries++) {
        const collides = (excludedNames?.has(name) ?? false) || cities.some((c) => c.name === name);
        if (!collides) {
          break;
        }
        name = generateCityName(rng, sample.biome);
      }

      const params = CITY_TYPE_PARAMS[cityType];
      const population = roundTo(rng.range(params.population[0], params.population[1]), 1000);
      const developmentLevel =
        cityType === "capital" ? 3 : cityType === "port" || population > 600_000 ? 2 : 1;

      cities.push({
        index: i,
        position: snapped,
        biome: sample.biome,
        terrain: sample.terrain,
        cityType,
        name,
        population,
        demandMultiplier: roundTo(rng.range(params.demand[0], params.demand[1]), 0.01),
        growthRate: roundTo(rng.range(params.growth[0], params.growth[1]), 0.0001),
        developmentLevel,
      });
      break;
    }
  }
  return cities;
}

/** 鄰近圖磚的名稱集合（固定視窗 → 命名結果與探索順序無關）。 */
function neighborNames(seed: number, style: MapStyle, tx: number, ty: number): Set<string> {
  const names = new Set<string>();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      for (const city of generateTileCities(seed, style, tx + dx, ty + dy)) {
        names.add(city.name);
      }
    }
  }
  return names;
}

/* ------------------------------ 生成與探索 ------------------------------ */

export interface MaterializeContext {
  world: World;
  tiles: Set<string>;
  /** 自由模式：全部城市直接解鎖。 */
  freeUnlock: boolean;
}

function cityIdFor(tx: number, ty: number, index: number): string {
  return `city-${tx}_${ty}_${index + 1}`;
}

function stationIdFor(tx: number, ty: number, index: number): string {
  return `stn-${tx}_${ty}_${index + 1}`;
}

/** 生成單一圖磚並加入世界（不重複處理已生成的圖磚）。回傳新城市數。 */
export function materializeTile(ctx: MaterializeContext, tx: number, ty: number): number {
  const key = tileKey(tx, ty);
  if (ctx.tiles.has(key)) {
    return 0;
  }
  ctx.tiles.add(key);
  const { world } = ctx;
  const cities = generateTileCities(
    world.seed,
    world.style === "auto" ? "auto" : world.style,
    tx,
    ty,
    neighborNames(world.seed, world.style === "auto" ? "auto" : world.style, tx, ty),
  );
  if (cities.length === 0) {
    return 0;
  }
  for (const tileCity of cities) {
    const id = cityIdFor(tx, ty, tileCity.index);
    const unlockLevel = unlockLevelForPosition(world.startCore, tileCity.position);
    ctx.world.cities.push({
      id,
      name: tileCity.name,
      position: { ...tileCity.position },
      population: tileCity.population,
      cityType: tileCity.cityType,
      industry: { ...CITY_TYPE_PARAMS[tileCity.cityType].industry },
      demandMultiplier: tileCity.demandMultiplier,
      growthRate: tileCity.growthRate,
      terrain: tileCity.terrain,
      biome: tileCity.biome,
      developmentLevel: tileCity.developmentLevel,
      unlocked: ctx.freeUnlock || unlockLevel === 0,
      unlockLevel,
      stationIds: [stationIdFor(tx, ty, tileCity.index)],
    });
    ctx.world.stations.push({
      id: stationIdFor(tx, ty, tileCity.index),
      cityId: id,
      name: `${tileCity.name}站`,
      position: { ...tileCity.position },
      level: 1,
      capacity: roundTo(
        STATION_CONFIG.baseCapacity + tileCity.population * STATION_CONFIG.capacityPerCitizen,
        100,
      ),
      routeIds: [],
      satisfaction: STATION_CONFIG.initialSatisfaction,
      stats: emptyStationStats(),
    });
  }
  return cities.length;
}

/** 生成以某座標為中心的一定範圍圖磚。回傳新城市數。 */
export function materializeTilesAround(
  ctx: MaterializeContext,
  x: number,
  y: number,
  radiusTiles: number,
): number {
  const minTx = Math.floor((x - radiusTiles * TILE_SIZE) / TILE_SIZE);
  const maxTx = Math.floor((x + radiusTiles * TILE_SIZE) / TILE_SIZE);
  const minTy = Math.floor((y - radiusTiles * TILE_SIZE) / TILE_SIZE);
  const maxTy = Math.floor((y + radiusTiles * TILE_SIZE) / TILE_SIZE);
  let added = 0;
  for (let tx = minTx; tx <= maxTx; tx++) {
    for (let ty = minTy; ty <= maxTy; ty++) {
      added += materializeTile(ctx, tx, ty);
    }
  }
  return added;
}

/** 由存檔的圖磚清單重建世界（讀檔用）。 */
export function materializeTileList(ctx: MaterializeContext, keys: readonly string[]): void {
  for (const key of keys) {
    const parsed = parseTileKey(key);
    if (parsed) {
      materializeTile(ctx, parsed.tx, parsed.ty);
    }
  }
}

function unlockLevelForPosition(startCore: Point, position: Point): number {
  const tiers = CITY_UNLOCK_TIERS;
  const d = dist(startCore, position);
  if (d <= tiers.radius1) {
    return tiers.levels[0] as number;
  }
  if (d <= tiers.radius2) {
    return tiers.levels[1] as number;
  }
  if (d <= tiers.radius3) {
    return tiers.levels[2] as number;
  }
  if (d <= tiers.radius4) {
    return tiers.levels[3] as number;
  }
  return tiers.levels[4] as number;
}

/**
 * 建立新世界：找出起始核心位置，生成起始區域的圖磚。
 * 回傳世界與已生成的圖磚清單。
 */
export function generateWorld(
  seed: number,
  style: GeographyChoice = "auto",
): { world: World; materializedTiles: string[] } {
  const mapStyle: MapStyle = style === "auto" ? "auto" : style;
  const sampler: TerrainSampler = createTerrainSampler(seed, mapStyle);
  const startCore = findLandNear(sampler, { x: 0, y: 0 }, 900) ?? { x: 0, y: 0 };
  const world: World = {
    seed,
    style,
    startCore,
    cities: [],
    stations: [],
  };
  const tiles = new Set<string>();
  const ctx: MaterializeContext = { world, tiles, freeUnlock: false };
  materializeTilesAround(ctx, startCore.x, startCore.y, WORLD_CONFIG.startRadiusTiles);
  return { world, materializedTiles: [...tiles] };
}

/* ------------------------------ 查詢工具 ------------------------------ */

/** 依 ID 取得城市。 */
export function cityById(world: World, id: ID): City | undefined {
  return world.cities.find((c) => c.id === id);
}

/** 依 ID 取得車站。 */
export function stationById(world: World, id: ID): Station | undefined {
  return world.stations.find((s) => s.id === id);
}

/** 城市顯示名稱（含市／鎮後綴）。 */
export function cityDisplayName(city: City): string {
  return `${city.name}${CITY_TYPE_PARAMS[city.cityType].suffix}`;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
