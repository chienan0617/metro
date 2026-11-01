/**
 * 遊戲共用型別定義。
 * 核心模擬與 UI 共用，不依賴 DOM，方便測試與存檔。
 */

export type ID = string;

export type TerrainType = "water" | "coast" | "plain" | "hill" | "mountain";

export type CityType =
  | "capital"
  | "port"
  | "industrial"
  | "university"
  | "tourism"
  | "satellite"
  | "town";

export type RouteStatus = "planning" | "building" | "active" | "suspended";

/** 遊戲模式：生涯（任務與解鎖）或自由經營。 */
export type GameMode = "career" | "free";

/** 地理樣式：大陸（廣闊內陸）或群島（海洋較多）。 */
export type GeographyStyle = "continent" | "islands";

/** 地理選擇：依種子自動決定，或由玩家指定。 */
export type GeographyChoice = GeographyStyle | "auto";

/** 生態域（由溫度、濕度與高度決定）。 */
export type BiomeId =
  | "deep_ocean"
  | "ocean"
  | "beach"
  | "plains"
  | "forest"
  | "jungle"
  | "savanna"
  | "desert"
  | "swamp"
  | "taiga"
  | "snow"
  | "hills"
  | "mountain"
  | "peaks";

/** 各路線的營運統計（今日與累計）。 */
export interface RouteStats {
  passengersToday: number;
  revenueToday: number;
  waitSumToday: number;
  journeySumToday: number;
  transfersSumToday: number;
  /** 今日理論運能（人）。 */
  capacityToday: number;
  passengersTotal: number;
  revenueTotal: number;
}

export function emptyRouteStats(): RouteStats {
  return {
    passengersToday: 0,
    revenueToday: 0,
    waitSumToday: 0,
    journeySumToday: 0,
    transfersSumToday: 0,
    capacityToday: 0,
    passengersTotal: 0,
    revenueTotal: 0,
  };
}

/** 各車站的進出站統計。 */
export interface StationStats {
  boardingsToday: number;
  alightingsToday: number;
  transfersToday: number;
  boardingsTotal: number;
  alightingsTotal: number;
}

export function emptyStationStats(): StationStats {
  return {
    boardingsToday: 0,
    alightingsToday: 0,
    transfersToday: 0,
    boardingsTotal: 0,
    alightingsTotal: 0,
  };
}

/** 每日財務摘要。 */
export interface DailyFinance {
  day: number;
  revenue: number;
  cost: number;
}

/** 公司累計統計。 */
export interface CompanyStats {
  totalGenerated: number;
  totalServed: number;
  totalUnserved: number;
  totalRevenue: number;
  totalPassengers: number;
}

export function emptyCompanyStats(): CompanyStats {
  return {
    totalGenerated: 0,
    totalServed: 0,
    totalUnserved: 0,
    totalRevenue: 0,
    totalPassengers: 0,
  };
}

/* ------------------------------ Phase 4 內容 ------------------------------ */

export type ResearchLine = "train" | "station" | "operation";

export interface ActiveResearch {
  line: ResearchLine;
  tier: number;
  startDay: number;
  endDay: number;
}

export interface ResearchState {
  /** 各研究線已完成到第幾階（0 = 未完成任何階）。 */
  completed: Record<ResearchLine, number>;
  active: ActiveResearch | null;
}

export type EventKind =
  | "exhibition"
  | "semester"
  | "festival"
  | "energy_price"
  | "station_works"
  | "city_boom";

export interface ActiveEvent {
  id: string;
  kind: EventKind;
  cityId: ID | null;
  startedDay: number;
  endDay: number;
  label: string;
}

export type MissionObjective =
  | { kind: "connect_city"; cityId: ID; label: string }
  | { kind: "passengers_total"; target: number; label: string }
  | { kind: "revenue_total"; target: number; label: string }
  | { kind: "network_length"; target: number; label: string }
  | { kind: "transfer_stations"; target: number; label: string }
  | { kind: "satisfaction"; target: number; label: string };

export interface Mission {
  id: string;
  title: string;
  description: string;
  objectives: MissionObjective[];
  rewardMoney: number;
  rewardXp: number;
}

export interface MissionState {
  seed: number;
  index: number;
  active: Mission | null;
  completedCount: number;
  stars: number;
}

/** 模擬產生的通知（由 UI 讀取並顯示）。 */
export interface GameNotification {
  id: number;
  kind: "info" | "success" | "warn" | "error";
  text: string;
  minute: number;
}

export type TrainStatus = "idle" | "running" | "stopped" | "maintenance";

/** 0 = 暫停；其餘為模擬加速倍率。 */
export type GameSpeed = 0 | 1 | 2 | 4 | 8;

export interface ClockState {
  /** 自遊戲開始累計的遊戲分鐘。 */
  minutes: number;
  speed: GameSpeed;
}

export interface Point {
  x: number;
  y: number;
}

export interface IndustryMix {
  residential: number;
  commercial: number;
  industrial: number;
  education: number;
  tourism: number;
}

export interface City {
  id: ID;
  /** 城市名稱（不含「市／鎮」後綴）。 */
  name: string;
  position: Point;
  population: number;
  cityType: CityType;
  industry: IndustryMix;
  demandMultiplier: number;
  growthRate: number;
  terrain: TerrainType;
  /** 城市所在的生態域。 */
  biome: BiomeId;
  developmentLevel: number;
  unlocked: boolean;
  /** 生涯模式中需要達到的公司等級（0 = 一開始即可用）。 */
  unlockLevel: number;
  stationIds: ID[];
}

export interface Station {
  id: ID;
  cityId: ID;
  name: string;
  position: Point;
  level: number;
  capacity: number;
  routeIds: ID[];
  satisfaction: number;
  stats: StationStats;
}

export interface Route {
  id: ID;
  name: string;
  color: string;
  /** 有順序的停靠站 ID。 */
  stationIds: ID[];
  status: RouteStatus;
  totalDistance: number;
  constructionCost: number;
  /** 發車間隔（遊戲分鐘）。 */
  departureInterval: number;
  /** 兩端點下一次可發車的遊戲分鐘（依發車間隔調度）。 */
  departureSlots: [number, number];
  assignedTrainIds: ID[];
  /** 已累計、尚未結算的營運成本（能源與維護），每日結算一次。 */
  opsCostPending: number;
  stats: RouteStats;
  createdAt: number;
}

export interface TrainModel {
  id: ID;
  name: string;
  manufacturer: string;
  purchasePrice: number;
  capacity: number;
  maxSpeed: number;
  energyRate: number;
  maintenanceRate: number;
  comfort: number;
  unlockLevel: number;
}

export interface Train {
  id: ID;
  modelId: ID;
  level: number;
  durability: number;
  routeId: ID | null;
  status: TrainStatus;
  /** 目前行駛的路段索引（路段 i 連接站 i 與站 i+1）。 */
  currentSegmentIndex: number;
  /** 0 - 1，位於目前路段的進度。 */
  progressOnSegment: number;
  direction: 1 | -1;
  passengers: number;
  /** 停靠剩餘時間（遊戲分鐘），大於 0 時列車停在月台。 */
  dwellRemaining: number;
}

export interface ODFlow {
  originCityId: ID;
  destinationCityId: ID;
  generated: number;
  served: number;
  unserved: number;
}

export type LedgerCategory =
  | "route_construction"
  | "train_purchase"
  | "train_sale"
  | "train_operation"
  | "station"
  | "ticket_revenue"
  | "mission"
  | "other";

export interface LedgerEntry {
  id: ID;
  seq: number;
  category: LedgerCategory;
  description: string;
  /** 收入為正、支出為負。 */
  amount: number;
  createdAt: number;
}

/**
 * 無限世界：地形由柏林雜訊程序化生成（不儲存格線），
 * 城市以「圖磚」為單位在玩家探索時逐步生成（materializedTiles 記錄已生成區域）。
 */
export interface World {
  seed: number;
  style: GeographyChoice;
  /** 起始核心城市的位置（解鎖分級與「回到起始區」使用）。 */
  startCore: Point;
  /** 已生成的城市與車站（隨探索增加，內容由 seed 決定、永久穩定）。 */
  cities: City[];
  stations: Station[];
}

export interface PlayerState {
  companyName: string;
  money: number;
  level: number;
  xp: number;
}

/** 資源增減結果。 */
export interface TransactionResult {
  ok: boolean;
  balanceAfter: number;
  /** 資金不足時尚缺金額（正數）。 */
  shortfall?: number;
}

export interface GameState {
  saveVersion: number;
  seed: number;
  mode: GameMode;
  /** 地圖地理樣式（"auto" = 依種子決定）。 */
  geoStyle: GeographyChoice;
  createdAt: number;
  world: World;
  /** 已生成的圖磚（"x,y"，隨探索累積）。 */
  materializedTiles: string[];
  player: PlayerState;
  clock: ClockState;
  routes: Route[];
  trains: Train[];
  /** 待命列車已累計、尚未結算的維護成本。 */
  depotCostPending: number;
  stats: CompanyStats;
  finance: { history: DailyFinance[]; todayRevenue: number };
  research: ResearchState;
  events: ActiveEvent[];
  mission: MissionState;
  notifications: GameNotification[];
  nextNotificationId: number;
  /** 新手引導進度（0 = 未完成任何步驟）。 */
  tutorialStep: number;
  ledger: LedgerEntry[];
  counters: {
    route: number;
    train: number;
    ledger: number;
  };
}
