import { describe, expect, it } from "vitest";
import type { GameState, ID } from "../core/types.ts";
import {
  buildPayload,
  clearSave,
  decodeSave,
  encodeSave,
  hasSave,
  readSave,
  writeSave,
  type SaveStorage,
} from "./save.ts";
import { SAVE_VERSION } from "./config.ts";
import { createNewGame } from "./state.ts";
import { addStop, confirmDraft, createDraft, routeGeometrics } from "./routes.ts";
import { assignTrainToRoute, purchaseTrain } from "./trains.ts";
import { stepMinute } from "./simulation.ts";
import { upgradeStation } from "./stations.ts";

const SEED = 20261030;

class MemoryStorage implements SaveStorage {
  private data: string | null = null;

  read(): string | null {
    return this.data;
  }

  write(value: string): boolean {
    this.data = value;
    return true;
  }

  remove(): void {
    this.data = null;
  }
}

function stationIdOf(state: GameState, cityId: ID): ID {
  const city = state.world.cities.find((c) => c.id === cityId);
  const stationId = city?.stationIds[0];
  if (!stationId) {
    throw new Error("城市缺少車站");
  }
  return stationId;
}

function withRoute(state: GameState): GameState {
  // 生涯模式中並非所有城市都已解鎖，這裡只使用已解鎖的城市。
  const unlocked = state.world.cities.filter((c) => c.unlocked);
  const a = unlocked[0];
  const b = unlocked[2] ?? unlocked[1];
  if (!a || !b) {
    throw new Error("城市不足");
  }
  const draft = createDraft("#4f8ef7");
  addStop(state, draft, stationIdOf(state, a.id));
  addStop(state, draft, stationIdOf(state, b.id));
  const result = confirmDraft(state, draft);
  if (!result.ok) {
    throw new Error("測試路線建設失敗");
  }
  return state;
}

describe("存檔與讀檔", () => {
  it("存檔再讀取後資金、路線與車站連接保持一致", () => {
    const state = withRoute(createNewGame(SEED, "free"));
    const payload = JSON.parse(encodeSave(state)) as unknown;
    const decoded = decodeSave(payload);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    expect(decoded.state.player.money).toBeCloseTo(state.player.money, 6);
    expect(decoded.state.player.companyName).toBe(state.player.companyName);
    expect(decoded.state.mode).toBe("free");
    expect(decoded.state.routes.length).toBe(state.routes.length);
    expect(decoded.state.routes[0]?.stationIds).toEqual(state.routes[0]?.stationIds);
    expect(decoded.state.routes[0]?.color).toBe(state.routes[0]?.color);
    expect(decoded.state.ledger.length).toBe(state.ledger.length);
    // 建設成本是歷史事實，讀檔後必須與付費時一致。
    expect(decoded.state.routes[0]?.constructionCost).toBeCloseTo(
      state.routes[0]?.constructionCost ?? -1,
      6,
    );
    expect(decoded.state.routes[0]?.totalDistance).toBeCloseTo(
      state.routes[0]?.totalDistance ?? -1,
      6,
    );

    // 車站所屬路線清單由路線重建。
    const route = decoded.state.routes[0];
    const station = decoded.state.world.stations.find((s) => s.id === route?.stationIds[0]);
    expect(station?.routeIds).toContain(route?.id);

    // 世界由種子重新生成，城市資料必須一致。
    expect(decoded.state.world.cities).toEqual(state.world.cities);
  });

  it("舊版存檔缺少建設成本欄位時，以地形倍率完整重算", () => {
    const state = withRoute(createNewGame(SEED, "free"));
    const payload = buildPayload(state) as unknown as Record<string, unknown>;
    const routes = payload["routes"] as Array<Record<string, unknown>>;
    const firstRoute = routes[0];
    if (firstRoute) {
      delete firstRoute["constructionCost"];
      delete firstRoute["totalDistance"];
    }
    const decoded = decodeSave(payload);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    const route = decoded.state.routes[0];
    expect(route).toBeDefined();
    if (!route) {
      return;
    }
    const expected = routeGeometrics(decoded.state, route.stationIds);
    expect(route.constructionCost).toBeCloseTo(expected.constructionCost, 6);
    expect(route.constructionCost).toBeCloseTo(state.routes[0]?.constructionCost ?? -1, 6);
  });

  it("列車、遊戲時間與營運成本在存檔往返後保持一致", () => {
    const state = withRoute(createNewGame(SEED, "free"));
    const route = state.routes[0];
    if (!route) {
      throw new Error("沒有路線");
    }
    const bought = purchaseTrain(state, "re-2");
    if (!bought.ok) {
      throw new Error("購買失敗");
    }
    assignTrainToRoute(state, bought.train.id, route.id);
    for (let i = 0; i < 90; i++) {
      stepMinute(state);
    }
    const trainPosBefore = bought.train.currentSegmentIndex + bought.train.progressOnSegment;

    const decoded = decodeSave(JSON.parse(encodeSave(state)) as unknown);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    expect(decoded.state.clock.minutes).toBe(90);
    expect(decoded.state.trains.length).toBe(1);
    const decodedTrain = decoded.state.trains[0];
    expect(decodedTrain?.routeId).toBe(route.id);
    expect(decodedTrain?.modelId).toBe("re-2");
    const trainPosAfter =
      (decodedTrain?.currentSegmentIndex ?? 0) + (decodedTrain?.progressOnSegment ?? 0);
    expect(trainPosAfter).toBeCloseTo(trainPosBefore, 6);
    const decodedRoute = decoded.state.routes[0];
    expect(decodedRoute?.assignedTrainIds).toContain(decodedTrain?.id);
    expect(decodedRoute?.departureSlots).toEqual(route.departureSlots);
  });

  it("v1（Phase 1）存檔可升級：缺少的欄位套用預設值", () => {
    const state = withRoute(createNewGame(SEED, "free"));
    const payload = buildPayload(state) as unknown as Record<string, unknown>;
    // 模擬 Phase 1 的存檔內容。
    payload["saveVersion"] = 1;
    delete payload["clock"];
    delete payload["trains"];
    delete payload["depotCostPending"];
    delete payload["mode"];
    delete payload["stats"];
    delete payload["finance"];
    delete payload["research"];
    delete payload["events"];
    delete payload["mission"];
    delete payload["notifications"];
    delete payload["cities"];
    delete payload["stations"];
    const routes = payload["routes"] as Array<Record<string, unknown>>;
    for (const route of routes) {
      delete route["departureSlots"];
      delete route["opsCostPending"];
      delete route["stats"];
    }
    const decoded = decodeSave(payload);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    expect(decoded.state.saveVersion).toBe(SAVE_VERSION);
    expect(decoded.state.clock).toEqual({ minutes: 0, speed: 0 });
    expect(decoded.state.trains.length).toBe(0);
    expect(decoded.state.depotCostPending).toBe(0);
    expect(decoded.state.routes[0]?.departureSlots).toEqual([0, 0]);
    expect(decoded.state.routes[0]?.opsCostPending).toBe(0);
    expect(decoded.state.routes.length).toBe(1);
    // v1 存檔預設以自由模式載入（當時所有城市皆已解鎖）。
    expect(decoded.state.mode).toBe("free");
    expect(decoded.state.stats.totalServed).toBe(0);
    expect(decoded.state.research.completed.train).toBe(0);
  });

  it("v3 存檔會保留公司統計、財務、研究、事件、任務與車站升級", () => {
    const state = withRoute(createNewGame(SEED, "career"));
    // 車站升級。
    const stationId = state.world.cities[0] ? stationIdOf(state, state.world.cities[0].id) : null;
    if (stationId) {
      const knob = upgradeStation(state, stationId);
      // 生涯模式起始資金足夠升級第一個車站。
      expect(knob.ok).toBe(true);
    }
    // 累計統計與財務。
    state.stats.totalServed = 1234;
    state.stats.totalRevenue = 56789;
    state.finance.history.push({ day: 1, revenue: 1000, cost: 500 });
    state.finance.todayRevenue = 250;
    // 研究完成度。
    state.research.completed.operation = 1;
    // 事件。
    state.events.push({
      id: "evt-test",
      kind: "festival",
      cityId: state.world.cities[0]?.id ?? null,
      startedDay: 0,
      endDay: 3,
      label: "節慶活動",
    });
    // 任務進度。
    state.mission.completedCount = 2;
    state.mission.stars = 4;

    const decoded = decodeSave(JSON.parse(encodeSave(state)) as unknown);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    expect(decoded.state.mode).toBe("career");
    expect(decoded.state.stats.totalServed).toBe(1234);
    expect(decoded.state.stats.totalRevenue).toBe(56789);
    expect(decoded.state.finance.history.length).toBe(1);
    expect(decoded.state.finance.todayRevenue).toBe(250);
    expect(decoded.state.research.completed.operation).toBe(1);
    expect(decoded.state.events.length).toBe(1);
    expect(decoded.state.events[0]?.kind).toBe("festival");
    expect(decoded.state.mission.completedCount).toBe(2);
    expect(decoded.state.mission.stars).toBe(4);
    if (stationId) {
      const station = decoded.state.world.stations.find((s) => s.id === stationId);
      expect(station?.level).toBe(2);
    }
    // 生涯模式：解鎖狀態由等級重新套用。
    expect(decoded.state.world.cities.some((c) => !c.unlocked)).toBe(true);
  });

  it("無效的列車資料會被丟棄或修正", () => {
    const state = withRoute(createNewGame(SEED, "free"));
    const bought = purchaseTrain(state, "re-2");
    if (!bought.ok) {
      throw new Error("購買失敗");
    }
    const payload = buildPayload(state) as unknown as Record<string, unknown>;
    const trains = payload["trains"] as Array<Record<string, unknown>>;
    trains.push({ id: "train-99", modelId: "nonexistent", routeId: null });
    if (trains[0]) {
      trains[0]["routeId"] = "route-not-exist";
      trains[0]["currentSegmentIndex"] = 999;
    }
    const decoded = decodeSave(payload);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    expect(decoded.state.trains.length).toBe(1);
    const train = decoded.state.trains[0];
    expect(train?.routeId).toBeNull();
    expect(train?.status).toBe("idle");
    expect(train?.currentSegmentIndex).toBe(0);
  });

  it("拒絕不同版本的存檔", () => {
    const state = createNewGame(SEED, "free");
    const payload = buildPayload(state) as unknown as Record<string, unknown>;
    payload["saveVersion"] = SAVE_VERSION + 1;
    const decoded = decodeSave(payload);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error).toContain("版本");
    }
  });

  it("地圖設定指紋不同時拒絕存檔", () => {
    const state = createNewGame(SEED, "free");
    const payload = buildPayload(state) as unknown as Record<string, unknown>;
    payload["configHash"] = "deadbeef";
    const decoded = decodeSave(payload);
    expect(decoded.ok).toBe(false);
  });

  it("無效的路線資料會被丟棄，其餘狀態仍可載入", () => {
    const state = withRoute(createNewGame(SEED, "free"));
    const payload = buildPayload(state) as unknown as Record<string, unknown>;
    const routes = payload["routes"] as Array<Record<string, unknown>>;
    routes.push({
      id: "route-99",
      name: "損毀路線",
      color: "#ffffff",
      stationIds: ["stn-not-exist", "stn-also-missing"],
      status: "active",
      departureInterval: 8,
      createdAt: 0,
    });
    const decoded = decodeSave(payload);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    expect(decoded.state.routes.length).toBe(1);
    expect(decoded.state.routes.some((r) => r.id === "route-99")).toBe(false);
  });

  it("金額為負的存檔會被修正為 0，髒資料不會拋出例外", () => {
    const state = createNewGame(SEED, "free");
    const payload = buildPayload(state) as unknown as Record<string, unknown>;
    (payload["player"] as Record<string, unknown>)["money"] = -5000;
    payload["ledger"] = [null, 42, { amount: "abc" }];
    const decoded = decodeSave(payload);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    expect(decoded.state.player.money).toBe(0);
    expect(decoded.state.ledger.length).toBe(0);
  });

  it("透過儲存介面寫入、讀取與清除", () => {
    const storage = new MemoryStorage();
    expect(hasSave(storage)).toBe(false);
    expect(readSave(storage)).toBeNull();

    const state = withRoute(createNewGame(SEED, "free"));
    expect(writeSave(state, storage)).toBe(true);
    expect(hasSave(storage)).toBe(true);

    const loaded = readSave(storage);
    expect(loaded?.ok).toBe(true);
    if (loaded && loaded.ok) {
      expect(loaded.state.routes.length).toBe(1);
    }

    clearSave(storage);
    expect(hasSave(storage)).toBe(false);
  });

  it("損毀的 JSON 會得到可理解的錯誤而非例外", () => {
    const storage = new MemoryStorage();
    storage.write("{ this is not valid json");
    const result = readSave(storage);
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("counters 會依路線數量修正，避免 ID 衝突", () => {
    const state = withRoute(createNewGame(SEED, "free"));
    const payload = buildPayload(state) as unknown as Record<string, unknown>;
    (payload["counters"] as Record<string, unknown>)["route"] = 0;
    const decoded = decodeSave(payload);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.state.counters.route).toBeGreaterThanOrEqual(1);
    }
  });
});
