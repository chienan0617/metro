/** 路線建設面板：停靠站順序、地形分析、預覽數據、確認與取消（含編輯既有路線）。 */

import {
  formatDistance,
  formatDuration,
  formatMoney,
  formatMoneyCompact,
  formatPopulation,
} from "../../core/format.ts";
import type { GameState, ID } from "../../core/types.ts";
import { ROUTE_CONFIG, SEGMENT_TERRAIN_CONFIG } from "../../game/config.ts";
import {
  DRAFT_ERROR_MESSAGES,
  nextRouteName,
  previewDraft,
  type DraftError,
  type RouteDraft,
  type SegmentPreview,
} from "../../game/routes.ts";
import { cityDisplayName, stationById } from "../../world/worldgen.ts";
import { el, icon } from "../dom.ts";
import { chip, colorDots, infoNote, panelHeader, sectionTitle, statRow, warningBox } from "./kit.ts";

export interface RouteBuilderHandlers {
  onRemoveStop(index: number): void;
  onMoveStop(index: number, delta: -1 | 1): void;
  onUndoLast(): void;
  onClear(): void;
  onCancel(): void;
  onConfirm(): void;
  onSetColor(color: string): void;
}

/** 編輯既有路線時的補充資訊（由呼叫端以 planRouteEdit 計算）。 */
export interface RouteEditContext {
  routeId: ID;
  routeName: string;
  addedCost: number;
  addedDistance: number;
  addedSegmentCount: number;
  removedSegmentCount: number;
  /** 原路線的停靠站（用來標示哪些是新加入的站）。 */
  originalStationIds: readonly ID[];
  /** 目前草稿的驗證錯誤（null 代表可套用）。 */
  error: DraftError | null;
}

export function renderRouteBuilderPanel(
  container: HTMLElement,
  state: GameState,
  draft: RouteDraft,
  handlers: RouteBuilderHandlers,
  editContext?: RouteEditContext | null,
): void {
  const editing = editContext !== null && editContext !== undefined;
  const preview = previewDraft(state, draft);
  const canConfirm = draft.stops.length >= ROUTE_CONFIG.minStops;

  container.appendChild(
    panelHeader(
      editing ? "編輯路線" : "建立路線",
      handlers.onCancel,
      editing
        ? chip(`編輯中：${editContext.routeName}`, "#6395f5", true)
        : chip("建設模式", undefined, true),
    ),
  );

  container.appendChild(
    infoNote(
      editing
        ? `調整「${editContext.routeName}」的停靠站：確認後只收取新增路段的費用，拆除路段不收費亦不退費。`
        : "依序點選地圖上的城市加入停靠站；可拖曳地圖、滾輪縮放。右鍵可復原上一站。",
    ),
  );

  container.appendChild(sectionTitle("路線顏色"));
  container.appendChild(
    colorDots(ROUTE_CONFIG.colorPalette, draft.color, (color) => handlers.onSetColor(color)),
  );

  container.appendChild(sectionTitle(`停靠順序（${draft.stops.length} 站）`));
  if (draft.stops.length === 0) {
    container.appendChild(
      el("div", { class: "empty-card" }, el("div", { class: "empty-text", text: "點選地圖上的城市，加入第一個停靠站。" })),
    );
  } else {
    const list = el("div", { class: "stop-list" });
    draft.stops.forEach((stationId, index) => {
      const station = stationById(state.world, stationId);
      const city = station ? state.world.cities.find((c) => c.id === station.cityId) : null;
      if (!station || !city) {
        return;
      }
      const isTransfer = station.routeIds.length > 0;
      const isNewHere =
        editing && editContext !== null && !editContext.originalStationIds.includes(stationId);
      const row = el(
        "div",
        { class: "stop-row" },
        el("span", { class: "stop-index", text: String(index + 1) }),
        el(
          "span",
          { class: "stop-name" },
          el("span", { text: cityDisplayName(city) }),
          isNewHere ? chip("新增", "#39c69e", true) : null,
          isTransfer ? chip("轉乘", "#43c59e", true) : null,
        ),
        el(
          "span",
          { class: "stop-actions" },
          iconButton("up", "往前移", index === 0, () => handlers.onMoveStop(index, -1)),
          iconButton("down", "往後移", index === draft.stops.length - 1, () =>
            handlers.onMoveStop(index, 1),
          ),
          iconButton("close", "移除", false, () => handlers.onRemoveStop(index)),
        ),
      );
      row.style.setProperty("--stop-color", draft.color);
      list.appendChild(row);
    });
    container.appendChild(list);
  }

  container.appendChild(sectionTitle("路線預覽（估算值）"));
  const stats = el("div", { class: "stat-grid" });
  stats.appendChild(statRow("總距離", preview.stops >= 2 ? formatDistance(preview.totalDistance) : "—"));
  stats.appendChild(
    statRow("服務人口", preview.stops >= 1 ? formatPopulation(preview.totalPopulation) : "—"),
  );
  stats.appendChild(
    statRow(
      "預估單程",
      preview.stops >= 2 ? `約 ${formatDuration(preview.estimatedTripMinutes)}` : "—",
    ),
  );
  stats.appendChild(
    statRow(
      "可轉乘",
      preview.transferStationCount > 0
        ? `${preview.transferStationCount} 站 / ${preview.transferRouteCount} 條線`
        : "無",
    ),
  );
  container.appendChild(stats);

  // 逐段地形分析：讓玩家能在動工前避開高山與水域。
  if (preview.segments.length > 0) {
    container.appendChild(sectionTitle("路段地形分析"));
    const list = el("div", { class: "segment-list" });
    preview.segments.forEach((segment, index) => {
      list.appendChild(renderSegmentRow(state, segment, index));
    });
    container.appendChild(list);

    const waterSegments = preview.segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => segment.crossesWater);
    if (waterSegments.length > 0) {
      container.appendChild(
        warningBox([
          icon("warn", 15),
          el("span", {
            text: `第 ${waterSegments.map(({ index }) => index + 1).join("、")} 段跨越水域（需橋梁／隧道），成本 ×${SEGMENT_TERRAIN_CONFIG.waterCrossingMultiplier}。`,
          }),
        ]),
      );
    }
    const mountainSegments = preview.segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => segment.crossesMountain && !segment.crossesWater);
    if (mountainSegments.length > 0) {
      container.appendChild(
        warningBox([
          icon("warn", 15),
          el("span", {
            text: `第 ${mountainSegments.map(({ index }) => index + 1).join("、")} 段穿越山地，施工成本較高；可考慮繞行。`,
          }),
        ]),
      );
    }
  }

  // 成本區：編輯模式只顯示本次新增路段費用。
  const costBox = el("div", { class: "cost-box" });
  if (editing && editContext) {
    costBox.appendChild(
      el(
        "div",
        { class: "cost-line" },
        el("span", { class: "cost-label", text: "本次新增路段費用" }),
        el("span", { class: "cost-value", text: formatMoney(editContext.addedCost) }),
      ),
    );
    costBox.appendChild(
      el("div", {
        class: "cost-note",
        text: `新增 ${editContext.addedSegmentCount} 段（${formatDistance(editContext.addedDistance)}）；拆除 ${editContext.removedSegmentCount} 段不收費亦不退費。`,
      }),
    );
    if (editContext.error === null && editContext.addedCost > 0) {
      costBox.appendChild(
        el("div", {
          class: "cost-note",
          text: `套用後餘額 ${formatMoneyCompact(state.player.money - editContext.addedCost)}`,
        }),
      );
    }
  } else {
    costBox.appendChild(
      el(
        "div",
        { class: "cost-line" },
        el("span", { class: "cost-label", text: "建設成本" }),
        el("span", { class: "cost-value", text: preview.stops >= 2 ? formatMoney(preview.constructionCost) : "—" }),
      ),
    );
    if (preview.stops >= 2) {
      if (preview.affordable) {
        costBox.appendChild(
          el("div", {
            class: "cost-note",
            text: `建設後餘額 ${formatMoneyCompact(state.player.money - preview.constructionCost)}`,
          }),
        );
      } else {
        costBox.appendChild(
          warningBox([
            icon("warn", 15),
            el("span", { text: `資金不足，尚缺 ${formatMoney(preview.shortfall)}` }),
          ]),
        );
      }
      costBox.appendChild(
        el("div", {
          class: "cost-note",
          text: `成本已含地形係數：跨水域 ×${SEGMENT_TERRAIN_CONFIG.waterCrossingMultiplier}、高度差加成；山區與跨水路段明顯較貴。`,
        }),
      );
    }
  }
  if (editing && editContext && editContext.error !== null) {
    costBox.appendChild(
      warningBox([el("span", { text: DRAFT_ERROR_MESSAGES[editContext.error] })]),
    );
  }
  container.appendChild(costBox);

  if (!editing) {
    container.appendChild(
      infoNote(`將自動命名為「${nextRouteName(state)}」，建設完成後可修改名稱與顏色。`),
    );
  } else {
    container.appendChild(infoNote("修改後列車會回到起點重新發車；原有建設費與路線紀錄會保留。"));
  }

  const actions = el("div", { class: "panel-actions wrap" });
  const confirmButton = el("button", {
    class: "btn primary",
    text: editing ? "套用變更" : "確認建設",
    onClick: () => handlers.onConfirm(),
  });
  if (editing && editContext) {
    const blocked = editContext.error !== null || !canConfirm || state.player.money < editContext.addedCost;
    if (blocked) {
      confirmButton.disabled = true;
      confirmButton.title =
        editContext.error !== null
          ? DRAFT_ERROR_MESSAGES[editContext.error]
          : !canConfirm
            ? "至少需要兩個停靠站"
            : "資金不足";
    }
  } else if (!canConfirm || !preview.affordable) {
    confirmButton.disabled = true;
    confirmButton.title = !canConfirm ? "至少需要兩個停靠站" : "資金不足";
  }
  actions.appendChild(confirmButton);
  actions.appendChild(
    el("button", {
      class: "btn ghost",
      text: "復原一站",
      onClick: () => handlers.onUndoLast(),
    }),
  );
  actions.appendChild(
    el("button", {
      class: "btn ghost",
      text: "清空",
      onClick: () => handlers.onClear(),
    }),
  );
  actions.appendChild(
    el("button", {
      class: "btn ghost",
      text: "取消",
      onClick: () => handlers.onCancel(),
    }),
  );
  container.appendChild(actions);
}

/** 單一路段列：起訖城市、距離、地形標籤與成本。 */
function renderSegmentRow(state: GameState, segment: SegmentPreview, index: number): HTMLElement {
  const fromStation = stationById(state.world, segment.fromStationId);
  const toStation = stationById(state.world, segment.toStationId);
  const fromCity = fromStation ? state.world.cities.find((c) => c.id === fromStation.cityId) : null;
  const toCity = toStation ? state.world.cities.find((c) => c.id === toStation.cityId) : null;
  const row = el(
    "div",
    { class: "segment-row" },
    el("span", { class: "segment-index", text: String(index + 1) }),
    el("span", {
      class: "segment-path",
      text: `${fromCity ? cityDisplayName(fromCity) : "？"} → ${toCity ? cityDisplayName(toCity) : "？"}`,
    }),
    segmentBadge(segment),
    el("span", { class: "segment-cost", text: formatMoneyCompact(segment.cost) }),
  );
  row.title = `${formatDistance(segment.distance)}・地形倍率 ×${segment.terrainMultiplier.toFixed(2)}`;
  return row;
}

/** 依地形剖面給出施工難度標籤。 */
function segmentBadge(segment: SegmentPreview): HTMLElement {
  if (segment.crossesWater) {
    return chip("跨水域", "#f07178", true);
  }
  if (segment.crossesMountain) {
    return chip("穿越山地", "#f0b85a", true);
  }
  if (segment.elevationRange >= SEGMENT_TERRAIN_CONFIG.elevationRangeNotice) {
    return chip("起伏地形", "#f0b85a", true);
  }
  if (segment.baseTerrainMultiplier >= 1.3) {
    return chip("丘陵", "#8fa3b8", true);
  }
  return chip("平坦", "#39c69e", true);
}

function iconButton(
  name: "up" | "down" | "close",
  title: string,
  disabled: boolean,
  onClick: () => void,
): HTMLElement {
  const button = el("button", { class: "icon-btn small", title, onClick });
  button.appendChild(icon(name, 14));
  button.disabled = disabled;
  return button;
}
