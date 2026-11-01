/**
 * 科技研究：三條研究線（列車／車站／營運），各三階。
 * 研究需要費用與時間（遊戲天數），完成後效果會作用於對應系統。
 */

import type { GameState, ResearchLine } from "../core/types.ts";
import { RESEARCH_CONFIG } from "./config.ts";
import { applyTransaction } from "./economy.ts";
import { pushNotification } from "./progression.ts";

export interface ResearchTierInfo {
  line: ResearchLine;
  lineLabel: string;
  tier: number;
  label: string;
  cost: number;
  days: number;
  effect: string;
}

export function researchTiers(): ResearchTierInfo[] {
  const result: ResearchTierInfo[] = [];
  for (const line of RESEARCH_CONFIG.lines) {
    line.tiers.forEach((tier, index) => {
      result.push({
        line: line.line,
        lineLabel: line.label,
        tier: index + 1,
        label: tier.label,
        cost: tier.cost,
        days: tier.days,
        effect: tier.effect,
      });
    });
  }
  return result;
}

export function completedTier(state: GameState, line: ResearchLine): number {
  return state.research.completed[line];
}

export function isResearchUnlocked(state: GameState): boolean {
  return state.player.level >= RESEARCH_CONFIG.minLevel;
}

export type ResearchStartResult = { ok: true } | { ok: false; error: string };

export function startResearch(
  state: GameState,
  line: ResearchLine,
  tier: number,
): ResearchStartResult {
  if (!isResearchUnlocked(state)) {
    return { ok: false, error: `需要公司等級 ${RESEARCH_CONFIG.minLevel}` };
  }
  if (state.research.active) {
    return { ok: false, error: "已有進行中的研究" };
  }
  const lineDef = RESEARCH_CONFIG.lines.find((l) => l.line === line);
  const tierDef = lineDef?.tiers[tier - 1];
  if (!lineDef || !tierDef) {
    return { ok: false, error: "找不到這項研究" };
  }
  if (state.research.completed[line] !== tier - 1) {
    return { ok: false, error: "必須先完成前一階研究" };
  }
  const tx = applyTransaction(state, {
    category: "other",
    description: `科技研究：${tierDef.label}`,
    amount: -tierDef.cost,
  });
  if (!tx.ok) {
    return { ok: false, error: "資金不足" };
  }
  const day = Math.floor(state.clock.minutes / 1440);
  state.research.active = {
    line,
    tier,
    startDay: day,
    endDay: day + tierDef.days,
  };
  pushNotification(state, "info", `開始研究「${tierDef.label}」，預計 ${tierDef.days} 天完成`);
  return { ok: true };
}

/** 每日檢查研究是否完成；回傳是否有研究在本次完成。 */
export function updateResearch(state: GameState): boolean {
  const active = state.research.active;
  if (!active) {
    return false;
  }
  const day = Math.floor(state.clock.minutes / 1440);
  if (day < active.endDay) {
    return false;
  }
  state.research.completed[active.line] += 1;
  const lineDef = RESEARCH_CONFIG.lines.find((l) => l.line === active.line);
  const tierDef = lineDef?.tiers[active.tier - 1];
  pushNotification(
    state,
    "success",
    `研究完成：${tierDef?.label ?? `${active.line} 第 ${active.tier} 階`}`,
  );
  state.research.active = null;
  return true;
}

export interface ResearchMultipliers {
  trainCapacity: number;
  trainSpeed: number;
  trainEnergy: number;
  stationCapacity: number;
  stationCommercial: number;
  trackCost: number;
  maintenance: number;
  energyOp: number;
}

/** 依已完成的研究計算各種倍率（未研究時全部為 1）。 */
export function researchMultipliers(state: GameState): ResearchMultipliers {
  const trainTier = state.research.completed.train;
  const stationTier = state.research.completed.station;
  const opTier = state.research.completed.operation;
  return {
    trainCapacity: 1 + 0.06 * trainTier,
    trainSpeed: 1 + 0.03 * trainTier,
    trainEnergy: 1 - 0.05 * trainTier,
    stationCapacity: 1 + 0.15 * stationTier,
    stationCommercial: 1 + 0.3 * stationTier,
    trackCost: 1 - 0.08 * opTier,
    maintenance: 1 - 0.06 * opTier,
    energyOp: 1 - 0.04 * opTier,
  };
}
