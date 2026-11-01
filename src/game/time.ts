/**
 * 遊戲時間系統。
 * 以「遊戲分鐘」為模擬的基本單位：每天 1440 分鐘、每月 28 天、每年 12 個月。
 * 遊戲從第 1 年 1 月 1 日（週一）早上 06:00 開始。
 */

export const MINUTES_PER_DAY = 1440;
export const DAYS_PER_MONTH = 28;
export const MONTHS_PER_YEAR = 12;
export const START_HOUR = 6;

export const WEEKDAY_LABELS = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"] as const;

export interface GameDate {
  /** 1 起算。 */
  year: number;
  /** 1 - 12。 */
  month: number;
  /** 1 - 28。 */
  day: number;
  hour: number;
  minute: number;
  /** 0 = 週一 … 6 = 週日。 */
  weekday: number;
  /** 自遊戲開始起算的天數（0 起算）。 */
  dayIndex: number;
}

export function gameDateFromMinutes(minutes: number): GameDate {
  const total = Math.max(0, Math.floor(minutes)) + START_HOUR * 60;
  const dayIndex = Math.floor(total / MINUTES_PER_DAY);
  const minuteOfDay = total % MINUTES_PER_DAY;
  const month = Math.floor(dayIndex / DAYS_PER_MONTH);
  return {
    year: Math.floor(month / MONTHS_PER_YEAR) + 1,
    month: (month % MONTHS_PER_YEAR) + 1,
    day: (dayIndex % DAYS_PER_MONTH) + 1,
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    weekday: dayIndex % 7,
    dayIndex,
  };
}

/** 例：「第 1 年 3 月 12 日 週三 14:32」／精簡：「1年3月12日 14:32」。 */
export function formatGameDate(minutes: number, compact = false): string {
  const date = gameDateFromMinutes(minutes);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const time = `${pad(date.hour)}:${pad(date.minute)}`;
  if (compact) {
    return `${date.year}年${date.month}月${date.day}日 ${time}`;
  }
  return `第 ${date.year} 年 ${date.month} 月 ${date.day} 日 ${WEEKDAY_LABELS[date.weekday]} ${time}`;
}

/** 當天已過的比例（0 - 1），未來時段需求模型使用。 */
export function dayFraction(minutes: number): number {
  const total = minutes + START_HOUR * 60;
  return (total % MINUTES_PER_DAY) / MINUTES_PER_DAY;
}

/** 距離下一個整日（dayIndex 增加 1）還有幾分鐘。 */
export function minutesUntilNextDay(minutes: number): number {
  const total = Math.max(0, Math.floor(minutes)) + START_HOUR * 60;
  return MINUTES_PER_DAY - (total % MINUTES_PER_DAY);
}
