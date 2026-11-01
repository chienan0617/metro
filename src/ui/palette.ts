/** 地圖與面板共用的色彩定義。 */

import type { CityType, TerrainType } from "../core/types.ts";

/** 地形顏色（RGB，供地形快取點陣圖使用）。 */
export const TERRAIN_RGB: Record<TerrainType, readonly [number, number, number]> = {
  water: [12, 34, 54],
  coast: [56, 78, 64],
  plain: [41, 58, 48],
  hill: [52, 68, 52],
  mountain: [72, 82, 69],
};

/** 地形顏色（CSS 色票，供圖例使用）。 */
export const TERRAIN_CSS: Record<TerrainType, string> = {
  water: "#0c2236",
  coast: "#384e40",
  plain: "#293a30",
  hill: "#344434",
  mountain: "#485245",
};

export const TERRAIN_LABELS: Record<TerrainType, string> = {
  water: "水域",
  coast: "海岸",
  plain: "平原",
  hill: "丘陵",
  mountain: "山地",
};

/** 城市類型代表色（標記與圖例共用）。 */
export const CITY_COLORS: Record<CityType, string> = {
  capital: "#ffb454",
  port: "#56b8e8",
  industrial: "#b09af0",
  university: "#5fd39a",
  tourism: "#f386c0",
  satellite: "#9fb0c3",
  town: "#c8d3de",
};

export const MAP_BACKGROUND = "#0a1a28";

/** 產業別顯示名稱與顏色（城市面板的產業結構長條圖）。 */
export const INDUSTRY_LABELS = {
  residential: "住宅",
  commercial: "商業",
  industrial: "工業",
  education: "教育",
  tourism: "觀光",
} as const;

export const INDUSTRY_COLORS = {
  residential: "#6ea8fe",
  commercial: "#f2b23c",
  industrial: "#b09af0",
  education: "#5fd39a",
  tourism: "#f386c0",
} as const;
