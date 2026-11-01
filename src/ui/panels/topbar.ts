/** 頂部資訊列：資金、遊戲時間、模擬速度、路線與城市統計、全域操作按鈕。 */

import { formatMoney, formatMoneyCompact } from "../../core/format.ts";
import type { GameSpeed, GameState } from "../../core/types.ts";
import { TIME_CONFIG } from "../../game/config.ts";
import { formatGameDate } from "../../game/time.ts";
import { logoSvg, STUDIO_NAME } from "../brand.ts";
import { el, icon } from "../dom.ts";

export interface TopbarHandlers {
  onFit(): void;
  onHelp(): void;
  onMenu(): void;
  onSetSpeed(speed: GameSpeed): void;
}

export interface Topbar {
  root: HTMLElement;
  /** 每次狀態變更或畫面幀更新時呼叫；內部會略過未變動的欄位。 */
  update(state: GameState): void;
}

const SPEED_LABELS: Record<number, string> = { 0: "暫停", 1: "1×", 2: "2×", 4: "4×", 8: "8×" };

export function createTopbar(handlers: TopbarHandlers): Topbar {
  const brandLogo = el("span", { class: "topbar-logo", html: logoSvg(18) });
  brandLogo.title = STUDIO_NAME;

  const moneyValue = el("span", { class: "money-value", text: "$0" });
  const moneyPill = el("div", { class: "money-pill" }, icon("money", 16), moneyValue);

  const clockValue = el("span", { class: "clock-value", text: "1年1月1日 06:00" });
  const clockPill = el("div", { class: "mini-pill clock-pill" }, clockValue);

  const levelValue = el("span", { class: "level-value", text: "Lv.1" });
  const levelPill = el("div", { class: "mini-pill level-pill" }, levelValue);

  const routeCount = el("span", { class: "stat-value", text: "0" });
  const cityCount = el("span", { class: "stat-value", text: "0" });
  const trainCount = el("span", { class: "stat-value", text: "0" });
  const routesPill = el(
    "div",
    { class: "mini-pill" },
    icon("route", 14),
    routeCount,
    el("span", { class: "mini-label", text: "路線" }),
  );
  const citiesPill = el(
    "div",
    { class: "mini-pill" },
    icon("city", 14),
    cityCount,
    el("span", { class: "mini-label", text: "城市" }),
  );
  const trainsPill = el(
    "div",
    { class: "mini-pill" },
    icon("train", 14),
    trainCount,
    el("span", { class: "mini-label", text: "列車" }),
  );

  // 速度控制。
  const speedButtons = new Map<number, HTMLButtonElement>();
  const speedGroup = el("div", { class: "speed-group", attrs: { role: "group", "aria-label": "模擬速度" } });
  for (const speed of TIME_CONFIG.speedOptions) {
    const isPause = speed === 0;
    const button = el("button", {
      class: "speed-btn",
      title: isPause ? "暫停（空白鍵）" : `速度 ${speed} 倍（按鍵 ${speed}）`,
      onClick: () => handlers.onSetSpeed(speed as GameSpeed),
    });
    button.appendChild(isPause ? icon("pause", 13) : el("span", { text: SPEED_LABELS[speed] ?? `${speed}×` }));
    speedGroup.appendChild(button);
    speedButtons.set(speed, button);
  }

  const fitButton = el(
    "button",
    { class: "btn ghost topbar-btn", title: "顯示整張地圖", onClick: handlers.onFit },
    icon("fit", 16),
    el("span", { text: "全圖" }),
  );
  const helpButton = el(
    "button",
    { class: "btn ghost topbar-btn", title: "操作說明", onClick: handlers.onHelp },
    icon("help", 16),
    el("span", { text: "說明" }),
  );
  const menuButton = el(
    "button",
    { class: "btn ghost topbar-btn", title: "返回主選單", onClick: handlers.onMenu },
    icon("menu", 16),
    el("span", { text: "選單" }),
  );

  const root = el(
    "header",
    { class: "topbar" },
    el(
      "div",
      { class: "topbar-left" },
      brandLogo,
      moneyPill,
      clockPill,
      speedGroup,
      levelPill,
      routesPill,
      citiesPill,
      trainsPill,
    ),
    el("div", { class: "topbar-right" }, fitButton, helpButton, menuButton),
  );

  let lastMoney = Number.NaN;
  let lastClockText = "";
  let lastRouteCount = -1;
  let lastCityCount = -1;
  let lastTrainText = "";
  let lastSpeed = -1;
  let lastLevel = -1;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  const update = (state: GameState): void => {
    const money = state.player.money;
    if (money !== lastMoney) {
      moneyValue.textContent = formatMoneyCompact(money);
      moneyPill.title = `資金：${formatMoney(money)}`;
      moneyPill.classList.toggle("negative", money < 0);

      if (Number.isFinite(lastMoney)) {
        moneyPill.classList.remove("flash-up", "flash-down");
        void moneyPill.offsetWidth;
        moneyPill.classList.add(money > lastMoney ? "flash-up" : "flash-down");
        if (flashTimer) {
          clearTimeout(flashTimer);
        }
        flashTimer = setTimeout(() => {
          moneyPill.classList.remove("flash-up", "flash-down");
        }, 800);
      }
      lastMoney = money;
    }

    const clockText = formatGameDate(state.clock.minutes, true);
    if (clockText !== lastClockText) {
      clockValue.textContent = clockText;
      clockPill.title = formatGameDate(state.clock.minutes);
      lastClockText = clockText;
    }

    if (state.clock.speed !== lastSpeed) {
      for (const [speed, button] of speedButtons) {
        button.classList.toggle("active", speed === state.clock.speed);
      }
      lastSpeed = state.clock.speed;
    }

    if (state.player.level !== lastLevel) {
      levelValue.textContent = `Lv.${state.player.level}`;
      levelPill.title = `公司等級 ${state.player.level}（XP ${Math.floor(state.player.xp).toLocaleString("en-US")}）`;
      lastLevel = state.player.level;
    }

    if (state.routes.length !== lastRouteCount) {
      routeCount.textContent = String(state.routes.length);
      lastRouteCount = state.routes.length;
    }

    let trainText = `${state.trains.length}`;
    if (state.trains.length > 0) {
      const running = state.trains.filter((t) => t.status === "running").length;
      trainText = `${state.trains.length}（行駛 ${running}）`;
    }
    if (trainText !== lastTrainText) {
      trainCount.textContent = trainText;
      lastTrainText = trainText;
    }

    const connected = new Set<string>();
    for (const route of state.routes) {
      for (const stationId of route.stationIds) {
        const station = state.world.stations.find((s) => s.id === stationId);
        if (station) {
          connected.add(station.cityId);
        }
      }
    }
    const cityText = connected.size;
    if (cityText !== lastCityCount) {
      cityCount.textContent = `${connected.size}/${state.world.cities.length}`;
      lastCityCount = cityText;
    }
  };

  return { root, update };
}
