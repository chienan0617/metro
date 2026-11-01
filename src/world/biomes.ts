/**
 * 生態域系統（類似 Minecraft 的做法）：
 * 用多個柏林雜訊場（大陸度、高度細節、溫度、濕度）決定地形與生態域。
 * 所有場都是無限域的純函式，同一 seed + 座標必定得到相同結果。
 */

import { PerlinNoise } from "../core/noise.ts";
import type { BiomeId, CityType, TerrainType } from "../core/types.ts";
import { clamp } from "../core/math.ts";

export type { BiomeId };

export type MapStyle = "auto" | "continent" | "islands";

export interface BiomeSample {
  elevation: number;
  temperature: number;
  humidity: number;
  biome: BiomeId;
  terrain: TerrainType;
}

/** 高度門檻（0 - 1）。 */
const SEA_LEVEL = 0.47;
const BEACH_TOP = 0.505;
const PLAIN_TOP = 0.6;
const HILL_TOP = 0.7;

const CONTINENTAL_SCALE = 1700;
const RIDGE_SCALE = 540;
const TEMP_SCALE = 2900;
const HUMID_SCALE = 2400;

export class BiomeFields {
  private continental: PerlinNoise;
  private ridge: PerlinNoise;
  private temperature: PerlinNoise;
  private humidity: PerlinNoise;
  private styleBias: number;

  constructor(seed: number, style: MapStyle) {
    this.continental = new PerlinNoise(seed ^ 0x1a2b3c4d);
    this.ridge = new PerlinNoise(seed ^ 0x11223344);
    this.temperature = new PerlinNoise(seed ^ 0x77aa88cc);
    this.humidity = new PerlinNoise(seed ^ 0x4b5c6d7e);
    this.styleBias = style === "continent" ? 0.2 : style === "islands" ? -0.2 : 0;
  }

  elevation(x: number, y: number): number {
    // 單一多頻率 fbm：低頻大陸度 + 高頻地形細節合併，降低取樣成本。
    const base = this.continental.fbm(x / CONTINENTAL_SCALE, y / CONTINENTAL_SCALE, 5, 2.35, 0.42);
    let e = 0.5 + (base + this.styleBias) * 0.5;
    // 高地區域疊加脊狀雜訊，形成山脈稜線。
    const ridge = this.ridge.ridged(x / RIDGE_SCALE, y / RIDGE_SCALE, 2);
    const ridgeBoost = clamp((e - 0.52) * 2.2, 0, 1) * (ridge - 0.45);
    e += Math.max(0, ridgeBoost) * 0.5;
    return clamp(e, 0, 1);
  }

  temperatureAt(x: number, y: number): number {
    const base = this.temperature.fbm(x / TEMP_SCALE, y / TEMP_SCALE, 3, 2.6, 0.45);
    return clamp(0.5 + base * 0.5, 0, 1);
  }

  humidityAt(x: number, y: number): number {
    const base = this.humidity.fbm(x / HUMID_SCALE, y / HUMID_SCALE, 3, 2.6, 0.45);
    return clamp(0.5 + base * 0.5, 0, 1);
  }

  sample(x: number, y: number): BiomeSample {
    const elevation = this.elevation(x, y);
    const temperature = this.temperatureAt(x, y);
    const humidity = this.humidityAt(x, y);
    const biome = classifyBiome(elevation, temperature, humidity);
    return { elevation, temperature, humidity, biome, terrain: terrainForElevation(elevation) };
  }
}

function terrainForElevation(elevation: number): TerrainType {
  if (elevation < SEA_LEVEL) {
    return "water";
  }
  if (elevation < BEACH_TOP) {
    return "coast";
  }
  if (elevation < PLAIN_TOP) {
    return "plain";
  }
  if (elevation < HILL_TOP) {
    return "hill";
  }
  return "mountain";
}

function classifyBiome(elevation: number, temperature: number, humidity: number): BiomeId {
  if (elevation < SEA_LEVEL) {
    return elevation < SEA_LEVEL - 0.07 ? "deep_ocean" : "ocean";
  }
  if (elevation < BEACH_TOP) {
    return temperature < 0.3 ? "snow" : "beach";
  }
  if (elevation >= 0.8) {
    return "peaks";
  }
  if (elevation >= HILL_TOP) {
    if (temperature < 0.32) {
      return "snow";
    }
    return temperature < 0.45 ? "taiga" : "mountain";
  }
  if (elevation >= PLAIN_TOP) {
    if (temperature < 0.3) {
      return "snow";
    }
    if (temperature < 0.42) {
      return "taiga";
    }
    if (temperature > 0.66 && humidity < 0.4) {
      return "desert";
    }
    if (humidity > 0.72) {
      return "forest";
    }
    return "hills";
  }

  // 低地：依溫度與濕度決定氣候生態域。
  if (temperature < 0.3) {
    return humidity > 0.45 ? "taiga" : "snow";
  }
  if (temperature < 0.46) {
    if (humidity > 0.62) {
      return "taiga";
    }
    return humidity > 0.36 ? "forest" : "plains";
  }
  if (temperature < 0.62) {
    if (humidity > 0.72) {
      return elevation < 0.53 ? "swamp" : "forest";
    }
    if (humidity > 0.42) {
      return "forest";
    }
    return humidity > 0.24 ? "plains" : "savanna";
  }
  if (temperature < 0.74) {
    if (humidity > 0.62) {
      return "jungle";
    }
    return humidity > 0.34 ? "savanna" : "desert";
  }
  if (humidity > 0.55) {
    return "jungle";
  }
  return humidity > 0.3 ? "savanna" : "desert";
}

/** 生態域在地圖上的顏色（RGB）。 */
export const BIOME_RGB: Record<BiomeId, readonly [number, number, number]> = {
  deep_ocean: [15, 27, 48],
  ocean: [21, 42, 74],
  beach: [150, 136, 96],
  plains: [84, 112, 66],
  forest: [54, 86, 52],
  jungle: [38, 82, 48],
  savanna: [128, 122, 68],
  desert: [168, 150, 100],
  swamp: [58, 76, 58],
  taiga: [64, 92, 80],
  snow: [186, 194, 204],
  hills: [96, 106, 76],
  mountain: [108, 102, 92],
  peaks: [206, 212, 220],
};

export const BIOME_LABELS: Record<BiomeId, string> = {
  deep_ocean: "深海",
  ocean: "海洋",
  beach: "海岸",
  plains: "平原",
  forest: "森林",
  jungle: "熱帶雨林",
  savanna: "莽原",
  desert: "沙漠",
  swamp: "濕地",
  taiga: "針葉林",
  snow: "雪原",
  hills: "丘陵",
  mountain: "山地",
  peaks: "高山",
};

/** BMI：各生態域的氣候資訊（供城市面板顯示）。 */
export function biomeClimateLabel(sample: { temperature: number; humidity: number }): string {
  const tempLabels = ["寒冷", "涼爽", "溫和", "溫暖", "炎熱"];
  const humidLabels = ["乾燥", "偏乾", "適中", "潮濕", "多雨"];
  const t = Math.min(4, Math.floor(sample.temperature * 5));
  const h = Math.min(4, Math.floor(sample.humidity * 5));
  return `${(tempLabels[t] as string) }・${(humidLabels[h] as string)}`;
}

/** 各生態域適合的城市類型權重（程序化生成城市時使用）。 */
export const BIOME_CITY_WEIGHTS: Record<BiomeId, Partial<Record<CityType, number>>> = {
  deep_ocean: {},
  ocean: {},
  beach: { port: 0.5, tourism: 0.2, town: 0.2, satellite: 0.1 },
  plains: { satellite: 0.24, town: 0.22, industrial: 0.16, university: 0.16, capital: 0.14, tourism: 0.08 },
  forest: { satellite: 0.2, town: 0.24, university: 0.2, industrial: 0.1, tourism: 0.14, capital: 0.12 },
  jungle: { town: 0.3, tourism: 0.28, university: 0.14, satellite: 0.28 },
  savanna: { town: 0.28, satellite: 0.24, industrial: 0.18, tourism: 0.16, university: 0.14 },
  desert: { industrial: 0.34, town: 0.28, satellite: 0.22, tourism: 0.16 },
  swamp: { town: 0.38, industrial: 0.24, satellite: 0.22, tourism: 0.16 },
  taiga: { town: 0.32, industrial: 0.18, tourism: 0.22, university: 0.12, satellite: 0.16 },
  snow: { town: 0.36, tourism: 0.32, industrial: 0.14, satellite: 0.18 },
  hills: { tourism: 0.24, town: 0.22, university: 0.2, satellite: 0.2, industrial: 0.14 },
  mountain: { tourism: 0.46, town: 0.3, industrial: 0.1, satellite: 0.14 },
  peaks: { tourism: 0.55, town: 0.3, satellite: 0.15 },
};
