/**
 * 公司成長系統：經驗值、等級與城市解鎖。
 * 升級不再自動解鎖城市：達到等級門檻後，玩家在城市面板付費解鎖。
 * 所有程序產生的通知都經過 pushNotification，由 UI 讀取顯示。
 */

import { dist } from "../core/math.ts";
import type { City, GameState, GameNotification, ID } from "../core/types.ts";
import { CITY_UNLOCK_COST, LEVEL_XP_THRESHOLDS } from "./config.ts";
import { applyTransaction } from "./economy.ts";

export function levelForXp(xp: number): number {
  let level = 1;
  for (let i = 0; i < LEVEL_XP_THRESHOLDS.length; i++) {
    const threshold = LEVEL_XP_THRESHOLDS[i] as number;
    if (xp >= threshold) {
      level = i + 1;
    } else {
      break;
    }
  }
  return level;
}

export function xpForNextLevel(level: number): number | null {
  const next = LEVEL_XP_THRESHOLDS[level];
  return next === undefined ? null : next;
}

export function pushNotification(
  state: GameState,
  kind: GameNotification["kind"],
  text: string,
): void {
  state.nextNotificationId += 1;
  state.notifications.push({
    id: state.nextNotificationId,
    kind,
    text,
    minute: state.clock.minutes,
  });
  if (state.notifications.length > 24) {
    state.notifications.splice(0, state.notifications.length - 24);
  }
}

/** 增加經驗值；升級時提示「已可解鎖」的城市，但不會自動解鎖。 */
export function applyXp(state: GameState, amount: number): boolean {
  if (amount <= 0) {
    return false;
  }
  state.player.xp += amount;
  const newLevel = levelForXp(state.player.xp);
  const previousLevel = state.player.level;
  if (newLevel <= previousLevel) {
    return false;
  }
  state.player.level = newLevel;

  // 這次升級「新達到門檻、且已探索」的城市。
  const unlockable = state.world.cities.filter(
    (city) => !city.unlocked && city.unlockLevel > previousLevel && city.unlockLevel <= newLevel,
  );
  if (unlockable.length > 0) {
    const names = unlockable.map((city) => city.name);
    const shown = names.slice(0, 3).join("、");
    const suffix = names.length > 3 ? ` 等 ${names.length} 座` : "";
    pushNotification(
      state,
      "success",
      `公司升級至等級 ${newLevel}：${shown}${suffix}已可解鎖，於城市面板付費開通。`,
    );
  } else {
    pushNotification(state, "success", `公司升級至等級 ${newLevel}`);
  }
  return true;
}

/** 解鎖城市所需的費用：基礎 + 人口比例 + 與起始核心的距離。 */
export function cityUnlockCost(state: GameState, city: City): number {
  const distance = dist(state.world.startCore, city.position);
  return Math.round(
    CITY_UNLOCK_COST.base +
      city.population * CITY_UNLOCK_COST.perPopulation +
      (distance / 1000) * CITY_UNLOCK_COST.per1000km,
  );
}

export type UnlockCityError =
  | "not_found"
  | "already_unlocked"
  | "level_too_low"
  | "insufficient_funds";

export type UnlockCityResult =
  | { ok: true; city: City; cost: number }
  | { ok: false; error: UnlockCityError };

/**
 * 付費解鎖城市（生涯模式）。
 * 需要：城市存在、尚未解鎖、公司等級達到門檻、資金足夠。
 */
export function unlockCity(state: GameState, cityId: ID): UnlockCityResult {
  const city = state.world.cities.find((c) => c.id === cityId);
  if (!city) {
    return { ok: false, error: "not_found" };
  }
  if (state.mode === "free" || city.unlocked) {
    return { ok: false, error: "already_unlocked" };
  }
  if (state.player.level < city.unlockLevel) {
    return { ok: false, error: "level_too_low" };
  }
  const cost = cityUnlockCost(state, city);
  const tx = applyTransaction(state, {
    category: "other",
    description: `解鎖城市：${city.name}`,
    amount: -cost,
  });
  if (!tx.ok) {
    return { ok: false, error: "insufficient_funds" };
  }
  city.unlocked = true;
  return { ok: true, city, cost };
}

/** 依城市 ID 檢查是否已解鎖（自由模式一律視為解鎖）。 */
export function isCityUnlocked(state: GameState, cityId: ID): boolean {
  if (state.mode === "free") {
    return true;
  }
  const city = state.world.cities.find((c) => c.id === cityId);
  return city ? city.unlocked : false;
}
