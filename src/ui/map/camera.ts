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
  private worldW: number;
  private worldH: number;

  constructor(worldW: number, worldH: number) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.cx = worldW / 2;
    this.cy = worldH / 2;
    this.zoom = 1;
    this.minZoom = 0.1;
    this.maxZoom = 3.6;
    this.viewW = 1;
    this.viewH = 1;
  }

  setViewport(width: number, height: number): void {
    this.viewW = Math.max(1, width);
    this.viewH = Math.max(1, height);
    const fit = this.fitZoom();
    this.minZoom = fit * 0.9;
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    this.clampToWorld();
  }

  fitZoom(): number {
    return Math.min(this.viewW / this.worldW, this.viewH / this.worldH) * 0.94;
  }

  /** 顯示整張地圖。 */
  fit(): void {
    this.zoom = this.fitZoom();
    this.cx = this.worldW / 2;
    this.cy = this.worldH / 2;
    this.clampToWorld();
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
    this.clampToWorld();
  }

  /** 以螢幕上某一點為中心縮放，保持該點下的世界座標不動。 */
  zoomAtScreen(screen: Point, factor: number): void {
    const before = this.screenToWorld(screen);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const after = this.screenToWorld(screen);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.clampToWorld();
  }

  private clampToWorld(): void {
    const halfW = this.viewW / 2 / this.zoom;
    const halfH = this.viewH / 2 / this.zoom;
    if (this.worldW * this.zoom <= this.viewW) {
      this.cx = this.worldW / 2;
    } else {
      this.cx = clamp(this.cx, halfW, this.worldW - halfW);
    }
    if (this.worldH * this.zoom <= this.viewH) {
      this.cy = this.worldH / 2;
    } else {
      this.cy = clamp(this.cy, halfH, this.worldH - halfH);
    }
  }
}
