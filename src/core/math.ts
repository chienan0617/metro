/** 純數學工具，與遊戲狀態無關。 */

import type { Point } from "./types.ts";

export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  if (a === b) {
    return 0;
  }
  return (v - a) / (b - a);
}

/** 平滑步進：回傳 [0,1]，在邊界附近以 S 曲線過渡。 */
export function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = clamp(invLerp(edge0, edge1, v), 0, 1);
  return t * t * (3 - 2 * t);
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function midPoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 點到線段的最短距離（用於路線點擊命中測試）。 */
export function pointSegmentDistSq(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lenSq = abx * abx + aby * aby;
  let t = 0;
  if (lenSq > 0) {
    t = clamp((apx * abx + apy * aby) / lenSq, 0, 1);
  }
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return dx * dx + dy * dy;
}
