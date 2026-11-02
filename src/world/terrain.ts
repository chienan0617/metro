/**
 * 無限地形取樣。
 * 不再儲存整張地形格線：所有地形、生態域、溫度與濕度都由柏林雜訊即時取得，
 * 同一 seed + 座標必定得到相同結果，可向任何方向無限延伸。
 */

import { clamp } from "../core/math.ts";
import type { BiomeId, Point, TerrainType, World } from "../core/types.ts";
import { SEGMENT_TERRAIN_CONFIG, TERRAIN_COST_MULTIPLIER } from "../game/config.ts";
import { BiomeFields, type BiomeSample, type MapStyle } from "./biomes.ts";

export type { BiomeSample, MapStyle };
export { BIOME_LABELS, BIOME_RGB, biomeClimateLabel } from "./biomes.ts";

export interface TerrainSampler {
  fields: BiomeFields;
  /** 遊戲邏輯使用的地形分類（水／海岸／平原／丘陵／山地）。 */
  terrainAt(p: Point): TerrainType;
  biomeAt(p: Point): BiomeId;
  sampleAt(p: Point): BiomeSample;
}

const samplerCache = new Map<string, TerrainSampler>();

export function createTerrainSampler(seed: number, style: MapStyle): TerrainSampler {
  const key = `${seed}|${style}`;
  const cached = samplerCache.get(key);
  if (cached) {
    return cached;
  }
  const fields = new BiomeFields(seed, style);
  const sampler: TerrainSampler = {
    fields,
    terrainAt: (p) => fields.sample(p.x, p.y).terrain,
    biomeAt: (p) => fields.sample(p.x, p.y).biome,
    sampleAt: (p) => fields.sample(p.x, p.y),
  };
  samplerCache.set(key, sampler);
  // 快取上限：正常遊戲只會用到少數幾組 seed/style。
  if (samplerCache.size > 8) {
    const firstKey = samplerCache.keys().next().value;
    if (firstKey !== undefined) {
      samplerCache.delete(firstKey);
    }
  }
  return sampler;
}

/** 由世界資料取得（快取）對應的地形取樣器。 */
export function samplerForWorld(world: World): TerrainSampler {
  return createTerrainSampler(world.seed, world.style);
}

/** 取樣一條線段沿線的平均地形成本倍率。 */
export function sampleTerrainMultiplier(
  terrainOf: (p: Point) => TerrainType,
  a: Point,
  b: Point,
  table: Record<TerrainType, number> = TERRAIN_COST_MULTIPLIER,
): number {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const samples = clamp(Math.ceil(length / 60), 8, 48);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    sum += table[terrainOf(p)];
  }
  return sum / samples;
}

/** 一條路段的沿線地形剖面（供成本計算與 UI 提示使用）。 */
export interface SegmentTerrainProfile {
  /** 沿線平均的地形成本倍率（尚未計入跨水與高度差加成）。 */
  avgMultiplier: number;
  /** 水域取樣比例（0-1）。 */
  waterShare: number;
  /** 丘陵取樣比例（0-1）。 */
  hillShare: number;
  /** 山地取樣比例（0-1）。 */
  mountainShare: number;
  /** 沿線取樣高度範圍（最大 − 最小，0-1 正規化）。 */
  elevationRange: number;
  /** 是否跨越水域（需要橋梁／隧道）。 */
  crossesWater: boolean;
  /** 是否明顯穿越山地。 */
  crossesMountain: boolean;
}

/** 取樣一條線段沿線的地形剖面：平均倍率、水域／山地比例與高度範圍。 */
export function segmentTerrainProfile(
  sampler: TerrainSampler,
  a: Point,
  b: Point,
): SegmentTerrainProfile {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const samples = clamp(Math.ceil(length / 60), 8, 48);
  let multiplierSum = 0;
  let waterCount = 0;
  let hillCount = 0;
  let mountainCount = 0;
  let minElevation = 1;
  let maxElevation = 0;
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    const sample = sampler.sampleAt({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    multiplierSum += TERRAIN_COST_MULTIPLIER[sample.terrain];
    if (sample.terrain === "water") {
      waterCount++;
    } else if (sample.terrain === "hill") {
      hillCount++;
    } else if (sample.terrain === "mountain") {
      mountainCount++;
    }
    minElevation = Math.min(minElevation, sample.elevation);
    maxElevation = Math.max(maxElevation, sample.elevation);
  }
  const waterShare = waterCount / samples;
  const mountainShare = mountainCount / samples;
  return {
    avgMultiplier: multiplierSum / samples,
    waterShare,
    hillShare: hillCount / samples,
    mountainShare,
    elevationRange: maxElevation - minElevation,
    crossesWater: waterShare >= SEGMENT_TERRAIN_CONFIG.waterShareThreshold,
    crossesMountain: mountainShare >= SEGMENT_TERRAIN_CONFIG.mountainShareThreshold,
  };
}

/**
 * 在指定點附近尋找陸地（非水域）位置；找不到時回傳 null。
 * 以環狀擴散搜尋，適用於無限座標。
 */
export function findLandNear(sampler: TerrainSampler, p: Point, maxRadius: number): Point | null {
  const step = 30;
  for (let r = 0; r <= maxRadius; r += step) {
    const ringCount = r === 0 ? 1 : Math.max(8, Math.floor((r * Math.PI) / 24));
    for (let i = 0; i < ringCount; i++) {
      const angle = (i / ringCount) * Math.PI * 2;
      const candidate = { x: p.x + Math.cos(angle) * r, y: p.y + Math.sin(angle) * r };
      if (sampler.terrainAt(candidate) !== "water") {
        return candidate;
      }
    }
  }
  return null;
}

export function isWaterTerrain(t: TerrainType): boolean {
  return t === "water";
}
