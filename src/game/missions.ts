/**
 * 任務系統：依目前進度程序化生成目標，附可行性檢查。
 * 任務由存檔中的 mission seed 決定，重載後不會重新抽取。
 */

import { Rng } from "../core/rng.ts";
import type { GameState, ID, Mission, MissionObjective } from "../core/types.ts";
import { MISSION_CONFIG } from "./config.ts";
import { applyTransaction } from "./economy.ts";
import { applyXp, pushNotification } from "./progression.ts";

export interface MissionProgressEntry {
  label: string;
  current: number;
  target: number;
  done: boolean;
}

export function generateMission(state: GameState): Mission {
  const index = state.mission.index;
  const rng = new Rng((state.mission.seed ^ Math.imul(index + 1, 40503)) >>> 0);

  const objectives: MissionObjective[] = [];
  const connectTarget = pickConnectTarget(state);

  if (connectTarget && (objectives.length === 0 || rng.chance(0.5))) {
    objectives.push({
      kind: "connect_city",
      cityId: connectTarget.id,
      label: `讓「${connectTarget.name}」連接上路網`,
    });
  }

  // 主要營運目標。
  const passengersDelta = MISSION_CONFIG.minPassengerTarget + index * 260;
  const revenueDelta = 200_000 + index * 60_000;
  const mainOptions: MissionObjective[] = [];
  if (currentNetworkLength(state) > 0) {
    mainOptions.push({
      kind: "passengers_total",
      target: Math.round(state.stats.totalServed + passengersDelta),
      label: `累計載運 ${Math.round(passengersDelta).toLocaleString("en-US")} 名旅客`,
    });
    mainOptions.push({
      kind: "revenue_total",
      target: Math.round(state.stats.totalRevenue + revenueDelta),
      label: `累計票務與營運收入達到 $${Math.round(state.stats.totalRevenue + revenueDelta).toLocaleString("en-US")}`,
    });
  } else {
    mainOptions.push({
      kind: "network_length",
      target: Math.round(currentNetworkLength(state) + MISSION_CONFIG.lengthTargetStep),
      label: `路網總長達到 ${Math.round(currentNetworkLength(state) + MISSION_CONFIG.lengthTargetStep)} 公里`,
    });
  }
  objectives.push(rng.pick(mainOptions));

  // 附加目標（1 - 2 個）。
  const bonusCount = rng.int(1, 2);
  const bonusPool: MissionObjective[] = [
    {
      kind: "network_length",
      target: Math.round(currentNetworkLength(state) + 90),
      label: `路網總長達到 ${Math.round(currentNetworkLength(state) + 90)} 公里`,
    },
    {
      kind: "satisfaction",
      target: 68,
      label: "所有營運中的車站滿意度不低於 68",
    },
    {
      kind: "transfer_stations",
      target: countTransferStations(state) + 1,
      label: `建立 ${countTransferStations(state) + 1} 座轉乘站（兩條以上路線交會）`,
    },
    {
      kind: "passengers_total",
      target: Math.round(state.stats.totalServed + passengersDelta * 0.5),
      label: `累計載運額外 ${Math.round(passengersDelta * 0.5).toLocaleString("en-US")} 名旅客`,
    },
  ];
  for (let i = 0; i < bonusCount; i++) {
    const chosen = rng.pick(bonusPool);
    bonusPool.splice(bonusPool.indexOf(chosen), 1);
    objectives.push(chosen);
    if (bonusPool.length === 0) {
      break;
    }
  }

  const main = objectives[0] as MissionObjective;
  const title = missionTitle(main, connectTarget?.name);
  const rewardMoney = Math.round(MISSION_CONFIG.baseRewardMoney + index * 22_000);
  const rewardXp = Math.round(MISSION_CONFIG.baseRewardXp + index * 40);

  return {
    id: `mission-${state.mission.seed}-${index}`,
    title,
    description: "完成主要目標即可取得獎勵；附加目標會提高星等評價。",
    objectives,
    rewardMoney,
    rewardXp,
  };
}

function missionTitle(main: MissionObjective, cityName?: string): string {
  switch (main.kind) {
    case "connect_city":
      return `連接 ${cityName ?? main.cityId}`;
    case "passengers_total":
      return "提升旅客運量";
    case "revenue_total":
      return "達成營收里程碑";
    case "network_length":
      return "擴張路網";
    case "transfer_stations":
      return "建立轉乘樞紐";
    case "satisfaction":
      return "提升服務品質";
  }
}

/** 挑選尚未連接路網、且已解鎖的最接近城市。 */
function pickConnectTarget(state: GameState): { id: ID; name: string } | null {
  const connectedCityIds = new Set<ID>();
  for (const route of state.routes) {
    for (const stationId of route.stationIds) {
      const station = state.world.stations.find((s) => s.id === stationId);
      if (station) {
        connectedCityIds.add(station.cityId);
      }
    }
  }
  const candidates = state.world.cities.filter(
    (c) =>
      c.unlocked &&
      !connectedCityIds.has(c.id) &&
      c.unlockLevel <= state.player.level,
  );
  if (candidates.length === 0) {
    return null;
  }
  // 選擇距離現有路網（或起始區域）最近的候選城市。
  const anchorPositions = state.world.cities
    .filter((c) => connectedCityIds.has(c.id))
    .map((c) => c.position);
  if (anchorPositions.length === 0) {
    const fallback = candidates[0];
    return fallback ? { id: fallback.id, name: fallback.name } : null;
  }
  let best = candidates[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const city of candidates) {
    for (const anchor of anchorPositions) {
      const d = Math.hypot(city.position.x - anchor.x, city.position.y - anchor.y);
      if (d < bestDist) {
        bestDist = d;
        best = city;
      }
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}

export function currentNetworkLength(state: GameState): number {
  let length = 0;
  for (const route of state.routes) {
    length += route.totalDistance;
  }
  return length;
}

export function countTransferStations(state: GameState): number {
  let count = 0;
  for (const station of state.world.stations) {
    if (station.routeIds.length >= 2) {
      count++;
    }
  }
  return count;
}

function isObjectiveDone(state: GameState, objective: MissionObjective): boolean {
  switch (objective.kind) {
    case "connect_city": {
      for (const route of state.routes) {
        for (const stationId of route.stationIds) {
          const station = state.world.stations.find((s) => s.id === stationId);
          if (station && station.cityId === objective.cityId) {
            return true;
          }
        }
      }
      return false;
    }
    case "passengers_total":
      return state.stats.totalServed >= objective.target;
    case "revenue_total":
      return state.stats.totalRevenue >= objective.target;
    case "network_length":
      return currentNetworkLength(state) >= objective.target;
    case "transfer_stations":
      return countTransferStations(state) >= objective.target;
    case "satisfaction": {
      const servedStations = state.world.stations.filter((s) => s.routeIds.length > 0);
      if (servedStations.length === 0) {
        return false;
      }
      return servedStations.every((s) => s.satisfaction >= objective.target);
    }
  }
}

export function missionProgress(state: GameState): MissionProgressEntry[] {
  const mission = state.mission.active;
  if (!mission) {
    return [];
  }
  return mission.objectives.map((objective) => ({
    label: objective.label,
    current: objectiveCurrentValue(state, objective),
    target: objectiveTargetValue(state, objective),
    done: isObjectiveDone(state, objective),
  }));
}

function objectiveCurrentValue(state: GameState, objective: MissionObjective): number {
  switch (objective.kind) {
    case "passengers_total":
      return Math.round(state.stats.totalServed);
    case "revenue_total":
      return Math.round(state.stats.totalRevenue);
    case "network_length":
      return Math.round(currentNetworkLength(state));
    case "transfer_stations":
      return countTransferStations(state);
    case "satisfaction": {
      const served = state.world.stations.filter((s) => s.routeIds.length > 0);
      if (served.length === 0) {
        return 0;
      }
      return Math.round(Math.min(...served.map((s) => s.satisfaction)));
    }
    case "connect_city":
      return isObjectiveDone(state, objective) ? 1 : 0;
  }
}

function objectiveTargetValue(state: GameState, objective: MissionObjective): number {
  void state;
  return objective.kind === "connect_city" ? 1 : objective.target;
}

/** 每日檢查任務；完成時發放獎勵並產生下一個任務。 */
export function checkMission(state: GameState): boolean {
  const mission = state.mission.active;
  if (!mission) {
    state.mission.active = generateMission(state);
    return false;
  }
  const done = mission.objectives.map((o) => isObjectiveDone(state, o));
  const allDone = done.every(Boolean);
  if (!allDone) {
    return false;
  }
  const bonusCompleted = done.slice(1).filter(Boolean).length;
  const stars = 1 + bonusCompleted;

  applyTransaction(state, {
    category: "mission",
    description: `任務獎勵：${mission.title}`,
    amount: mission.rewardMoney,
  });
  applyXp(state, mission.rewardXp);
  state.mission.completedCount += 1;
  state.mission.stars += stars;
  state.mission.index += 1;
  pushNotification(
    state,
    "success",
    `任務完成「${mission.title}」：${"★".repeat(stars)} 獎勵 $${mission.rewardMoney.toLocaleString("en-US")}、XP ${mission.rewardXp}`,
  );
  state.mission.active = generateMission(state);
  if (state.mission.active) {
    pushNotification(state, "info", `新任務：${state.mission.active.title}`);
  }
  return true;
}
