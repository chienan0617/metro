/**
 * 地形格線生成與查詢。
 * 使用可重現的 value noise 產生高度場，再依「地理樣式」塑形：
 *   - island：四面環海的橢圓大陸。
 *   - mainland：單側海岸的大陸（其餘方向延伸至地圖邊緣），含內陸湖泊。
 *   - strait：兩塊大陸隔著一道海峽。
 * 樣式由 seed 決定，同一 seed 必定產生相同地理。
 */

import { clamp, smoothstep } from "../core/math.ts";
import { Rng } from "../core/rng.ts";
import type { GeographyStyle, Point, TerrainGrid, TerrainType } from "../core/types.ts";
import { TERRAIN_COST_MULTIPLIER, TERRAIN_THRESHOLDS, WORLD_CONFIG } from "../game/config.ts";

export const TERRAIN_TYPES: readonly TerrainType[] = ["water", "coast", "plain", "hill", "mountain"];

export const TERRAIN_INDEX: Record<TerrainType, number> = {
  water: 0,
  coast: 1,
  plain: 2,
  hill: 3,
  mountain: 4,
};

export type { GeographyStyle };

/** 格線以索引儲存地形，供快速查詢。 */
class ValueNoise {
  private size: number;
  private lattice: Float32Array;

  constructor(rng: Rng, size = 64) {
    this.size = size;
    this.lattice = new Float32Array(size * size);
    for (let i = 0; i < this.lattice.length; i++) {
      this.lattice[i] = rng.next();
    }
  }

  /** 以雙線性內插（含環繞）取樣 [0,1) 的格子座標。 */
  sample(x: number, y: number): number {
    const s = this.size;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = smoothstep(0, 1, x - xi);
    const ty = smoothstep(0, 1, y - yi);
    const x0 = ((xi % s) + s) % s;
    const y0 = ((yi % s) + s) % s;
    const x1 = (x0 + 1) % s;
    const y1 = (y0 + 1) % s;
    const v00 = this.lattice[y0 * s + x0] as number;
    const v10 = this.lattice[y0 * s + x1] as number;
    const v01 = this.lattice[y1 * s + x0] as number;
    const v11 = this.lattice[y1 * s + x1] as number;
    const a = v00 + (v10 - v00) * tx;
    const b = v01 + (v11 - v01) * tx;
    return a + (b - a) * ty;
  }
}

function fbm(noise: ValueNoise, x01: number, y01: number, octaves: number, frequency: number, persistence: number): number {
  let amp = 1;
  let freq = frequency;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise.sample(x01 * freq, y01 * freq);
    norm += amp;
    amp *= persistence;
    freq *= 2.03;
  }
  return sum / norm;
}

function classify(elevation: number): number {
  if (elevation < TERRAIN_THRESHOLDS.water) {
    return TERRAIN_INDEX.water;
  }
  if (elevation < TERRAIN_THRESHOLDS.coast) {
    return TERRAIN_INDEX.coast;
  }
  if (elevation < TERRAIN_THRESHOLDS.plain) {
    return TERRAIN_INDEX.plain;
  }
  if (elevation < TERRAIN_THRESHOLDS.hill) {
    return TERRAIN_INDEX.hill;
  }
  return TERRAIN_INDEX.mountain;
}

const STYLE_ORDER: readonly GeographyStyle[] = ["continent", "island", "mainland", "strait"];

/**
 * 依權重挑選地理樣式（可重現）。
 * 即使玩家指定樣式，也會消耗同一個亂數抽樣，讓「指定樣式」與「自動抽到同款式」
 * 產生完全相同的世界。
 */
export function pickGeographyStyle(rng: Rng, override?: GeographyStyle): GeographyStyle {
  const weights = WORLD_CONFIG.geographyWeights;
  const index = rng.weightedIndex([
    weights.continent,
    weights.island,
    weights.mainland,
    weights.strait,
  ]);
  const picked = STYLE_ORDER[index] ?? "continent";
  return override ?? picked;
}

interface IslandParams {
  kind: "island";
}

interface MainlandParams {
  kind: "mainland";
  /** 海洋所在的一邊：0 = 南、1 = 東、2 = 北、3 = 西。 */
  coastSide: number;
  shoreline: number;
  wobble: number;
}

interface StraitParams {
  kind: "strait";
  /** 海峽方向：true = 垂直（南北向海峽）。 */
  vertical: boolean;
  channelCenter: number;
  channelWidth: number;
  wobble: number;
}

interface ContinentParams {
  kind: "continent";
  /** 內灣（選用）：-1 = 無；0 = 南、1 = 東、2 = 北、3 = 西。 */
  baySide: number;
  bayDepth: number;
  bayWidth: number;
  bayWobble: number;
  /** 湖泊門檻（比預設低 → 更大、更多的內陸湖）。 */
  lakeThreshold: number;
}

type GeographyParams = IslandParams | MainlandParams | StraitParams | ContinentParams;

/** 依樣式計算該座標的「陸地遮罩」：1 = 內陸、0 = 海洋。 */
function landMask(params: GeographyParams, x01: number, y01: number, wobbleNoise: ValueNoise): number {
  if (params.kind === "island") {
    const nx = x01 * 2 - 1;
    const ny = y01 * 2 - 1;
    const d = Math.sqrt((nx * 0.92) ** 2 + (ny * 1.05) ** 2);
    return smoothstep(1.12, 0.3, d);
  }

  const wobble = (wobbleNoise.sample(x01 * 2.3 + 13, y01 * 2.3 + 7) - 0.5) * 2;

  if (params.kind === "continent") {
    // 廣闊內陸：絕大部分是陸地；選用一個向內凹陷的內灣，其餘靠湖泊增添變化。
    if (params.baySide < 0) {
      return 1;
    }
    const towardSea =
      params.baySide === 0
        ? y01
        : params.baySide === 1
          ? x01
          : params.baySide === 2
            ? 1 - y01
            : 1 - x01;
    const perp = params.baySide === 0 || params.baySide === 2 ? x01 : y01;
    const center = 0.5 + wobble * 0.18;
    const widthFactor = smoothstep(
      params.bayWidth * 0.5,
      params.bayWidth * 0.5 - 0.2,
      Math.abs(perp - center),
    );
    const depth = smoothstep(params.bayDepth - 0.08, params.bayDepth + 0.08, towardSea);
    return 1 - depth * widthFactor;
  }

  if (params.kind === "mainland") {
    // 朝海岸邊的座標：海洋側為 1，往內陸遞減。
    const towardSea =
      params.coastSide === 0
        ? y01
        : params.coastSide === 1
          ? x01
          : params.coastSide === 2
            ? 1 - y01
            : 1 - x01;
    const shore = params.shoreline + wobble * params.wobble;
    return smoothstep(shore + 0.05, shore - 0.15, towardSea);
  }

  // strait：海峽遮罩 × 兩塊大陸各自的橢圓衰減。
  const along = params.vertical ? x01 : y01;
  const across = params.vertical ? y01 : x01;
  const line = params.channelCenter + wobble * params.wobble;
  const halfWidth = params.channelWidth / 2;
  const distanceToChannel = Math.abs(along - line);
  const channelMask = smoothstep(halfWidth * 0.55, halfWidth * 1.2, distanceToChannel);

  const lobe = (center: number, half: number): number => {
    if (half <= 0.02) {
      return 0;
    }
    const u = (along - center) / half;
    const v = (across - 0.5) / 0.5;
    const d = Math.sqrt((u * 0.95) ** 2 + (v * 1.05) ** 2);
    return smoothstep(1.14, 0.32, d);
  };
  const lobeMask =
    along < line ? lobe(line / 2, line / 2) : lobe((line + 1) / 2, (1 - line) / 2);
  return Math.min(channelMask, lobeMask);
}

function buildGrid(
  primary: ValueNoise,
  lakeNoise: ValueNoise,
  wobbleNoise: ValueNoise,
  params: GeographyParams,
): { data: Uint8Array; cols: number; rows: number; landRatio: number } {
  const { width, height, cellSize, noiseOctaves, noiseFrequency, noisePersistence } = WORLD_CONFIG;
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const data = new Uint8Array(cols * rows);
  let landCount = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x01 = (col + 0.5) / cols;
      const y01 = (row + 0.5) / rows;
      const raw = fbm(primary, x01, y01, noiseOctaves, noiseFrequency, noisePersistence);
      const mask = landMask(params, x01, y01, wobbleNoise);
      let elevation = clamp(raw * mask + (1 - mask) * 0.08, 0, 1);

      // 內陸湖泊：高度適中的地區若次要雜訊超過門檻，形成湖泊。
      const lakeThreshold =
        params.kind === "continent" ? params.lakeThreshold : WORLD_CONFIG.lakeThreshold;
      if (
        elevation > WORLD_CONFIG.lakeMinElevation &&
        elevation < WORLD_CONFIG.lakeMaxElevation
      ) {
        const lake = fbm(lakeNoise, x01, y01, 2, 6.5, 0.5);
        if (lake > lakeThreshold) {
          elevation = TERRAIN_THRESHOLDS.water - 0.02;
        }
      }

      const terrain = classify(elevation);
      data[row * cols + col] = terrain;
      if (terrain !== TERRAIN_INDEX.water) {
        landCount++;
      }
    }
  }

  return { data, cols, rows, landRatio: landCount / (cols * rows) };
}

/**
 * 產生地形格線。
 * 依 seed（或玩家指定的樣式）決定地理；陸地太少時會以固定序列重試。
 */
export function generateTerrain(rng: Rng, styleOverride?: GeographyStyle): TerrainGrid {
  const { width, height, cellSize, terrainAttempts, minLandRatio } = WORLD_CONFIG;
  let best: { data: Uint8Array; cols: number; rows: number; landRatio: number } | null = null;

  for (let attempt = 0; attempt < terrainAttempts; attempt++) {
    const attemptRng = attempt === 0 ? rng : rng.fork(`retry-${attempt}`);
    const style = pickGeographyStyle(attemptRng, styleOverride);
    const primary = new ValueNoise(attemptRng);
    const lakeNoise = new ValueNoise(attemptRng);
    const wobbleNoise = new ValueNoise(attemptRng);

    let params: GeographyParams;
    if (style === "island") {
      params = { kind: "island" };
    } else if (style === "mainland") {
      params = {
        kind: "mainland",
        coastSide: attemptRng.int(0, 3),
        shoreline: attemptRng.range(0.6, 0.78),
        wobble: attemptRng.range(0.05, 0.12),
      };
    } else if (style === "continent") {
      const hasBay = attemptRng.chance(0.55);
      params = {
        kind: "continent",
        baySide: hasBay ? attemptRng.int(0, 3) : -1,
        bayDepth: attemptRng.range(0.12, 0.3),
        bayWidth: attemptRng.range(0.32, 0.55),
        bayWobble: attemptRng.range(0.05, 0.14),
        lakeThreshold: attemptRng.range(0.64, 0.72),
      };
    } else {
      params = {
        kind: "strait",
        vertical: attemptRng.chance(0.5),
        channelCenter: attemptRng.range(0.44, 0.56),
        channelWidth: attemptRng.range(0.05, 0.09),
        wobble: attemptRng.range(0.03, 0.06),
      };
    }

    const grid = buildGrid(primary, lakeNoise, wobbleNoise, params);
    if (!best || grid.landRatio > best.landRatio) {
      best = grid;
    }
    if (grid.landRatio >= minLandRatio) {
      despeckle(grid.data, grid.cols, grid.rows);
      return { width, height, cellSize, cols: grid.cols, rows: grid.rows, data: grid.data };
    }
  }

  // 理論上不會發生（多數樣式陸地比例都遠高於門檻），保底使用最佳結果。
  const fallback = best as { data: Uint8Array; cols: number; rows: number };
  despeckle(fallback.data, fallback.cols, fallback.rows);
  return { width, height, cellSize, cols: fallback.cols, rows: fallback.rows, data: fallback.data };
}

/** 移除單格雜訊（孤島／單格水面），讓海岸更自然。 */
function despeckle(data: Uint8Array, cols: number, rows: number): void {
  const copy = data.slice();
  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      const idx = row * cols + col;
      const self = copy[idx] as number;
      const isWaterSelf = self === TERRAIN_INDEX.water;
      let sameAsSelf = 0;
      let allWater = true;
      let allLand = true;
      const neighbors = [idx - 1, idx + 1, idx - cols, idx + cols];
      for (const n of neighbors) {
        const v = copy[n] as number;
        if (v === self) {
          sameAsSelf++;
        }
        if (v === TERRAIN_INDEX.water) {
          allLand = false;
        } else {
          allWater = false;
        }
      }
      if (sameAsSelf === 0 && isWaterSelf && allLand) {
        data[idx] = TERRAIN_INDEX.coast;
      } else if (sameAsSelf === 0 && !isWaterSelf && allWater) {
        data[idx] = TERRAIN_INDEX.water;
      }
    }
  }
}

export function terrainAtIndex(grid: TerrainGrid, index: number): TerrainType {
  return (TERRAIN_TYPES[grid.data[index] as number] ?? "water") as TerrainType;
}

/** 取得指定世界座標的地形（超出範圍視為水域）。 */
export function terrainAtPoint(grid: TerrainGrid, p: Point): TerrainType {
  const col = Math.floor(p.x / grid.cellSize);
  const row = Math.floor(p.y / grid.cellSize);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) {
    return "water";
  }
  return terrainAtIndex(grid, row * grid.cols + col);
}

export function isWaterTerrain(t: TerrainType): boolean {
  return t === "water";
}

/** 取樣一條線段沿線的平均地形成本倍率。 */
export function sampleTerrainMultiplier(
  grid: TerrainGrid,
  a: Point,
  b: Point,
  table: Record<TerrainType, number> = TERRAIN_COST_MULTIPLIER,
): number {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const samples = clamp(Math.ceil(length / 22), 6, 40);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    sum += table[terrainAtPoint(grid, p)];
  }
  return sum / samples;
}

/**
 * 在指定點附近尋找陸地（非水域）位置。
 * 找不到時回傳 null。
 */
export function findLandNear(grid: TerrainGrid, p: Point, maxRadius: number): Point | null {
  const step = grid.cellSize / 2;
  for (let r = 0; r <= maxRadius; r += step) {
    const ringCount = r === 0 ? 1 : Math.max(8, Math.floor(TAU_RING(r)));
    for (let i = 0; i < ringCount; i++) {
      const angle = (i / ringCount) * Math.PI * 2;
      const candidate = { x: p.x + Math.cos(angle) * r, y: p.y + Math.sin(angle) * r };
      const t = terrainAtPoint(grid, candidate);
      if (t !== "water") {
        return candidate;
      }
    }
  }
  return null;
}

function TAU_RING(radius: number): number {
  return (radius * Math.PI) / 12;
}
