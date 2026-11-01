/**
 * 世界生成：由固定 seed 產生地形、城市群與車站。
 * 同一 seed 必須產生完全相同的世界，供存檔與測試使用。
 */

import { dist } from "../core/math.ts";
import { Rng } from "../core/rng.ts";
import { emptyStationStats } from "../core/types.ts";
import type {
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
import { CAPITAL_NAME_POOL, CITY_NAME_POOL } from "./cityNames.ts";
import { findLandNear, generateTerrain, terrainAtPoint } from "./terrain.ts";

interface Placement {
  position: Point;
  terrain: TerrainType;
  kind: "core" | "satellite" | "remote";
}

export function generateWorld(seed: number, style: GeographyChoice = "auto"): World {
  const rng = new Rng(seed);
  const terrainRng = rng.fork("terrain");
  const grid = generateTerrain(terrainRng, style === "auto" ? undefined : style);
  const cityRng = rng.fork("cities");

  const placements: Placement[] = [];
  const cores = placeCores(cityRng, grid);
  for (const core of cores) {
    placements.push(core);
    placeSatellites(cityRng, grid, core, cores, placements);
  }
  placeRemoteCities(cityRng, grid, placements);

  const world = buildWorld(seed, grid, placements, rng.fork("names"));
  return world;
}

function placeCores(rng: Rng, grid: World["grid"]): Placement[] {
  const cores: Placement[] = [];
  const { width, height, borderMargin, minCoreDistance, regionCount } = WORLD_CONFIG;
  let attempts = 0;
  while (cores.length < regionCount && attempts < 6000) {
    attempts++;
    const p = {
      x: rng.range(borderMargin, width - borderMargin),
      y: rng.range(borderMargin, height - borderMargin),
    };
    const snapped = findLandNear(grid, p, 150);
    if (!snapped) {
      continue;
    }
    const terrain = terrainAtPoint(grid, snapped);
    // 核心城市避免直接落在高山上。
    if (terrain === "mountain" && rng.chance(0.75)) {
      continue;
    }
    if (cores.some((c) => dist(c.position, snapped) < minCoreDistance)) {
      continue;
    }
    cores.push({ position: snapped, terrain, kind: "core" });
  }
  return cores;
}

function placeSatellites(
  rng: Rng,
  grid: World["grid"],
  core: Placement,
  allCores: readonly Placement[],
  out: Placement[],
): void {
  const [minCount, maxCount] = WORLD_CONFIG.satellitesPerRegion;
  const count = rng.int(minCount, maxCount);
  const [minDist, maxDist] = WORLD_CONFIG.satelliteDistance;
  const attempted: Placement[] = [];
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < 160 && !placed; attempt++) {
      const angle = rng.range(0, Math.PI * 2);
      const distance = rng.range(minDist, maxDist);
      const p = {
        x: core.position.x + Math.cos(angle) * distance,
        y: core.position.y + Math.sin(angle) * distance,
      };
      const snapped = findLandNear(grid, p, 70);
      if (!snapped) {
        continue;
      }
      const margin = WORLD_CONFIG.borderMargin * 0.6;
      if (
        snapped.x < margin ||
        snapped.y < margin ||
        snapped.x > WORLD_CONFIG.width - margin ||
        snapped.y > WORLD_CONFIG.height - margin
      ) {
        continue;
      }
      // 必須與已放置城市及所有核心城市保持最小距離。
      if (!isFarEnough(snapped, [...out, ...allCores, ...attempted], WORLD_CONFIG.minCityDistance)) {
        continue;
      }
      const terrain = terrainAtPoint(grid, snapped);
      attempted.push({ position: snapped, terrain, kind: "satellite" });
      placed = true;
    }
  }
  out.push(...attempted);
}

function placeRemoteCities(rng: Rng, grid: World["grid"], out: Placement[]): void {
  const target = WORLD_CONFIG.remoteTarget;
  let attempts = 0;
  while (out.length < target && attempts < 4000) {
    attempts++;
    const p = {
      x: rng.range(WORLD_CONFIG.borderMargin, WORLD_CONFIG.width - WORLD_CONFIG.borderMargin),
      y: rng.range(WORLD_CONFIG.borderMargin, WORLD_CONFIG.height - WORLD_CONFIG.borderMargin),
    };
    const snapped = findLandNear(grid, p, 80);
    if (!snapped) {
      continue;
    }
    if (!isFarEnough(snapped, out, WORLD_CONFIG.remoteMinDistance)) {
      continue;
    }
    const terrain = terrainAtPoint(grid, snapped);
    out.push({ position: snapped, terrain, kind: "remote" });
  }
}

function isFarEnough(p: Point, others: readonly Placement[], minDistance: number): boolean {
  for (const other of others) {
    if (dist(p, other.position) < minDistance) {
      return false;
    }
  }
  return true;
}

/** 依位置與地形決定衛星／遠距城市的型別。 */
function pickSatelliteType(rng: Rng, terrain: TerrainType): CityType {
  if (terrain === "coast") {
    const weights = [0.25, 0.18, 0.3, 0.15, 0.12]; // port, tourism, satellite, town, university
    const types: CityType[] = ["port", "tourism", "satellite", "town", "university"];
    return types[rng.weightedIndex(weights)] as CityType;
  }
  if (terrain === "hill" || terrain === "mountain") {
    const weights = [0.3, 0.25, 0.25, 0.1, 0.1]; // tourism, town, satellite, university, industrial
    const types: CityType[] = ["tourism", "town", "satellite", "university", "industrial"];
    return types[rng.weightedIndex(weights)] as CityType;
  }
  const weights = [0.4, 0.22, 0.16, 0.14, 0.08]; // satellite, town, industrial, university, tourism
  const types: CityType[] = ["satellite", "town", "industrial", "university", "tourism"];
  return types[rng.weightedIndex(weights)] as CityType;
}

function pickRemoteType(rng: Rng): CityType {
  const weights = [0.5, 0.3, 0.2]; // town, tourism, industrial
  const types: CityType[] = ["town", "tourism", "industrial"];
  return types[rng.weightedIndex(weights)] as CityType;
}

function buildWorld(seed: number, grid: World["grid"], placements: Placement[], nameRng: Rng): World {
  // 穩定排序，確保城市 ID 不因生成順序而變動。
  const sorted = placements
    .slice()
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

  const namePool = nameRng.shuffle(CITY_NAME_POOL);
  const capitalPool = nameRng.shuffle(CAPITAL_NAME_POOL);
  const usedNames = new Set<string>();

  const cities: City[] = [];
  const stations: Station[] = [];

  sorted.forEach((placement, index) => {
    const id = idFor("city", index);
    const cityType: CityType =
      placement.kind === "core"
        ? placement.terrain === "coast"
          ? "port"
          : "capital"
        : pickTypeForPlacement(nameRng, placement);

    const name = takeName(cityType, namePool, capitalPool, usedNames, index);
    const params = CITY_TYPE_PARAMS[cityType];
    const population = roundTo(nameRng.range(params.population[0], params.population[1]), 1000);
    const developmentLevel =
      cityType === "capital" ? 3 : cityType === "port" || population > 600_000 ? 2 : 1;

    const city: City = {
      id,
      name,
      position: { ...placement.position },
      population,
      cityType,
      industry: { ...params.industry },
      demandMultiplier: roundTo(nameRng.range(params.demand[0], params.demand[1]), 0.01),
      growthRate: roundTo(nameRng.range(params.growth[0], params.growth[1]), 0.0001),
      terrain: placement.terrain,
      developmentLevel,
      unlocked: true,
      unlockLevel: 0,
      stationIds: [idFor("stn", index)],
    };
    cities.push(city);

    stations.push({
      id: idFor("stn", index),
      cityId: id,
      name: `${name}${STATION_SUFFIX}`,
      position: { ...placement.position },
      level: 1,
      capacity: roundTo(
        STATION_CONFIG.baseCapacity + population * STATION_CONFIG.capacityPerCitizen,
        100,
      ),
      routeIds: [],
      satisfaction: STATION_CONFIG.initialSatisfaction,
      stats: emptyStationStats(),
    });
  });

  assignUnlockLevels(cities);

  return {
    seed,
    width: WORLD_CONFIG.width,
    height: WORLD_CONFIG.height,
    grid,
    cities,
    stations,
  };
}

/**
 * 依與「起始核心城市」的距離指派解鎖等級（生涯模式的進度曲線）。
 * 完全由既有城市資料決定，不消耗亂數，因此不影響世界生成結果。
 */
function assignUnlockLevels(cities: City[]): void {
  const tiers = CITY_UNLOCK_TIERS;
  const cores = cities.filter((c) => c.cityType === "capital" || c.cityType === "port");
  let startCore: City | null = null;
  let bestCount = -1;
  for (const core of cores) {
    const count = cities.filter(
      (c) => c.id !== core.id && dist(c.position, core.position) <= tiers.radius1,
    ).length;
    if (count > bestCount) {
      bestCount = count;
      startCore = core;
    }
  }
  if (!startCore) {
    return;
  }
  for (const city of cities) {
    if (city.id === startCore.id) {
      city.unlockLevel = tiers.levels[0] as number;
      city.unlocked = true;
      continue;
    }
    const d = dist(city.position, startCore.position);
    const level =
      d <= tiers.radius1
        ? (tiers.levels[0] as number)
        : d <= tiers.radius2
          ? (tiers.levels[1] as number)
          : d <= tiers.radius3
            ? (tiers.levels[2] as number)
            : d <= tiers.radius4
              ? (tiers.levels[3] as number)
              : (tiers.levels[4] as number);
    city.unlockLevel = level;
    city.unlocked = level === 0;
  }
}

/** 將 Placement.assignedType 留空的衛星城市補上型別（遠距城市使用遠距權重）。 */
function pickTypeForPlacement(rng: Rng, placement: Placement): CityType {
  return placement.kind === "remote"
    ? pickRemoteType(rng)
    : pickSatelliteType(rng, placement.terrain);
}

const STATION_SUFFIX = "站";

function takeName(
  cityType: CityType,
  pool: readonly string[],
  capitalPool: readonly string[],
  used: Set<string>,
  index: number,
): string {
  const preferCapital = cityType === "capital" || cityType === "port";
  const primary = preferCapital ? capitalPool : pool;
  for (const name of primary) {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  for (const name of pool) {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `新城${index + 1}`;
  used.add(fallback);
  return fallback;
}

function idFor(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(2, "0")}`;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

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
