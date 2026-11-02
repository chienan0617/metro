import { describe, expect, it } from "vitest";
import { dist } from "../core/math.ts";
import type { GameState, ID } from "../core/types.ts";
import { fareForDistance, hourlyDemandFactor, pairDemand, runHourlyDemand } from "./demand.ts";
import { buildNetwork, findPathsFrom } from "./network.ts";
import { addStop, confirmDraft, createDraft, segmentCost } from "./routes.ts";
import { createNewGame } from "./state.ts";
import {
  assignTrainToRoute,
  purchaseTrain,
  routeHourlyCapacity,
  setRouteOperationStatus,
} from "./trains.ts";
import { researchMultipliers, startResearch, updateResearch } from "./research.ts";
import { applyXp, cityUnlockCost, unlockCity } from "./progression.ts";
import { stationEffectiveCapacity, stationDailyIncome, upgradeStation } from "./stations.ts";
import { checkMission } from "./missions.ts";
import { eventDemandMultiplier, rollDailyEvents } from "./events.ts";
import { MINUTES_PER_DAY } from "./time.ts";

const SEED = 20261030;

function stationIdOf(state: GameState, cityId: ID): ID {
  const city = state.world.cities.find((c) => c.id === cityId);
  const stationId = city?.stationIds[0];
  if (!stationId) {
    throw new Error("城市缺少車站");
  }
  return stationId;
}

function buildRouteBetween(state: GameState, cityA: ID, cityB: ID): ID {
  const draft = createDraft("#4f8ef7");
  addStop(state, draft, stationIdOf(state, cityA));
  addStop(state, draft, stationIdOf(state, cityB));
  const result = confirmDraft(state, draft);
  if (!result.ok) {
    throw new Error(`建設失敗：${result.error}`);
  }
  return result.route.id;
}

interface Served {
  state: GameState;
  routeId: ID;
}

/** 建立一條有列車的路線。 */
function routeWithTrain(modelId = "re-2"): Served {
  const state = createNewGame(SEED, "free");
  const a = state.world.cities[0];
  const b = state.world.cities[2];
  if (!a || !b) {
    throw new Error("城市不足");
  }
  const routeId = buildRouteBetween(state, a.id, b.id);
  const bought = purchaseTrain(state, modelId);
  if (!bought.ok) {
    throw new Error("購買失敗");
  }
  if (!assignTrainToRoute(state, bought.train.id, routeId).ok) {
    throw new Error("指派失敗");
  }
  return { state, routeId };
}

describe("路網與路徑搜尋", () => {
  it("有列車的路線會產生可行路徑；沒有列車則沒有路徑", () => {
    const { state } = routeWithTrain();
    const a = state.world.cities[0];
    const b = state.world.cities[2];
    if (!a || !b) {
      throw new Error("城市不足");
    }
    const graph = buildNetwork(state);
    const paths = findPathsFrom(graph, stationIdOf(state, a.id));
    const path = paths.get(stationIdOf(state, b.id));
    expect(path).toBeDefined();
    expect(path?.legs.length).toBe(1);
    expect(path?.transfers).toBe(0);
    expect(path?.totalMinutes).toBeGreaterThan(0);
    expect(path?.waitMinutes).toBeLessThanOrEqual(45);

    // 移除列車後路線不再提供服務。
    state.trains.splice(0, state.trains.length);
    const graph2 = buildNetwork(state);
    const paths2 = findPathsFrom(graph2, stationIdOf(state, a.id));
    expect(paths2.get(stationIdOf(state, b.id))).toBeUndefined();
  });

  it("暫停營運的路線不會出現在路網中", () => {
    const { state, routeId } = routeWithTrain();
    setRouteOperationStatus(state, routeId, "suspended");
    const a = state.world.cities[0];
    const b = state.world.cities[2];
    if (!a || !b) {
      throw new Error("城市不足");
    }
    const graph = buildNetwork(state);
    const paths = findPathsFrom(graph, stationIdOf(state, a.id));
    expect(paths.get(stationIdOf(state, b.id))).toBeUndefined();
  });

  it("兩條路線交會時可以轉乘抵達", () => {
    const state = createNewGame(SEED, "free");
    // 找一組 A-B-C 使兩段都符合最短距離限制。
    const cities = state.world.cities;
    let found: { a: ID; b: ID; c: ID } | null = null;
    outer: for (const a of cities) {
      for (const b of cities) {
        if (a.id === b.id || dist(a.position, b.position) < 60) {
          continue;
        }
        for (const c of cities) {
          if (c.id === a.id || c.id === b.id) {
            continue;
          }
          if (dist(b.position, c.position) < 60 || dist(a.position, c.position) < 60) {
            continue;
          }
          // 選 B 作為兩線交會點，避免 A-C 直接相連的干擾。
          found = { a: a.id, b: b.id, c: c.id };
          break outer;
        }
      }
    }
    if (!found) {
      throw new Error("找不到可用的三座城市");
    }
    const route1 = buildRouteBetween(state, found.a, found.b);
    const route2 = buildRouteBetween(state, found.b, found.c);
    const train1 = purchaseTrain(state, "re-2");
    const train2 = purchaseTrain(state, "re-2");
    if (!train1.ok || !train2.ok) {
      throw new Error("購買失敗");
    }
    assignTrainToRoute(state, train1.train.id, route1);
    assignTrainToRoute(state, train2.train.id, route2);

    const graph = buildNetwork(state);
    const paths = findPathsFrom(graph, stationIdOf(state, found.a));
    const path = paths.get(stationIdOf(state, found.c));
    expect(path).toBeDefined();
    expect(path?.transfers).toBe(1);
    const routeIds = new Set(path?.legs.map((l) => l.routeId));
    expect(routeIds.size).toBe(2);
  });
});

describe("乘客需求與票務收入", () => {
  it("票價依距離計算且有最低票價", () => {
    expect(fareForDistance(0)).toBeGreaterThanOrEqual(30);
    expect(fareForDistance(200)).toBeGreaterThan(fareForDistance(100));
  });

  it("有路網時會產生已服務乘客與收入", () => {
    const { state } = routeWithTrain();
    const moneyBefore = state.player.money;
    const report = runHourlyDemand(state);
    expect(report.generated).toBeGreaterThan(0);
    expect(report.served).toBeGreaterThan(0);
    expect(report.revenue).toBeGreaterThan(0);
    expect(state.player.money).toBeGreaterThan(moneyBefore);
    expect(state.stats.totalServed).toBeGreaterThan(0);
    expect(state.stats.totalUnserved).toBeGreaterThanOrEqual(0);

    // 起點城市的車站會記錄進站人次。
    const originStation = state.world.stations.find(
      (s) => s.id === stationIdOf(state, state.world.cities[0]?.id ?? ""),
    );
    expect((originStation?.stats.boardingsToday ?? 0) > 0).toBe(true);
  });

  it("完全沒有路網時不會產生已服務乘客或收入", () => {
    const state = createNewGame(SEED, "free");
    const report = runHourlyDemand(state);
    expect(report.generated).toBeGreaterThan(0);
    expect(report.served).toBe(0);
    expect(report.revenue).toBe(0);
    expect(state.stats.totalServed).toBe(0);
  });

  it("列車容量會限制實際載客量，增加列車可提升運能", () => {
    // 使用小容量列車與低班次；在尖峰時段模擬。
    const { state, routeId } = routeWithTrain("lt-1");
    state.clock.minutes = 120; // 上午尖峰
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) {
      throw new Error("找不到路線");
    }
    const capacity1 = routeHourlyCapacity(state, route);
    const report1 = runHourlyDemand(state);
    expect(report1.served).toBeGreaterThan(0);
    expect(report1.served).toBeLessThanOrEqual(capacity1 + 1e-6);

    // 增加列車：班距縮短、運能提高。
    for (let i = 0; i < 5; i++) {
      const extra = purchaseTrain(state, "lt-1");
      if (!extra.ok) {
        throw new Error("購買失敗");
      }
      assignTrainToRoute(state, extra.train.id, routeId);
    }
    const capacity6 = routeHourlyCapacity(state, route);
    expect(capacity6).toBeGreaterThan(capacity1);

    // 同一時段重新模擬（每次呼叫都會重置負載）。
    state.clock.minutes = 120;
    const report2 = runHourlyDemand(state);
    expect(report2.served).toBeGreaterThanOrEqual(report1.served);
    expect(report2.served).toBeLessThanOrEqual(capacity6 + 1e-6);
  });

  it("總需求超過運能時會出現未滿足旅次", () => {
    // 用最低速列車單獨服務一張大圖，尖峰時總需求應超過此路線運能。
    const { state } = routeWithTrain("lt-1");
    state.clock.minutes = 120;
    const report = runHourlyDemand(state);
    // 大部分城市之間沒有路徑，這些需求都不會被服務。
    expect(report.unserved).toBeGreaterThan(0);
    expect(report.served).toBeLessThan(report.generated);
  });

  it("服務指標會累積在各路線上", () => {
    const { state, routeId } = routeWithTrain();
    runHourlyDemand(state);
    const route = state.routes.find((r) => r.id === routeId);
    expect(route?.stats.passengersToday).toBeGreaterThan(0);
    expect(route?.stats.revenueToday).toBeGreaterThan(0);
    expect(route?.stats.waitSumToday).toBeGreaterThan(0);
    expect(route?.stats.capacityToday).toBeGreaterThan(0);
  });
});

describe("車站升級與收支", () => {
  it("車站可以升級，容量提高且成本上升", () => {
    const state = createNewGame(SEED, "career");
    const city = state.world.cities[0];
    if (!city) {
      throw new Error("沒有城市");
    }
    const station = state.world.stations.find((s) => s.cityId === city.id);
    if (!station) {
      throw new Error("沒有車站");
    }
    const capacityBefore = stationEffectiveCapacity(state, station);
    const result = upgradeStation(state, station.id);
    expect(result.ok).toBe(true);
    expect(station.level).toBe(2);
    expect(stationEffectiveCapacity(state, station)).toBeGreaterThan(capacityBefore);

    expect(upgradeStation(state, station.id).ok).toBe(true);
    expect(station.level).toBe(3);
    const atMax = upgradeStation(state, station.id);
    expect(atMax.ok).toBe(false);
  });

  it("有路線服務的車站會產生商業收入", () => {
    const { state, routeId } = routeWithTrain();
    const route = state.routes.find((r) => r.id === routeId);
    const station = state.world.stations.find((s) => s.id === route?.stationIds[0]);
    if (!station) {
      throw new Error("沒有車站");
    }
    expect(station.routeIds.length).toBeGreaterThan(0);
    expect(stationDailyIncome(state, station)).toBeGreaterThan(0);

    // 沒有路線的車站沒有商業收入。
    const lonely = state.world.stations.find((s) => s.routeIds.length === 0);
    if (lonely) {
      expect(stationDailyIncome(state, lonely)).toBe(0);
    }
  });
});

describe("科技研究", () => {
  it("研究需要等級與資金，完成後效果生效", () => {
    const state = createNewGame(SEED, "free");
    const early = startResearch(state, "operation", 1);
    expect(early.ok).toBe(false);

    state.player.level = 2;
    const moneyBefore = state.player.money;
    const started = startResearch(state, "operation", 1);
    expect(started.ok).toBe(true);
    expect(state.player.money).toBeLessThan(moneyBefore);

    const multipliersBefore = researchMultipliers(state);
    // 推進到研究完成。
    const active = state.research.active;
    if (!active) {
      throw new Error("沒有進行中的研究");
    }
    state.clock.minutes = active.endDay * MINUTES_PER_DAY;
    expect(updateResearch(state)).toBe(true);
    expect(state.research.completed.operation).toBe(1);
    const multipliersAfter = researchMultipliers(state);
    expect(multipliersAfter.trackCost).toBeLessThan(multipliersBefore.trackCost);

    // 建設成本確實下降。
    const a = state.world.cities[0];
    const b = state.world.cities[2];
    if (a && b) {
      const stationA = state.world.stations.find((s) => s.cityId === a.id);
      const stationB = state.world.stations.find((s) => s.cityId === b.id);
      if (stationA && stationB) {
        const costAfter = segmentCost(state, stationA, stationB).cost;
        state.research.completed.operation = 0;
        const costBefore = segmentCost(state, stationA, stationB).cost;
        expect(costAfter).toBeLessThan(costBefore);
      }
    }
  });
});

describe("公司等級與城市解鎖", () => {
  it("升級不再自動解鎖城市，但會提示已可解鎖", () => {
    const state = createNewGame(SEED, "career");
    const lockedBefore = state.world.cities.filter((c) => !c.unlocked);
    expect(lockedBefore.length).toBeGreaterThan(0);

    applyXp(state, 600); // 等級 2
    expect(state.player.level).toBe(2);
    // 城市不會自動解鎖。
    const stillLocked = state.world.cities.filter((c) => !c.unlocked);
    expect(stillLocked.length).toBe(lockedBefore.length);
    const candidates = state.world.cities.filter((c) => !c.unlocked && c.unlockLevel === 2);
    expect(candidates.length).toBeGreaterThan(0);
    expect(state.notifications.length).toBeGreaterThan(0);
  });

  it("付費解鎖：等級不足失敗、資金不足失敗、成功扣款並記錄財務", () => {
    const state = createNewGame(SEED, "career");
    const target = state.world.cities.find((c) => !c.unlocked);
    expect(target).toBeDefined();
    if (!target) {
      return;
    }

    const tooEarly = unlockCity(state, target.id);
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) {
      expect(tooEarly.error).toBe("level_too_low");
    }

    state.player.level = target.unlockLevel;
    const cost = cityUnlockCost(state, target);
    expect(cost).toBeGreaterThan(0);
    state.player.money = cost - 1;
    const poor = unlockCity(state, target.id);
    expect(poor.ok).toBe(false);
    if (!poor.ok) {
      expect(poor.error).toBe("insufficient_funds");
    }

    state.player.money = cost + 1_000;
    const moneyBefore = state.player.money;
    const result = unlockCity(state, target.id);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.cost).toBe(cost);
    expect(state.player.money).toBeCloseTo(moneyBefore - cost, 6);
    expect(target.unlocked).toBe(true);
    expect(state.ledger.at(-1)?.category).toBe("other");
    expect(state.ledger.at(-1)?.description).toContain(target.name);

    const again = unlockCity(state, target.id);
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.error).toBe("already_unlocked");
    }
  });

  it("每日需求只計算已解鎖城市（含目的地）", () => {
    const state = createNewGame(SEED, "career");
    const unlocked = state.world.cities.filter((c) => c.unlocked);
    const locked = state.world.cities.filter((c) => !c.unlocked);
    expect(unlocked.length).toBeGreaterThan(1);
    expect(locked.length).toBeGreaterThan(0);

    const report = runHourlyDemand(state);
    const hourFactor = hourlyDemandFactor(state);
    let expected = 0;
    for (const origin of unlocked) {
      for (const destination of unlocked) {
        if (origin.id === destination.id) {
          continue;
        }
        const demand = pairDemand(state, origin, destination, hourFactor);
        // 與模擬一致：低於門檻的需求不計入。
        if (demand > 0.001) {
          expected += demand;
        }
      }
    }
    expect(report.generated).toBeCloseTo(expected, 6);
  });

  it("自由模式所有城市都已解鎖", () => {
    const state = createNewGame(SEED, "free");
    expect(state.world.cities.every((c) => c.unlocked)).toBe(true);
  });
});

describe("任務與事件", () => {
  it("達成全部目標時任務完成並發放獎勵", () => {
    const state = createNewGame(SEED, "career");
    state.mission.active = {
      id: "test-mission",
      title: "測試任務",
      description: "",
      objectives: [
        { kind: "passengers_total", target: 100, label: "載運 100 名旅客" },
        { kind: "revenue_total", target: 1000, label: "收入達到 $1,000" },
      ],
      rewardMoney: 5000,
      rewardXp: 100,
    };
    state.stats.totalServed = 200;
    state.stats.totalRevenue = 2000;
    const moneyBefore = state.player.money;
    const completed = checkMission(state);
    expect(completed).toBe(true);
    expect(state.mission.completedCount).toBe(1);
    // 主要目標（1 星）+ 一個附加目標 = 2 星。
    expect(state.mission.stars).toBe(2);
    expect(state.player.money).toBeGreaterThan(moneyBefore);
    expect(state.mission.active).not.toBeNull();
  });

  it("未達成目標時任務保持進行中", () => {
    const state = createNewGame(SEED, "career");
    state.stats.totalServed = 0;
    const completed = checkMission(state);
    expect(completed).toBe(false);
    expect(state.mission.completedCount).toBe(0);
  });

  it("事件會影響城市需求倍率並可過期", () => {
    const state = createNewGame(SEED, "free");
    const city = state.world.cities[0];
    if (!city) {
      throw new Error("沒有城市");
    }
    state.events.push({
      id: "evt-1",
      kind: "exhibition",
      cityId: city.id,
      startedDay: 0,
      endDay: 3,
      label: "大型展覽",
    });
    expect(eventDemandMultiplier(state, city.id)).toBeGreaterThan(1.5);

    // 過期事件會被移除。
    state.clock.minutes = 5 * MINUTES_PER_DAY;
    rollDailyEvents(state);
    expect(state.events.some((e) => e.id === "evt-1")).toBe(false);
  });
});
