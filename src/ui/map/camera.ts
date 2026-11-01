/**
 * 地圖攝影機：世界座標與螢幕座標轉換、平移與縮放。
 * 所有世界↔螢幕轉換都必須經過此模組，確保縮放平移時物件對齊。
 */

import { clamp } from "../../core/math.ts";
import type { Point } from "../../core/types.ts";

export class Camera {
  cx: number;
  cy: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  private viewW: number;
  private viewH: number;

  constructor(startX = 0, startY = 0, startZoom = 0.24) {
    this.cx = startX;
    this.cy = startY;
    this.zoom = startZoom;
    // 無限世界：允許拉得很遠，但保留可用範圍。
    this.minZoom = 0.045;
    this.maxZoom = 3.6;
    this.viewW = 1;
    this.viewH = 1;
  }

  setViewport(width: number, height: number): void {
    this.viewW = Math.max(1, width);
    this.viewH = Math.max(1, height);
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
  }

  worldToScreen(p: Point): Point {
    return {
      x: (p.x - this.cx) * this.zoom + this.viewW / 2,
      y: (p.y - this.cy) * this.zoom + this.viewH / 2,
    };
  }

  screenToWorld(p: Point): Point {
    return {
      x: (p.x - this.viewW / 2) / this.zoom + this.cx,
      y: (p.y - this.viewH / 2) / this.zoom + this.cy,
    };
  }

  panByScreen(dx: number, dy: number): void {
    this.cx -= dx / this.zoom;
    this.cy -= dy / this.zoom;
    // 無限世界：不限制平移範圍。
  }

  /** 以螢幕上某一點為中心縮放，保持該點下的世界座標不動。 */
  zoomAtScreen(screen: Point, factor: number): void {
    const before = this.screenToWorld(screen);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const after = this.screenToWorld(screen);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  /** 移動視角到指定世界座標。 */
  centerOn(x: number, y: number): void {
    this.cx = x;
    this.cy = y;
  }
}
