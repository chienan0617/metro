/** 任務面板：目前任務目標、進度與獎勵。 */

import { formatMoney } from "../../core/format.ts";
import type { GameState } from "../../core/types.ts";
import { missionProgress } from "../../game/missions.ts";
import { el } from "../dom.ts";
import { chip, infoNote, panelHeader, sectionTitle, statRow } from "./kit.ts";

export interface MissionsPanelHandlers {
  onClose(): void;
}

export function renderMissionsPanel(
  container: HTMLElement,
  state: GameState,
  handlers: MissionsPanelHandlers,
): void {
  container.appendChild(panelHeader("任務", handlers.onClose));

  const stats = el("div", { class: "stat-grid" });
  stats.appendChild(statRow("已完成任務", `${state.mission.completedCount} 個`));
  stats.appendChild(statRow("累計星等", `${state.mission.stars} ★`));
  stats.appendChild(statRow("公司等級", `Lv.${state.player.level}`));
  container.appendChild(stats);

  const mission = state.mission.active;
  if (!mission) {
    container.appendChild(
      el("div", { class: "empty-card" }, el("div", { class: "empty-text", text: "目前沒有進行中的任務。" })),
    );
    return;
  }

  container.appendChild(sectionTitle("目前任務"));
  const card = el("div", { class: "mission-card" });
  card.appendChild(el("div", { class: "mission-title", text: mission.title }));
  card.appendChild(el("div", { class: "mission-desc", text: mission.description }));
  container.appendChild(card);

  const progress = missionProgress(state);
  const list = el("div", { class: "objective-list" });
  progress.forEach((entry, index) => {
    const ratio =
      entry.target > 0 ? Math.min(1, entry.current / entry.target) : entry.done ? 1 : 0;
    const row = el(
      "div",
      { class: `objective-row${entry.done ? " done" : ""}` },
      el(
        "div",
        { class: "objective-head" },
        el("span", { class: "objective-label", text: `${index === 0 ? "主要" : "附加"}：${entry.label}` }),
        entry.done ? chip("完成", "#43c59e", true) : chip(`${Math.round(ratio * 100)}%`, undefined, true),
      ),
    );
    const bar = el("div", { class: "progress-bar" }, el("span", { class: "progress-fill" }));
    (bar.querySelector(".progress-fill") as HTMLElement).style.width = `${Math.round(ratio * 100)}%`;
    row.appendChild(bar);
    if (!entry.done) {
      row.appendChild(
        el("div", {
          class: "objective-progress",
          text: `${formatValue(entry.current)} / ${formatValue(entry.target)}`,
        }),
      );
    }
    list.appendChild(row);
  });
  container.appendChild(list);

  container.appendChild(
    el(
      "div",
      { class: "mission-reward" },
      el("span", { text: "獎勵：" }),
      el("span", { class: "plus", text: formatMoney(mission.rewardMoney) }),
      el("span", { text: `　XP ${mission.rewardXp}` }),
    ),
  );

  container.appendChild(
    infoNote("任務在每日結算時檢查。完成主要目標獲得 1 星，達成附加目標可提高星等；完成後會自動產生新任務。"),
  );
}

function formatValue(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}
