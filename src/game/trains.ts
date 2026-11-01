/**
 * 車隊系統：購買列車、指派路線、班距設定與運能估算。
 * 純遊戲邏輯，不依賴 DOM。
 */

import type { GameState, ID, Route, Train, TrainModel } from "../core/types.ts";
import { ECONOMY_CONFIG, TRAIN_CONFIG, TRAIN_UPGRADE_CONFIG } from "./config.ts";
import { applyTransaction } from "./economy.ts";
import { researchMultipliers } from "./research.ts";
import { trainModelById } from "./trainModels.ts";
import { stationById } from "../world/worldgen.ts";
import { dist } from "../core/math.ts";

/* ------------------------------ 有效數值（升級 × 科技） ------------------------------ */

export function effectiveTrainCapacity(state: GameState, train: Train): number {
  const model = trainModelById(train.modelId);
  if (!model) {
    return 0;
  }
  const levelMult = 1 + TRAIN_UPGRADE_CONFIG.capacityPerLevel * (train.level - 1);
  return Math.round(model.capacity * levelMult * researchMultipliers(state).trainCapacity);
}

export function effectiveTrainSpeedKmh(state: GameState, train: Train): number {
  const model = trainModelById(train.modelId);
  if (!model) {
    return ECONOMY_CONFIG.referenceSpeedKmh;
  }
  const levelMult = 1 + TRAIN_UPGRADE_CONFIG.speedPerLevel * (train.level - 1);
  return model.maxSpeed * levelMult * researchMultipliers(state).trainSpeed;
}

/** 能源消耗係數：已包含列車等級與科技效果（乘上基礎能源成本用）。 */
export function effectiveTrainEnergyFactor(state: GameState, train: Train): number {
  const model = trainModelById(train.modelId);
  if (!model) {
    return 1;
  }
  const levelMult = 1 - TRAIN_UPGRADE_CONFIG.energyReductionPerLevel * (train.level - 1);
  const research = researchMultipliers(state);
  return model.energyRate * levelMult * research.trainEnergy * research.energyOp;
}

/** 列車升級費用（下一級的價格）；已滿級回傳 null。 */
export function trainUpgradeCost(train: Train): number | null {
  const model = trainModelById(train.modelId);
  if (!model || train.level >= TRAIN_UPGRADE_CONFIG.maxLevel) {
    return null;
  }
  return Math.round(model.purchasePrice * TRAIN_UPGRADE_CONFIG.costRatio * train.level);
}

/** 升級列車一級：提高容量與速度、降低能源消耗。 */
export function upgradeTrain(
  state: GameState,
  trainId: ID,
): { ok: true } | { ok: false; error: string } {
  const train = state.trains.find((t) => t.id === trainId);
  if (!train) {
    return { ok: false, error: "找不到這輛列車" };
  }
  const cost = trainUpgradeCost(train);
  const model = trainModelById(train.modelId);
  if (cost === null || !model) {
    return { ok: false, error: "已達最高等級" };
  }
  const tx = applyTransaction(state, {
    category: "train_purchase",
    description: `列車升級：${model.name} → Lv.${train.level + 1}`,
    amount: -cost,
  });
  if (!tx.ok) {
    return { ok: false, error: "資金不足" };
  }
  train.level += 1;
  return { ok: true };
}

export function routeAssignedTrains(state: GameState, route: Route): Train[] {
  return route.assignedTrainIds
    .map((id) => state.trains.find((t) => t.id === id))
    .filter((t): t is Train => t !== undefined);
}

/** 路線車隊的平均有效速度；沒有列車時使用參考速度。 */
export function routeAvgSpeedKmh(state: GameState, route: Route): number {
  const trains = routeAssignedTrains(state, route);
  if (trains.length === 0) {
    return ECONOMY_CONFIG.referenceSpeedKmh;
  }
  let sum = 0;
  for (const train of trains) {
    sum += effectiveTrainSpeedKmh(state, train);
  }
  return sum / trains.length;
}

/** 單向實際班距（分鐘）；沒有列車時回傳 null。 */
export function routeHeadwayMinutes(state: GameState, route: Route): number | null {
  const trains = routeAssignedTrains(state, route);
  if (trains.length === 0) {
    return null;
  }
  const singleTrip = tripMinutes(route, routeAvgSpeedKmh(state, route));
  const roundTrip = singleTrip * 2 + TRAIN_CONFIG.dwellMinutes * 2;
  return Math.max(roundTrip / trains.length, route.departureInterval);
}

/** 每小時可載運人次（單向）；沒有列車時為 0。 */
export function routeHourlyCapacity(state: GameState, route: Route): number {
  const headway = routeHeadwayMinutes(state, route);
  if (headway === null || route.status !== "active") {
    return 0;
  }
  const trains = routeAssignedTrains(state, route);
  let capacitySum = 0;
  for (const train of trains) {
    capacitySum += effectiveTrainCapacity(state, train);
  }
  const avgCapacity = capacitySum / trains.length;
  return (avgCapacity * 60) / headway;
}

export type PurchaseError = "model_not_found" | "locked" | "insufficient_funds";

export const PURCHASE_ERROR_MESSAGES: Record<PurchaseError, string> = {
  model_not_found: "找不到這個列車型號",
  locked: "此型號尚未解鎖",
  insufficient_funds: "資金不足，無法購買",
};

export function isModelUnlocked(state: GameState, model: TrainModel): boolean {
  return state.player.level >= model.unlockLevel;
}

export function purchaseTrain(
  state: GameState,
  modelId: string,
): { ok: true; train: Train } | { ok: false; error: PurchaseError } {
  const model = trainModelById(modelId);
  if (!model) {
    return { ok: false, error: "model_not_found" };
  }
  if (!isModelUnlocked(state, model)) {
    return { ok: false, error: "locked" };
  }
  const tx = applyTransaction(state, {
    category: "train_purchase",
    description: `購買列車：${model.name}`,
    amount: -model.purchasePrice,
  });
  if (!tx.ok) {
    return { ok: false, error: "insufficient_funds" };
  }

  state.counters.train += 1;
  const train: Train = {
    id: `train-${state.counters.train}`,
    modelId: model.id,
    level: 1,
    durability: 100,
    routeId: null,
    status: "idle",
    currentSegmentIndex: 0,
    progressOnSegment: 0,
    direction: 1,
    passengers: 0,
    dwellRemaining: 0,
  };
  state.trains.push(train);
  return { ok: true, train };
}

export type AssignError = "train_not_found" | "route_not_found" | "invalid_state";

export const ASSIGN_ERROR_MESSAGES: Record<AssignError, string> = {
  train_not_found: "找不到這輛列車",
  route_not_found: "找不到這條路線",
  invalid_state: "路線狀態無法配置列車",
};

/** 將列車指派到路線（routeId 為 null 時解除指派）。 */
export function assignTrainToRoute(
  state: GameState,
  trainId: ID,
  routeId: ID | null,
): { ok: true } | { ok: false; error: AssignError } {
  const train = state.trains.find((t) => t.id === trainId);
  if (!train) {
    return { ok: false, error: "train_not_found" };
  }

  // 先從原本的路線移除。
  if (train.routeId) {
    const previous = state.routes.find((r) => r.id === train.routeId);
    if (previous) {
      previous.assignedTrainIds = previous.assignedTrainIds.filter((id) => id !== trainId);
    }
  }

  if (routeId === null) {
    train.routeId = null;
    train.status = "idle";
    train.passengers = 0;
    train.dwellRemaining = 0;
    train.currentSegmentIndex = 0;
    train.progressOnSegment = 0;
    train.direction = 1;
    return { ok: true };
  }

  const route = state.routes.find((r) => r.id === routeId);
  if (!route) {
    return { ok: false, error: "route_not_found" };
  }
  if (route.stationIds.length < 2) {
    return { ok: false, error: "invalid_state" };
  }
  if (!route.assignedTrainIds.includes(trainId)) {
    route.assignedTrainIds.push(trainId);
  }
  train.routeId = routeId;
  train.passengers = 0;
  train.status = "stopped";
  train.dwellRemaining = 0;
  spaceTrainsEvenly(state, route);
  return { ok: true };
}

/** 將路線上所有列車沿全程均勻分布，讓班距穩定。 */
export function spaceTrainsEvenly(state: GameState, route: Route): void {
  const trains = route.assignedTrainIds
    .map((id) => state.trains.find((t) => t.id === id))
    .filter((t): t is Train => t !== undefined);
  const count = trains.length;
  trains.forEach((train, index) => {
    const fraction = count > 1 ? index / count : 0;
    placeTrainAtFraction(state, train, route, fraction);
  });
}

/** 依比例把列車放到路線上的位置（0 = 起點站）。 */
export function placeTrainAtFraction(
  state: GameState,
  train: Train,
  route: Route,
  fraction: number,
): void {
  const lengths = segmentLengths(state, route);
  const total = lengths.reduce((sum, value) => sum + value, 0);
  train.direction = 1;
  train.dwellRemaining = 0;
  if (total <= 0 || route.stationIds.length < 2) {
    train.currentSegmentIndex = 0;
    train.progressOnSegment = 0;
    train.status = "stopped";
    return;
  }
  let target = Math.min(Math.max(fraction, 0), 0.9999) * total;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i] as number;
    if (target < length || i === lengths.length - 1) {
      train.currentSegmentIndex = i;
      train.progressOnSegment = length > 0 ? Math.min(target / length, 1) : 0;
      // 停在車站（進度 0）時視為待發車，會經過端點的發車時刻檢查。
      train.status = train.progressOnSegment > 0 ? "running" : "stopped";
      return;
    }
    target -= length;
  }
}

export function sellTrain(
  state: GameState,
  trainId: ID,
): { ok: true; refund: number } | { ok: false; error: "train_not_found" } {
  const index = state.trains.findIndex((t) => t.id === trainId);
  if (index < 0) {
    return { ok: false, error: "train_not_found" };
  }
  const train = state.trains[index] as Train;
  const model = trainModelById(train.modelId);
  const refund = Math.round((model?.purchasePrice ?? 0) * TRAIN_CONFIG.sellRefundRatio);
  if (train.routeId) {
    const route = state.routes.find((r) => r.id === train.routeId);
    if (route) {
      route.assignedTrainIds = route.assignedTrainIds.filter((id) => id !== trainId);
    }
  }
  state.trains.splice(index, 1);
  if (refund > 0) {
    applyTransaction(state, {
      category: "train_sale",
      description: `出售列車：${model?.name ?? train.modelId}`,
      amount: refund,
    });
  }
  return { ok: true, refund };
}

export function setRouteInterval(state: GameState, routeId: ID, minutes: number): boolean {
  const route = state.routes.find((r) => r.id === routeId);
  if (!route) {
    return false;
  }
  const clamped = Math.min(Math.max(Math.round(minutes), 1), 120);
  route.departureInterval = clamped;
  return true;
}

/** 暫停／恢復營運。恢復時重設發車時刻，避免累積的班次一次湧出。 */
export function setRouteOperationStatus(
  state: GameState,
  routeId: ID,
  status: "active" | "suspended",
): boolean {
  const route = state.routes.find((r) => r.id === routeId);
  if (!route || (route.status !== "active" && route.status !== "suspended")) {
    return false;
  }
  if (route.status === status) {
    return true;
  }
  route.status = status;
  if (status === "active") {
    route.departureSlots = [state.clock.minutes, state.clock.minutes];
  }
  return true;
}

/** 各路段的實際距離（公里）。 */
export function segmentLengths(state: GameState, route: Route): number[] {
  const lengths: number[] = [];
  for (let i = 0; i + 1 < route.stationIds.length; i++) {
    const a = stationById(state.world, route.stationIds[i] as ID);
    const b = stationById(state.world, route.stationIds[i + 1] as ID);
    lengths.push(a && b ? dist(a.position, b.position) : 0);
  }
  return lengths;
}

/** 以指定平均速度估算單程行駛時間（含停靠）。 */
export function tripMinutes(route: Route, speedKmh: number): number {
  const speed = speedKmh > 1 ? speedKmh : ECONOMY_CONFIG.referenceSpeedKmh;
  const dwell = TRAIN_CONFIG.dwellMinutes * Math.max(0, route.stationIds.length - 2);
  return (route.totalDistance / speed) * 60 + dwell;
}

export interface RouteFleetStats {
  trainCount: number;
  avgSpeedKmh: number;
  avgCapacity: number;
  /** 實際班距（單向，遊戲分鐘）：受車輛數與發車間隔限制；無列車時為 null。 */
  actualIntervalMinutes: number | null;
  /** 預估單向運能（人／時）。 */
  capacityPerHour: number | null;
  /** 建議列車數（以目前發車間隔達成）。 */
  suggestedTrains: number;
  roundTripMinutes: number;
  /** 每日能源與維護估算（全部指派列車連續營運）。 */
  dailyEnergyCost: number;
  dailyMaintenanceCost: number;
}

export function routeFleetStats(state: GameState, route: Route): RouteFleetStats {
  const trains = routeAssignedTrains(state, route);

  let speedSum = 0;
  let capacitySum = 0;
  let energyPerDay = 0;
  let maintenancePerDay = 0;
  for (const train of trains) {
    const model = trainModelById(train.modelId);
    if (!model) {
      continue;
    }
    speedSum += effectiveTrainSpeedKmh(state, train);
    capacitySum += effectiveTrainCapacity(state, train);
    maintenancePerDay += model.maintenanceRate;
  }
  const count = trains.length;
  const avgSpeed = count > 0 ? speedSum / count : ECONOMY_CONFIG.referenceSpeedKmh;
  const avgCapacity = count > 0 ? capacitySum / count : 0;

  const singleTrip = tripMinutes(route, avgSpeed);
  const roundTrip = singleTrip * 2 + TRAIN_CONFIG.dwellMinutes * 2;
  const fleetHeadway = count > 0 ? roundTrip / count : Number.POSITIVE_INFINITY;
  const interval = Math.max(fleetHeadway, route.departureInterval);
  const actualInterval = count > 0 && Number.isFinite(interval) ? interval : null;
  const capacityPerHour =
    actualInterval !== null && avgCapacity > 0 ? (avgCapacity * 60) / actualInterval : null;

  const suggested = Math.min(
    TRAIN_CONFIG.maxSuggestedTrains,
    Math.max(1, Math.ceil((roundTrip + singleTrip * 0.5) / Math.max(route.departureInterval, 1))),
  );

  // 每日能源：以平均速度連續行駛估算（含折返停靠的比例折扣）。
  const utilization = 0.85;
  for (const train of trains) {
    const speed = effectiveTrainSpeedKmh(state, train);
    const kmPerDay = speed * 24 * utilization;
    energyPerDay += kmPerDay * TRAIN_CONFIG.energyCostPerKm * effectiveTrainEnergyFactor(state, train);
  }

  return {
    trainCount: count,
    avgSpeedKmh: avgSpeed,
    avgCapacity,
    actualIntervalMinutes: actualInterval,
    capacityPerHour,
    suggestedTrains: suggested,
    roundTripMinutes: roundTrip,
    dailyEnergyCost: energyPerDay,
    dailyMaintenanceCost: maintenancePerDay,
  };
}
