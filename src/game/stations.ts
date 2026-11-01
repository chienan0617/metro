/**
 * 車站系統：容量、升級、營運成本與商業收入。
 */

import type { GameState, ID, Station } from "../core/types.ts";
import { STATION_ECONOMY } from "./config.ts";
import { applyTransaction } from "./economy.ts";
import { eventStationCapacityMultiplier } from "./events.ts";
import { researchMultipliers } from "./research.ts";

/** 車站的有效容量（包含升級、科技與事件效果）。 */
export function stationEffectiveCapacity(state: GameState, station: Station): number {
  const levelMult = STATION_ECONOMY.capacityMultiplierPerLevel ** (station.level - 1);
  const research = researchMultipliers(state);
  const eventMult = eventStationCapacityMultiplier(state, station.cityId);
  return Math.round(station.capacity * levelMult * research.stationCapacity * eventMult);
}

/** 升到下一級的費用；已達上限回傳 null。 */
export function stationUpgradeCost(station: Station): number | null {
  if (station.level >= STATION_ECONOMY.maxLevel) {
    return null;
  }
  return STATION_ECONOMY.upgradeCosts[station.level - 1] ?? null;
}

export function upgradeStation(
  state: GameState,
  stationId: ID,
): { ok: true } | { ok: false; error: string } {
  const station = state.world.stations.find((s) => s.id === stationId);
  if (!station) {
    return { ok: false, error: "找不到車站" };
  }
  const cost = stationUpgradeCost(station);
  if (cost === null) {
    return { ok: false, error: "已達最高等級" };
  }
  const tx = applyTransaction(state, {
    category: "station",
    description: `車站升級：${station.name} → Lv.${station.level + 1}`,
    amount: -cost,
  });
  if (!tx.ok) {
    return { ok: false, error: "資金不足" };
  }
  station.level += 1;
  station.satisfaction = Math.min(
    100,
    station.satisfaction + STATION_ECONOMY.satisfactionBonusPerLevel,
  );
  return { ok: true };
}

/**
 * 車站每日營運成本。
 * 只有「已開通（有路線停靠）」的車站才計費；探索發現但尚未連接的車站為 0 成本，
 * 因此擴大探索不會增加營運負擔。
 */
export function stationDailyCost(station: Station): number {
  if (station.routeIds.length === 0) {
    return 0;
  }
  return STATION_ECONOMY.baseCostPerDay + STATION_ECONOMY.costPerLevel * (station.level - 1);
}

/** 車站每日商業收入（租金與廣告），受等級與車站科技影響。 */
export function stationDailyIncome(state: GameState, station: Station): number {
  if (station.routeIds.length === 0) {
    return 0;
  }
  const levelBonus = STATION_ECONOMY.commercialPerLevel * (station.level - 1);
  const base = STATION_ECONOMY.baseCommercialIncome + levelBonus;
  const research = researchMultipliers(state);
  const trafficBonus = Math.min(3, station.stats.boardingsTotal > 0 ? 1 + Math.log10(1 + station.stats.boardingsTotal) * 0.3 : 1);
  return base * research.stationCommercial * trafficBonus;
}

/** 每日更新車站滿意度：候車時間與擁擠程度會影響分數。 */
export function updateStationSatisfaction(state: GameState): void {
  for (const station of state.world.stations) {
    if (station.routeIds.length === 0) {
      // 無路線服務時慢慢回到基準值。
      station.satisfaction += (75 - station.satisfaction) * 0.1;
      continue;
    }
    let waitAvg = 0;
    let loadAvg = 0;
    let count = 0;
    for (const routeId of station.routeIds) {
      const route = state.routes.find((r) => r.id === routeId);
      if (!route) {
        continue;
      }
      const passengers = route.stats.passengersToday;
      if (passengers > 0) {
        waitAvg += route.stats.waitSumToday / passengers;
      }
      if (route.stats.capacityToday > 0) {
        loadAvg += Math.min(1.5, passengers / route.stats.capacityToday);
      }
      count++;
    }
    if (count === 0) {
      continue;
    }
    const avgWait = waitAvg / count;
    const avgLoad = loadAvg / count;
    const waitPenalty = Math.max(0, avgWait - 4) * 1.6;
    const crowdPenalty = Math.max(0, avgLoad - 0.75) * 40;
    const target = Math.max(35, Math.min(98, 92 - waitPenalty - crowdPenalty));
    station.satisfaction += (target - station.satisfaction) * 0.35;
  }
}
