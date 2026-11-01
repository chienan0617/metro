/**
 * 隨機事件：影響客流、成本與車站運作。
 * 事件由「存檔 seed + 天數」決定，可重現；同時最多數個事件。
 */

import { Rng } from "../core/rng.ts";
import type { ActiveEvent, City, CityType, EventKind, GameState, ID } from "../core/types.ts";
import { EVENT_CONFIG } from "./config.ts";
import { pushNotification } from "./progression.ts";

interface EventDefinition {
  kind: EventKind;
  label: string;
  /** 可套用的城市類型（null = 不限）。 */
  targetTypes: readonly CityType[] | null;
  /** 需求倍率（給 UI 顯示）。 */
  demandMult: number;
}

const EVENT_DEFINITIONS: readonly EventDefinition[] = [
  { kind: "exhibition", label: "大型展覽", targetTypes: ["capital", "port", "industrial", "university"], demandMult: 1.6 },
  { kind: "semester", label: "學期開始", targetTypes: ["university"], demandMult: 1.5 },
  { kind: "festival", label: "節慶活動", targetTypes: ["tourism", "port", "capital"], demandMult: 1.8 },
  { kind: "energy_price", label: "能源價格上升", targetTypes: null, demandMult: 1.0 },
  { kind: "station_works", label: "車站周邊施工", targetTypes: null, demandMult: 1.0 },
  { kind: "city_boom", label: "新商業區開發", targetTypes: ["satellite", "industrial", "university", "town"], demandMult: 1.3 },
];

export function currentDay(state: GameState): number {
  return Math.floor(state.clock.minutes / 1440);
}

export function activeEventsLabels(state: GameState): string[] {
  return state.events.map((e) => {
    const city = e.cityId ? state.world.cities.find((c) => c.id === e.cityId) : null;
    return city ? `${e.label}（${city.name}）` : e.label;
  });
}

/** 城市層級的需求倍率（展覽、學期、節慶、商業區開發）。 */
export function eventDemandMultiplier(state: GameState, cityId: ID): number {
  let mult = 1;
  for (const event of state.events) {
    if (event.cityId !== cityId) {
      continue;
    }
    if (event.kind === "exhibition") {
      mult *= 1.6;
    } else if (event.kind === "semester") {
      mult *= 1.5;
    } else if (event.kind === "festival") {
      mult *= 1.8;
    } else if (event.kind === "city_boom") {
      mult *= 1.3;
    }
  }
  return mult;
}

/** 能源價格事件：整體營運成本倍率。 */
export function eventEnergyCostMultiplier(state: GameState): number {
  return state.events.some((e) => e.kind === "energy_price") ? 1.25 : 1;
}

/** 施工事件：車站容量倍率。 */
export function eventStationCapacityMultiplier(state: GameState, cityId: ID): number {
  return state.events.some((e) => e.kind === "station_works" && e.cityId === cityId) ? 0.6 : 1;
}

/** 城市成長加成（新商業區開發）。 */
export function eventGrowthMultiplier(state: GameState, cityId: ID): number {
  return state.events.some((e) => e.kind === "city_boom" && e.cityId === cityId) ? 3 : 1;
}

/** 每日結算時呼叫：結束過期事件、可能開始新事件。 */
export function rollDailyEvents(state: GameState): void {
  const day = currentDay(state);

  // 結束過期事件。
  const expired = state.events.filter((e) => e.endDay <= day);
  for (const event of expired) {
    const city = event.cityId ? state.world.cities.find((c) => c.id === event.cityId) : null;
    pushNotification(state, "info", `事件結束：${event.label}${city ? `（${city.name}）` : ""}`);
  }
  state.events = state.events.filter((e) => e.endDay > day);

  if (state.events.length >= EVENT_CONFIG.maxActive) {
    return;
  }
  const rng = new Rng((state.seed ^ Math.imul(day + 1, 2654435761)) >>> 0);
  if (!rng.chance(EVENT_CONFIG.dailyChance)) {
    return;
  }

  const definition = rng.pick(EVENT_DEFINITIONS);
  const targetCity = pickTargetCity(state, rng, definition);
  if (definition.targetTypes !== null && !targetCity) {
    return;
  }
  const [minDays, maxDays] = EVENT_CONFIG.durations[definition.kind];
  const duration = rng.int(minDays, maxDays);
  const event: ActiveEvent = {
    id: `evt-${day}-${definition.kind}`,
    kind: definition.kind,
    cityId: targetCity?.id ?? null,
    startedDay: day,
    endDay: day + duration,
    label: definition.label,
  };
  state.events.push(event);
  pushNotification(
    state,
    "warn",
    `事件：${definition.label}${targetCity ? `（${targetCity.name}）` : ""} — 為期 ${duration} 天`,
  );
}

function pickTargetCity(state: GameState, rng: Rng, definition: EventDefinition): City | null {
  if (definition.targetTypes === null) {
    return null;
  }
  const candidates = state.world.cities.filter((c) => definition.targetTypes?.includes(c.cityType));
  const served = candidates.filter((c) => c.stationIds.some((id) => {
    const station = state.world.stations.find((s) => s.id === id);
    return station !== undefined && station.routeIds.length > 0;
  }));
  const pool = served.length > 0 ? served : candidates;
  return pool.length > 0 ? rng.pick(pool) : null;
}
