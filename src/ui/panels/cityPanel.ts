/** 城市資訊面板。 */

import { formatDistance, formatMoney, formatPopulation } from "../../core/format.ts";
import type { GameState, ID } from "../../core/types.ts";
import { CITY_TYPE_PARAMS, ROUTE_CONFIG } from "../../game/config.ts";
import { stationEffectiveCapacity, stationUpgradeCost } from "../../game/stations.ts";
import { cityDisplayName } from "../../world/worldgen.ts";
import { INDUSTRY_COLORS, INDUSTRY_LABELS, TERRAIN_LABELS } from "../palette.ts";
import { el } from "../dom.ts";
import { chip, infoNote, panelHeader, sectionTitle, statRow } from "./kit.ts";

export interface CityPanelHandlers {
  onStartBuildFrom(cityId: ID): void;
  onSelectRoute(routeId: ID): void;
  onUpgradeStation(stationId: ID): void;
  onClose(): void;
}

export function renderCityPanel(
  container: HTMLElement,
  state: GameState,
  cityId: ID,
  handlers: CityPanelHandlers,
): void {
  const city = state.world.cities.find((c) => c.id === cityId);
  if (!city) {
    container.appendChild(panelHeader("城市資訊", handlers.onClose));
    container.appendChild(infoNote("找不到這座城市的資料。"));
    return;
  }

  const typeParams = CITY_TYPE_PARAMS[city.cityType];
  container.appendChild(
    panelHeader(cityDisplayName(city), handlers.onClose, chip(typeParams.label, undefined, true)),
  );

  const stats = el("div", { class: "stat-grid" });
  stats.appendChild(statRow("人口", formatPopulation(city.population)));
  stats.appendChild(statRow("地形", TERRAIN_LABELS[city.terrain]));
  stats.appendChild(statRow("發展等級", "★".repeat(city.developmentLevel)));
  stats.appendChild(statRow("交通需求倍率", `×${city.demandMultiplier.toFixed(2)}`));
  stats.appendChild(statRow("年成長率", `+${(city.growthRate * 100).toFixed(1)}%`));

  const station = state.world.stations.find((s) => s.cityId === city.id);
  if (station) {
    stats.appendChild(
      statRow("車站容量", `${stationEffectiveCapacity(state, station).toLocaleString("en-US")} 人/時`),
    );
    stats.appendChild(statRow("車站等級", `Lv.${station.level}`));
  }
  container.appendChild(stats);

  if (station) {
    container.appendChild(sectionTitle("車站營運"));
    const stationStats = el("div", { class: "stat-grid" });
    stationStats.appendChild(
      statRow(
        "旅客滿意度",
        `${Math.round(station.satisfaction)} / 100`,
        { strong: station.satisfaction < 60 },
      ),
    );
    stationStats.appendChild(
      statRow(
        "今日進站／出站",
        `${Math.round(station.stats.boardingsToday).toLocaleString("en-US")} / ${Math.round(station.stats.alightingsToday).toLocaleString("en-US")} 人次`,
      ),
    );
    if (station.stats.transfersToday > 0) {
      stationStats.appendChild(
        statRow("今日轉乘", `${Math.round(station.stats.transfersToday).toLocaleString("en-US")} 人次`),
      );
    }
    stationStats.appendChild(
      statRow(
        "累計進站",
        `${Math.round(station.stats.boardingsTotal).toLocaleString("en-US")} 人次`,
      ),
    );
    container.appendChild(stationStats);

    const upgradeCost = stationUpgradeCost(station);
    if (upgradeCost !== null) {
      const button = el("button", {
        class: "btn primary",
        text: `升級車站 → Lv.${station.level + 1}（${formatMoney(upgradeCost)}）`,
        onClick: () => handlers.onUpgradeStation(station.id),
      });
      if (state.player.money < upgradeCost) {
        button.disabled = true;
        button.title = "資金不足";
      }
      container.appendChild(el("div", { class: "panel-actions" }, button));
      container.appendChild(
        infoNote("升級可提升車站容量、商業收入與旅客滿意度。"),
      );
    } else {
      container.appendChild(infoNote("此車站已達最高等級。"));
    }
  }

  container.appendChild(sectionTitle("產業結構"));
  const bar = el("div", { class: "industry-bar" });
  const industryEntries = Object.entries(city.industry) as Array<
    [keyof typeof city.industry, number]
  >;
  for (const [key, ratio] of industryEntries) {
    const segment = el("span", {
      class: "industry-segment",
      title: `${INDUSTRY_LABELS[key]} ${(ratio * 100).toFixed(0)}%`,
    });
    segment.style.width = `${ratio * 100}%`;
    segment.style.background = INDUSTRY_COLORS[key];
    bar.appendChild(segment);
  }
  container.appendChild(bar);
  const industryLegend = el("div", { class: "industry-legend" });
  for (const [key, ratio] of industryEntries) {
    const item = el(
      "span",
      { class: "legend-item" },
      el("span", { class: "legend-dot" }),
      el("span", { text: `${INDUSTRY_LABELS[key]} ${(ratio * 100).toFixed(0)}%` }),
    );
    const dot = item.querySelector(".legend-dot") as HTMLElement;
    dot.style.background = INDUSTRY_COLORS[key];
    industryLegend.appendChild(item);
  }
  container.appendChild(industryLegend);

  container.appendChild(sectionTitle("行經路線"));
  if (station && station.routeIds.length > 0) {
    const chips = el("div", { class: "chip-row" });
    for (const routeId of station.routeIds) {
      const route = state.routes.find((r) => r.id === routeId);
      if (!route) {
        continue;
      }
      const routeChip = el("button", {
        class: "chip chip-button",
        text: route.name,
        onClick: () => handlers.onSelectRoute(route.id),
      });
      routeChip.style.setProperty("--chip-color", route.color);
      routeChip.classList.add("chip-colored");
      chips.appendChild(routeChip);
    }
    container.appendChild(chips);
    if (station.routeIds.length >= 2) {
      container.appendChild(infoNote("此站為轉乘站：乘客可在此於多條路線之間轉乘。"));
    }
  } else {
    container.appendChild(infoNote("目前沒有路線經過這座城市。"));
  }

  const actions = el("div", { class: "panel-actions" });
  actions.appendChild(
    el("button", {
      class: "btn primary",
      text: "從此城市開始建線",
      onClick: () => handlers.onStartBuildFrom(city.id),
    }),
  );
  container.appendChild(actions);
  container.appendChild(
    infoNote(
      `提示：路段最短距離為 ${formatDistance(ROUTE_CONFIG.minSegmentDistance)}，建設成本依實際距離與地形倍率計算。`,
    ),
  );
}
