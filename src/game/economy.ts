/**
 * 經濟系統：資金進出與財務紀錄。
 * 所有資金變動都必須經過 applyTransaction，以便留下可查閱的紀錄。
 */

import type { GameState, LedgerCategory, TransactionResult } from "../core/types.ts";
import { ECONOMY_CONFIG } from "./config.ts";

export function canAfford(state: GameState, amount: number): boolean {
  return state.player.money >= amount;
}

/** 資金不足時回傳尚缺金額（正數）；足夠時回傳 0。 */
export function shortfallFor(state: GameState, amount: number): number {
  return Math.max(0, amount - state.player.money);
}

export interface TransactionRequest {
  category: LedgerCategory;
  description: string;
  /** 收入為正、支出為負。 */
  amount: number;
  /** 允許餘額轉為負值（用於每日營運支出結算，公司可暫時虧損）。 */
  allowNegative?: boolean;
}

export function applyTransaction(state: GameState, tx: TransactionRequest): TransactionResult {
  if (!Number.isFinite(tx.amount)) {
    throw new Error("交易金額必須是有限數值");
  }
  if (tx.amount < 0 && tx.allowNegative !== true && !canAfford(state, -tx.amount)) {
    return {
      ok: false,
      balanceAfter: state.player.money,
      shortfall: shortfallFor(state, -tx.amount),
    };
  }

  state.player.money += tx.amount;
  recordLedgerEntry(state, tx);
  return { ok: true, balanceAfter: state.player.money };
}

/**
 * 只寫入財務紀錄、不變動餘額。
 * 用於「資金已在過程中即時入帳」的收入（例如逐小時累計的票務收入）。
 */
export function recordLedgerEntry(
  state: GameState,
  entry: { category: LedgerCategory; description: string; amount: number },
): void {
  state.counters.ledger += 1;
  state.ledger.push({
    id: `led-${state.counters.ledger}`,
    seq: state.counters.ledger,
    category: entry.category,
    description: entry.description,
    amount: entry.amount,
    createdAt: Date.now(),
  });
  if (state.ledger.length > ECONOMY_CONFIG.ledgerMaxEntries) {
    state.ledger.splice(0, state.ledger.length - ECONOMY_CONFIG.ledgerMaxEntries);
  }
}
