/** 科技研究面板：三條研究線與各階效果。 */

import { formatMoney } from "../../core/format.ts";
import type { GameState, ResearchLine } from "../../core/types.ts";
import { RESEARCH_CONFIG } from "../../game/config.ts";
import { isResearchUnlocked, researchTiers } from "../../game/research.ts";
import { el } from "../dom.ts";
import { chip, infoNote, panelHeader, sectionTitle, warningBox } from "./kit.ts";

export interface ResearchPanelHandlers {
  onClose(): void;
  onStart(line: ResearchLine, tier: number): void;
}

export function renderResearchPanel(
  container: HTMLElement,
  state: GameState,
  handlers: ResearchPanelHandlers,
): void {
  container.appendChild(
    panelHeader(
      "科技研究",
      handlers.onClose,
      chip(`等級 ${state.player.level}`, undefined, true),
    ),
  );

  if (!isResearchUnlocked(state)) {
    container.appendChild(
      warningBox([
        el("span", {
          text: `研究需要公司等級 ${RESEARCH_CONFIG.minLevel}（目前 ${state.player.level}）。載運旅客與完成任務可提升等級。`,
        }),
      ]),
    );
  }

  const active = state.research.active;
  if (active) {
    const day = Math.floor(state.clock.minutes / 1440);
    const remaining = Math.max(0, active.endDay - day);
    const lineLabel =
      RESEARCH_CONFIG.lines.find((l) => l.line === active.line)?.label ?? active.line;
    container.appendChild(
      infoNote(`進行中：${lineLabel} 第 ${active.tier} 階（剩餘約 ${remaining} 天）`),
    );
  }

  for (const line of RESEARCH_CONFIG.lines) {
    container.appendChild(sectionTitle(line.label));
    const tiers = researchTiers().filter((t) => t.line === line.line);
    const list = el("div", { class: "research-list" });
    for (const tier of tiers) {
      const completed = state.research.completed[line.line] >= tier.tier;
      const isActive = active?.line === line.line && active.tier === tier.tier;
      const available = state.research.completed[line.line] === tier.tier - 1 && !active;
      const row = el("div", { class: `research-row${completed ? " done" : ""}` });

      row.appendChild(
        el(
          "div",
          { class: "research-head" },
          el("span", { class: "research-name", text: `${tier.tier}. ${tier.label}` }),
          completed
            ? chip("完成", "#43c59e", true)
            : isActive
              ? chip("研究中", "#f2b23c", true)
              : chip(`${formatMoney(tier.cost)} · ${tier.days} 天`, undefined, true),
        ),
      );
      row.appendChild(el("div", { class: "research-effect", text: tier.effect }));

      if (!completed && !isActive) {
        const button = el("button", {
          class: "btn primary sm",
          text: available ? "開始研究" : "尚未解鎖",
          onClick: () => {
            if (available) {
              handlers.onStart(line.line, tier.tier);
            }
          },
        });
        if (!available || !isResearchUnlocked(state) || state.player.money < tier.cost) {
          button.disabled = true;
          if (available && state.player.money < tier.cost) {
            button.title = "資金不足";
          }
        }
        row.appendChild(el("div", { class: "research-actions" }, button));
      }
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  container.appendChild(
    infoNote("研究需要時間（以遊戲天數計算）；同一時間只能進行一項研究。效果會立即反映在列車、車站與建設成本上。"),
  );
}
