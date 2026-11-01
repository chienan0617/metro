import { describe, expect, it } from "vitest";
import { dist } from "../core/math.ts";
import type { GameState, ID } from "../core/types.ts";
import { runHourlyDemand } from "./demand.ts";
import { addStop, confirmDraft, createDraft } from "./routes.ts";
import { settleDay, stepMinute } from "./simulation.ts";
import { createNewGame } from "./state.ts";
import { stationDailyCost } from "./stations.ts";
import { assignTrainToRoute, purchaseTrain } from "./trains.ts";
import { materializeTilesAround, type MaterializeContext } from "../world/worldgen.ts";

const SEED = 20261030;

function stationIdOf(state: GameState, cityId: ID): ID {
  const city = state.world.cities.find((c) => c.id === cityId);
  const stationId = city?.stationIds[0];
  if (!stationId) {
    throw new Error("城市缺少車站");
  }
  return stationId;
}

/** 在起始區域中挑一組「合理」的成對城市：人口合計大、距離適中。 */
function bestPair(state: GameState): { a: ID; b: ID } {
  const cities = state.world.cities.filter((c) => c.unlocked && c.population >= 120_000);
  let best: { a: ID; b: ID } | null = null;
  let bestScore = 0;
  for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
      const a = cities[i] as (typeof cities)[number];
      const b = cities[j] as (typeof cities)[number];
      const d = dist(a.position, b.position);
      if (d < 90 || d > 1600) {
        continue;
      }
      const score = (a.population + b.population) / d;
      if (score > bestScore) {
        bestScore = score;
        best = { a: a.id, b: b.id };
      }
    }
  }
  if (!best) {
    throw new Error("找不到合適的城市對");
  }
  return best;
}

describe("經濟平衡", () => {
  it("連接合理城市的路線營運一天後應為獲利（營收 > 成本）", () => {
    const state = createNewGame(SEED, "free");
    const pair = bestPair(state);
    const draft = createDraft("#4f8ef7");
    addStop(state, draft, stationIdOf(state, pair.a));
    addStop(state, draft, stationIdOf(state, pair.b));
    const built = confirmDraft(state, draft);
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const train = purchaseTrain(state, "re-2");
    expect(train.ok).toBe(true);
    if (!train.ok) {
      return;
    }
    assignTrainToRoute(state, train.train.id, built.route.id);

    // 模擬完整一天（列車運行、逐小時需求、每日結算）。
    for (let i = 0; i < 1440; i++) {
      stepMinute(state);
    }
    const summary = state.finance.history.find((h) => h.day === 1);
    expect(summary).toBeDefined();
    if (!summary) {
      return;
    }
    // 合理城市對的一天應明顯獲利。
    expect(summary.revenue).toBeGreaterThan(summary.cost);
  });

  it("盈利列車路線的每日淨利足以回收建設成本（合理的回收期）", () => {
    const state = createNewGame(SEED, "free");
    const pair = bestPair(state);
    const draft = createDraft("#4f8ef7");
    addStop(state, draft, stationIdOf(state, pair.a));
    addStop(state, draft, stationIdOf(state, pair.b));
    const built = confirmDraft(state, draft);
    if (!built.ok) {
      throw new Error("建設失敗");
    }
    const train = purchaseTrain(state, "re-2");
    if (!train.ok) {
      throw new Error("購買失敗");
    }
    assignTrainToRoute(state, train.train.id, built.route.id);
    for (let i = 0; i < 1440; i++) {
      stepMinute(state);
    }
    const summary = state.finance.history.find((h) => h.day === 1);
    if (!summary) {
      throw new Error("沒有每日結算");
    }
    const dailyProfit = summary.revenue - summary.cost;
    expect(dailyProfit).toBeGreaterThan(0);
    // 建設費 + 列車費的回收期應在合理天數內（< 60 天）。
    const investment = built.route.constructionCost + 320_000;
    expect(investment / dailyProfit).toBeLessThan(60);
  });

  it("探索更多城市不會增加營運成本（未開通車站 0 成本）", () => {
    const state = createNewGame(SEED, "free");
    // 大量探索。
    const ctx: MaterializeContext = {
      world: state.world,
      tiles: new Set(state.materializedTiles),
      freeUnlock: true,
    };
    materializeTilesAround(ctx, state.world.startCore.x, state.world.startCore.y, 6);
    state.materializedTiles = [...ctx.tiles];
    expect(state.world.cities.length).toBeGreaterThan(80);

    // 沒有任何路線時直接結算：即使探索出 100+ 座城市，也不應該有任何車站成本。
    const train = purchaseTrain(state, "lt-1");
    expect(train.ok).toBe(true);
    state.clock.minutes = 1440;
    settleDay(state);
    const entry = state.finance.history.at(-1);
    expect(entry).toBeDefined();
    if (!entry) {
      return;
    }
    // 未連接的車站在探索後仍為 0 成本。
    for (const station of state.world.stations) {
      if (station.routeIds.length === 0) {
        expect(stationDailyCost(station)).toBe(0);
      }
    }
    // 沒有列車運行、沒有連接車站 → 當日成本為 0（待命列車的維護費由 stepMinute 累計，
    // 已由 simulation 測試涵蓋）。
    expect(entry.cost).toBeCloseTo(0, 0);
  });

  it("未被服務的路線（沒有列車）不會產生收入", () => {
    const state = createNewGame(SEED, "free");
    const pair = bestPair(state);
    const draft = createDraft("#4f8ef7");
    addStop(state, draft, stationIdOf(state, pair.a));
    addStop(state, draft, stationIdOf(state, pair.b));
    const built = confirmDraft(state, draft);
    expect(built.ok).toBe(true);
    const report = runHourlyDemand(state);
    expect(report.served).toBe(0);
    expect(report.revenue).toBe(0);
  });
});
