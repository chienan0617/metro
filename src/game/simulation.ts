/**
 * 營運模擬核心。
 * 以固定時間步進（每次 1 遊戲分鐘）推進：列車移動、停站、折返、發車調度、營運成本、
 * 每小時的乘客需求與客流分配，以及每日結算（財務、統計、成長、事件、任務與研究）。
 * 與畫面完全分離，可獨立測試。
 */

import type { GameState, ID, Route, Train, TrainModel } from "../core/types.ts";
import { GROWTH_CONFIG, TRAIN_CONFIG } from "./config.ts";
import { runHourlyDemand } from "./demand.ts";
import { applyTransaction, recordLedgerEntry } from "./economy.ts";
import { eventEnergyCostMultiplier, eventGrowthMultiplier, rollDailyEvents } from "./events.ts";
import { checkMission } from "./missions.ts";
import { researchMultipliers, updateResearch } from "./research.ts";
import { stationDailyCost, stationDailyIncome, updateStationSatisfaction } from "./stations.ts";
import { MINUTES_PER_DAY } from "./time.ts";
import { effectiveTrainEnergyFactor, segmentLengths } from "./trains.ts";
import { trainModelById } from "./trainModels.ts";

/** 推進一個遊戲分鐘。所有模擬狀態變更都在這裡發生。 */
export function stepMinute(state: GameState): void {
  state.clock.minutes += 1;

  for (const train of state.trains) {
    const model = trainModelById(train.modelId);
    if (!model) {
      continue;
    }
    const route = train.routeId !== null ? findRouteById(state, train.routeId) : null;
    if (train.routeId !== null && !route) {
      // 路線已被刪除：列車回到待命。
      train.routeId = null;
      train.status = "idle";
      train.passengers = 0;
    }
    if (!route) {
      train.status = "idle";
      continue;
    }
    if (route.status === "suspended") {
      if (train.status !== "maintenance") {
        train.status = "stopped";
      }
      // 暫停營運：不移動、不耗能，但維護費仍會累計（見下）。
      continue;
    }
    if (train.status === "maintenance") {
      continue;
    }
    advanceTrain(state, train, route, model);
  }

  accrueOperatingCosts(state);

  if (state.clock.minutes % 60 === 0) {
    runHourlyDemand(state);
  }
  if (state.clock.minutes % MINUTES_PER_DAY === 0) {
    settleDay(state);
  }
}

/**
 * 是否為環狀線：起點與終點相同（且至少三站），列車會單向循環而不折返。
 */
export function isLoopRoute(route: Route): boolean {
  return (
    route.stationIds.length >= 3 &&
    route.stationIds[0] === route.stationIds[route.stationIds.length - 1]
  );
}

/** 列車每分鐘的移動與停靠。 */
function advanceTrain(state: GameState, train: Train, route: Route, model: TrainModel): void {
  if (route.stationIds.length < 2) {
    return;
  }
  if (train.dwellRemaining > 0) {
    train.status = "stopped";
    train.dwellRemaining -= 1;
    return;
  }
  const loop = isLoopRoute(route);

  // 停靠結束；只有在「停在端點站」時才需要等待發車時刻（行進中的列車不檢查）。
  if (train.progressOnSegment === 0) {
    const stationIndex =
      train.direction === 1 ? train.currentSegmentIndex : train.currentSegmentIndex + 1;
    const lastIndex = route.stationIds.length - 1;
    // 環狀線沒有終點站：只在起點站檢查發車時刻（列車不會折返）。
    if (stationIndex === 0 || (!loop && stationIndex === lastIndex)) {
      const slotIndex = stationIndex === 0 ? 0 : 1;
      const nextSlot = route.departureSlots[slotIndex] ?? 0;
      if (state.clock.minutes < nextSlot) {
        train.status = "stopped";
        train.dwellRemaining = 1;
        return;
      }
      route.departureSlots[slotIndex] = state.clock.minutes + route.departureInterval;
    }
  }

  const lengths = segmentLengths(state, route);
  const segmentLength = lengths[train.currentSegmentIndex] ?? 0;
  if (segmentLength <= 0) {
    // 防禦：資料異常時不讓列車卡死。
    train.currentSegmentIndex = 0;
    train.progressOnSegment = 0;
    train.status = "stopped";
    return;
  }

  const kmPerMinute = model.maxSpeed / 60;
  const progressDelta = kmPerMinute / segmentLength;
  train.status = "running";
  train.progressOnSegment += progressDelta;

  if (train.progressOnSegment >= 1) {
    arriveAtStation(train, route);
    return;
  }

  // 能源成本：本分鐘實際行駛距離 × 有效能源係數（升級與科技）。
  route.opsCostPending +=
    kmPerMinute * TRAIN_CONFIG.energyCostPerKm * effectiveTrainEnergyFactor(state, train) *
    eventEnergyCostMultiplier(state);
}

/** 抵達下一站：更新路段、折返（環狀線則循環）與停靠時間。 */
function arriveAtStation(train: Train, route: Route): void {
  const lastIndex = route.stationIds.length - 1;
  if (train.direction === 1) {
    const station = train.currentSegmentIndex + 1;
    if (station >= lastIndex) {
      if (isLoopRoute(route)) {
        // 環狀線：回到起點後繼續同一方向循環。
        train.currentSegmentIndex = 0;
        train.direction = 1;
      } else {
        train.direction = -1;
        train.currentSegmentIndex = lastIndex - 1;
      }
    } else {
      train.currentSegmentIndex = station;
    }
  } else {
    const station = train.currentSegmentIndex;
    if (station <= 0) {
      train.direction = 1;
      train.currentSegmentIndex = 0;
    } else {
      train.currentSegmentIndex = station - 1;
    }
  }
  train.progressOnSegment = 0;
  train.dwellRemaining = TRAIN_CONFIG.dwellMinutes;
  train.status = "stopped";
}

/** 每分鐘累計維護成本（所有列車，包括待命列車），含營運科技折扣。 */
function accrueOperatingCosts(state: GameState): void {
  const maintenanceMult = researchMultipliers(state).maintenance;
  for (const train of state.trains) {
    const model = trainModelById(train.modelId);
    if (!model) {
      continue;
    }
    const maintenance = (model.maintenanceRate / MINUTES_PER_DAY) * maintenanceMult;
    const route = train.routeId !== null ? findRouteById(state, train.routeId) : null;
    if (route) {
      route.opsCostPending += maintenance;
    } else {
      state.depotCostPending += maintenance;
    }
  }
}

/** 每日結算：營運成本、車站收支、票務收入紀錄、財務摘要、統計重置、成長、事件、任務與研究。 */
export function settleDay(state: GameState): void {
  const day = Math.floor(state.clock.minutes / MINUTES_PER_DAY);
  let totalCost = 0;

  // 1. 列車能源與維護（逐分鐘累計）。
  for (const route of state.routes) {
    if (route.opsCostPending > 0.01) {
      applyTransaction(state, {
        category: "train_operation",
        description: `${route.name} 營運支出（能源與維護）`,
        amount: -route.opsCostPending,
        allowNegative: true,
      });
      totalCost += route.opsCostPending;
      route.opsCostPending = 0;
    }
  }
  if (state.depotCostPending > 0.01) {
    applyTransaction(state, {
      category: "train_operation",
      description: "待命列車維護支出",
      amount: -state.depotCostPending,
      allowNegative: true,
    });
    totalCost += state.depotCostPending;
    state.depotCostPending = 0;
  }

  // 2. 車站成本與商業收入（僅計費已開通的車站，未連接的車站不產生任何費用）。
  for (const station of state.world.stations) {
    if (station.routeIds.length === 0) {
      continue;
    }
    const cost = stationDailyCost(station);
    if (cost > 0.5) {
      applyTransaction(state, {
        category: "station",
        description: `車站營運支出：${station.name}`,
        amount: -cost,
        allowNegative: true,
      });
      totalCost += cost;
    }

    const income = stationDailyIncome(state, station);
    if (income > 0.5) {
      applyTransaction(state, {
        category: "station",
        description: `車站商業收入：${station.name}`,
        amount: income,
      });
      state.finance.todayRevenue += income;
    }
  }

  // 3. 票務收入：資金已在每小時入帳，這裡只寫財務紀錄。
  for (const route of state.routes) {
    if (route.stats.revenueToday >= 1) {
      recordLedgerEntry(state, {
        category: "ticket_revenue",
        description: `${route.name} 票務收入`,
        amount: route.stats.revenueToday,
      });
    }
  }

  // 4. 財務摘要。
  state.finance.history.push({
    day,
    revenue: state.finance.todayRevenue,
    cost: totalCost,
  });
  if (state.finance.history.length > 180) {
    state.finance.history.splice(0, state.finance.history.length - 180);
  }
  state.finance.todayRevenue = 0;

  // 5. 重置「今日」統計（累計值保留）。
  for (const route of state.routes) {
    route.stats.passengersToday = 0;
    route.stats.revenueToday = 0;
    route.stats.waitSumToday = 0;
    route.stats.journeySumToday = 0;
    route.stats.transfersSumToday = 0;
    route.stats.capacityToday = 0;
  }
  for (const station of state.world.stations) {
    station.stats.boardingsToday = 0;
    station.stats.alightingsToday = 0;
    station.stats.transfersToday = 0;
  }

  // 6. 服務品質：更新車站滿意度。
  updateStationSatisfaction(state);

  // 7. 城市成長。
  for (const city of state.world.cities) {
    const boom = eventGrowthMultiplier(state, city.id);
    const dailyRate = (city.growthRate / GROWTH_CONFIG.daysPerYear) * boom;
    city.population = Math.min(4_000_000, city.population * (1 + dailyRate));
  }

  // 8. 研究、事件與任務。
  updateResearch(state);
  rollDailyEvents(state);
  checkMission(state);
}

function findRouteById(state: GameState, routeId: ID): Route | null {
  return state.routes.find((r) => r.id === routeId) ?? null;
}
