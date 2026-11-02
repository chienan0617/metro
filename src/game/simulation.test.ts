import { describe, expect, it } from "vitest";
import { dist } from "../core/math.ts";
import type { GameState, ID, Train } from "../core/types.ts";
import { addStop, confirmDraft, createDraft } from "./routes.ts";
import { stepMinute } from "./simulation.ts";
import { SimulationRunner } from "./simulationRunner.ts";
import { createNewGame } from "./state.ts";
import { assignTrainToRoute, purchaseTrain, setRouteOperationStatus } from "./trains.ts";
import { MINUTES_PER_DAY } from "./time.ts";

const SEED = 20261030;

function stationIdOf(state: GameState, cityId: ID): ID {
  const city = state.world.cities.find((c) => c.id === cityId);
  const stationId = city?.stationIds[0];
  if (!stationId) {
    throw new Error("城市沒有車站");
  }
  return stationId;
}

function nearestCityId(state: GameState, fromId: ID, exclude: ID[] = []): ID {
  const from = state.world.cities.find((c) => c.id === fromId);
  if (!from) {
    throw new Error("找不到城市");
  }
  let best: ID | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const city of state.world.cities) {
    if (city.id === fromId || exclude.includes(city.id)) {
      continue;
    }
    const d = dist(from.position, city.position);
    if (d < bestDist) {
      best = city.id;
      bestDist = d;
    }
  }
  if (!best) {
    throw new Error("找不到鄰近城市");
  }
  return best;
}

interface Scenario {
  state: GameState;
  routeId: ID;
  train: Train;
}

function scenario(modelId = "re-2"): Scenario {
  const state = createNewGame(SEED, "free");
  const cityA = state.world.cities[0];
  if (!cityA) {
    throw new Error("沒有城市");
  }
  const cityB = nearestCityId(state, cityA.id);
  const draft = createDraft("#4f8ef7");
  addStop(state, draft, stationIdOf(state, cityA.id));
  addStop(state, draft, stationIdOf(state, cityB));
  const built = confirmDraft(state, draft);
  if (!built.ok) {
    throw new Error("建設失敗");
  }
  const bought = purchaseTrain(state, modelId);
  if (!bought.ok) {
    throw new Error("購買失敗");
  }
  const assigned = assignTrainToRoute(state, bought.train.id, built.route.id);
  if (!assigned.ok) {
    throw new Error("指派失敗");
  }
  return { state, routeId: built.route.id, train: bought.train };
}

function run(state: GameState, minutes: number): void {
  for (let i = 0; i < minutes; i++) {
    stepMinute(state);
  }
}

describe("營運模擬", () => {
  it("每個 tick 推進一分鐘遊戲時間", () => {
    const state = createNewGame(SEED, "free");
    run(state, 10);
    expect(state.clock.minutes).toBe(10);
  });

  it("列車會沿路線前進、停站並保持資料合法", () => {
    const { state, train, routeId } = scenario();
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) {
      throw new Error("找不到路線");
    }
    const segments = route.stationIds.length - 1;
    const startPos = train.currentSegmentIndex + train.progressOnSegment;

    for (let i = 0; i < 30; i++) {
      stepMinute(state);
      expect(train.currentSegmentIndex).toBeGreaterThanOrEqual(0);
      expect(train.currentSegmentIndex).toBeLessThanOrEqual(segments - 1);
      expect(train.progressOnSegment).toBeGreaterThanOrEqual(0);
      expect(train.progressOnSegment).toBeLessThanOrEqual(1);
    }
    const endPos = train.currentSegmentIndex + train.progressOnSegment;
    expect(endPos).toBeGreaterThan(startPos);
  });

  it("列車會抵達兩端終點站並折返", () => {
    const { state, train, routeId } = scenario("ce-3");
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) {
      throw new Error("找不到路線");
    }
    const lastIndex = route.stationIds.length - 1;

    const visited = new Set<number>();
    // 以最保守的方式估算「去回至少一趟」所需時間（實際班距限制只會更慢）。
    const oneWay = (route.totalDistance / 105) * 60;
    const totalMinutes = Math.ceil(oneWay * 2 * 1.25) + 180;
    for (let i = 0; i < totalMinutes; i++) {
      stepMinute(state);
      if (train.status === "stopped" && train.progressOnSegment === 0) {
        const station =
          train.direction === 1 ? train.currentSegmentIndex : train.currentSegmentIndex + 1;
        visited.add(station);
      }
    }
    expect(visited.has(lastIndex), `應抵達終點站 ${lastIndex}（造訪：${[...visited].join(",")}）`).toBe(true);
    expect(visited.has(0), `應折返回起點站 0（造訪：${[...visited].join(",")}）`).toBe(true);
  });

  it("環狀線列車單向循環，不會折返", () => {
    const state = createNewGame(SEED, "free");
    const cityA = state.world.cities[0];
    if (!cityA) {
      throw new Error("沒有城市");
    }
    const cityB = nearestCityId(state, cityA.id);
    const cityC = nearestCityId(state, cityB, [cityA.id]);
    const draft = createDraft("#4f8ef7");
    addStop(state, draft, stationIdOf(state, cityA.id));
    addStop(state, draft, stationIdOf(state, cityB));
    addStop(state, draft, stationIdOf(state, cityC));
    addStop(state, draft, stationIdOf(state, cityA.id)); // 回到起點 = 環狀線
    const built = confirmDraft(state, draft);
    if (!built.ok) {
      throw new Error("建設失敗");
    }
    const bought = purchaseTrain(state, "ce-3");
    if (!bought.ok) {
      throw new Error("購買失敗");
    }
    assignTrainToRoute(state, bought.train.id, built.route.id);
    const train = bought.train;

    // 跑完整一圈以上的時間：列車行經最後一段後應回到第 0 段並繼續同向循環（不折返）。
    const lastSegment = built.route.stationIds.length - 2;
    const oneLap = (built.route.totalDistance / 105) * 60 * 1.6 + 240;
    let sawLastSegment = false;
    let returnedToStart = false;
    for (let i = 0; i < oneLap; i++) {
      stepMinute(state);
      expect(train.direction).toBe(1);
      if (train.currentSegmentIndex === lastSegment && train.progressOnSegment > 0) {
        sawLastSegment = true;
      }
      if (
        sawLastSegment &&
        train.currentSegmentIndex === 0 &&
        train.progressOnSegment === 0
      ) {
        returnedToStart = true;
      }
    }
    expect(sawLastSegment).toBe(true);
    expect(returnedToStart).toBe(true);
    expect(train.direction).toBe(1);
  });

  it("行駛會累計能源成本，每日結算寫入財務紀錄", () => {
    const { state, routeId } = scenario();
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) {
      throw new Error("找不到路線");
    }
    run(state, 120);
    expect(route.opsCostPending).toBeGreaterThan(0);

    const ledgerBefore = state.ledger.length;
    run(state, MINUTES_PER_DAY - 120);
    expect(state.clock.minutes).toBe(MINUTES_PER_DAY);
    expect(route.opsCostPending).toBeCloseTo(0, 5);
    expect(state.ledger.length).toBeGreaterThan(ledgerBefore);
    const opsEntry = state.ledger.find(
      (e) => e.category === "train_operation" && e.description.includes("營運支出"),
    );
    expect(opsEntry).toBeDefined();
    expect(opsEntry?.amount).toBeLessThan(0);
    const stationEntry = state.ledger.find((e) => e.category === "station" && e.amount < 0);
    expect(stationEntry).toBeDefined();
    expect(state.finance.history.length).toBe(1);
    const summary = state.finance.history[0];
    expect(summary?.day).toBe(1);
    expect((summary?.cost ?? 0) > 0).toBe(true);
  });

  it("待命列車也會產生每日維護費", () => {
    const state = createNewGame(SEED, "free");
    const bought = purchaseTrain(state, "lt-1");
    if (!bought.ok) {
      throw new Error("購買失敗");
    }
    run(state, MINUTES_PER_DAY);
    expect(state.depotCostPending).toBeCloseTo(0, 5);
    const entry = state.ledger.find((e) => e.description.includes("待命列車"));
    expect(entry).toBeDefined();
    expect(entry?.amount).toBeLessThan(0);
  });

  it("暫停營運時列車停止移動，但仍累計維護費", () => {
    const { state, routeId, train } = scenario();
    setRouteOperationStatus(state, routeId, "suspended");
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) {
      throw new Error("找不到路線");
    }
    const posBefore = train.currentSegmentIndex + train.progressOnSegment;
    run(state, 60);
    const posAfter = train.currentSegmentIndex + train.progressOnSegment;
    expect(posAfter).toBe(posBefore);
    expect(train.status).toBe("stopped");
    // 維護費仍會累計（每分鐘 maintenanceRate/1440）。
    expect(route.opsCostPending).toBeGreaterThan(10);
  });

  it("刪除路線後列車回到待命狀態", () => {
    const { state, train } = scenario();
    state.routes.splice(0, state.routes.length);
    stepMinute(state);
    expect(train.routeId).toBeNull();
    expect(train.status).toBe("idle");
  });

  it("SimulationRunner 依速度推進固定步進，暫停時不推進", () => {
    const state = createNewGame(SEED, "free");
    const runner = new SimulationRunner(state);

    expect(runner.update(0.5)).toBe(0); // 初始為暫停
    state.clock.speed = 2;
    expect(runner.update(0.5)).toBe(6); // 0.5s × 6 分/秒 × 2 倍
    expect(state.clock.minutes).toBe(6);

    state.clock.speed = 0;
    expect(runner.update(1)).toBe(0);
    expect(state.clock.minutes).toBe(6);
  });

  it("固定步進不受呼叫頻率影響（累加器跨幀保留）", () => {
    const state = createNewGame(SEED, "free");
    const runner = new SimulationRunner(state);
    state.clock.speed = 1;
    // 每次 0.1 秒，十次後應累積約 6 分鐘。
    for (let i = 0; i < 10; i++) {
      runner.update(0.1);
    }
    expect(state.clock.minutes).toBe(6);
  });
});
