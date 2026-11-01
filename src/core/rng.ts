/**
 * 可重現的偽隨機數產生器（mulberry32）。
 * 所有程序生成內容都必須透過此模組，禁止直接使用 Math.random() 產生遊戲進度。
 */

/** 將字串雜湊為 32 位元整數（FNV-1a 變體）。 */
export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: number | string) {
    const s = typeof seed === "string" ? hashString(seed) : seed >>> 0;
    this.state = s === 0 ? 0x9e3779b9 : s;
  }

  /** 下一個 [0, 1) 隨機數。 */
  next(): number {
    let t = (this.state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) 之間的浮點數。 */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** [min, max] 之間的整數（含頭尾）。 */
  int(min: number, max: number): number {
    if (max < min) {
      throw new Error(`Rng.int 參數錯誤：min=${min} > max=${max}`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** 以機率 p 回傳 true。 */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** 從非空陣列中均勻選取一個元素。 */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Rng.pick 無法從空陣列選取");
    }
    const item = items[Math.floor(this.next() * items.length)];
    // 上面索引必然在範圍內，這裡僅為型別收斂。
    return item as T;
  }

  /** 回傳洗牌後的新陣列（不修改原陣列）。 */
  shuffle<T>(items: readonly T[]): T[] {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const a = arr[i] as T;
      const b = arr[j] as T;
      arr[i] = b;
      arr[j] = a;
    }
    return arr;
  }

  /** 依權重選取索引。weights 必須非空且總和大於 0。 */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) {
      total += Math.max(0, w);
    }
    if (total <= 0) {
      return 0;
    }
    let roll = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= Math.max(0, weights[i] as number);
      if (roll < 0) {
        return i;
      }
    }
    return weights.length - 1;
  }

  /** 由目前種子衍生出一條獨立、可重現的子隨機流。 */
  fork(label: string): Rng {
    return new Rng((hashString(label) ^ Math.floor(this.next() * 0xffffffff)) >>> 0);
  }
}
