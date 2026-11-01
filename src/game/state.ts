/**
 * 遊戲狀態建立。狀態為單一來源，由 command 函式修改、UI 訂閱顯示。
 */

import { emptyCompanyStats } from "../core/types.ts";
import type { GameMode, GameState, GeographyChoice } from "../core/types.ts";
import { generateWorld } from "../world/worldgen.ts";
import { ECONOMY_CONFIG, SAVE_VERSION } from "./config.ts";
import { generateMission } from "./missions.ts";

export const DEFAULT_COMPANY_NAME = "都會捷運公司";

export interface NewGameOptions {
  /** 地圖地理樣式；預設依種子自動決定。 */
  geoStyle?: GeographyChoice;
  companyName?: string;
}

export function createNewGame(
  seed: number,
  mode: GameMode = "career",
  options?: NewGameOptions,
): GameState {
  const geoStyle: GeographyChoice = options?.geoStyle ?? "auto";
  const generated = generateWorld(seed, geoStyle);
  const world = generated.world;
  if (mode === "free") {
    for (const city of world.cities) {
      city.unlocked = true;
    }
  }
  const state: GameState = {
    saveVersion: SAVE_VERSION,
    seed,
    mode,
    geoStyle,
    createdAt: Date.now(),
    world,
    materializedTiles: generated.materializedTiles,
    player: {
      companyName: options?.companyName ?? DEFAULT_COMPANY_NAME,
      money: mode === "free" ? ECONOMY_CONFIG.freeStartingMoney : ECONOMY_CONFIG.startingMoney,
      level: 1,
      xp: 0,
    },
    clock: {
      minutes: 0,
      // 新遊戲預設暫停，讓玩家先觀察地圖再開始營運。
      speed: 0,
    },
    routes: [],
    trains: [],
    depotCostPending: 0,
    stats: emptyCompanyStats(),
    finance: { history: [], todayRevenue: 0 },
    research: {
      completed: { train: 0, station: 0, operation: 0 },
      active: null,
    },
    events: [],
    mission: {
      seed: (seed ^ 0x9e3779b9) >>> 0,
      index: 0,
      active: null,
      completedCount: 0,
      stars: 0,
    },
    notifications: [],
    nextNotificationId: 0,
    tutorialStep: mode === "free" ? 99 : 0,
    ledger: [],
    counters: {
      route: 0,
      train: 0,
      ledger: 0,
    },
  };
  state.mission.active = generateMission(state);
  return state;
}
