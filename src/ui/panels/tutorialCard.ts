/** 新手引導卡片：依玩家實際進度逐項打勾；窄螢幕時可收合成小卡。 */

import type { GameState } from "../../core/types.ts";
import { el } from "../dom.ts";

interface TutorialStep {
  label: string;
  done(state: GameState): boolean;
}

const STEPS: readonly TutorialStep[] = [
  { label: "用「建立路線」連接至少兩座城市", done: (s) => s.routes.length > 0 },
  { label: "到「車庫」購買第一輛列車", done: (s) => s.trains.length > 0 },
  { label: "把列車配置到路線", done: (s) => s.trains.some((t) => t.routeId !== null) },
  { label: "按 ▶（或空白鍵）開始營運", done: (s) => s.clock.minutes > 0 },
  { label: "獲得第一筆票務收入", done: (s) => s.stats.totalRevenue > 0 },
];

export interface TutorialCard {
  root: HTMLElement;
  update(state: GameState): void;
}

export function createTutorialCard(onSkip: () => void): TutorialCard {
  let userExpanded = false;
  const count = el("span", { class: "tutorial-count" });
  const list = el("div", { class: "tutorial-steps" });
  const skipButton = el("button", {
    class: "link-btn",
    text: "跳過引導",
    onClick: (event) => {
      event.stopPropagation();
      onSkip();
    },
  });
  const head = el(
    "div",
    { class: "tutorial-head", title: "點擊展開／收合" },
    el("span", { class: "tutorial-title", text: "新手引導" }),
    count,
    skipButton,
  );
  head.addEventListener("click", () => {
    userExpanded = !userExpanded;
    root.classList.toggle("collapsed", !userExpanded);
  });
  const root = el("div", { class: "tutorial-card hidden" }, head, list);

  const update = (state: GameState): void => {
    const visible = state.mode === "career" && state.tutorialStep < 90;
    const doneCount = STEPS.filter((step) => step.done(state)).length;
    if (!visible || doneCount === STEPS.length) {
      root.classList.add("hidden");
      return;
    }
    root.classList.remove("hidden");
    count.textContent = `${doneCount}/${STEPS.length}`;
    // 窄螢幕預設收合成小卡（使用者點擊可展開）。
    const narrow = window.matchMedia("(max-width: 920px)").matches;
    root.classList.toggle("collapsed", narrow && !userExpanded);

    list.innerHTML = "";
    let currentMarked = false;
    for (const step of STEPS) {
      const done = step.done(state);
      const isCurrent = !done && !currentMarked;
      if (isCurrent) {
        currentMarked = true;
      }
      list.appendChild(
        el(
          "div",
          { class: `tutorial-step${done ? " done" : ""}${isCurrent ? " current" : ""}` },
          el("span", { class: "tutorial-check", text: done ? "✓" : isCurrent ? "→" : "·" }),
          el("span", { text: step.label }),
        ),
      );
    }
  };

  return { root, update };
}
