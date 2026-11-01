import { describe, expect, it } from "vitest";
import { dist } from "../core/math.ts";
import type { ID, TerrainType } from "../core/types.ts";
import { createTerrainSampler, sampleTerrainMultiplier } from "../world/terrain.ts";
import { ECONOMY_CONFIG, ROUTE_CONFIG } from "./config.ts";
import {
  addStop,
  canAddStop,
  confirmDraft,
  createDraft,
  deleteRoute,
  moveStop,
  previewDraft,
  removeStopAt,
  segmentCost,
} from "./routes.ts";
import { createNewGame } from "./state.ts";

const SEED = 20261030;

function setup(): ReturnType<typeof createNewGame> {
  return createNewGame(SEED, "free");
}

/** 找出距離某城市最近的城市。 */
function nearestCityId(state: ReturnType<typeof setup>, fromId: ID, exclude: ID[] = []): ID {
  const from = state.world.cities.find((c) => c.id === fromId);
  if (!from) {
    throw new Error("找不到起點城市");
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

function stationIdOf(state: ReturnType<typeof setup>, cityId: ID): ID {
  const city = state.world.cities.find((c) => c.id === cityId);
  const stationId = city?.stationIds[0];
  if (!stationId) {
    throw new Error("城市沒有車站");
  }
  return stationId;
}

describe("路線建設", () => {
  it("預覽會計算距離與成本，且反覆計算結果一致", () => {
    const state = setup();
    const cityA = state.world.cities[0];
    if (!cityA) {
      throw new Error("沒有城市");
    }
    const cityB = nearestCityId(state, cityA.id);
    const draft = createDraft("#4f8ef7");
    expect(addStop(state, draft, stationIdOf(state, cityA.id)).ok).toBe(true);
    expect(addStop(state, draft, stationIdOf(state, cityB)).ok).toBe(true);

    const preview1 = previewDraft(state, draft);
    const preview2 = previewDraft(state, draft);
    expect(preview1.totalDistance).toBeGreaterThan(0);
    expect(preview1.constructionCost).toBeGreaterThan(0);
    expect(preview1).toEqual(preview2);
    expect(preview1.stops).toBe(2);
  });

  it("路段成本會依地形提高（水域與山地比平原貴）", () => {
    const a = { x: 20, y: 20 };
    const b = { x: 320, y: 20 };
    const tile = (terrain: TerrainType) => () => terrain;
    const plainMultiplier = sampleTerrainMultiplier(tile("plain"), a, b);
    expect(plainMultiplier).toBeCloseTo(1.0, 5);

    const waterMultiplier = sampleTerrainMultiplier(tile("water"), a, b);
    expect(waterMultiplier).toBeGreaterThan(plainMultiplier * 3);

    const mountainMultiplier = sampleTerrainMultiplier(tile("mountain"), a, b);
    expect(mountainMultiplier).toBeGreaterThan(plainMultiplier * 2);
  });

  it("不能重複加入同一城市", () => {
    const state = setup();
    const cityA = state.world.cities[0];
    if (!cityA) {
      throw new Error("沒有城市");
    }
    const draft = createDraft("#4f8ef7");
    const stationId = stationIdOf(state, cityA.id);
    expect(addStop(state, draft, stationId).ok).toBe(true);
    const second = addStop(state, draft, stationId);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBe("already_in_draft");
    }
  });

  it("拒絕過短的距離與解鎖檢查（純驗證函式）", () => {
    const state = setup();
    const cityA = state.world.cities[0];
    const cityB = state.world.cities[1];
    if (!cityA || !cityB) {
      throw new Error("城市不足");
    }
    const draft = createDraft("#4f8ef7");
    const stationA = stationIdOf(state, cityA.id);
    addStop(state, draft, stationA);

    // 暫時把城市 B 的車站移到 A 旁邊，驗證最短距離規則。
    const stationAObj = state.world.stations.find((s) => s.id === stationA);
    const stationBObj = state.world.stations.find((s) => s.id === stationIdOf(state, cityB.id));
    if (!stationAObj || !stationBObj) {
      throw new Error("車站不足");
    }
    const original = { ...stationBObj.position };
    stationBObj.position = { x: stationAObj.position.x + 10, y: stationAObj.position.y };
    const result = canAddStop(state, draft, stationBObj.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("segment_too_short");
    }
    stationBObj.position = original;

    // 鎖定的城市不能建設。
    cityB.unlocked = false;
    const lockedResult = canAddStop(state, draft, stationIdOf(state, cityB.id));
    expect(lockedResult.ok).toBe(false);
    if (!lockedResult.ok) {
      expect(lockedResult.error).toBe("locked_city");
    }
    cityB.unlocked = true;
  });

  it("少於兩站不能確認建設", () => {
    const state = setup();
    const draft = createDraft("#4f8ef7");
    const result = confirmDraft(state, draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("too_few_stops");
    }
  });

  it("資金不足時無法建設，且不會扣款或建立路線", () => {
    const state = setup();
    const cityA = state.world.cities[0];
    if (!cityA) {
      throw new Error("沒有城市");
    }
    const cityB = nearestCityId(state, cityA.id);
    const draft = createDraft("#4f8ef7");
    addStop(state, draft, stationIdOf(state, cityA.id));
    addStop(state, draft, stationIdOf(state, cityB));

    state.player.money = 100;
    const moneyBefore = state.player.money;
    const result = confirmDraft(state, draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("insufficient_funds");
    }
    expect(state.player.money).toBe(moneyBefore);
    expect(state.routes.length).toBe(0);
    expect(state.ledger.length).toBe(0);
  });

  it("確認建設會扣款、建立路線、連接車站並留下財務紀錄", () => {
    const state = setup();
    const cityA = state.world.cities[0];
    if (!cityA) {
      throw new Error("沒有城市");
    }
    const cityB = nearestCityId(state, cityA.id);
    const stationA = stationIdOf(state, cityA.id);
    const stationB = stationIdOf(state, cityB);
    const draft = createDraft("#4f8ef7");
    addStop(state, draft, stationA);
    addStop(state, draft, stationB);

    const preview = previewDraft(state, draft);
    const moneyBefore = state.player.money;
    const result = confirmDraft(state, draft);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(state.player.money).toBeCloseTo(moneyBefore - preview.constructionCost, 6);
    expect(state.routes.length).toBe(1);
    expect(result.route.stationIds).toEqual([stationA, stationB]);
    expect(result.route.status).toBe("active");
    expect(result.route.color).toBe("#4f8ef7");

    const station = state.world.stations.find((s) => s.id === stationA);
    expect(station?.routeIds).toContain(result.route.id);
    expect(state.ledger.length).toBe(1);
    expect(state.ledger[0]?.amount).toBeCloseTo(-preview.constructionCost, 6);
  });

  it("停靠站可以移除與重新排序", () => {
    const state = setup();
    const draft = createDraft("#4f8ef7");
    const ids = state.world.cities.slice(0, 3).map((c) => stationIdOf(state, c.id));
    // 依序加入三個城市（若距離不足則跳過該城市）。
    for (const id of ids) {
      addStop(state, draft, id);
    }
    expect(draft.stops.length).toBeGreaterThanOrEqual(2);

    const first = draft.stops[0] as ID;
    const second = draft.stops[1] as ID;
    expect(moveStop(draft, 0, 1)).toBe(true);
    expect(draft.stops[0]).toBe(second);
    expect(draft.stops[1]).toBe(first);

    removeStopAt(draft, 0);
    expect(draft.stops).not.toContain(second);
  });

  it("單一路段的成本公式與距離成正比（不含地形差異時）", () => {
    const state = setup();
    const cityA = state.world.cities[0];
    const cityB = state.world.cities[1];
    if (!cityA || !cityB) {
      throw new Error("城市不足");
    }
    const stationA = state.world.stations.find((s) => s.cityId === cityA.id);
    const stationB = state.world.stations.find((s) => s.cityId === cityB.id);
    if (!stationA || !stationB) {
      throw new Error("車站不足");
    }
    const preview = segmentCost(state, stationA, stationB);
    const expectedDistance = dist(stationA.position, stationB.position);
    expect(preview.distance).toBeCloseTo(expectedDistance, 6);
    // 成本 = 單位成本 × 距離 × 地形倍率（地形倍率至少為 1）。
    expect(preview.cost).toBeGreaterThanOrEqual(
      preview.distance * ECONOMY_CONFIG.trackCostPerUnit - 1e-6,
    );
  });

  it("刪除路線會清理車站的所屬清單", () => {
    const state = setup();
    const cityA = state.world.cities[0];
    if (!cityA) {
      throw new Error("沒有城市");
    }
    const cityB = nearestCityId(state, cityA.id);
    const draft = createDraft("#4f8ef7");
    addStop(state, draft, stationIdOf(state, cityA.id));
    addStop(state, draft, stationIdOf(state, cityB));
    const result = confirmDraft(state, draft);
    if (!result.ok) {
      throw new Error("測試前置建設失敗");
    }
    expect(deleteRoute(state, result.route.id)).toBe(true);
    expect(state.routes.length).toBe(0);
    for (const station of state.world.stations) {
      expect(station.routeIds).not.toContain(result.route.id);
    }
  });

  it("路線上限停靠站數生效", () => {
    const state = setup();
    const draft = createDraft("#4f8ef7");
    let added = 0;
    // 逐城市嘗試加入，直到超過上限或沒有可加入的城市。
    for (const city of state.world.cities) {
      const result = addStop(state, draft, stationIdOf(state, city.id));
      if (result.ok) {
        added++;
      }
      if (added >= ROUTE_CONFIG.maxStops) {
        break;
      }
    }
    if (added >= ROUTE_CONFIG.maxStops) {
      const extraCity = state.world.cities.find(
        (c) => !draft.stops.includes(stationIdOf(state, c.id)),
      );
      if (extraCity) {
        const overflow = canAddStop(state, draft, stationIdOf(state, extraCity.id));
        expect(overflow.ok).toBe(false);
        if (!overflow.ok) {
          expect(overflow.error).toBe("max_stops");
        }
      }
    }
  });

  it("使用自訂種子與 -1 種子也能產生有效世界並建設", () => {
    const state = createNewGame(-1, "free");
    const cities = state.world.cities;
    expect(cities.length).toBeGreaterThan(0);
    const draft = createDraft("#43c59e");
    const first = cities[0];
    if (!first) {
      throw new Error("沒有城市");
    }
    const secondId = nearestCityId(state, first.id);
    expect(addStop(state, draft, stationIdOf(state, first.id)).ok).toBe(true);
    expect(addStop(state, draft, stationIdOf(state, secondId)).ok).toBe(true);
    const result = confirmDraft(state, draft);
    expect(result.ok).toBe(true);
  });

  it("地形取樣器是可重現的（同一 seed 相同地形）", () => {
    const a = createTerrainSampler(5, "auto");
    const b = createTerrainSampler(5, "auto");
    for (let i = 0; i < 40; i++) {
      const p = { x: i * 137.5 - 2000, y: i * 91.3 + 500 };
      expect(a.terrainAt(p)).toBe(b.terrainAt(p));
      expect(a.biomeAt(p)).toBe(b.biomeAt(p));
    }
  });
});
