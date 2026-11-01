/** 預設右側面板：營運概況、路線清單、圖例與提示。 */

import { formatDistance, formatMoney, formatMoneyCompact } from "../../core/format.ts";
import type { GameState, ID } from "../../core/types.ts";
import { CITY_TYPE_PARAMS } from "../../game/config.ts";
import { activeEventsLabels } from "../../game/events.ts";
import { xpForNextLevel } from "../../game/progression.ts";
import { currentDay } from "../../game/events.ts";
import { cityDisplayName, stationById } from "../../world/worldgen.ts";
import { CITY_COLORS, TERRAIN_CSS, TERRAIN_LABELS } from "../palette.ts";
import { el } from "../dom.ts";
import { chip, emptyCard, infoNote, sectionTitle, statRow } from "./kit.ts";

export interface OverviewHandlers {
  onStartBuild(): void;
  onSelectRoute(routeId: ID): void;
}

export function renderOverviewPanel(
  container: HTMLElement,
  state: GameState,
  handlers: OverviewHandlers,
): void {
  container.appendChild(el("h2", { class: "panel-title", text: "營運概況" }));

  const connected = new Set<ID>();
  let networkLength = 0;
  for (const route of state.routes) {
    networkLength += route.totalDistance;
    for (const stationId of route.stationIds) {
      const station = stationById(state.world, stationId);
      if (station) {
        connected.add(station.cityId);
      }
    }
  }

  const stats = el("div", { class: "stat-grid" });
  stats.appendChild(statRow("資金", formatMoneyCompact(state.player.money), { strong: true }));
  const nextLevelXp = xpForNextLevel(state.player.level);
  stats.appendChild(
    statRow(
      "公司等級",
      nextLevelXp === null
        ? `Lv.${state.player.level}（最高）`
        : `Lv.${state.player.level} · XP ${Math.floor(state.player.xp).toLocaleString("en-US")} / ${nextLevelXp.toLocaleString("en-US")}`,
    ),
  );
  stats.appendChild(statRow("路線", `${state.routes.length} 條`));
  stats.appendChild(statRow("已連接城市", `${connected.size} / ${state.world.cities.length}`));
  stats.appendChild(statRow("路網總長", formatDistance(networkLength)));
  if (state.trains.length > 0) {
    const running = state.trains.filter((t) => t.status === "running").length;
    const assigned = state.trains.filter((t) => t.routeId !== null).length;
    stats.appendChild(
      statRow("列車", `${state.trains.length} 輛（行駛 ${running}・配置 ${assigned}）`),
    );
  }
  if (state.stats.totalGenerated > 0) {
    const serveRate = state.stats.totalServed / state.stats.totalGenerated;
    stats.appendChild(statRow("需求服務率", `${(serveRate * 100).toFixed(1)}%`));
  }
  container.appendChild(stats);

  // 進行中的事件。
  const eventLabels = activeEventsLabels(state);
  if (eventLabels.length > 0) {
    container.appendChild(sectionTitle("進行中的事件"));
    const day = currentDay(state);
    const eventList = el("div", { class: "event-list" });
    for (const event of state.events) {
      const city = event.cityId ? state.world.cities.find((c) => c.id === event.cityId) : null;
      const remaining = Math.max(0, event.endDay - day);
      eventList.appendChild(
        el(
          "div",
          { class: "event-row" },
          el("span", { class: "event-label", text: city ? `${event.label}（${city.name}）` : event.label }),
          chip(`剩 ${remaining} 天`, "#f2b23c", true),
        ),
      );
    }
    container.appendChild(eventList);
  }

  container.appendChild(sectionTitle("路線清單"));
  if (state.routes.length === 0) {
    container.appendChild(
      emptyCard("還沒有任何路線。玩家規劃的第一條路線會出現在這裡。", {
        label: "建立第一條路線",
        onClick: handlers.onStartBuild,
      }),
    );
  } else {
    const list = el("div", { class: "route-list" });
    for (const route of state.routes) {
      const firstStop = route.stationIds[0] ? stationById(state.world, route.stationIds[0]) : null;
      const lastStop = route.stationIds.length
        ? stationById(state.world, route.stationIds[route.stationIds.length - 1] as ID)
        : null;
      let endpoints = "";
      if (firstStop && lastStop) {
        const firstCity = state.world.cities.find((c) => c.id === firstStop.cityId);
        const lastCity = state.world.cities.find((c) => c.id === lastStop.cityId);
        if (firstCity && lastCity) {
          endpoints = `${cityDisplayName(firstCity)} ↔ ${cityDisplayName(lastCity)}`;
        }
      }
      const item = el(
        "button",
        {
          class: "route-list-item",
          onClick: () => handlers.onSelectRoute(route.id),
        },
        el("span", { class: "route-dot" }),
        el(
          "span",
          { class: "route-item-body" },
          el("span", { class: "route-item-name", text: route.name }),
          el("span", { class: "route-item-meta", text: `${route.stationIds.length} 站 · ${endpoints}` }),
        ),
        el("span", { class: "route-item-length", text: formatDistance(route.totalDistance) }),
      );
      (item.querySelector(".route-dot") as HTMLElement).style.background = route.color;
      list.appendChild(item);
    }
    container.appendChild(list);
  }

  container.appendChild(sectionTitle("圖例"));
  const legendGrid = el("div", { class: "legend-grid" });
  for (const [type, params] of Object.entries(CITY_TYPE_PARAMS)) {
    const color = CITY_COLORS[type as keyof typeof CITY_COLORS];
    legendGrid.appendChild(
      el(
        "span",
        { class: "legend-item" },
        el("span", { class: "legend-dot" }),
        el("span", { text: params.label }),
      ),
    );
    const dot = legendGrid.lastElementChild?.querySelector(".legend-dot") as HTMLElement;
    dot.style.background = color;
  }
  const terrainGrid = el("div", { class: "legend-grid" });
  for (const [terrain, label] of Object.entries(TERRAIN_LABELS)) {
    terrainGrid.appendChild(
      el(
        "span",
        { class: "legend-item" },
        el("span", { class: "legend-dot square" }),
        el("span", { text: label }),
      ),
    );
    const dot = terrainGrid.lastElementChild?.querySelector(".legend-dot") as HTMLElement;
    dot.style.background = TERRAIN_CSS[terrain as keyof typeof TERRAIN_CSS];
  }
  container.appendChild(legendGrid);
  container.appendChild(terrainGrid);

  container.appendChild(
    infoNote(
      "提示：點選城市查看資訊；按左側「建立路線」後依序點選要停靠的城市，即可規劃自訂路線。建設費用會依距離與地形計算。",
    ),
  );

  // 目前資金可用於多長的路線（粗略估算，使用平原倍率）。
  if (state.routes.length === 0) {
    container.appendChild(
      infoNote(`目前資金 ${formatMoney(state.player.money)}，足以建設數條中短程路線。`),
    );
  }
}
