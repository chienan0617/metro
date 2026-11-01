/**
 * 程序化城市命名：由生態域決定字詞風格，組合出自然的中文地名。
 * 無限世界需要無限的名字，因此採「修飾字 × 主體字」組合（含生態域專屬字池）。
 */

import { Rng } from "../core/rng.ts";
import type { BiomeId } from "../core/types.ts";

const MODIFIERS: readonly string[] = [
  "北", "南", "東", "西", "新", "大", "碧", "青", "白", "金", "翠", "銀",
  "雲", "星", "松", "楓", "竹", "梅", "海", "山", "河", "湖", "清", "明",
  "龍", "鳳", "晨", "暮", "晴", "綠", "藍", "丹", "秋", "春", "靜", "遠",
  "廣", "長", "永", "安", "和", "興", "隆", "昌", "盛", "福", "瑞", "祥",
  "吉", "嘉", "寶", "順", "泰", "平", "樂", "豐", "紫", "橙", "黃", "翠",
];

const COMMON_CORES: readonly string[] = [
  "原", "川", "城", "丘", "溪", "林", "谷", "橋", "坪", "洲", "塘", "園",
  "庄", "坡", "石", "野", "泉", "潭", "州", "邑", "埔", "岡", "崙", "坑",
  "澳", "畔", "嶼", "隴", "埕", "寮",
];

const BIOME_CORES: Partial<Record<BiomeId, readonly string[]>> = {
  beach: ["灣", "港", "沙", "濱", "潮", "礁"],
  snow: ["雪", "霜", "冰", "寒", "嶺"],
  desert: ["沙", "漠", "礫", "陽", "丘"],
  forest: ["林", "森", "杉", "樟", "楠"],
  taiga: ["杉", "松", "嶺", "麓"],
  jungle: ["雨", "藤", "溪", "葉"],
  swamp: ["澤", "沼", "蘆", "塘"],
  hills: ["丘", "坡", "嶺", "坪"],
  mountain: ["峰", "嶺", "岩", "隘", "磐"],
  peaks: ["峰", "頂", "雪", "壁"],
  savanna: ["野", "莽", "草", "原"],
  plains: ["原", "野", "田", "禾", "畈"],
};

/** 產生一個符合生態域風格的城市名（不含市／鎮後綴）。 */
export function generateCityName(rng: Rng, biome: BiomeId): string {
  const modifiers = MODIFIERS;
  const cores = [...(BIOME_CORES[biome] ?? []), ...COMMON_CORES];
  return `${rng.pick(modifiers)}${rng.pick(cores)}`;
}
