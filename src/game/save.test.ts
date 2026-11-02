import { describe, expect, it } from "vitest";
import type { GameState, ID } from "../core/types.ts";
import {
  buildPayload,
  createSaveSlot,
  decodeSave,
  deleteSaveSlot,
  encodeSave,
  exportSaveText,
  importSaveText,
  installAutosave,
  listSaveSlots,
  migrateLegacySave,
  readSaveSlot,
  slotKey,
  writeSaveSlot,
  type SaveStorage,
} from "./save.ts";
import { SAVE_VERSION } from "./config.ts";
import { Store } from "../core/store.ts";
import { createNewGame } from "./state.ts";
import { addStop, confirmDraft, createDraft, routeGeometrics } from "./routes.ts";
import { assignTrainToRoute, purchaseTrain } from "./trains.ts";
import { stepMinute } from "./simulation.ts";
import { upgradeStation } from "./stations.ts";
import { materializeTile } from "../world/worldgen.ts";

const SEED = 20261030;

class MemoryStorage implements SaveStorage {
  private data = new Map<string, string>();

  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  set(key: string, value: string): boolean {
    this.data.set(key, value);
    return true;
  }

  remove(key: string): void {
    this.data.delete(key);
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
  // 生涯模式中並非所有城市都已解鎖；選擇距離最近的一對已解鎖城市，
  // 確保測試路線在起始資金內可完成。
  const unlocked = state.world.cities.filter((c) => c.unlocked);
  const a = unlocked[0];
  if (!a) {
    throw new Error("城市不足");
  }
  let b = unlocked[1];
  let best = Number.POSITIVE_INFINITY;
  for (const candidate of unlocked.slice(1)) {
    const d = Math.hypot(
      candidate.position.x - a.position.x,
      candidate.position.y - a.position.y,
    );
    if (d < best) {
      best = d;
      b = candidate;
    }
  }
  if (!b) {
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

  it("環狀線（重複停靠）存檔往返後保持完整", () => {
    const state = createNewGame(SEED, "free");
    const cities = state.world.cities.slice(0, 3);
    if (cities.length < 3) {
      throw new Error("城市不足");
    }
    const draft = createDraft("#4f8ef7");
    addStop(state, draft, stationIdOf(state, cities[0]!.id));
    addStop(state, draft, stationIdOf(state, cities[1]!.id));
    addStop(state, draft, stationIdOf(state, cities[2]!.id));
    addStop(state, draft, stationIdOf(state, cities[0]!.id)); // 回到起點 = 環狀線
    const built = confirmDraft(state, draft);
    if (!built.ok) {
      throw new Error(`環狀線建設失敗：${built.error}`);
    }
    expect(built.route.stationIds[0]).toBe(built.route.stationIds[built.route.stationIds.length - 1]);

    const decoded = decodeSave(JSON.parse(encodeSave(state)) as unknown);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    const route = decoded.state.routes.find((r) => r.id === built.route.id);
    expect(route).toBeDefined();
    expect(route?.stationIds).toEqual(built.route.stationIds);
    expect(route?.totalDistance).toBeCloseTo(built.route.totalDistance, 6);
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

  it("舊版地圖系統（v1–v3）存檔會被明確拒絕，不會白屏", () => {
    const state = withRoute(createNewGame(SEED, "free"));
    const payload = buildPayload(state) as unknown as Record<string, unknown>;
    payload["saveVersion"] = 3;
    const decoded = decodeSave(payload);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error).toContain("舊版");
    }
  });

  it("探索的圖磚清單會隨存檔保留，載入後城市完全一致", () => {
    const state = createNewGame(SEED, "free");
    // 模擬探索兩個額外圖磚。
    const before = state.world.cities.length;
    const ctx = {
      world: state.world,
      tiles: new Set(state.materializedTiles),
      freeUnlock: true,
    };
    materializeTile(ctx, 9, -4);
    materializeTile(ctx, 10, -4);
    state.materializedTiles = [...ctx.tiles];
    expect(state.world.cities.length).toBeGreaterThanOrEqual(before);

    const decoded = decodeSave(JSON.parse(encodeSave(state)) as unknown);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    expect(decoded.state.materializedTiles.length).toBe(state.materializedTiles.length);
    expect(decoded.state.world.cities.length).toBe(state.world.cities.length);
    expect(decoded.state.world.cities).toEqual(state.world.cities);
    expect(decoded.state.world.startCore).toEqual(state.world.startCore);
  });

  it("v4 存檔會保留公司統計、財務、研究、事件、任務與車站升級", () => {
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
    // 生涯模式：解鎖狀態隨存檔還原（未解鎖的城市維持鎖定）。
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

  it("多存檔欄位：寫入、列出、讀取與刪除互不影響", () => {
    const storage = new MemoryStorage();
    expect(listSaveSlots(storage)).toEqual([]);

    const stateA = withRoute(createNewGame(SEED, "free"));
    const stateB = withRoute(createNewGame(SEED + 1, "career"));
    const slotA = createSaveSlot();
    const slotB = createSaveSlot();
    expect(writeSaveSlot(slotA, stateA, storage)).toBe(true);
    expect(writeSaveSlot(slotB, stateB, storage)).toBe(true);

    const slots = listSaveSlots(storage);
    expect(slots.length).toBe(2);
    expect(slots.map((s) => s.id).sort()).toEqual([slotA, slotB].sort());

    const loadedA = readSaveSlot(slotA, storage);
    expect(loadedA?.ok).toBe(true);
    if (loadedA && loadedA.ok) {
      expect(loadedA.state.seed).toBe(SEED);
      expect(loadedA.state.routes.length).toBe(1);
    }

    deleteSaveSlot(slotB, storage);
    expect(listSaveSlots(storage).length).toBe(1);
    expect(readSaveSlot(slotB, storage)).toBeNull();
    expect(readSaveSlot(slotA, storage)?.ok).toBe(true);
  });

  it("開新遊戲不會覆蓋既有存檔欄位", () => {
    const storage = new MemoryStorage();
    const firstSlot = createSaveSlot();
    writeSaveSlot(firstSlot, createNewGame(SEED, "free"), storage);
    // 再開一場新遊戲 → 另一個欄位。
    const secondSlot = createSaveSlot();
    writeSaveSlot(secondSlot, createNewGame(SEED + 1, "career"), storage);
    expect(listSaveSlots(storage).length).toBe(2);
    // 第一次的存檔內容仍然存在。
    const first = readSaveSlot(firstSlot, storage);
    expect(first?.ok).toBe(true);
    if (first && first.ok) {
      expect(first.state.seed).toBe(SEED);
    }
  });

  it("匯入存檔一律建立新的欄位，不覆蓋現有進度", () => {
    const storage = new MemoryStorage();
    const existing = createSaveSlot();
    writeSaveSlot(existing, withRoute(createNewGame(SEED, "free")), storage);
    const exported = exportSaveText(existing, storage);
    expect(exported).not.toBeNull();
    const result = importSaveText(exported as string, storage);
    expect(result.ok).toBe(true);
    expect(listSaveSlots(storage).length).toBe(2);
    expect(readSaveSlot(existing, storage)?.ok).toBe(true);
    if (result.ok && result.slotId) {
      expect(readSaveSlot(result.slotId, storage)?.ok).toBe(true);
    }
  });

  it("舊版單一存檔會自動搬移成新欄位（保留進度）", () => {
    const storage = new MemoryStorage();
    const legacyState = withRoute(createNewGame(SEED, "free"));
    storage.set("metro-network-tycoon/save", encodeSave(legacyState));
    migrateLegacySave(storage);
    expect(storage.get("metro-network-tycoon/save")).toBeNull();
    const slots = listSaveSlots(storage);
    expect(slots.length).toBe(1);
    const slotId = slots[0]?.id as string;
    const loaded = readSaveSlot(slotId, storage);
    expect(loaded?.ok).toBe(true);
    if (loaded && loaded.ok) {
      expect(loaded.state.routes.length).toBe(1);
    }
  });

  it("損毀的 JSON 會得到可理解的錯誤而非例外", () => {
    const storage = new MemoryStorage();
    const slotId = createSaveSlot();
    storage.set(slotKey(slotId), "{ this is not valid json");
    const result = readSaveSlot(slotId, storage);
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("自動存檔以節流方式寫入指定欄位", async () => {
    const storage = new MemoryStorage();
    const slotId = createSaveSlot();
    const state = createNewGame(SEED, "free");
    const store = new Store(state);
    const dispose = installAutosave(store, slotId, 60, storage);
    store.update((s) => {
      s.player.money = 123456;
    });
    await new Promise((resolve) => setTimeout(resolve, 140));
    const saved = readSaveSlot(slotId, storage);
    expect(saved?.ok).toBe(true);
    if (saved && saved.ok) {
      expect(Math.round(saved.state.player.money)).toBe(123456);
    }
    dispose();
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
