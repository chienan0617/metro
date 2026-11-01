import { describe, expect, it } from "vitest";
import type { GameState, ID } from "../core/types.ts";
import { TRAIN_CONFIG } from "./config.ts";
import { addStop, confirmDraft, createDraft } from "./routes.ts";
import { createNewGame } from "./state.ts";
import {
  assignTrainToRoute,
  effectiveTrainCapacity,
  placeTrainAtFraction,
  purchaseTrain,
  routeFleetStats,
  sellTrain,
  setRouteInterval,
  setRouteOperationStatus,
  tripMinutes,
  upgradeTrain,
} from "./trains.ts";
import { TRAIN_MODELS, trainModelById } from "./trainModels.ts";

const SEED = 20261030;

function stationIdOf(state: GameState, cityId: ID): ID {
  const city = state.world.cities.find((c) => c.id === cityId);
  const stationId = city?.stationIds[0];
  if (!stationId) {
    throw new Error("城市沒有車站");
  }
  return stationId;
}

function buildRoute(state: GameState): ID {
  const a = state.world.cities[0];
  const b = state.world.cities[2];
  if (!a || !b) {
    throw new Error("城市不足");
  }
  const draft = createDraft("#4f8ef7");
  addStop(state, draft, stationIdOf(state, a.id));
  addStop(state, draft, stationIdOf(state, b.id));
  const result = confirmDraft(state, draft);
  if (!result.ok) {
    throw new Error("建設測試路線失敗");
  }
  return result.route.id;
}

describe("列車購買與車隊", () => {
  it("購買列車會扣款、加入車隊並留下財務紀錄", () => {
    const state = createNewGame(SEED, "free");
    const moneyBefore = state.player.money;
    const model = TRAIN_MODELS[0];
    if (!model) {
      throw new Error("沒有列車型號");
    }
    const result = purchaseTrain(state, model.id);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(state.player.money).toBeCloseTo(moneyBefore - model.purchasePrice, 6);
    expect(state.trains.length).toBe(1);
    expect(result.train.modelId).toBe(model.id);
    expect(result.train.routeId).toBeNull();
    expect(result.train.status).toBe("idle");
    expect(state.ledger.at(-1)?.category).toBe("train_purchase");
  });

  it("資金不足與未解鎖型號無法購買", () => {
    const state = createNewGame(SEED, "free");
    state.player.money = 100;
    const cheap = TRAIN_MODELS[0];
    if (!cheap) {
      throw new Error("沒有列車型號");
    }
    const poor = purchaseTrain(state, cheap.id);
    expect(poor.ok).toBe(false);
    if (!poor.ok) {
      expect(poor.error).toBe("insufficient_funds");
    }

    state.player.money = 10_000_000;
    const locked = TRAIN_MODELS.find((m) => m.unlockLevel > state.player.level);
    if (locked) {
      const lockedResult = purchaseTrain(state, locked.id);
      expect(lockedResult.ok).toBe(false);
      if (!lockedResult.ok) {
        expect(lockedResult.error).toBe("locked");
      }
    }
  });

  it("指派列車到路線：設定狀態、均勻分布並可解除", () => {
    const state = createNewGame(SEED, "free");
    const routeId = buildRoute(state);
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) {
      throw new Error("找不到路線");
    }

    const a = purchaseTrain(state, "re-2");
    const b = purchaseTrain(state, "re-2");
    if (!a.ok || !b.ok) {
      throw new Error("購買失敗");
    }
    expect(assignTrainToRoute(state, a.train.id, routeId).ok).toBe(true);
    expect(assignTrainToRoute(state, b.train.id, routeId).ok).toBe(true);

    expect(route.assignedTrainIds.length).toBe(2);
    expect(a.train.routeId).toBe(routeId);
    // 兩輛列車應被分散在不同位置。
    const posA = a.train.currentSegmentIndex + a.train.progressOnSegment;
    const posB = b.train.currentSegmentIndex + b.train.progressOnSegment;
    expect(Math.abs(posA - posB)).toBeGreaterThan(0.2);

    expect(assignTrainToRoute(state, a.train.id, null).ok).toBe(true);
    expect(a.train.routeId).toBeNull();
    expect(a.train.status).toBe("idle");
    expect(route.assignedTrainIds).not.toContain(a.train.id);
  });

  it("賣出列車退回六成金額並解除指派", () => {
    const state = createNewGame(SEED, "free");
    const routeId = buildRoute(state);
    const bought = purchaseTrain(state, "lt-1");
    if (!bought.ok) {
      throw new Error("購買失敗");
    }
    assignTrainToRoute(state, bought.train.id, routeId);
    const model = trainModelById("lt-1");
    if (!model) {
      throw new Error("找不到型號");
    }
    const expectedRefund = Math.round(model.purchasePrice * TRAIN_CONFIG.sellRefundRatio);
    const moneyBefore = state.player.money;
    const sold = sellTrain(state, bought.train.id);
    expect(sold.ok).toBe(true);
    if (!sold.ok) {
      return;
    }
    expect(sold.refund).toBe(expectedRefund);
    expect(state.player.money).toBeCloseTo(moneyBefore + expectedRefund, 6);
    expect(state.trains.length).toBe(0);
    const route = state.routes.find((r) => r.id === routeId);
    expect(route?.assignedTrainIds.length).toBe(0);
    expect(state.ledger.at(-1)?.category).toBe("train_sale");
  });

  it("列車升級會提高容量並可重複進行", () => {
    const state = createNewGame(SEED, "free");
    const bought = purchaseTrain(state, "re-2");
    if (!bought.ok) {
      throw new Error("購買失敗");
    }
    const capacityBefore = effectiveTrainCapacity(state, bought.train);
    const result = upgradeTrain(state, bought.train.id);
    expect(result.ok).toBe(true);
    expect(bought.train.level).toBe(2);
    expect(effectiveTrainCapacity(state, bought.train)).toBeGreaterThan(capacityBefore);
    // 升到最高級後不能再升。
    upgradeTrain(state, bought.train.id);
    const atMax = upgradeTrain(state, bought.train.id);
    expect(atMax.ok).toBe(false);
    expect(bought.train.level).toBe(3);
  });

  it("發車間隔設定有範圍限制", () => {
    const state = createNewGame(SEED, "free");
    const routeId = buildRoute(state);
    expect(setRouteInterval(state, routeId, 6)).toBe(true);
    const route = state.routes.find((r) => r.id === routeId);
    expect(route?.departureInterval).toBe(6);
    setRouteInterval(state, routeId, 0);
    expect(route?.departureInterval).toBe(1);
    setRouteInterval(state, routeId, 999);
    expect(route?.departureInterval).toBe(120);
  });

  it("暫停與恢復營運會重設發車時刻", () => {
    const state = createNewGame(SEED, "free");
    const routeId = buildRoute(state);
    state.clock.minutes = 500;
    expect(setRouteOperationStatus(state, routeId, "suspended")).toBe(true);
    const route = state.routes.find((r) => r.id === routeId);
    expect(route?.status).toBe("suspended");
    expect(setRouteOperationStatus(state, routeId, "active")).toBe(true);
    expect(route?.status).toBe("active");
    expect(route?.departureSlots).toEqual([500, 500]);
  });

  it("車隊統計會反映班距、運能與成本", () => {
    const state = createNewGame(SEED, "free");
    const routeId = buildRoute(state);
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) {
      throw new Error("找不到路線");
    }
    const empty = routeFleetStats(state, route);
    expect(empty.trainCount).toBe(0);
    expect(empty.actualIntervalMinutes).toBeNull();
    expect(empty.suggestedTrains).toBeGreaterThanOrEqual(1);

    const bought = purchaseTrain(state, "ce-3");
    if (!bought.ok) {
      throw new Error("購買失敗");
    }
    assignTrainToRoute(state, bought.train.id, routeId);
    const stats = routeFleetStats(state, route);
    expect(stats.trainCount).toBe(1);
    expect(stats.actualIntervalMinutes).not.toBeNull();
    expect(stats.capacityPerHour).toBeGreaterThan(0);
    expect(stats.dailyMaintenanceCost).toBeCloseTo(
      trainModelById("ce-3")?.maintenanceRate ?? -1,
      6,
    );
    expect(stats.dailyEnergyCost).toBeGreaterThan(0);
  });

  it("較快的列車單程時間較短（tripMinutes 單調性）", () => {
    const state = createNewGame(SEED, "free");
    const routeId = buildRoute(state);
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) {
      throw new Error("找不到路線");
    }
    expect(tripMinutes(route, 120)).toBeLessThan(tripMinutes(route, 60));
  });

  it("列車可被放置到路線上的指定比例位置", () => {
    const state = createNewGame(SEED, "free");
    const routeId = buildRoute(state);
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) {
      throw new Error("找不到路線");
    }
    const bought = purchaseTrain(state, "lt-1");
    if (!bought.ok) {
      throw new Error("購買失敗");
    }
    placeTrainAtFraction(state, bought.train, route, 0);
    expect(bought.train.currentSegmentIndex).toBe(0);
    expect(bought.train.progressOnSegment).toBe(0);

    placeTrainAtFraction(state, bought.train, route, 0.75);
    expect(bought.train.direction).toBe(1);
    expect(
      bought.train.currentSegmentIndex + bought.train.progressOnSegment,
    ).toBeGreaterThan(0.5);
  });
});
