/**
 * 存檔與讀檔系統。
 * 存檔只保存「種子 + 玩家變更」，世界由種子重新生成，確保一致性並縮小存檔。
 * 存取介面抽象化，遊戲邏輯不依賴特定儲存實作。
 */

import { hashString } from "../core/rng.ts";
import type { Store } from "../core/store.ts";
import {
  emptyCompanyStats,
  emptyRouteStats,
  emptyStationStats,
} from "../core/types.ts";
import type {
  ActiveEvent,
  ClockState,
  CompanyStats,
  DailyFinance,
  EventKind,
  GameMode,
  GameNotification,
  GeographyChoice,
  GameSpeed,
  GameState,
  ID,
  LedgerCategory,
  LedgerEntry,
  Mission,
  MissionObjective,
  MissionState,
  PlayerState,
  ResearchLine,
  ResearchState,
  Route,
  RouteStats,
  RouteStatus,
  StationStats,
  Train,
  TrainStatus,
} from "../core/types.ts";
import { unlockCitiesForLevel } from "./progression.ts";
import { generateWorld, stationById } from "../world/worldgen.ts";
import {
  CITY_TYPE_PARAMS,
  CITY_UNLOCK_TIERS,
  ECONOMY_CONFIG,
  ROUTE_CONFIG,
  SAVE_VERSION,
  TERRAIN_THRESHOLDS,
  WORLD_CONFIG,
} from "./config.ts";
import { routeGeometrics } from "./routes.ts";
import { trainModelById } from "./trainModels.ts";

export const SAVE_KEY = "metro-network-tycoon/save";

export interface SavedRoute {
  id: ID;
  name: string;
  color: string;
  stationIds: ID[];
  status: RouteStatus;
  totalDistance: number;
  constructionCost: number;
  departureInterval: number;
  departureSlots: [number, number];
  opsCostPending: number;
  stats: RouteStats;
  createdAt: number;
}

/** 世界中被玩家改變的城市狀態（世界本身由 seed 重新生成）。 */
export interface SavedCity {
  id: ID;
  population: number;
  unlocked: boolean;
}

export interface SavedStation {
  id: ID;
  level: number;
  satisfaction: number;
  stats: StationStats;
}

export interface SavedTrain {
  id: ID;
  modelId: string;
  level: number;
  durability: number;
  routeId: ID | null;
  status: TrainStatus;
  currentSegmentIndex: number;
  progressOnSegment: number;
  direction: 1 | -1;
  passengers: number;
  dwellRemaining: number;
}

export interface SavePayload {
  saveVersion: number;
  configHash: string;
  seed: number;
  mode: GameMode;
  geoStyle: GeographyChoice;
  createdAt: number;
  savedAt: number;
  player: PlayerState;
  clock: ClockState;
  routes: SavedRoute[];
  trains: SavedTrain[];
  cities: SavedCity[];
  stations: SavedStation[];
  depotCostPending: number;
  stats: CompanyStats;
  finance: { history: DailyFinance[]; todayRevenue: number };
  research: ResearchState;
  events: ActiveEvent[];
  mission: MissionState;
  notifications: GameNotification[];
  nextNotificationId: number;
  tutorialStep: number;
  ledger: LedgerEntry[];
  counters: { route: number; train: number; ledger: number };
}

/** 世界生成與平衡設定指紋：設定改動後舊存檔必須重新開始，避免城市位置不一致。 */
export function computeConfigHash(): string {
  return hashString(
    JSON.stringify({
      world: WORLD_CONFIG,
      thresholds: TERRAIN_THRESHOLDS,
      cityTypes: CITY_TYPE_PARAMS,
      unlockTiers: CITY_UNLOCK_TIERS,
      economy: { trackCostPerUnit: ECONOMY_CONFIG.trackCostPerUnit },
      route: { minStops: ROUTE_CONFIG.minStops, minSegmentDistance: ROUTE_CONFIG.minSegmentDistance },
    }),
  ).toString(16);
}

export function buildPayload(state: GameState): SavePayload {
  return {
    saveVersion: SAVE_VERSION,
    configHash: computeConfigHash(),
    seed: state.seed,
    mode: state.mode,
    geoStyle: state.geoStyle,
    createdAt: state.createdAt,
    savedAt: Date.now(),
    player: { ...state.player },
    clock: { ...state.clock },
    routes: state.routes.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      stationIds: r.stationIds.slice(),
      status: r.status,
      totalDistance: r.totalDistance,
      constructionCost: r.constructionCost,
      departureInterval: r.departureInterval,
      departureSlots: [r.departureSlots[0], r.departureSlots[1]],
      opsCostPending: r.opsCostPending,
      stats: { ...r.stats },
      createdAt: r.createdAt,
    })),
    cities: state.world.cities.map((c) => ({
      id: c.id,
      population: c.population,
      unlocked: c.unlocked,
    })),
    stations: state.world.stations.map((s) => ({
      id: s.id,
      level: s.level,
      satisfaction: s.satisfaction,
      stats: { ...s.stats },
    })),
    stats: { ...state.stats },
    finance: {
      history: state.finance.history.slice(-180),
      todayRevenue: state.finance.todayRevenue,
    },
    research: {
      completed: { ...state.research.completed },
      active: state.research.active ? { ...state.research.active } : null,
    },
    events: state.events.map((e) => ({ ...e })),
    mission: {
      seed: state.mission.seed,
      index: state.mission.index,
      active: state.mission.active ? { ...state.mission.active, objectives: state.mission.active.objectives.map((o) => ({ ...o })) } : null,
      completedCount: state.mission.completedCount,
      stars: state.mission.stars,
    },
    notifications: state.notifications.slice(-24).map((n) => ({ ...n })),
    nextNotificationId: state.nextNotificationId,
    tutorialStep: state.tutorialStep,
    trains: state.trains.map((t) => ({
      id: t.id,
      modelId: t.modelId,
      level: t.level,
      durability: t.durability,
      routeId: t.routeId,
      status: t.status,
      currentSegmentIndex: t.currentSegmentIndex,
      progressOnSegment: t.progressOnSegment,
      direction: t.direction,
      passengers: t.passengers,
      dwellRemaining: t.dwellRemaining,
    })),
    depotCostPending: state.depotCostPending,
    ledger: state.ledger.slice(-ECONOMY_CONFIG.ledgerMaxEntries),
    counters: { ...state.counters },
  };
}

export function encodeSave(state: GameState): string {
  return JSON.stringify(buildPayload(state));
}

export type DecodeResult = { ok: true; state: GameState } | { ok: false; error: string };

/**
 * 由存檔資料重建遊戲狀態。
 * 驗證失敗時回傳可理解的錯誤訊息，不拋出例外造成白屏。
 */
export function decodeSave(raw: unknown): DecodeResult {
  if (!isRecord(raw)) {
    return { ok: false, error: "存檔內容不是有效的物件" };
  }
  const version = raw["saveVersion"];
  if (typeof version !== "number") {
    return { ok: false, error: "存檔缺少版本資訊" };
  }
  // v1 / v2 存檔可以升級：缺少的欄位會套用預設值。
  if (version !== 1 && version !== 2 && version !== SAVE_VERSION) {
    return { ok: false, error: `存檔版本不相容（存檔 v${version}，目前 v${SAVE_VERSION}）` };
  }
  if (raw["configHash"] !== computeConfigHash()) {
    return { ok: false, error: "地圖設定已更新，此存檔無法繼續使用" };
  }
  const seed = raw["seed"];
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    return { ok: false, error: "存檔缺少有效的種子" };
  }

  const modeRaw = raw["mode"];
  const mode: GameMode =
    modeRaw === "career" || modeRaw === "free" ? modeRaw : version >= 3 ? "career" : "free";

  const geoStyleRaw = raw["geoStyle"];
  const geoStyle: GeographyChoice =
    geoStyleRaw === "continent" ||
    geoStyleRaw === "island" ||
    geoStyleRaw === "mainland" ||
    geoStyleRaw === "strait" ||
    geoStyleRaw === "auto"
      ? geoStyleRaw
      : "auto";

  const state: GameState = {
    saveVersion: SAVE_VERSION,
    seed,
    mode,
    geoStyle,
    createdAt: numberOr(raw["createdAt"], Date.now()),
    world: generateWorld(seed, geoStyle),
    player: decodePlayer(raw["player"]),
    clock: decodeClock(raw["clock"]),
    routes: [],
    trains: [],
    depotCostPending: Math.max(0, numberOr(raw["depotCostPending"], 0)),
    stats: decodeCompanyStats(raw["stats"]),
    finance: decodeFinance(raw["finance"]),
    research: decodeResearch(raw["research"]),
    events: decodeEvents(raw["events"]),
    mission: decodeMission(raw["mission"], seed),
    notifications: decodeNotifications(raw["notifications"]),
    nextNotificationId: Math.max(0, Math.floor(numberOr(raw["nextNotificationId"], 0))),
    tutorialStep: Math.max(0, Math.floor(numberOr(raw["tutorialStep"], mode === "free" ? 99 : 0))),
    ledger: decodeLedger(raw["ledger"]),
    counters: { route: 0, train: 0, ledger: 0 },
  };

  applyWorldOverrides(state, raw);

  const routesRaw = raw["routes"];
  if (Array.isArray(routesRaw)) {
    for (const item of routesRaw) {
      const route = decodeRoute(item, state);
      if (route) {
        state.routes.push(route);
      }
    }
  }

  // 由路線重建車站的所屬路線清單，避免存檔與實際狀態不一致。
  for (const route of state.routes) {
    for (const stationId of route.stationIds) {
      const station = stationById(state.world, stationId);
      if (station && !station.routeIds.includes(route.id)) {
        station.routeIds.push(route.id);
      }
    }
  }

  const trainsRaw = raw["trains"];
  if (Array.isArray(trainsRaw)) {
    for (const item of trainsRaw) {
      const train = decodeTrain(item, state);
      if (train) {
        state.trains.push(train);
      }
    }
  }

  // 以列車的 routeId 為準重建各路線的配置清單。
  for (const route of state.routes) {
    route.assignedTrainIds = state.trains
      .filter((t) => t.routeId === route.id)
      .map((t) => t.id);
  }

  const counters = raw["counters"];
  const countersRecord = isRecord(counters) ? counters : {};
  state.counters = {
    route: Math.max(
      numberOr(countersRecord["route"], 0),
      state.routes.length,
      maxNumericSuffix(state.routes.map((r) => r.id)),
    ),
    train: Math.max(
      numberOr(countersRecord["train"], 0),
      state.trains.length,
      maxNumericSuffix(state.trains.map((t) => t.id)),
    ),
    ledger: Math.max(
      numberOr(countersRecord["ledger"], 0),
      state.ledger.length,
      maxNumericSuffix(state.ledger.map((e) => e.id)),
    ),
  };

  // 依公司等級重新套用城市解鎖（自由模式全部解鎖）。
  if (state.mode === "free") {
    for (const city of state.world.cities) {
      city.unlocked = true;
    }
  } else {
    unlockCitiesForLevel(state);
  }

  return { ok: true, state };
}

/** 套用存檔中「玩家造成的世界改變」：城市人口／解鎖與車站等級／滿意度／統計。 */
function applyWorldOverrides(state: GameState, raw: Record<string, unknown>): void {
  const citiesRaw = raw["cities"];
  if (Array.isArray(citiesRaw)) {
    for (const item of citiesRaw) {
      if (!isRecord(item) || typeof item["id"] !== "string") {
        continue;
      }
      const city = state.world.cities.find((c) => c.id === item["id"]);
      if (!city) {
        continue;
      }
      city.population = Math.min(4_000_000, Math.max(1_000, numberOr(item["population"], city.population)));
      if (typeof item["unlocked"] === "boolean") {
        city.unlocked = item["unlocked"] as boolean;
      }
    }
  }
  const stationsRaw = raw["stations"];
  if (Array.isArray(stationsRaw)) {
    for (const item of stationsRaw) {
      if (!isRecord(item) || typeof item["id"] !== "string") {
        continue;
      }
      const station = state.world.stations.find((s) => s.id === item["id"]);
      if (!station) {
        continue;
      }
      station.level = Math.min(3, Math.max(1, Math.floor(numberOr(item["level"], 1))));
      station.satisfaction = clampNumber(numberOr(item["satisfaction"], 75), 0, 100);
      station.stats = decodeStationStats(item["stats"]);
    }
  }
}

function decodeStationStats(raw: unknown): StationStats {
  const base = emptyStationStats();
  if (!isRecord(raw)) {
    return base;
  }
  return {
    boardingsToday: Math.max(0, numberOr(raw["boardingsToday"], 0)),
    alightingsToday: Math.max(0, numberOr(raw["alightingsToday"], 0)),
    transfersToday: Math.max(0, numberOr(raw["transfersToday"], 0)),
    boardingsTotal: Math.max(0, numberOr(raw["boardingsTotal"], 0)),
    alightingsTotal: Math.max(0, numberOr(raw["alightingsTotal"], 0)),
  };
}

function decodeRouteStats(raw: unknown): RouteStats {
  const base = emptyRouteStats();
  if (!isRecord(raw)) {
    return base;
  }
  return {
    passengersToday: Math.max(0, numberOr(raw["passengersToday"], 0)),
    revenueToday: Math.max(0, numberOr(raw["revenueToday"], 0)),
    waitSumToday: Math.max(0, numberOr(raw["waitSumToday"], 0)),
    journeySumToday: Math.max(0, numberOr(raw["journeySumToday"], 0)),
    transfersSumToday: Math.max(0, numberOr(raw["transfersSumToday"], 0)),
    capacityToday: Math.max(0, numberOr(raw["capacityToday"], 0)),
    passengersTotal: Math.max(0, numberOr(raw["passengersTotal"], 0)),
    revenueTotal: Math.max(0, numberOr(raw["revenueTotal"], 0)),
  };
}

function decodeCompanyStats(raw: unknown): CompanyStats {
  const base = emptyCompanyStats();
  if (!isRecord(raw)) {
    return base;
  }
  return {
    totalGenerated: Math.max(0, numberOr(raw["totalGenerated"], 0)),
    totalServed: Math.max(0, numberOr(raw["totalServed"], 0)),
    totalUnserved: Math.max(0, numberOr(raw["totalUnserved"], 0)),
    totalRevenue: Math.max(0, numberOr(raw["totalRevenue"], 0)),
    totalPassengers: Math.max(0, numberOr(raw["totalPassengers"], 0)),
  };
}

function decodeFinance(raw: unknown): { history: DailyFinance[]; todayRevenue: number } {
  const result: { history: DailyFinance[]; todayRevenue: number } = {
    history: [],
    todayRevenue: 0,
  };
  if (!isRecord(raw)) {
    return result;
  }
  result.todayRevenue = Math.max(0, numberOr(raw["todayRevenue"], 0));
  const historyRaw = raw["history"];
  if (Array.isArray(historyRaw)) {
    for (const item of historyRaw) {
      if (!isRecord(item)) {
        continue;
      }
      result.history.push({
        day: Math.max(0, Math.floor(numberOr(item["day"], 0))),
        revenue: numberOr(item["revenue"], 0),
        cost: numberOr(item["cost"], 0),
      });
    }
    result.history = result.history.slice(-180);
  }
  return result;
}

const RESEARCH_LINES: readonly ResearchLine[] = ["train", "station", "operation"];

function decodeResearch(raw: unknown): ResearchState {
  const result: ResearchState = {
    completed: { train: 0, station: 0, operation: 0 },
    active: null,
  };
  if (!isRecord(raw)) {
    return result;
  }
  const completed = isRecord(raw["completed"]) ? raw["completed"] : {};
  for (const line of RESEARCH_LINES) {
    result.completed[line] = clampNumber(Math.floor(numberOr(completed[line], 0)), 0, 3);
  }
  const active = raw["active"];
  if (isRecord(active) && RESEARCH_LINES.includes(active["line"] as ResearchLine)) {
    const tier = clampNumber(Math.floor(numberOr(active["tier"], 0)), 1, 3);
    result.active = {
      line: active["line"] as ResearchLine,
      tier,
      startDay: Math.max(0, Math.floor(numberOr(active["startDay"], 0))),
      endDay: Math.max(0, Math.floor(numberOr(active["endDay"], 0))),
    };
  }
  return result;
}

const EVENT_KINDS: readonly EventKind[] = [
  "exhibition",
  "semester",
  "festival",
  "energy_price",
  "station_works",
  "city_boom",
];

function decodeEvents(raw: unknown): ActiveEvent[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const events: ActiveEvent[] = [];
  for (const item of raw) {
    if (!isRecord(item) || !EVENT_KINDS.includes(item["kind"] as EventKind)) {
      continue;
    }
    events.push({
      id: typeof item["id"] === "string" ? (item["id"] as string) : `evt-${events.length}`,
      kind: item["kind"] as EventKind,
      cityId: typeof item["cityId"] === "string" ? (item["cityId"] as string) : null,
      startedDay: Math.max(0, Math.floor(numberOr(item["startedDay"], 0))),
      endDay: Math.max(0, Math.floor(numberOr(item["endDay"], 0))),
      label: typeof item["label"] === "string" ? (item["label"] as string).slice(0, 32) : "事件",
    });
  }
  return events.slice(0, 6);
}

function decodeMission(raw: unknown, seed: number): MissionState {
  const result: MissionState = {
    seed: ((seed ^ 0x9e3779b9) >>> 0),
    index: 0,
    active: null,
    completedCount: 0,
    stars: 0,
  };
  if (!isRecord(raw)) {
    return result;
  }
  result.seed = Math.max(0, Math.floor(numberOr(raw["seed"], result.seed)));
  result.index = Math.max(0, Math.floor(numberOr(raw["index"], 0)));
  result.completedCount = Math.max(0, Math.floor(numberOr(raw["completedCount"], 0)));
  result.stars = Math.max(0, Math.floor(numberOr(raw["stars"], 0)));
  result.active = decodeMissionObject(raw["active"]);
  return result;
}

function decodeMissionObject(raw: unknown): Mission | null {
  if (!isRecord(raw) || typeof raw["id"] !== "string" || !Array.isArray(raw["objectives"])) {
    return null;
  }
  const objectives: MissionObjective[] = [];
  for (const item of raw["objectives"]) {
    const objective = decodeObjective(item);
    if (objective) {
      objectives.push(objective);
    }
  }
  if (objectives.length === 0) {
    return null;
  }
  return {
    id: raw["id"] as string,
    title: typeof raw["title"] === "string" ? (raw["title"] as string).slice(0, 40) : "任務",
    description:
      typeof raw["description"] === "string" ? (raw["description"] as string).slice(0, 120) : "",
    objectives,
    rewardMoney: Math.max(0, numberOr(raw["rewardMoney"], 0)),
    rewardXp: Math.max(0, numberOr(raw["rewardXp"], 0)),
  };
}

function decodeObjective(raw: unknown): MissionObjective | null {
  if (!isRecord(raw) || typeof raw["kind"] !== "string") {
    return null;
  }
  const label = typeof raw["label"] === "string" ? (raw["label"] as string).slice(0, 80) : "";
  switch (raw["kind"]) {
    case "connect_city": {
      if (typeof raw["cityId"] !== "string") {
        return null;
      }
      return { kind: "connect_city", cityId: raw["cityId"] as string, label };
    }
    case "passengers_total":
      return { kind: "passengers_total", target: Math.max(0, numberOr(raw["target"], 0)), label };
    case "revenue_total":
      return { kind: "revenue_total", target: Math.max(0, numberOr(raw["target"], 0)), label };
    case "network_length":
      return { kind: "network_length", target: Math.max(0, numberOr(raw["target"], 0)), label };
    case "transfer_stations":
      return { kind: "transfer_stations", target: Math.max(0, numberOr(raw["target"], 0)), label };
    case "satisfaction":
      return { kind: "satisfaction", target: clampNumber(numberOr(raw["target"], 70), 0, 100), label };
    default:
      return null;
  }
}

function decodeNotifications(raw: unknown): GameNotification[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const notifications: GameNotification[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const kindRaw = item["kind"];
    const kind =
      kindRaw === "success" || kindRaw === "warn" || kindRaw === "error" ? kindRaw : "info";
    notifications.push({
      id: Math.max(0, Math.floor(numberOr(item["id"], 0))),
      kind,
      text: typeof item["text"] === "string" ? (item["text"] as string).slice(0, 160) : "",
      minute: Math.max(0, Math.floor(numberOr(item["minute"], 0))),
    });
  }
  return notifications.slice(-24);
}

const VALID_SPEEDS: readonly number[] = [0, 1, 2, 4, 8];

function decodeClock(raw: unknown): ClockState {
  const record = isRecord(raw) ? raw : {};
  const minutes = Math.max(0, numberOr(record["minutes"], 0));
  const speedRaw = numberOr(record["speed"], 0);
  const speed = (VALID_SPEEDS.includes(speedRaw) ? speedRaw : 0) as GameSpeed;
  return { minutes: Math.floor(minutes), speed };
}

const TRAIN_STATUSES: readonly TrainStatus[] = ["idle", "running", "stopped", "maintenance"];

function decodeTrain(raw: unknown, state: GameState): Train | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = raw["id"];
  const modelId = raw["modelId"];
  if (typeof id !== "string" || typeof modelId !== "string") {
    return null;
  }
  if (!trainModelById(modelId)) {
    return null;
  }
  const statusRaw = raw["status"];
  const status = TRAIN_STATUSES.includes(statusRaw as TrainStatus)
    ? (statusRaw as TrainStatus)
    : "idle";
  const direction = raw["direction"] === -1 ? -1 : 1;

  let routeId: ID | null = typeof raw["routeId"] === "string" ? (raw["routeId"] as string) : null;
  let route = routeId !== null ? state.routes.find((r) => r.id === routeId) : undefined;
  if (routeId !== null && !route) {
    routeId = null;
    route = undefined;
  }

  const segmentCount = route ? Math.max(1, route.stationIds.length - 1) : 1;
  const segmentIndex = Math.min(
    Math.max(0, Math.floor(numberOr(raw["currentSegmentIndex"], 0))),
    segmentCount - 1,
  );

  return {
    id,
    modelId,
    level: Math.max(1, Math.floor(numberOr(raw["level"], 1))),
    durability: clampNumber(numberOr(raw["durability"], 100), 0, 100),
    routeId,
    status: routeId === null ? "idle" : status,
    currentSegmentIndex: segmentIndex,
    progressOnSegment: clampNumber(numberOr(raw["progressOnSegment"], 0), 0, 1),
    direction,
    passengers: Math.max(0, Math.floor(numberOr(raw["passengers"], 0))),
    dwellRemaining: clampNumber(numberOr(raw["dwellRemaining"], 0), 0, 240),
  };
}

function decodePlayer(raw: unknown): PlayerState {
  const record = isRecord(raw) ? raw : {};
  const money = numberOr(record["money"], ECONOMY_CONFIG.startingMoney);
  return {
    companyName:
      typeof record["companyName"] === "string" && record["companyName"].trim().length > 0
        ? (record["companyName"] as string).slice(0, 32)
        : "都會捷運公司",
    money: Math.max(0, money),
    level: Math.max(1, Math.floor(numberOr(record["level"], 1))),
    xp: Math.max(0, numberOr(record["xp"], 0)),
  };
}

function decodeRoute(raw: unknown, state: GameState): Route | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = raw["id"];
  const stationIdsRaw = raw["stationIds"];
  if (typeof id !== "string" || !Array.isArray(stationIdsRaw)) {
    return null;
  }
  const stationIds: ID[] = [];
  const seen = new Set<ID>();
  for (const item of stationIdsRaw) {
    if (typeof item !== "string") {
      return null;
    }
    const station = stationById(state.world, item);
    if (!station || seen.has(item)) {
      return null;
    }
    seen.add(item);
    stationIds.push(item);
  }
  if (stationIds.length < ROUTE_CONFIG.minStops) {
    return null;
  }

  const color = typeof raw["color"] === "string" ? (raw["color"] as string) : "#4f8ef7";
  const name = typeof raw["name"] === "string" ? (raw["name"] as string).slice(0, 24) : "路線";
  const statusRaw = raw["status"];
  const status: RouteStatus =
    statusRaw === "planning" || statusRaw === "building" || statusRaw === "suspended"
      ? statusRaw
      : "active";

  // 以幾何重新計算距離（只取決於世界種子與停靠順序），避免存檔數值被竄改。
  const geometry = routeGeometrics(state, stationIds);
  const totalDistance = geometry.totalDistance;

  let constructionCost = numberOr(raw["constructionCost"], 0);
  if (!(constructionCost > 0)) {
    // 舊版存檔缺少成本欄位時，以地形倍率完整重算（與建設時相同）。
    constructionCost = geometry.constructionCost;
  }

  const slotsRaw = raw["departureSlots"];
  const departureSlots: [number, number] =
    Array.isArray(slotsRaw) && typeof slotsRaw[0] === "number" && typeof slotsRaw[1] === "number"
      ? [Math.max(0, slotsRaw[0]), Math.max(0, slotsRaw[1])]
      : [0, 0];

  return {
    id,
    name,
    color,
    stationIds,
    status,
    totalDistance,
    constructionCost,
    departureInterval: clampNumber(
      numberOr(raw["departureInterval"], ROUTE_CONFIG.defaultDepartureInterval),
      1,
      120,
    ),
    departureSlots,
    assignedTrainIds: [],
    opsCostPending: Math.max(0, numberOr(raw["opsCostPending"], 0)),
    stats: decodeRouteStats(raw["stats"]),
    createdAt: numberOr(raw["createdAt"], Date.now()),
  };
}

const LEDGER_CATEGORIES: readonly LedgerCategory[] = [
  "route_construction",
  "train_purchase",
  "train_sale",
  "train_operation",
  "station",
  "ticket_revenue",
  "mission",
  "other",
];

function decodeLedger(raw: unknown): LedgerEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const entries: LedgerEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const amount = item["amount"];
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      continue;
    }
    const categoryRaw = item["category"];
    const category = LEDGER_CATEGORIES.includes(categoryRaw as LedgerCategory)
      ? (categoryRaw as LedgerCategory)
      : "other";
    entries.push({
      id: typeof item["id"] === "string" ? (item["id"] as string) : `led-${entries.length + 1}`,
      seq: numberOr(item["seq"], entries.length + 1),
      category,
      description:
        typeof item["description"] === "string" ? (item["description"] as string).slice(0, 80) : "",
      amount,
      createdAt: numberOr(item["createdAt"], Date.now()),
    });
  }
  return entries.slice(-ECONOMY_CONFIG.ledgerMaxEntries);
}

function maxNumericSuffix(ids: readonly string[]): number {
  let max = 0;
  for (const id of ids) {
    const match = /-(\d+)$/.exec(id);
    if (match && match[1]) {
      max = Math.max(max, Number.parseInt(match[1], 10));
    }
  }
  return max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------ 儲存存取介面 ------------------------------ */

export interface SaveStorage {
  read(): string | null;
  write(data: string): boolean;
  remove(): void;
}

/** localStorage 實作；無法使用時（例如隱私模式）退化為無儲存。 */
export const localStorageAdapter: SaveStorage = {
  read(): string | null {
    try {
      return window.localStorage.getItem(SAVE_KEY);
    } catch {
      return null;
    }
  },
  write(data: string): boolean {
    try {
      window.localStorage.setItem(SAVE_KEY, data);
      return true;
    } catch {
      return false;
    }
  },
  remove(): void {
    try {
      window.localStorage.removeItem(SAVE_KEY);
    } catch {
      // 忽略：無法存取時不需要額外處理。
    }
  },
};

export function hasSave(storage: SaveStorage = localStorageAdapter): boolean {
  return storage.read() !== null;
}

export interface SaveSummary {
  money: number;
  routeCount: number;
  trainCount: number;
  /** 存檔中的遊戲時間（分鐘）。 */
  clockMinutes: number;
  savedAt: number;
}

/** 不重建世界、僅解析基本資訊，供主選單顯示存檔摘要。 */
export function readSaveSummary(storage: SaveStorage = localStorageAdapter): SaveSummary | null {
  const raw = storage.read();
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    const player = isRecord(parsed["player"]) ? parsed["player"] : {};
    const routes = Array.isArray(parsed["routes"]) ? parsed["routes"] : [];
    const trains = Array.isArray(parsed["trains"]) ? parsed["trains"] : [];
    const clock = isRecord(parsed["clock"]) ? parsed["clock"] : {};
    return {
      money: numberOr(player["money"], 0),
      routeCount: routes.length,
      trainCount: trains.length,
      clockMinutes: Math.max(0, numberOr(clock["minutes"], 0)),
      savedAt: numberOr(parsed["savedAt"], 0),
    };
  } catch {
    return null;
  }
}

export function readSave(storage: SaveStorage = localStorageAdapter): DecodeResult | null {
  const raw = storage.read();
  if (raw === null) {
    return null;
  }
  try {
    return decodeSave(JSON.parse(raw) as unknown);
  } catch {
    return { ok: false, error: "存檔格式損毀，無法解析" };
  }
}

export function writeSave(state: GameState, storage: SaveStorage = localStorageAdapter): boolean {
  return storage.write(encodeSave(state));
}

export function clearSave(storage: SaveStorage = localStorageAdapter): void {
  storage.remove();
}

/** 匯出存檔為 JSON 字串（供下載備份）。 */
export function exportSaveText(storage: SaveStorage = localStorageAdapter): string | null {
  return storage.read();
}

/**
 * 匯入 JSON 存檔字串：先驗證後寫入。
 * 驗證失敗時回傳錯誤，不會覆蓋現有存檔。
 */
export function importSaveText(
  text: string,
  storage: SaveStorage = localStorageAdapter,
): DecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: "檔案不是有效的 JSON" };
  }
  const decoded = decodeSave(parsed);
  if (!decoded.ok) {
    return decoded;
  }
  if (!storage.write(text)) {
    return { ok: false, error: "無法寫入存檔（儲存空間可能已滿）" };
  }
  return decoded;
}

/**
 * 安裝自動存檔：狀態變更後以節流方式寫入（最多每 intervalMs 一次），
 * 頁面隱藏或關閉時立即寫入。回傳取消安裝的函式。
 */
export function installAutosave(state: Store<GameState>, intervalMs = 8000): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let lastSaveAt = 0;

  const saveNow = (): void => {
    pending = false;
    lastSaveAt = Date.now();
    writeSave(state.get());
  };

  const schedule = (): void => {
    if (timer !== null) {
      return;
    }
    const wait = Math.max(0, lastSaveAt + intervalMs - Date.now());
    timer = setTimeout(() => {
      timer = null;
      if (!pending) {
        return;
      }
      if (Date.now() - lastSaveAt >= intervalMs) {
        saveNow();
      } else {
        schedule();
      }
    }, wait);
  };

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      saveNow();
    }
  };

  const unsubscribe = state.subscribe(() => {
    pending = true;
    schedule();
  });

  const onHide = (): void => {
    flush();
  };
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flush();
    }
  });

  return () => {
    unsubscribe();
    window.removeEventListener("pagehide", onHide);
    flush();
  };
}
