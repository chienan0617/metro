/**
 * 生態域圖磚快取（讓地圖保持銳利）。
 * 地形以世界座標切塊，每塊只算一次並快取成點陣圖：
 *   - far 層：1024 世界單位／256px（縮小檢視用）
 *   - near 層：512 世界單位／512px（放大檢視用，1 單位／像素）
 * 缺失的圖磚以時間預算分批建立（每幀最多數毫秒），畫面先顯示快速底層、
 * 完成後換上銳利圖磚，不會阻塞操作。
 */

import type { Point } from "../../core/types.ts";
import { BIOME_RGB, type BiomeSample } from "../../world/biomes.ts";

export interface BiomeChunkLevel {
  chunkUnits: number;
  pixels: number;
}

export const FAR_LEVEL: BiomeChunkLevel = { chunkUnits: 1024, pixels: 256 };
export const NEAR_LEVEL: BiomeChunkLevel = { chunkUnits: 512, pixels: 512 };

/**
 * 地貌陰影（立體感）參數。
 * 以光源來自西北方的坡向明暗計算：坡度以「世界單位」為基準，
 * 因此不同縮放層級的立體感一致（不會拉遠就變平或過強）。
 */
export const RELIEF_STRENGTH = 26_000;
export const RELIEF_CLAMP = 26;
export const ALTITUDE_TINT = 20;

/** 依坡度（世界單位）計算單顆像素的地貌陰影量，已夾在合理範圍。 */
export function reliefShade(westEast: number, northSouth: number, worldPerPixel: number): number {
  const value = ((westEast + 0.7 * northSouth) * RELIEF_STRENGTH) / (2 * worldPerPixel);
  return value < -RELIEF_CLAMP ? -RELIEF_CLAMP : value > RELIEF_CLAMP ? RELIEF_CLAMP : value;
}

interface QueuedChunk {
  level: BiomeChunkLevel;
  cx: number;
  cy: number;
  priority: number;
}

export class BiomeChunkCache {
  private far = new Map<string, HTMLCanvasElement>();
  private near = new Map<string, HTMLCanvasElement>();
  private pending = new Set<string>();
  private queue: QueuedChunk[] = [];
  private readonly farLimit = 140;
  private readonly nearLimit = 28;

  /** 取得圖磚；不存在時排入佇列並回傳 null。priority 為距離相機的螢幕距離。 */
  request(level: BiomeChunkLevel, cx: number, cy: number, priority: number): HTMLCanvasElement | null {
    const map = level === FAR_LEVEL ? this.far : this.near;
    const key = `${cx},${cy}`;
    const cached = map.get(key);
    if (cached) {
      return cached;
    }
    const queueKey = `${level.chunkUnits}|${key}`;
    if (!this.pending.has(queueKey)) {
      this.pending.add(queueKey);
      this.queue.push({ level, cx, cy, priority });
      this.queue.sort((a, b) => a.priority - b.priority);
    }
    return null;
  }

  /** 清空（更換世界時使用）。 */
  clear(): void {
    this.far.clear();
    this.near.clear();
    this.pending.clear();
    this.queue.length = 0;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get cachedCount(): number {
    return this.far.size + this.near.size;
  }

  /** 以時間預算建立佇列中的圖磚；回傳是否有任何圖磚完成。 */
  buildBudget(
    sampler: { sampleAt(p: Point): BiomeSample },
    budgetMs: number,
  ): boolean {
    if (this.queue.length === 0) {
      return false;
    }
    const start = performance.now();
    let built = false;
    while (this.queue.length > 0 && performance.now() - start < budgetMs) {
      const item = this.queue.shift() as QueuedChunk;
      built = this.buildChunk(sampler, item) || built;
    }
    return built;
  }

  private buildChunk(
    sampler: { sampleAt(p: Point): BiomeSample },
    item: QueuedChunk,
  ): boolean {
    const { level, cx, cy } = item;
    const key = `${cx},${cy}`;
    const map = level === FAR_LEVEL ? this.far : this.near;
    const queueKey = `${level.chunkUnits}|${key}`;
    this.pending.delete(queueKey);
    if (map.has(key)) {
      return false;
    }

    const { chunkUnits, pixels } = level;
    const canvas = document.createElement("canvas");
    canvas.width = pixels;
    canvas.height = pixels;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return false;
    }
    const image = ctx.createImageData(pixels, pixels);
    const data = image.data;
    const unitPerPixel = chunkUnits / pixels;
    const originX = cx * chunkUnits;
    const originY = cy * chunkUnits;
    // 先存高度，第二遍再以鄰居坡度計算地貌陰影。
    const elevations = new Float32Array(pixels * pixels);

    for (let py = 0; py < pixels; py++) {
      const wy = originY + (py + 0.5) * unitPerPixel;
      for (let px = 0; px < pixels; px++) {
        const wx = originX + (px + 0.5) * unitPerPixel;
        const sample = sampler.sampleAt({ x: wx, y: wy });
        elevations[py * pixels + px] = sample.elevation;
        const rgb = BIOME_RGB[sample.biome];
        const shade = (sample.elevation - 0.5) * ALTITUDE_TINT;
        const index = (py * pixels + px) * 4;
        data[index] = clampByte((rgb[0] as number) + shade);
        data[index + 1] = clampByte((rgb[1] as number) + shade);
        data[index + 2] = clampByte((rgb[2] as number) + shade);
        data[index + 3] = 255;
      }
    }

    // 地貌陰影：光源在西北方（左上方較亮 = 向光坡）。
    for (let py = 1; py < pixels - 1; py++) {
      for (let px = 1; px < pixels - 1; px++) {
        const i = py * pixels + px;
        const relief = reliefShade(
          (elevations[i - 1] as number) - (elevations[i + 1] as number),
          (elevations[i - pixels] as number) - (elevations[i + pixels] as number),
          unitPerPixel,
        );
        if (relief === 0) {
          continue;
        }
        const index = i * 4;
        data[index] = clampByte((data[index] as number) + relief);
        data[index + 1] = clampByte((data[index + 1] as number) + relief);
        data[index + 2] = clampByte((data[index + 2] as number) + relief);
      }
    }
    ctx.putImageData(image, 0, 0);

    map.set(key, canvas);
    // 簡單的容量控制：超過上限時移除最舊的項目。
    const limit = level === FAR_LEVEL ? this.farLimit : this.nearLimit;
    while (map.size > limit) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      map.delete(oldest);
    }
    return true;
  }
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}
