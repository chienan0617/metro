/** 路線建設面板：停靠站順序、預覽數據、確認與取消。 */

import {
  formatDistance,
  formatDuration,
  formatMoney,
  formatMoneyCompact,
  formatPopulation,
} from "../../core/format.ts";
import type { GameState } from "../../core/types.ts";
import { ROUTE_CONFIG } from "../../game/config.ts";
import { nextRouteName, previewDraft, type RouteDraft } from "../../game/routes.ts";
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

export function renderRouteBuilderPanel(
  container: HTMLElement,
  state: GameState,
  draft: RouteDraft,
  handlers: RouteBuilderHandlers,
): void {
  const preview = previewDraft(state, draft);
  const canConfirm = draft.stops.length >= ROUTE_CONFIG.minStops;

  container.appendChild(
    panelHeader("建立路線", handlers.onCancel, chip("建設模式", undefined, true)),
  );

  container.appendChild(
    infoNote("依序點選地圖上的城市加入停靠站；可拖曳地圖、滾輪縮放。右鍵可復原上一站。"),
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
      const row = el(
        "div",
        { class: "stop-row" },
        el("span", { class: "stop-index", text: String(index + 1) }),
        el(
          "span",
          { class: "stop-name" },
          el("span", { text: cityDisplayName(city) }),
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

  const costBox = el("div", { class: "cost-box" });
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
        text: "成本已包含地形倍率：山區與跨水域路段明顯較貴。",
      }),
    );
  }
  container.appendChild(costBox);
  container.appendChild(
    infoNote(`將自動命名為「${nextRouteName(state)}」，建設完成後可修改名稱與顏色。`),
  );

  const actions = el("div", { class: "panel-actions wrap" });
  const confirmButton = el("button", {
    class: "btn primary",
    text: "確認建設",
    onClick: () => handlers.onConfirm(),
  });
  if (!canConfirm || !preview.affordable) {
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
