/** 路線詳情面板：營運控制、班距、車隊配置、營運數據與停靠站管理。 */

import {
  formatDistance,
  formatDuration,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  formatPopulation,
} from "../../core/format.ts";
import type { GameState, ID, TrainStatus } from "../../core/types.ts";
import { ECONOMY_CONFIG, ROUTE_CONFIG, TRAIN_CONFIG } from "../../game/config.ts";
import { routeFleetStats } from "../../game/trains.ts";
import { trainModelById } from "../../game/trainModels.ts";
import { cityDisplayName, stationById } from "../../world/worldgen.ts";
import { el } from "../dom.ts";
import { chip, colorDots, infoNote, panelHeader, sectionTitle, statRow } from "./kit.ts";

export interface RoutePanelHandlers {
  onRename(name: string): void;
  onSetColor(color: string): void;
  onDelete(): void;
  onClose(): void;
  onSelectCity(cityId: ID): void;
  onToggleOperation(): void;
  onSetInterval(minutes: number): void;
  onAssignTrain(trainId: ID): void;
  onUnassignTrain(trainId: ID): void;
  onOpenGarage(): void;
}

const STATUS_LABELS: Record<TrainStatus, string> = {
  idle: "待命",
  running: "行駛中",
  stopped: "停靠中",
  maintenance: "維修中",
};

export function renderRoutePanel(
  container: HTMLElement,
  state: GameState,
  routeId: ID,
  handlers: RoutePanelHandlers,
): void {
  const route = state.routes.find((r) => r.id === routeId);
  if (!route) {
    container.appendChild(panelHeader("路線資訊", handlers.onClose));
    container.appendChild(infoNote("找不到這條路線的資料。"));
    return;
  }

  const isSuspended = route.status === "suspended";
  const statusLabel =
    route.status === "active" ? "營運中" : isSuspended ? "暫停營運" : "規劃中";
  container.appendChild(
    panelHeader("路線資訊", handlers.onClose, chip(statusLabel, route.color, true)),
  );

  const nameRow = el("div", { class: "field-row" });
  nameRow.appendChild(el("label", { class: "field-label", text: "路線名稱" }));
  const input = el("input", { class: "text-input" });
  input.type = "text";
  input.value = route.name;
  input.maxLength = 24;
  const commit = (): void => {
    const value = input.value.trim();
    if (value.length > 0 && value !== route.name) {
      handlers.onRename(value);
    } else {
      input.value = route.name;
    }
  };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      commit();
      input.blur();
    }
  });
  nameRow.appendChild(input);
  container.appendChild(nameRow);

  container.appendChild(sectionTitle("路線顏色"));
  container.appendChild(
    colorDots(ROUTE_CONFIG.colorPalette, route.color, (color) => handlers.onSetColor(color)),
  );

  // ------------------------------ 營運控制 ------------------------------
  container.appendChild(sectionTitle("營運控制"));
  const controls = el("div", { class: "panel-actions" });
  controls.appendChild(
    el("button", {
      class: `btn ${isSuspended ? "primary" : "ghost"}`,
      text: isSuspended ? "恢復營運" : "暫停營運",
      onClick: () => handlers.onToggleOperation(),
    }),
  );
  container.appendChild(controls);
  if (isSuspended) {
    container.appendChild(
      infoNote("路線暫停中：列車不會行駛（不耗能源），但仍需支付列車維護費。"),
    );
  }

  const intervalLabel = el("div", { class: "field-label interval-label" });
  intervalLabel.textContent = `發車間隔：${route.departureInterval} 分鐘`;
  container.appendChild(intervalLabel);
  const intervalRow = el("div", { class: "chip-row" });
  for (const option of TRAIN_CONFIG.intervalOptions) {
    const optionChip = el("button", {
      class: `chip chip-button${option === route.departureInterval ? " selected" : ""}`,
      text: `${option} 分`,
      onClick: () => handlers.onSetInterval(option),
    });
    intervalRow.appendChild(optionChip);
  }
  container.appendChild(intervalRow);

  // ------------------------------ 營運數據 ------------------------------
  const fleet = routeFleetStats(state, route);
  container.appendChild(sectionTitle("營運數據"));
  const stats = el("div", { class: "stat-grid" });
  stats.appendChild(statRow("停靠站", `${route.stationIds.length} 站`));
  stats.appendChild(statRow("總距離", formatDistance(route.totalDistance)));
  stats.appendChild(statRow("建設成本", formatMoney(route.constructionCost)));
  const tripMinutes =
    (route.totalDistance / (fleet.trainCount > 0 ? fleet.avgSpeedKmh : ECONOMY_CONFIG.referenceSpeedKmh)) * 60 +
    route.stationIds.length * ECONOMY_CONFIG.dwellMinutes;
  stats.appendChild(statRow("單程時間（估算）", `約 ${formatDuration(tripMinutes)}`));
  stats.appendChild(
    statRow("已配置列車", `${fleet.trainCount} 輛（建議 ${fleet.suggestedTrains} 輛）`),
  );
  stats.appendChild(
    statRow(
      "實際班距",
      fleet.actualIntervalMinutes !== null
        ? `約 ${formatDuration(fleet.actualIntervalMinutes)}`
        : "尚未配置列車",
    ),
  );
  stats.appendChild(
    statRow(
      "預估運能",
      fleet.capacityPerHour !== null
        ? `${Math.round(fleet.capacityPerHour).toLocaleString("en-US")} 人/時（單向）`
        : "—",
    ),
  );
  if (fleet.trainCount > 0) {
    stats.appendChild(
      statRow(
        "每日維運成本（估算）",
        `${formatMoney(fleet.dailyEnergyCost + fleet.dailyMaintenanceCost)}`,
      ),
    );
  }
  let population = 0;
  const transferStations: string[] = [];
  for (const stationId of route.stationIds) {
    const station = stationById(state.world, stationId);
    if (!station) {
      continue;
    }
    const city = state.world.cities.find((c) => c.id === station.cityId);
    if (city) {
      population += city.population;
    }
    if (station.routeIds.length >= 2) {
      transferStations.push(station.name);
    }
  }
  stats.appendChild(statRow("服務人口（沿線）", formatPopulation(population)));
  stats.appendChild(
    statRow("轉乘站", transferStations.length > 0 ? transferStations.join("、") : "無"),
  );
  container.appendChild(stats);

  // 今日營運績效（由乘客模擬產生）。
  container.appendChild(sectionTitle("今日營運"));
  const today = el("div", { class: "stat-grid" });
  const statsData = route.stats;
  if (statsData.capacityToday > 0 || statsData.passengersToday > 0) {
    today.appendChild(
      statRow("今日乘客", `${Math.round(statsData.passengersToday).toLocaleString("en-US")} 人次`),
    );
    today.appendChild(statRow("今日收入", formatMoney(statsData.revenueToday)));
    const loadFactor =
      statsData.capacityToday > 0 ? statsData.passengersToday / statsData.capacityToday : 0;
    today.appendChild(statRow("載客率", formatPercent(loadFactor, 1)));
    if (statsData.passengersToday > 0) {
      today.appendChild(
        statRow(
          "平均候車",
          `約 ${(statsData.waitSumToday / statsData.passengersToday).toFixed(1)} 分`,
        ),
      );
      today.appendChild(
        statRow(
          "平均旅程",
          formatDuration(statsData.journeySumToday / statsData.passengersToday),
        ),
      );
      today.appendChild(
        statRow(
          "平均轉乘",
          `${(statsData.transfersSumToday / statsData.passengersToday).toFixed(2)} 次`,
        ),
      );
    }
  } else {
    today.appendChild(statRow("今日乘客", "0 人次（等待營運）"));
  }
  today.appendChild(
    statRow(
      "累計乘客／收入",
      `${Math.round(statsData.passengersTotal).toLocaleString("en-US")} 人 · ${formatMoneyCompact(statsData.revenueTotal)}`,
    ),
  );
  container.appendChild(today);

  if (fleet.trainCount === 0) {
    container.appendChild(
      infoNote("此路線還沒有列車，不會產生載運或收入。配置列車後才會開始營運。"),
    );
  } else if (fleet.actualIntervalMinutes !== null && fleet.actualIntervalMinutes > route.departureInterval * 1.5) {
    container.appendChild(
      infoNote(
        `目前車輛數不足以達成 ${route.departureInterval} 分鐘班距，建議增加列車或加長間隔。`,
      ),
    );
  }

  // ------------------------------ 列車配置 ------------------------------
  container.appendChild(sectionTitle(`列車配置（${fleet.trainCount}）`));
  const assignedTrains = route.assignedTrainIds
    .map((id) => state.trains.find((t) => t.id === id))
    .filter((t) => t !== undefined);
  if (assignedTrains.length > 0) {
    const list = el("div", { class: "train-list" });
    for (const train of assignedTrains) {
      const model = trainModelById(train.modelId);
      const row = el(
        "div",
        { class: "train-row compact" },
        el("span", { class: "train-id", text: train.id.replace("train-", "T-") }),
        el("span", { class: "train-model", text: model?.name ?? train.modelId }),
        chip(STATUS_LABELS[train.status], undefined, true),
        el("button", {
          class: "btn ghost sm",
          text: "解除",
          onClick: () => handlers.onUnassignTrain(train.id),
        }),
      );
      list.appendChild(row);
    }
    container.appendChild(list);
  } else {
    container.appendChild(
      el("div", { class: "empty-card" }, el("div", { class: "empty-text", text: "尚未配置列車。" })),
    );
  }

  const idleTrains = state.trains.filter((t) => t.routeId === null);
  if (idleTrains.length > 0) {
    container.appendChild(sectionTitle("待命列車（可配置）"));
    const idleList = el("div", { class: "train-list" });
    for (const train of idleTrains) {
      const model = trainModelById(train.modelId);
      const row = el(
        "div",
        { class: "train-row compact" },
        el("span", { class: "train-id", text: train.id.replace("train-", "T-") }),
        el("span", { class: "train-model", text: model?.name ?? train.modelId }),
        el("button", {
          class: "btn primary sm",
          text: "配置",
          onClick: () => handlers.onAssignTrain(train.id),
        }),
      );
      idleList.appendChild(row);
    }
    container.appendChild(idleList);
  } else {
    container.appendChild(
      el("div", { class: "panel-actions" }, el("button", {
        class: "btn ghost",
        text: "前往車庫購買列車",
        onClick: () => handlers.onOpenGarage(),
      })),
    );
  }

  container.appendChild(sectionTitle("停靠順序"));
  const stopList = el("div", { class: "stop-list readonly" });
  route.stationIds.forEach((stationId, index) => {
    const station = stationById(state.world, stationId);
    const city = station ? state.world.cities.find((c) => c.id === station.cityId) : null;
    if (!station || !city) {
      return;
    }
    const row = el(
      "button",
      { class: "stop-row clickable", onClick: () => handlers.onSelectCity(city.id) },
      el("span", { class: "stop-index", text: String(index + 1) }),
      el("span", { class: "stop-name" }, el("span", { text: cityDisplayName(city) })),
    );
    row.style.setProperty("--stop-color", route.color);
    stopList.appendChild(row);
  });
  container.appendChild(stopList);

  container.appendChild(
    infoNote("乘客需求、載客率與票務收入將於下一階段（Phase 3）開放。"),
  );

  const actions = el("div", { class: "panel-actions" });
  actions.appendChild(
    el("button", {
      class: "btn danger ghost",
      text: "刪除路線",
      onClick: () => handlers.onDelete(),
    }),
  );
  container.appendChild(actions);
}
