/**
 * 公司成長系統：經驗值、等級與城市解鎖。
 * 所有程序產生的通知都經過 pushNotification，由 UI 讀取顯示。
 */

import type { City, GameState, GameNotification, ID } from "../core/types.ts";
import { LEVEL_XP_THRESHOLDS } from "./config.ts";

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

/** 增加經驗值；升級時解鎖城市並產生通知。 */
export function applyXp(state: GameState, amount: number): boolean {
  if (amount <= 0) {
    return false;
  }
  state.player.xp += amount;
  const newLevel = levelForXp(state.player.xp);
  if (newLevel <= state.player.level) {
    return false;
  }
  state.player.level = newLevel;
  const unlocked = unlockCitiesForLevel(state);
  if (unlocked.length > 0) {
    pushNotification(
      state,
      "success",
      `公司升級至等級 ${newLevel}，解鎖城市：${unlocked.map((c) => c.name).join("、")}`,
    );
  } else {
    pushNotification(state, "success", `公司升級至等級 ${newLevel}`);
  }
  return true;
}

/** 依目前等級解鎖城市（生涯模式），回傳本次新解鎖的城市。 */
export function unlockCitiesForLevel(state: GameState): City[] {
  if (state.mode === "free") {
    return [];
  }
  const newlyUnlocked: City[] = [];
  for (const city of state.world.cities) {
    if (!city.unlocked && city.unlockLevel <= state.player.level) {
      city.unlocked = true;
      newlyUnlocked.push(city);
    }
  }
  return newlyUnlocked;
}

/** 依城市 ID 檢查是否已解鎖（自由模式一律視為解鎖）。 */
export function isCityUnlocked(state: GameState, cityId: ID): boolean {
  if (state.mode === "free") {
    return true;
  }
  const city = state.world.cities.find((c) => c.id === cityId);
  return city ? city.unlocked : false;
}
