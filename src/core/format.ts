/** 數字與文字的顯示格式工具（僅供 UI 使用，不參與模擬計算）。 */

/** 完整金額，例如 $1,250,000。 */
export function formatMoney(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(Math.round(amount));
  return `${sign}$${abs.toLocaleString("en-US")}`;
}

/** 精簡金額：以億／萬為單位，適合資訊列顯示。 */
export function formatMoneyCompact(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 100_000_000) {
    return `${sign}$${trimFixed(abs / 100_000_000, 2)} 億`;
  }
  if (abs >= 10_000) {
    return `${sign}$${trimFixed(abs / 10_000, 1)} 萬`;
  }
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

/** 人口：以萬為單位。 */
export function formatPopulation(pop: number): string {
  if (pop >= 10_000) {
    return `${trimFixed(pop / 10_000, 1)} 萬人`;
  }
  return `${Math.round(pop).toLocaleString("en-US")} 人`;
}

/** 距離（世界單位 = 公里）。 */
export function formatDistance(km: number): string {
  if (km >= 100) {
    return `${Math.round(km).toLocaleString("en-US")} km`;
  }
  return `${trimFixed(km, 1)} km`;
}

/** 時間長度（遊戲分鐘）。 */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) {
    return `${m} 分`;
  }
  return `${h} 小時 ${m} 分`;
}

export function formatPercent(value01: number, digits = 0): string {
  return `${(value01 * 100).toFixed(digits)}%`;
}

/** 移除多餘的小數尾零。 */
function trimFixed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
