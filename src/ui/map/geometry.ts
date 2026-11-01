/**
 * 路線畫面幾何工具（螢幕座標）。
 * 幾何僅影響顯示，不影響路線拓撲與營運邏輯。
 */

import type { Point } from "../../core/types.ts";

/** 每條路線在共用路段上的垂直偏移量（依建立順序錯開，避免互相覆蓋）。 */
export function routeOffsetFor(index: number): number {
  return ((index % 7) - 3) * 2.6;
}

/**
 * 依照每段落的方向計算各頂點的垂直偏移點。
 * 垂直方向以字典序（先比 x 再比 y）統一，避免反向路線偏移方向相反。
 */
export function offsetPolyline(points: readonly Point[], offset: number): Point[] {
  const n = points.length;
  if (n < 2 || offset === 0) {
    return points.slice();
  }
  const segOffsets: Point[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      segOffsets.push({ x: 0, y: 0 });
      continue;
    }
    let px = -dy / len;
    let py = dx / len;
    // 統一垂直方向：讓 (a,b) 的小端在前，避免 A→B 與 B→A 得到相反偏移。
    if (a.x > b.x || (a.x === b.x && a.y > b.y)) {
      px = -px;
      py = -py;
    }
    segOffsets.push({ x: px * offset, y: py * offset });
  }

  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    const base = points[i] as Point;
    const prev = i > 0 ? (segOffsets[i - 1] as Point) : null;
    const next = i < n - 1 ? (segOffsets[i] as Point) : null;
    let ox = 0;
    let oy = 0;
    if (prev && next) {
      ox = prev.x + next.x;
      oy = prev.y + next.y;
      const len = Math.hypot(ox, oy);
      if (len > 1e-6) {
        ox = (ox / len) * offset;
        oy = (oy / len) * offset;
      }
    } else {
      const single = (prev ?? next) as Point;
      ox = single.x;
      oy = single.y;
    }
    result.push({ x: base.x + ox, y: base.y + oy });
  }
  return result;
}

/**
 * 精確折線路徑：直線連接每個頂點，只在轉角以 arcTo 做小幅圓角，
 * 確保線條「精確穿過」每個城市（與列車行進路徑完全一致）。
 */
export function traceSmoothPath(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  cornerRadius = 5,
): void {
  const n = points.length;
  if (n === 0) {
    return;
  }
  const first = points[0] as Point;
  ctx.moveTo(first.x, first.y);
  if (n === 1) {
    return;
  }
  if (n === 2) {
    const second = points[1] as Point;
    ctx.lineTo(second.x, second.y);
    return;
  }
  for (let i = 1; i < n - 1; i++) {
    const prev = points[i - 1] as Point;
    const current = points[i] as Point;
    const next = points[i + 1] as Point;
    const radius = Math.min(
      cornerRadius,
      distPoint(prev, current) / 2,
      distPoint(current, next) / 2,
    );
    ctx.arcTo(current.x, current.y, next.x, next.y, Math.max(0.1, radius));
  }
  const last = points[n - 1] as Point;
  ctx.lineTo(last.x, last.y);
}

/** 取得折線前段（依總長比例），用於建設完成時的生成動畫。 */
export function partialPolyline(points: readonly Point[], fraction: number): Point[] {
  if (points.length < 2 || fraction >= 1) {
    return points.slice();
  }
  if (fraction <= 0) {
    return [points[0] as Point];
  }
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    total += distPoint(points[i] as Point, points[i + 1] as Point);
  }
  const target = total * fraction;
  const result: Point[] = [points[0] as Point];
  let walked = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    const seg = distPoint(a, b);
    if (walked + seg >= target) {
      const t = seg > 0 ? (target - walked) / seg : 0;
      result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      return result;
    }
    walked += seg;
    result.push(b);
  }
  return result;
}

/** 點到折線的最短距離平方（螢幕座標命中測試）。 */
export function distToPolylineSq(p: Point, points: readonly Point[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < points.length; i++) {
    const d = distToSegmentSq(p, points[i] as Point, points[i + 1] as Point);
    if (d < best) {
      best = d;
    }
  }
  return best;
}

function distToSegmentSq(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lenSq = abx * abx + aby * aby;
  let t = 0;
  if (lenSq > 0) {
    t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq));
  }
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return dx * dx + dy * dy;
}

function distPoint(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
