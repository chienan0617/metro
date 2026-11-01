/**
 * 路網圖與乘客路徑搜尋。
 * 節點：車站月台（P）與「車站 × 路線」的乘車狀態（R），讓轉乘與候車成本可以正確計算。
 * 僅包含營運中、且已有列車的路線；其餘路線無法載客。
 */

import { dist } from "../core/math.ts";
import type { GameState, ID } from "../core/types.ts";
import { DEMAND_CONFIG, TRAIN_CONFIG } from "./config.ts";
import { stationById } from "../world/worldgen.ts";
import { routeAvgSpeedKmh, routeAssignedTrains, routeHeadwayMinutes } from "./trains.ts";

export interface NetworkPathLeg {
  routeId: ID;
  fromStationId: ID;
  toStationId: ID;
  minutes: number;
  distanceKm: number;
}

export interface NetworkPath {
  legs: NetworkPathLeg[];
  transfers: number;
  waitMinutes: number;
  inVehicleMinutes: number;
  distanceKm: number;
  /** 總旅行時間（含候車與轉乘懲罰，不含最後一次下車的懲罰）。 */
  totalMinutes: number;
}

interface Edge {
  to: string;
  minutes: number;
  kind: "board" | "alight" | "ride";
  routeId?: ID;
  fromStationId?: ID;
  toStationId?: ID;
  distanceKm?: number;
}

export interface NetworkGraph {
  edges: Map<string, Edge[]>;
  stationIds: Set<ID>;
  /** 轉乘懲罰（分鐘），受車站等級與科技影響。 */
  transferPenalty: number;
}

const PLATFORM = "P:";
const RIDE = "R:";

function platformKey(stationId: ID): string {
  return `${PLATFORM}${stationId}`;
}

function rideKey(stationId: ID, routeId: ID): string {
  return `${RIDE}${stationId}:${routeId}`;
}

export function buildNetwork(state: GameState): NetworkGraph {
  const edges = new Map<string, Edge[]>();
  const stationIds = new Set<ID>();
  const transferPenalty = 6;

  const addEdge = (from: string, edge: Edge): void => {
    const list = edges.get(from);
    if (list) {
      list.push(edge);
    } else {
      edges.set(from, [edge]);
    }
  };

  for (const station of state.world.stations) {
    stationIds.add(station.id);
  }

  for (const route of state.routes) {
    if (route.status !== "active" || route.stationIds.length < 2) {
      continue;
    }
    if (routeAssignedTrains(state, route).length === 0) {
      continue;
    }
    const headway = routeHeadwayMinutes(state, route);
    if (headway === null) {
      continue;
    }
    const wait = Math.min(headway / 2, DEMAND_CONFIG.maxWaitMinutes);
    const speed = routeAvgSpeedKmh(state, route);

    // 月台 <-> 乘車狀態的上下車邊。
    for (const stationId of route.stationIds) {
      const platform = platformKey(stationId);
      const ride = rideKey(stationId, route.id);
      addEdge(platform, { to: ride, minutes: wait, kind: "board", routeId: route.id });
      addEdge(ride, { to: platform, minutes: transferPenalty, kind: "alight", routeId: route.id });
    }

    // 相鄰停靠站之間的行駛邊（雙向）。
    const stationPositions = route.stationIds.map((id) => stationById(state.world, id));
    for (let i = 0; i + 1 < route.stationIds.length; i++) {
      const a = stationPositions[i];
      const b = stationPositions[i + 1];
      if (!a || !b) {
        continue;
      }
      const distance = dist(a.position, b.position);
      const minutes = (distance / speed) * 60 + TRAIN_CONFIG.dwellMinutes;
      addEdge(rideKey(a.id, route.id), {
        to: rideKey(b.id, route.id),
        minutes,
        kind: "ride",
        routeId: route.id,
        fromStationId: a.id,
        toStationId: b.id,
        distanceKm: distance,
      });
      addEdge(rideKey(b.id, route.id), {
        to: rideKey(a.id, route.id),
        minutes,
        kind: "ride",
        routeId: route.id,
        fromStationId: b.id,
        toStationId: a.id,
        distanceKm: distance,
      });
    }
  }

  return { edges, stationIds, transferPenalty };
}

interface PrevStep {
  edge: Edge;
  from: string;
}

/** 從單一起點站算出到所有車站的最短路徑（Dijkstra）。 */
export function findPathsFrom(graph: NetworkGraph, fromStationId: ID): Map<ID, NetworkPath> {
  const start = platformKey(fromStationId);
  const distTo = new Map<string, number>();
  const steps = new Map<string, PrevStep>();
  const visited = new Set<string>();
  distTo.set(start, 0);

  // 節點數量小，使用簡單的線性挑選即可。
  for (;;) {
    let current: string | null = null;
    let currentDist = Number.POSITIVE_INFINITY;
    for (const [node, d] of distTo) {
      if (!visited.has(node) && d < currentDist) {
        current = node;
        currentDist = d;
      }
    }
    if (current === null) {
      break;
    }
    visited.add(current);
    const outgoing = graph.edges.get(current);
    if (!outgoing) {
      continue;
    }
    for (const edge of outgoing) {
      const next = currentDist + edge.minutes;
      if (next < (distTo.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        distTo.set(edge.to, next);
        steps.set(edge.to, { edge, from: current });
      }
    }
  }

  const result = new Map<ID, NetworkPath>();
  for (const stationId of graph.stationIds) {
    if (stationId === fromStationId) {
      continue;
    }
    const target = platformKey(stationId);
    if (!visited.has(target) || !Number.isFinite(distTo.get(target) ?? Number.POSITIVE_INFINITY)) {
      continue;
    }
    const path = reconstructPath(graph, fromStationId, target, steps);
    if (path) {
      result.set(stationId, path);
    }
  }
  return result;
}

function reconstructPath(
  graph: NetworkGraph,
  originStationId: ID,
  targetKey: string,
  steps: Map<string, PrevStep>,
): NetworkPath | null {
  const chain: Edge[] = [];
  let node = targetKey;
  let guard = 0;
  while (node !== platformKey(originStationId) && guard < 10000) {
    guard++;
    const step = steps.get(node);
    if (!step) {
      return null;
    }
    chain.push(step.edge);
    node = step.from;
  }
  chain.reverse();

  const legs: NetworkPathLeg[] = [];
  let waitMinutes = 0;
  let inVehicle = 0;
  let distanceKm = 0;
  let alights = 0;

  for (const edge of chain) {
    if (edge.kind === "board") {
      waitMinutes += edge.minutes;
    } else if (edge.kind === "alight") {
      alights++;
    } else if (edge.kind === "ride" && edge.routeId && edge.fromStationId && edge.toStationId) {
      inVehicle += edge.minutes;
      distanceKm += edge.distanceKm ?? 0;
      const last = legs[legs.length - 1];
      if (last && last.routeId === edge.routeId) {
        last.toStationId = edge.toStationId;
        last.minutes += edge.minutes;
        last.distanceKm += edge.distanceKm ?? 0;
      } else {
        legs.push({
          routeId: edge.routeId,
          fromStationId: edge.fromStationId,
          toStationId: edge.toStationId,
          minutes: edge.minutes,
          distanceKm: edge.distanceKm ?? 0,
        });
      }
    }
  }

  if (legs.length === 0) {
    return null;
  }

  const transfers = Math.max(0, alights - 1);
  const totalMinutes = inVehicle + waitMinutes + transfers * graph.transferPenalty;
  return {
    legs,
    transfers,
    waitMinutes,
    inVehicleMinutes: inVehicle,
    distanceKm,
    totalMinutes,
  };
}
