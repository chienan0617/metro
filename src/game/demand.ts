/**
 * 乘客需求與客流分配。
 * 每個遊戲小時以重力模型產生城市間 OD 需求，透過路網搜尋路徑，
 * 依路線的實際運能（列車數 × 容量 × 班距）限制實際載運量並計算票務收入。
 */

import { dist } from "../core/math.ts";
import type { City, GameState, ID, Point } from "../core/types.ts";
import { DEMAND_CONFIG, FARE_CONFIG, WORLD_CONFIG, XP_PER_PASSENGER } from "./config.ts";
import { eventDemandMultiplier } from "./events.ts";
import { buildNetwork, findPathsFrom } from "./network.ts";
import { applyXp } from "./progression.ts";
import { gameDateFromMinutes } from "./time.ts";
import { routeHourlyCapacity } from "./trains.ts";

export function cityTripWeight(city: City): number {
  return DEMAND_CONFIG.typeTripWeight[city.cityType];
}

/** 目的地的吸引分數：人口 × 產業結構（商業、工業、教育、觀光）。 */
export function cityAttraction(city: City): number {
  const weights = DEMAND_CONFIG.attractionWeights;
  const industryScore =
    1 +
    city.industry.commercial * weights.commercial +
    city.industry.industrial * weights.industrial +
    city.industry.education * weights.education +
    city.industry.tourism * weights.tourism;
  return city.demandMultiplier * cityTripWeight(city) * industryScore;
}

export function fareForDistance(distanceKm: number): number {
  return Math.max(FARE_CONFIG.minFare, FARE_CONFIG.baseFare + FARE_CONFIG.farePerKm * distanceKm);
}

/** 目前時段的需求倍率（含平假日）。 */
export function hourlyDemandFactor(state: GameState): number {
  const date = gameDateFromMinutes(state.clock.minutes);
  const hourFactor = DEMAND_CONFIG.hourlyFactors[date.hour] ?? 0.5;
  const weekend = date.weekday >= 5 ? DEMAND_CONFIG.weekendFactor : 1;
  return hourFactor * weekend;
}

/** 單一 OD 對（每小時）的潛在需求。 */
export function pairDemand(
  state: GameState,
  origin: City,
  destination: City,
  hourFactor: number,
): number {
  const date = gameDateFromMinutes(state.clock.minutes);
  const isWeekend = date.weekday >= 5;
  const originStation = state.world.stations.find((s) => s.cityId === origin.id);
  const satisfaction = originStation?.satisfaction ?? 75;
  const satisfactionFactor =
    DEMAND_CONFIG.satisfactionRange[0] +
    (satisfaction / 100) * (DEMAND_CONFIG.satisfactionRange[1] - DEMAND_CONFIG.satisfactionRange[0]);

  const generation =
    cityTripWeight(origin) * origin.demandMultiplier * (origin.population / 500_000) ** DEMAND_CONFIG.populationExponent;
  const attraction =
    cityAttraction(destination) * (destination.population / 500_000) ** DEMAND_CONFIG.populationExponent;
  const distance = dist(origin.position, destination.position);
  const impedance =
    1 + (distance / DEMAND_CONFIG.refDistance) ** DEMAND_CONFIG.impedancePower;

  let eventMult = eventDemandMultiplier(state, origin.id) * eventDemandMultiplier(state, destination.id);
  if (isWeekend && (origin.cityType === "tourism" || destination.cityType === "tourism")) {
    eventMult *= DEMAND_CONFIG.weekendTourismBonus;
  }

  return (
    (DEMAND_CONFIG.baseTripsPerHour * generation * attraction * hourFactor * satisfactionFactor * eventMult) /
    impedance
  );
}

export interface HourlyDemandReport {
  generated: number;
  served: number;
  unserved: number;
  revenue: number;
}

/**
 * 執行一個小時的需求模擬。
 * 已服務人次受各路線每小時運能限制；沒有路徑的需求不計收入。
 */
export function runHourlyDemand(state: GameState): HourlyDemandReport {
  const hourFactor = hourlyDemandFactor(state);
  const graph = buildNetwork(state);

  const capacity = new Map<ID, number>();
  const load = new Map<ID, number>();
  for (const route of state.routes) {
    const routeCapacity = routeHourlyCapacity(state, route);
    capacity.set(route.id, routeCapacity);
    load.set(route.id, 0);
    route.stats.capacityToday += routeCapacity;
  }

  // 無限世界效能保護：城市太多時只模擬路網周邊範圍。
  // 每日營運只計算「已解鎖」的城市（自由模式全部視為解鎖）。
  const simulatedCities = limitSimulationCities(state).filter(
    (c) => c.unlocked || state.mode === "free",
  );
  const origins = simulatedCities;
  let generated = 0;
  let servedTotal = 0;
  let revenueTotal = 0;

  for (const origin of origins) {
    const originStationId = origin.stationIds[0];
    if (!originStationId) {
      continue;
    }
    const paths = findPathsFrom(graph, originStationId);
    for (const destination of simulatedCities) {
      if (destination.id === origin.id) {
        continue;
      }
      const demand = pairDemand(state, origin, destination, hourFactor);
      if (demand <= 0.001) {
        continue;
      }
      generated += demand;
      state.stats.totalGenerated += demand;

      const destinationStationId = destination.stationIds[0];
      const path = destinationStationId ? paths.get(destinationStationId) : undefined;
      if (!path) {
        state.stats.totalUnserved += demand;
        continue;
      }

      // 容量限制：整條路徑的每一段都必須有剩餘運能。
      let served = demand;
      for (const leg of path.legs) {
        const remaining = Math.max(0, (capacity.get(leg.routeId) ?? 0) - (load.get(leg.routeId) ?? 0));
        served = Math.min(served, remaining);
        if (served <= 0) {
          break;
        }
      }
      if (served <= 0.001) {
        state.stats.totalUnserved += demand;
        continue;
      }

      for (const leg of path.legs) {
        load.set(leg.routeId, (load.get(leg.routeId) ?? 0) + served);
      }

      const fare = fareForDistance(path.distanceKm);
      const revenue = fare * served;
      servedTotal += served;
      revenueTotal += revenue;
      state.stats.totalServed += served;
      state.stats.totalUnserved += demand - served;
      state.stats.totalRevenue += revenue;
      state.stats.totalPassengers += served;
      state.finance.todayRevenue += revenue;
      state.player.money += revenue;

      // 各路線統計（收入與服務指標依各路段的距離比例分攤）。
      for (const leg of path.legs) {
        const route = state.routes.find((r) => r.id === leg.routeId);
        if (!route) {
          continue;
        }
        const share = path.distanceKm > 0 ? leg.distanceKm / path.distanceKm : 1 / path.legs.length;
        route.stats.passengersToday += served;
        route.stats.passengersTotal += served;
        route.stats.revenueToday += revenue * share;
        route.stats.revenueTotal += revenue * share;
        route.stats.waitSumToday += path.waitMinutes * served * share;
        route.stats.journeySumToday += path.totalMinutes * served * share;
        route.stats.transfersSumToday += path.transfers * served * share;
      }

      // 車站統計。
      recordBoarding(state, originStationId, served);
      if (destinationStationId) {
        recordAlighting(state, destinationStationId, served);
      }
      for (let i = 0; i + 1 < path.legs.length; i++) {
        const leg = path.legs[i];
        if (leg) {
          recordTransfer(state, leg.toStationId, served);
        }
      }
    }
  }

  applyXp(state, servedTotal * XP_PER_PASSENGER);

  return {
    generated,
    served: servedTotal,
    unserved: generated - servedTotal,
    revenue: revenueTotal,
  };
}

/**
 * 需求模擬的城市集合。
 * 城市數量在保護值內時全部模擬；超過時以「路網中心（或起始核心）」為準，
 * 只模擬一定半徑內的城市，避免無限探索造成計算量爆炸。
 */
function limitSimulationCities(state: GameState): City[] {
  const cities = state.world.cities;
  if (cities.length <= WORLD_CONFIG.maxSimulationCities) {
    return cities;
  }
  let center: Point = state.world.startCore;
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (const route of state.routes) {
    for (const stationId of route.stationIds) {
      const station = state.world.stations.find((s) => s.id === stationId);
      if (station) {
        sumX += station.position.x;
        sumY += station.position.y;
        count++;
      }
    }
  }
  if (count > 0) {
    center = { x: sumX / count, y: sumY / count };
  }
  return cities
    .filter((c) => dist(c.position, center) <= WORLD_CONFIG.simulationRadius)
    .slice(0, WORLD_CONFIG.maxSimulationCities);
}

function recordBoarding(state: GameState, stationId: ID, count: number): void {
  const station = state.world.stations.find((s) => s.id === stationId);
  if (station) {
    station.stats.boardingsToday += count;
    station.stats.boardingsTotal += count;
  }
}

function recordAlighting(state: GameState, stationId: ID, count: number): void {
  const station = state.world.stations.find((s) => s.id === stationId);
  if (station) {
    station.stats.alightingsToday += count;
    station.stats.alightingsTotal += count;
  }
}

function recordTransfer(state: GameState, stationId: ID, count: number): void {
  const station = state.world.stations.find((s) => s.id === stationId);
  if (station) {
    station.stats.transfersToday += count;
  }
}
