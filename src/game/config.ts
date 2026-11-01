/**
 * 遊戲平衡與世界設定集中管理。
 * 所有經濟、世界生成與路線參數都必須放在這裡，不可散落在各系統或 UI 中。
 */

import type { CityType, EventKind, IndustryMix, TerrainType } from "../core/types.ts";

export const SAVE_VERSION = 3;

/** 預設地圖種子（固定，確保每位玩家第一次遊玩的區域一致）。 */
export const DEFAULT_SEED = 20261030;

export const WORLD_CONFIG = {
  width: 7200,
  height: 4800,
  cellSize: 36,
  /** 城市群（區域）數量。 */
  regionCount: 10,
  /** 城市之間的最小距離（世界單位）。 */
  minCityDistance: 220,
  /** 城市與地圖邊界的最小距離。 */
  borderMargin: 340,
  /** 每個區域的衛星城市數量範圍。 */
  satellitesPerRegion: [2, 4] as const,
  /** 區域核心城市之間的最小距離。 */
  minCoreDistance: 1000,
  /** 衛星城市與核心城市的距離範圍。 */
  satelliteDistance: [260, 620] as const,
  /** 遠距城市與其他城市的最小距離。 */
  remoteMinDistance: 800,
  /** 遠距城市填充目標（總城市數上限由 cityCountRange 控制）。 */
  remoteTarget: 46,
  /** 城市總數目標範圍（生成後檢查）。 */
  cityCountRange: [32, 52] as const,
  noiseOctaves: 4,
  noiseFrequency: 3.4,
  noisePersistence: 0.52,
  /**
   * 地理樣式權重：內陸大陸、海島、大陸海岸、海峽雙陸。
   * 由 seed 決定，同一 seed 產生相同地理（玩家也可在選單直接指定）。
   */
  geographyWeights: { continent: 0.34, island: 0.2, mainland: 0.28, strait: 0.18 },
  /** 內陸湖泊：次要雜訊高於門檻且高度適中時形成湖泊。 */
  lakeThreshold: 0.8,
  lakeMinElevation: 0.4,
  lakeMaxElevation: 0.6,
  /** 地形重新嘗試的陸地比例下限（避免極端地形讓城市無法放置）。 */
  minLandRatio: 0.38,
  terrainAttempts: 3,
} as const;

/** 地形分類門檻（依高度值）。 */
export const TERRAIN_THRESHOLDS = {
  water: 0.3,
  coast: 0.365,
  plain: 0.62,
  hill: 0.79,
} as const;

/** 各地形的路線建設成本倍率。 */
export const TERRAIN_COST_MULTIPLIER: Record<TerrainType, number> = {
  water: 3.6,
  coast: 1.25,
  plain: 1.0,
  hill: 1.7,
  mountain: 2.9,
};

/** 建設方式倍率（第一版僅地面，保留欄位以便擴充高架／地下）。 */
export const BUILD_TYPE_MULTIPLIER = {
  surface: 1.0,
  elevated: 1.8,
  underground: 2.6,
} as const;

export const ECONOMY_CONFIG = {
  /** 生涯模式的起始資金。 */
  startingMoney: 2_600_000,
  /** 自由經營模式的起始資金。 */
  freeStartingMoney: 6_500_000,
  /** 每公里軌道基礎建設成本（世界單位 = 公里；地圖放大後單位成本調降）。 */
  trackCostPerUnit: 340,
  /** 公司科技建設成本倍率（Phase 4 研究可降低，最低 0.6）。 */
  techCostMultiplier: 1.0,
  /** 比較列車單程時間的參考時速（km/h），用於路線預覽估算。 */
  referenceSpeedKmh: 75,
  /** 每站停靠時間（遊戲分鐘），用於路線預覽估算。 */
  dwellMinutes: 0.5,
  /** 財務紀錄保留上限。 */
  ledgerMaxEntries: 400,
} as const;

/** 乘客需求（重力模型）與票價設定。 */
export const DEMAND_CONFIG = {
  /** 每小時基礎出行量係數（百萬人以下城市的流量尺度）。 */
  baseTripsPerHour: 4.2,
  /** 人口指數（凹陷：大城市間出行不成比例增長）。 */
  populationExponent: 0.85,
  /** 距離阻抗：1 + (距離 / refDistance)^power（地圖放大後同步調高）。 */
  refDistance: 260,
  impedancePower: 1.55,
  /** 各城市類型的產生／吸引權重。 */
  typeTripWeight: {
    capital: 1.3,
    port: 1.15,
    industrial: 1.05,
    university: 1.0,
    tourism: 0.95,
    satellite: 0.95,
    town: 0.7,
  } as Record<CityType, number>,
  /** 目的地吸引權重（工作與商業機會）。 */
  attractionWeights: {
    residential: 0.2,
    commercial: 0.5,
    industrial: 0.25,
    education: 0.2,
    tourism: 0.25,
  },
  /** 每小時的時段倍率（索引 0 - 23 時）。 */
  hourlyFactors: [
    0.15, 0.1, 0.08, 0.08, 0.1, 0.2, 0.5, 1.1, 1.5, 1.3, 0.9, 0.85, 0.9, 0.85, 0.8, 0.85, 1.2,
    1.5, 1.3, 0.9, 0.7, 0.5, 0.35, 0.2,
  ] as readonly number[],
  /** 假日（週六日）的整體倍率。 */
  weekendFactor: 0.82,
  /** 假日對觀光城市的加成。 */
  weekendTourismBonus: 1.6,
  /** 服務滿意度對需求的影響範圍（最低／最高倍率）。 */
  satisfactionRange: [0.85, 1.15] as const,
  /** 車站候車時間的評估上限（分鐘），避免無限等待低估。 */
  maxWaitMinutes: 45,
} as const;

export const FARE_CONFIG = {
  /** 起跳票價。 */
  baseFare: 35,
  /** 每公里票價。 */
  farePerKm: 0.6,
  /** 最低票價。 */
  minFare: 40,
} as const;

/** 車站營運成本與商業收入（每日）。 */
export const STATION_ECONOMY = {
  baseCostPerDay: 900,
  /** 尚未連接路線的車站：僅收取場地維護費。 */
  idleCostPerDay: 120,
  costPerLevel: 500,
  baseCommercialIncome: 1_400,
  commercialPerLevel: 1_100,
  /** 車站升級費用（升到等級 2、3 的價格）。 */
  upgradeCosts: [160_000, 260_000] as const,
  maxLevel: 3,
  /** 升級後的容量與滿意度效果。 */
  capacityMultiplierPerLevel: 1.6,
  satisfactionBonusPerLevel: 6,
} as const;

/** 公司等級：累計經驗值門檻（索引 = 等級 - 1）。 */
export const LEVEL_XP_THRESHOLDS: readonly number[] = [
  0, 500, 1_500, 3_200, 5_800, 9_500, 15_000, 22_000, 32_000,
];
/** 每服務一名乘客獲得的經驗值。 */
export const XP_PER_PASSENGER = 0.12;

/** 城市解鎖等級（依與起始核心城市的距離分級）。 */
export const CITY_UNLOCK_TIERS = {
  radius1: 700,
  radius2: 1_300,
  radius3: 1_900,
  radius4: 2_600,
  levels: [0, 2, 3, 4, 5] as readonly number[],
} as const;

/** 科技研究（三條研究線，各三階）。 */
export const RESEARCH_CONFIG = {
  lines: [
    {
      line: "train" as const,
      label: "列車技術",
      tiers: [
        { label: "輕量化車體", cost: 150_000, days: 3, effect: "列車容量 +6%、速度 +3%、能源 -5%" },
        { label: "再生制動", cost: 380_000, days: 6, effect: "列車容量 +12%、速度 +6%、能源 -10%" },
        { label: "新一代牽引系統", cost: 780_000, days: 10, effect: "列車容量 +18%、速度 +9%、能源 -15%" },
      ],
    },
    {
      line: "station" as const,
      label: "車站技術",
      tiers: [
        { label: "月台門與導引", cost: 140_000, days: 3, effect: "車站容量 +15%、商業收入 +30%" },
        { label: "轉乘動線優化", cost: 360_000, days: 6, effect: "車站容量 +30%、商業收入 +60%" },
        { label: "智慧車站系統", cost: 720_000, days: 10, effect: "車站容量 +45%、商業收入 +90%" },
      ],
    },
    {
      line: "operation" as const,
      label: "營運技術",
      tiers: [
        { label: "標準化施工", cost: 160_000, days: 3, effect: "建設成本 -8%、維護費 -6%" },
        { label: "動態調度", cost: 400_000, days: 6, effect: "建設成本 -16%、維護費 -12%" },
        { label: "全自動營運", cost: 800_000, days: 10, effect: "建設成本 -24%、維護費 -18%" },
      ],
    },
  ],
  /** 研究需要的最低公司等級。 */
  minLevel: 2,
} as const;

/** 列車升級（每輛列車最高等級 3）。 */
export const TRAIN_UPGRADE_CONFIG = {
  maxLevel: 3,
  /** 每級升級費用 = 原價 × 比例 × 目標等級。 */
  costRatio: 0.28,
  capacityPerLevel: 0.15,
  speedPerLevel: 0.05,
  energyReductionPerLevel: 0.08,
} as const;

/** 任務系統。 */
export const MISSION_CONFIG = {
  /** 完成任務的基礎獎勵。 */
  baseRewardMoney: 120_000,
  baseRewardXp: 220,
  /** 旅客目標的最低數量。 */
  minPassengerTarget: 600,
  /** 路線總長目標增量（公里）。 */
  lengthTargetStep: 180,
} as const;

/** 隨機事件。 */
export const EVENT_CONFIG = {
  maxActive: 3,
  /** 每日擲骰後開始新事件的機率。 */
  dailyChance: 0.4,
  /** 事件期間（天）。 */
  durations: {
    exhibition: [2, 4],
    semester: [10, 16],
    festival: [3, 5],
    energy_price: [5, 9],
    station_works: [3, 6],
    city_boom: [8, 14],
  } as Record<EventKind, readonly [number, number]>,
} as const;

/** 城市成長。 */
export const GROWTH_CONFIG = {
  /** 一年（336 天）的日成長換算。 */
  daysPerYear: 336,
  /** 事件加成（city_boom）。 */
  boomGrowthMultiplier: 3,
} as const;

/** 時間與模擬速度設定。 */
export const TIME_CONFIG = {
  /** 1 倍速時，每真實秒推進的遊戲分鐘數。 */
  minutesPerSecond: 6,
  /** 可選的模擬速度。 */
  speedOptions: [0, 1, 2, 4] as const,
  /** 單次更新最多處理的遊戲分鐘數，避免分頁切回時大量補算。 */
  maxStepsPerUpdate: 240,
  /** 每過多少真實秒自動存檔一次（模擬持續進行時）。 */
  autosaveSeconds: 30,
} as const;

/** 列車營運設定。 */
export const TRAIN_CONFIG = {
  /** 每公里能源成本（基礎值，會乘上列車能源倍率）。 */
  energyCostPerKm: 6.5,
  /** 每站停靠時間（遊戲分鐘，基礎值）。 */
  dwellMinutes: 0.6,
  /** 賣出列車的退款比例。 */
  sellRefundRatio: 0.6,
  /** 可設定的發車間隔選項（遊戲分鐘）。 */
  intervalOptions: [3, 4, 5, 6, 8, 10, 12, 15, 20, 30] as const,
  /** 建議列車數的計算上限，避免極端值。 */
  maxSuggestedTrains: 40,
} as const;

export const ROUTE_CONFIG = {
  minStops: 2,
  maxStops: 14,
  /** 兩站之間的最小距離（世界單位），避免無意義的極短路段。 */
  minSegmentDistance: 90,
  /** 預設發車間隔（遊戲分鐘），Phase 2 使用。 */
  defaultDepartureInterval: 8,
  /** 路線顏色選項（易於區分，且不只依賴顏色辨識）。 */
  colorPalette: [
    "#e85d5d",
    "#f2b23c",
    "#43c59e",
    "#4f8ef7",
    "#b07cf5",
    "#f2784b",
    "#8bc34a",
    "#ef7fb3",
    "#4dc8d8",
    "#d4c94a",
  ],
} as const;

export interface CityTypeParams {
  /** 顯示名稱。 */
  label: string;
  population: readonly [number, number];
  demand: readonly [number, number];
  growth: readonly [number, number];
  industry: IndustryMix;
  /** 名稱後綴。 */
  suffix: string;
}

export const CITY_TYPE_PARAMS: Record<CityType, CityTypeParams> = {
  capital: {
    label: "核心都市",
    suffix: "市",
    population: [780_000, 1_550_000],
    demand: [1.25, 1.45],
    growth: [0.012, 0.02],
    industry: { residential: 0.3, commercial: 0.38, industrial: 0.08, education: 0.12, tourism: 0.12 },
  },
  port: {
    label: "港口城市",
    suffix: "市",
    population: [380_000, 820_000],
    demand: [1.05, 1.25],
    growth: [0.008, 0.014],
    industry: { residential: 0.32, commercial: 0.22, industrial: 0.3, education: 0.06, tourism: 0.1 },
  },
  industrial: {
    label: "工業城市",
    suffix: "市",
    population: [300_000, 680_000],
    demand: [0.95, 1.15],
    growth: [0.006, 0.012],
    industry: { residential: 0.38, commercial: 0.14, industrial: 0.4, education: 0.05, tourism: 0.03 },
  },
  university: {
    label: "大學城",
    suffix: "市",
    population: [160_000, 420_000],
    demand: [0.9, 1.1],
    growth: [0.006, 0.012],
    industry: { residential: 0.38, commercial: 0.16, industrial: 0.06, education: 0.32, tourism: 0.08 },
  },
  tourism: {
    label: "觀光城市",
    suffix: "市",
    population: [90_000, 320_000],
    demand: [0.85, 1.05],
    growth: [0.008, 0.016],
    industry: { residential: 0.28, commercial: 0.22, industrial: 0.05, education: 0.05, tourism: 0.4 },
  },
  satellite: {
    label: "衛星城市",
    suffix: "市",
    population: [110_000, 380_000],
    demand: [0.8, 1.0],
    growth: [0.01, 0.018],
    industry: { residential: 0.58, commercial: 0.14, industrial: 0.16, education: 0.08, tourism: 0.04 },
  },
  town: {
    label: "小型城鎮",
    suffix: "鎮",
    population: [18_000, 80_000],
    demand: [0.65, 0.85],
    growth: [0.004, 0.008],
    industry: { residential: 0.6, commercial: 0.16, industrial: 0.12, education: 0.06, tourism: 0.06 },
  },
};

/** 車站初始容量公式：基礎值 + 人口比例。 */
export const STATION_CONFIG = {
  baseCapacity: 2_500,
  capacityPerCitizen: 0.025,
  initialSatisfaction: 75,
} as const;
