/** 車庫面板：列車購買、車隊管理與路線指派。 */

import { formatMoney, formatMoneyCompact } from "../../core/format.ts";
import type { GameState, ID, Train, TrainStatus } from "../../core/types.ts";
import { TRAIN_UPGRADE_CONFIG } from "../../game/config.ts";
import {
  effectiveTrainCapacity,
  effectiveTrainSpeedKmh,
  isModelUnlocked,
  PURCHASE_ERROR_MESSAGES,
  trainUpgradeCost,
} from "../../game/trains.ts";
import { TRAIN_MODELS } from "../../game/trainModels.ts";
import { el } from "../dom.ts";
import { chip, infoNote, panelHeader, sectionTitle, statRow } from "./kit.ts";

export interface GarageHandlers {
  onBuy(modelId: string): void;
  onAssign(trainId: ID, routeId: ID | null): void;
  onSell(trainId: ID): void;
  onUpgrade(trainId: ID): void;
  onSelectRoute(routeId: ID): void;
  onClose(): void;
}

const STATUS_LABELS: Record<TrainStatus, string> = {
  idle: "待命",
  running: "行駛中",
  stopped: "停靠中",
  maintenance: "維修中",
};

const STATUS_COLORS: Record<TrainStatus, string> = {
  idle: "#9fb0c3",
  running: "#43c59e",
  stopped: "#f2b23c",
  maintenance: "#e85d5d",
};

export function renderGaragePanel(
  container: HTMLElement,
  state: GameState,
  handlers: GarageHandlers,
): void {
  container.appendChild(
    panelHeader("車庫", handlers.onClose, chip(`列車 ${state.trains.length} 輛`, undefined, true)),
  );

  const running = state.trains.filter((t) => t.status === "running").length;
  const idle = state.trains.filter((t) => t.routeId === null).length;
  let dailyMaintenance = 0;
  for (const train of state.trains) {
    const model = TRAIN_MODELS.find((m) => m.id === train.modelId);
    dailyMaintenance += model?.maintenanceRate ?? 0;
  }
  const stats = el("div", { class: "stat-grid" });
  stats.appendChild(statRow("行駛中", `${running} 輛`));
  stats.appendChild(statRow("待命中", `${idle} 輛`));
  stats.appendChild(statRow("每日維護（全部列車）", formatMoney(dailyMaintenance)));
  container.appendChild(stats);
  container.appendChild(
    infoNote("能源費用依實際行駛里程計費，維護費每日結算一次；待命列車也會產生維護費。"),
  );

  container.appendChild(sectionTitle("列車型號"));
  const modelList = el("div", { class: "model-list" });
  for (const model of TRAIN_MODELS) {
    const unlocked = isModelUnlocked(state, model);
    const ownedCount = state.trains.filter((t) => t.modelId === model.id).length;
    const card = el("div", { class: `model-card${unlocked ? "" : " locked"}` });

    const head = el(
      "div",
      { class: "model-head" },
      el(
        "div",
        { class: "model-name-box" },
        el("span", { class: "model-name", text: model.name }),
        el("span", { class: "model-maker", text: model.manufacturer }),
      ),
      ownedCount > 0 ? chip(`已有 ${ownedCount}`, "#43c59e", true) : null,
    );
    card.appendChild(head);

    const spec = el("div", { class: "model-specs" });
    spec.appendChild(el("span", { text: `容量 ${model.capacity} 人` }));
    spec.appendChild(el("span", { text: `最高 ${model.maxSpeed} km/h` }));
    spec.appendChild(el("span", { text: `能源 ×${model.energyRate.toFixed(2)}` }));
    spec.appendChild(el("span", { text: `維護 ${formatMoneyCompact(model.maintenanceRate)}/日` }));
    spec.appendChild(el("span", { text: `舒適 ${model.comfort}/10` }));
    card.appendChild(spec);

    const footer = el("div", { class: "model-footer" });
    footer.appendChild(
      el("span", { class: "model-price", text: formatMoney(model.purchasePrice) }),
    );
    if (unlocked) {
      const buyButton = el("button", {
        class: "btn primary sm",
        text: "購買",
        onClick: () => handlers.onBuy(model.id),
      });
      if (state.player.money < model.purchasePrice) {
        buyButton.disabled = true;
        buyButton.title = PURCHASE_ERROR_MESSAGES.insufficient_funds;
      }
      footer.appendChild(buyButton);
    } else {
      footer.appendChild(
        chip(`需公司等級 ${model.unlockLevel}`, "#f2b23c", true),
      );
    }
    card.appendChild(footer);
    modelList.appendChild(card);
  }
  container.appendChild(modelList);

  container.appendChild(sectionTitle(`我的列車（${state.trains.length}）`));
  if (state.trains.length === 0) {
    container.appendChild(
      el("div", { class: "empty-card" }, el("div", { class: "empty-text", text: "還沒有任何列車。購買後可指派到路線開始營運。" })),
    );
    return;
  }

  const trainList = el("div", { class: "train-list" });
  for (const train of state.trains) {
    trainList.appendChild(renderTrainRow(state, train, handlers));
  }
  container.appendChild(trainList);
}

function renderTrainRow(state: GameState, train: Train, handlers: GarageHandlers): HTMLElement {
  const model = TRAIN_MODELS.find((m) => m.id === train.modelId);
  const assignedRoute = train.routeId ? state.routes.find((r) => r.id === train.routeId) : null;
  const row = el("div", { class: "train-row" });

  const head = el(
    "div",
    { class: "train-head" },
    el("span", { class: "train-id", text: train.id.replace("train-", "T-"), title: train.id }),
    el("span", {
      class: "train-model",
      text: model?.name ?? train.modelId,
    }),
    chip(`Lv.${train.level}`, "#4f8ef7", true),
    chip(STATUS_LABELS[train.status], STATUS_COLORS[train.status], true),
  );
  row.appendChild(head);

  const upgradeCost = trainUpgradeCost(train);
  const spec = el(
    "div",
    { class: "train-spec" },
    el("span", {
      text: `容量 ${effectiveTrainCapacity(state, train)} 人 · ${Math.round(effectiveTrainSpeedKmh(state, train))} km/h`,
    }),
    upgradeCost !== null
      ? el("span", {
          class: "train-upgrade-info",
          text: `升級 Lv.${train.level + 1}：${formatMoney(upgradeCost)}（容量 +${Math.round(TRAIN_UPGRADE_CONFIG.capacityPerLevel * 100)}%）`,
        })
      : el("span", { class: "train-upgrade-info", text: "已達最高等級" }),
  );
  row.appendChild(spec);

  const controls = el("div", { class: "train-controls" });

  const select = el("select", { class: "text-input select-input", title: "指派路線" });
  const noneOption = el("option", { text: "未指派" });
  noneOption.value = "";
  select.appendChild(noneOption);
  for (const route of state.routes) {
    const option = el("option", { text: route.name });
    option.value = route.id;
    select.appendChild(option);
  }
  select.value = train.routeId ?? "";
  select.addEventListener("change", () => {
    handlers.onAssign(train.id, select.value === "" ? null : select.value);
  });
  controls.appendChild(select);

  if (assignedRoute) {
    const goto = el("button", {
      class: "icon-btn small",
      title: "查看路線",
      onClick: () => handlers.onSelectRoute(assignedRoute.id),
    });
    goto.textContent = "→";
    controls.appendChild(goto);
  }

  const upgradeButton = el("button", {
    class: "btn primary sm",
    text: "升級",
    onClick: () => handlers.onUpgrade(train.id),
  });
  if (upgradeCost === null) {
    upgradeButton.disabled = true;
  } else if (state.player.money < upgradeCost) {
    upgradeButton.disabled = true;
    upgradeButton.title = "資金不足";
  }
  controls.appendChild(upgradeButton);

  const sellButton = el("button", {
    class: "btn ghost sm",
    text: "賣出",
    onClick: () => handlers.onSell(train.id),
  });
  controls.appendChild(sellButton);
  row.appendChild(controls);
  return row;
}
