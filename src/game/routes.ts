/**
 * 路線系統：草稿規劃、驗證、建設成本計算與路線管理。
 * 此模組為純遊戲邏輯，不依賴 DOM；路線拓撲與畫面幾何分離。
 */

import { dist } from "../core/math.ts";
import { emptyRouteStats } from "../core/types.ts";
import type { GameState, ID, Route, Station } from "../core/types.ts";
import { researchMultipliers } from "./research.ts";
import { samplerForWorld, sampleTerrainMultiplier } from "../world/terrain.ts";
import { cityById, stationById } from "../world/worldgen.ts";
import {
  BUILD_TYPE_MULTIPLIER,
  ECONOMY_CONFIG,
  ROUTE_CONFIG,
} from "./config.ts";
import { applyTransaction, shortfallFor } from "./economy.ts";

/** 建設草稿：只存在於 UI 操作流程中，確認後才成為正式路線。 */
export interface RouteDraft {
  stops: ID[];
  color: string;
}

export type DraftError =
  | "invalid_stop"
  | "locked_city"
  | "already_in_draft"
  | "too_few_stops"
  | "max_stops"
  | "segment_too_short"
  | "insufficient_funds";

export const DRAFT_ERROR_MESSAGES: Record<DraftError, string> = {
  invalid_stop: "找不到這個車站",
  locked_city: "此城市尚未解鎖，無法建設",
  already_in_draft: "此城市已在路線中",
  too_few_stops: "路線至少需要兩個停靠站",
  max_stops: "已達單一路線的停靠站上限",
  segment_too_short: "兩站距離過短，無法建設路段",
  insufficient_funds: "資金不足，無法完成建設",
};

export interface SegmentPreview {
  fromStationId: ID;
  toStationId: ID;
  distance: number;
  terrainMultiplier: number;
  cost: number;
}

export interface DraftPreview {
  stops: number;
  totalDistance: number;
  constructionCost: number;
  totalPopulation: number;
  transferStationCount: number;
  transferRouteCount: number;
  estimatedTripMinutes: number;
  segments: SegmentPreview[];
  affordable: boolean;
  shortfall: number;
}

export type AddStopResult = { ok: true } | { ok: false; error: DraftError };

export function createDraft(color: string): RouteDraft {
  return { stops: [], color };
}

/** 預設使用目前尚未被路線使用的顏色，依建立順序循環。 */
export function nextRouteColor(state: GameState): string {
  const palette = ROUTE_CONFIG.colorPalette;
  const used = new Set(state.routes.map((r) => r.color));
  for (const color of palette) {
    if (!used.has(color)) {
      return color;
    }
  }
  return palette[state.routes.length % palette.length] as string;
}

export function nextRouteName(state: GameState): string {
  return `${state.counters.route + 1} 號線`;
}

/** 兩站（車站 ID）之間的直線距離。 */
export function stationDistance(state: GameState, aId: ID, bId: ID): number {
  const a = stationById(state.world, aId);
  const b = stationById(state.world, bId);
  if (!a || !b) {
    return 0;
  }
  return dist(a.position, b.position);
}

/** 單一路段的建設成本。 */
export function segmentCost(state: GameState, a: Station, b: Station): SegmentPreview {
  const distance = dist(a.position, b.position);
  const sampler = samplerForWorld(state.world);
  const terrainMultiplier = sampleTerrainMultiplier(sampler.terrainAt, a.position, b.position);
  const cost =
    ECONOMY_CONFIG.trackCostPerUnit *
    distance *
    terrainMultiplier *
    BUILD_TYPE_MULTIPLIER.surface *
    researchMultipliers(state).trackCost;
  return {
    fromStationId: a.id,
    toStationId: b.id,
    distance,
    terrainMultiplier,
    cost,
  };
}

/** 純驗證：檢查某站能否加入草稿（不修改草稿），供即時預覽與加入共用。 */
export function canAddStop(state: GameState, draft: RouteDraft, stationId: ID): AddStopResult {
  const station = stationById(state.world, stationId);
  if (!station) {
    return { ok: false, error: "invalid_stop" };
  }
  const city = cityById(state.world, station.cityId);
  if (!city || !city.unlocked) {
    return { ok: false, error: "locked_city" };
  }
  if (draft.stops.includes(stationId)) {
    return { ok: false, error: "already_in_draft" };
  }
  if (draft.stops.length >= ROUTE_CONFIG.maxStops) {
    return { ok: false, error: "max_stops" };
  }
  const last = draft.stops[draft.stops.length - 1];
  if (last !== undefined) {
    const lastStation = stationById(state.world, last);
    if (!lastStation) {
      return { ok: false, error: "invalid_stop" };
    }
    if (dist(lastStation.position, station.position) < ROUTE_CONFIG.minSegmentDistance) {
      return { ok: false, error: "segment_too_short" };
    }
  }
  return { ok: true };
}

export function addStop(state: GameState, draft: RouteDraft, stationId: ID): AddStopResult {
  const result = canAddStop(state, draft, stationId);
  if (!result.ok) {
    return result;
  }
  draft.stops.push(stationId);
  return { ok: true };
}

export function removeStopAt(draft: RouteDraft, index: number): void {
  if (index >= 0 && index < draft.stops.length) {
    draft.stops.splice(index, 1);
  }
}

/** 將指定停靠站往左（delta = -1）或往右（delta = 1）移動。 */
export function moveStop(draft: RouteDraft, index: number, delta: -1 | 1): boolean {
  const target = index + delta;
  if (index < 0 || index >= draft.stops.length || target < 0 || target >= draft.stops.length) {
    return false;
  }
  const a = draft.stops[index] as ID;
  const b = draft.stops[target] as ID;
  draft.stops[index] = b;
  draft.stops[target] = a;
  return true;
}

export function previewDraft(state: GameState, draft: RouteDraft): DraftPreview {
  const segments: SegmentPreview[] = [];
  let totalDistance = 0;
  let cost = 0;

  for (let i = 0; i + 1 < draft.stops.length; i++) {
    const a = stationById(state.world, draft.stops[i] as ID);
    const b = stationById(state.world, draft.stops[i + 1] as ID);
    if (!a || !b) {
      continue;
    }
    const seg = segmentCost(state, a, b);
    segments.push(seg);
    totalDistance += seg.distance;
    cost += seg.cost;
  }

  const cityIds = new Set<ID>();
  const transferCityIds = new Set<ID>();
  const transferRouteIds = new Set<ID>();
  let totalPopulation = 0;
  for (const stationId of draft.stops) {
    const station = stationById(state.world, stationId);
    if (!station) {
      continue;
    }
    const city = cityById(state.world, station.cityId);
    if (city && !cityIds.has(city.id)) {
      cityIds.add(city.id);
      totalPopulation += city.population;
    }
    // 與現有路線的轉乘：此站已被其他路線停靠。
    if (station.routeIds.length > 0) {
      transferCityIds.add(station.cityId);
      for (const routeId of station.routeIds) {
        transferRouteIds.add(routeId);
      }
    }
  }

  const tripMinutes =
    (totalDistance / ECONOMY_CONFIG.referenceSpeedKmh) * 60 +
    draft.stops.length * ECONOMY_CONFIG.dwellMinutes;

  return {
    stops: draft.stops.length,
    totalDistance,
    constructionCost: cost,
    totalPopulation,
    transferStationCount: transferCityIds.size,
    transferRouteCount: transferRouteIds.size,
    estimatedTripMinutes: tripMinutes,
    segments,
    affordable: state.player.money >= cost,
    shortfall: shortfallFor(state, cost),
  };
}

export type ConfirmResult = { ok: true; route: Route } | { ok: false; error: DraftError };

/** 確認建設：驗證規則、扣除資金、建立路線並連接車站。 */
export function confirmDraft(
  state: GameState,
  draft: RouteDraft,
  options?: { name?: string },
): ConfirmResult {
  if (draft.stops.length < ROUTE_CONFIG.minStops) {
    return { ok: false, error: "too_few_stops" };
  }
  const unique = new Set(draft.stops);
  if (unique.size !== draft.stops.length) {
    return { ok: false, error: "already_in_draft" };
  }
  for (let i = 0; i + 1 < draft.stops.length; i++) {
    const distance = stationDistance(state, draft.stops[i] as ID, draft.stops[i + 1] as ID);
    if (distance < ROUTE_CONFIG.minSegmentDistance) {
      return { ok: false, error: "segment_too_short" };
    }
  }

  const preview = previewDraft(state, draft);
  const name = (options?.name ?? "").trim() || nextRouteName(state);
  const tx = applyTransaction(state, {
    category: "route_construction",
    description: `路線建設：${name}`,
    amount: -preview.constructionCost,
  });
  if (!tx.ok) {
    return { ok: false, error: "insufficient_funds" };
  }

  state.counters.route += 1;
  const route: Route = {
    id: `route-${state.counters.route}`,
    name,
    color: draft.color,
    stationIds: draft.stops.slice(),
    status: "active",
    totalDistance: preview.totalDistance,
    constructionCost: preview.constructionCost,
    departureInterval: ROUTE_CONFIG.defaultDepartureInterval,
    departureSlots: [state.clock.minutes, state.clock.minutes],
    assignedTrainIds: [],
    opsCostPending: 0,
    stats: emptyRouteStats(),
    createdAt: Date.now(),
  };
  state.routes.push(route);

  for (const stationId of route.stationIds) {
    const station = stationById(state.world, stationId);
    if (station && !station.routeIds.includes(route.id)) {
      station.routeIds.push(route.id);
    }
  }

  return { ok: true, route };
}

/**
 * 由幾何重新計算一條路線的距離與建設成本。
 * 供讀檔驗證使用：結果只取決於世界種子與停靠站順序，因此與原始建設值一致。
 */
export function routeGeometrics(
  state: GameState,
  stationIds: readonly ID[],
): { totalDistance: number; constructionCost: number } {
  let totalDistance = 0;
  let constructionCost = 0;
  for (let i = 0; i + 1 < stationIds.length; i++) {
    const a = stationById(state.world, stationIds[i] as ID);
    const b = stationById(state.world, stationIds[i + 1] as ID);
    if (!a || !b) {
      continue;
    }
    const segment = segmentCost(state, a, b);
    totalDistance += segment.distance;
    constructionCost += segment.cost;
  }
  return { totalDistance, constructionCost };
}

export function deleteRoute(state: GameState, routeId: ID): boolean {
  const index = state.routes.findIndex((r) => r.id === routeId);
  if (index < 0) {
    return false;
  }
  state.routes.splice(index, 1);
  for (const station of state.world.stations) {
    const i = station.routeIds.indexOf(routeId);
    if (i >= 0) {
      station.routeIds.splice(i, 1);
    }
  }
  for (const train of state.trains) {
    if (train.routeId === routeId) {
      train.routeId = null;
      train.status = "idle";
      train.currentSegmentIndex = 0;
      train.progressOnSegment = 0;
      train.direction = 1;
      train.passengers = 0;
    }
  }
  return true;
}

export function renameRoute(state: GameState, routeId: ID, name: string): boolean {
  const route = state.routes.find((r) => r.id === routeId);
  const trimmed = name.trim();
  if (!route || trimmed.length === 0) {
    return false;
  }
  route.name = trimmed.slice(0, 24);
  return true;
}

export function setRouteColor(state: GameState, routeId: ID, color: string): boolean {
  const route = state.routes.find((r) => r.id === routeId);
  if (!route) {
    return false;
  }
  route.color = color;
  return true;
}
