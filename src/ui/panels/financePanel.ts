/** 財務面板：每日收支摘要與最近交易紀錄。 */

import { formatMoney, formatMoneyCompact, formatPercent } from "../../core/format.ts";
import type { GameState } from "../../core/types.ts";
import { gameDateFromMinutes } from "../../game/time.ts";
import { el } from "../dom.ts";
import { infoNote, panelHeader, sectionTitle, statRow } from "./kit.ts";

export interface FinancePanelHandlers {
  onClose(): void;
}

export function renderFinancePanel(
  container: HTMLElement,
  state: GameState,
  handlers: FinancePanelHandlers,
): void {
  container.appendChild(panelHeader("財務報表", handlers.onClose));

  const stats = el("div", { class: "stat-grid" });
  stats.appendChild(statRow("資金", formatMoney(state.player.money), { strong: true }));
  stats.appendChild(statRow("累計收入", formatMoney(state.stats.totalRevenue)));
  stats.appendChild(statRow("累計載客", `${Math.round(state.stats.totalPassengers).toLocaleString("en-US")} 人`));
  const serveRate =
    state.stats.totalGenerated > 0 ? state.stats.totalServed / state.stats.totalGenerated : 0;
  stats.appendChild(statRow("需求服務率", formatPercent(serveRate, 1)));
  stats.appendChild(
    statRow("未滿足旅次", `${Math.round(state.stats.totalUnserved).toLocaleString("en-US")} 次`),
  );
  container.appendChild(stats);

  container.appendChild(sectionTitle("每日收支（最近 14 天）"));
  const history = state.finance.history.slice(-14).reverse();
  if (history.length === 0) {
    container.appendChild(
      el("div", { class: "empty-card" }, el("div", { class: "empty-text", text: "還沒有完整的營運日。開始營運後，每天會產生收支摘要。" })),
    );
  } else {
    const maxValue = Math.max(
      1,
      ...history.map((h) => Math.max(h.revenue, h.cost)),
    );
    const list = el("div", { class: "finance-list" });
    for (const entry of history) {
      const date = gameDateFromMinutes(entry.day * 1440);
      const net = entry.revenue - entry.cost;
      const row = el(
        "div",
        { class: "finance-row" },
        el("span", { class: "finance-date", text: `${date.month}/${date.day}` }),
        el(
          "span",
          { class: "finance-bars" },
          el("span", { class: "bar revenue" }),
          el("span", { class: "bar cost" }),
        ),
        el(
          "span",
          { class: "finance-values" },
          el("span", { class: "plus", text: `+${formatMoneyCompact(entry.revenue)}` }),
          el("span", { class: "minus", text: `-${formatMoneyCompact(entry.cost)}` }),
          el("span", {
            class: `net ${net >= 0 ? "positive" : "negative"}`,
            text: `${net >= 0 ? "+" : ""}${formatMoneyCompact(net)}`,
          }),
        ),
      );
      const bars = row.querySelectorAll(".bar");
      (bars[0] as HTMLElement | undefined)?.style.setProperty(
        "width",
        `${Math.round((entry.revenue / maxValue) * 100)}%`,
      );
      (bars[1] as HTMLElement | undefined)?.style.setProperty(
        "width",
        `${Math.round((entry.cost / maxValue) * 100)}%`,
      );
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  container.appendChild(sectionTitle("最近交易"));
  const recent = state.ledger.slice(-8).reverse();
  if (recent.length === 0) {
    container.appendChild(infoNote("尚無交易紀錄。"));
  } else {
    const ledgerList = el("div", { class: "ledger-list" });
    for (const entry of recent) {
      ledgerList.appendChild(
        el(
          "div",
          { class: "ledger-row" },
          el("span", { class: "ledger-desc", text: entry.description, title: entry.description }),
          el("span", {
            class: `ledger-amount ${entry.amount >= 0 ? "positive" : "negative"}`,
            text: `${entry.amount >= 0 ? "+" : ""}${formatMoneyCompact(entry.amount)}`,
          }),
        ),
      );
    }
    container.appendChild(ledgerList);
  }

  container.appendChild(
    infoNote("票務收入逐小時入帳，每日結算時彙總；能源與維護、車站成本於每日結算。"),
  );
}
