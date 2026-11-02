/**
 * 地圖渲染與互動。
 * Canvas 負責地形與向量繪製；點擊、拖曳、縮放透過螢幕座標命中測試處理。
 * 僅負責顯示與輸入，不修改遊戲狀態（所有操作經由回呼交給控制層）。
 */

import { clamp } from "../../core/math.ts";
import type { City, GameState, ID, Point, Route, Station, World } from "../../core/types.ts";
import { samplerForWorld, type TerrainSampler } from "../../world/terrain.ts";
import { BIOME_RGB } from "../../world/biomes.ts";
import {
  ALTITUDE_TINT,
  BiomeChunkCache,
  FAR_LEVEL,
  NEAR_LEVEL,
  reliefShade,
} from "./biomeCache.ts";
import { cityDisplayName } from "../../world/worldgen.ts";
import { CITY_COLORS, MAP_BACKGROUND } from "../palette.ts";
import { Camera } from "./camera.ts";
import {
  distToPolylineSq,
  offsetPolyline,
  partialPolyline,
  routeOffsetFor,
  traceSmoothPath,
} from "./geometry.ts";

export interface MapVisualState {
  mode: "select" | "build";
  selectedCityId: ID | null;
  selectedRouteId: ID | null;
  draft: { stops: ID[]; color: string; hoverValid: boolean } | null;
}

export interface MapCallbacks {
  onCityClick(cityId: ID): void;
  onRouteClick(routeId: ID): void;
  onEmptyClick(): void;
  onSecondaryAction(): void;
  onHoverCity(cityId: ID | null): void;
}

interface RoutePolyline {
  routeId: ID;
  points: Point[];
}

const FONT_STACK = '"Noto Sans TC", "Microsoft JhengHei", "PingFang TC", "Heiti TC", sans-serif';
const DRAG_THRESHOLD = 5;
const ROUTE_HIT_RADIUS = 10;

export class MapView {
  readonly canvas: HTMLCanvasElement;
  private container: HTMLElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: MapCallbacks;
  private camera = new Camera(1, 1);
  private world: World | null = null;
  private cityMap = new Map<ID, City>();
  private stationMap = new Map<ID, Station>();
  /** 遊戲狀態參考（就地更新；畫面每幀讀取，不需重新指派）。 */
  private state: GameState | null = null;
  private visual: MapVisualState = {
    mode: "select",
    selectedCityId: null,
    selectedRouteId: null,
    draft: null,
  };
  /** 無限地形：快速底層（低解析視窗取樣）＋銳利圖磚快取。 */
  private sampler: TerrainSampler | null = null;
  private biomeCanvas: HTMLCanvasElement | null = null;
  private biomeImage: ImageData | null = null;
  private terrainDirty = true;
  private chunkCache = new BiomeChunkCache();

  hoverCityId: ID | null = null;
  private hoverRouteId: ID | null = null;

  private routePolylines: RoutePolyline[] = [];
  private reveal: { routeId: ID; start: number } | null = null;
  private pan: { pointerId: number; last: Point; moved: boolean; total: number } | null = null;
  private pointers = new Map<number, Point>();
  private pinch: { ids: [number, number]; startDist: number; startZoom: number } | null = null;
  private rafHandle = 0;
  private resizeObserver: ResizeObserver;
  private destroyed = false;
  private viewW = 1;
  private viewH = 1;

  constructor(container: HTMLElement, callbacks: MapCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "map-canvas";
    container.appendChild(this.canvas);
    const context = this.canvas.getContext("2d");
    if (!context) {
      throw new Error("無法建立 Canvas 繪圖環境");
    }
    this.ctx = context;

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.handleResize();

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.onContextMenu);

    this.rafHandle = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafHandle);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas.remove();
  }

  setWorld(world: World): void {
    this.world = world;
    this.cityMap = new Map(world.cities.map((c) => [c.id, c]));
    this.stationMap = new Map(world.stations.map((s) => [s.id, s]));
    this.sampler = samplerForWorld(world);
    this.chunkCache.clear();
    this.camera = new Camera(world.startCore.x, world.startCore.y, 0.24);
    this.handleResize();
    this.terrainDirty = true;
  }

  /** 綁定遊戲狀態（路線與列車皆由此讀取）。 */
  attachState(state: GameState): void {
    this.state = state;
  }

  /** 世界內容變動（探索新區域）後，重建城市與車站的查詢表。 */
  refreshWorldData(): void {
    if (!this.world) {
      return;
    }
    this.cityMap = new Map(this.world.cities.map((c) => [c.id, c]));
    this.stationMap = new Map(this.world.stations.map((s) => [s.id, s]));
  }

  setVisual(visual: MapVisualState): void {
    this.visual = visual;
  }

  /** 回到起始區域（無限世界沒有「整張地圖」）。 */
  focusStart(): void {
    if (this.world) {
      this.camera.centerOn(this.world.startCore.x, this.world.startCore.y);
      this.camera.zoom = clamp(0.24, this.camera.minZoom, this.camera.maxZoom);
    }
    this.terrainDirty = true;
  }

  /** 目前相機中心（世界座標）。 */
  getCameraCenter(): Point {
    return { x: this.camera.cx, y: this.camera.cy };
  }

  zoomBy(factor: number): void {
    this.camera.zoomAtScreen({ x: this.viewW / 2, y: this.viewH / 2 }, factor);
    this.terrainDirty = true;
  }

  /** 播放新建路線的生成動畫。 */
  revealRoute(routeId: ID): void {
    this.reveal = { routeId, start: performance.now() };
  }

  /** 將視角移動到指定城市（不改變縮放，僅調整中心）。 */
  centerOnCity(cityId: ID): void {
    const city = this.cityMap.get(cityId);
    if (!city) {
      return;
    }
    this.camera.centerOn(city.position.x, city.position.y);
    this.terrainDirty = true;
  }

  /** 城市目前所在的螢幕座標（相對畫布左上角）。 */
  screenPositionOf(cityId: ID): Point | null {
    const city = this.cityMap.get(cityId);
    return city ? this.camera.worldToScreen(city.position) : null;
  }

  private handleResize(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = Math.max(1, Math.floor(rect.width));
    this.viewH = Math.max(1, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.viewW * dpr);
    this.canvas.height = Math.floor(this.viewH * dpr);
    this.canvas.style.width = `${this.viewW}px`;
    this.canvas.style.height = `${this.viewH}px`;
    this.camera.setViewport(this.viewW, this.viewH);
    this.terrainDirty = true;
    // 尺寸變更後立即重繪一次，避免等待下一個動畫幀造成空白閃爍。
    this.render();
  }

  /** 供開發除錯與自動化驗證使用：立即重繪一次。 */
  debugRender(): void {
    this.render();
  }

  /** 供開發除錯與自動化驗證使用：直接設定相機。 */
  debugSetCamera(x: number, y: number, zoom?: number): void {
    this.camera.centerOn(x, y);
    if (zoom !== undefined) {
      this.camera.zoom = clamp(zoom, this.camera.minZoom, this.camera.maxZoom);
    }
    this.terrainDirty = true;
  }

  /* ------------------------------ 輸入處理 ------------------------------ */

  private canvasPoint(event: PointerEvent | WheelEvent | MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onPointerDown = (event: PointerEvent): void => {
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // 部分情況（例如合成事件）無法捕獲指標，仍可繼續處理。
    }
    const point = this.canvasPoint(event);
    this.pointers.set(event.pointerId, point);
    if (this.pointers.size === 1) {
      this.pan = { pointerId: event.pointerId, last: point, moved: false, total: 0 };
    } else if (this.pointers.size === 2) {
      this.pan = null;
      const ids = [...this.pointers.keys()] as [number, number];
      const a = this.pointers.get(ids[0]) as Point;
      const b = this.pointers.get(ids[1]) as Point;
      this.pinch = {
        ids,
        startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        startZoom: this.camera.zoom,
      };
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    const point = this.canvasPoint(event);
    if (this.pointers.has(event.pointerId)) {
      this.pointers.set(event.pointerId, point);
    }

    if (this.pinch && this.pointers.size >= 2) {
      const a = this.pointers.get(this.pinch.ids[0]);
      const b = this.pointers.get(this.pinch.ids[1]);
      if (a && b) {
        const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const target = clamp(
          this.pinch.startZoom * (distance / this.pinch.startDist),
          this.camera.minZoom,
          this.camera.maxZoom,
        );
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.camera.zoomAtScreen(mid, target / this.camera.zoom);
        this.terrainDirty = true;
      }
      return;
    }

    if (this.pan && event.pointerId === this.pan.pointerId) {
      const dx = point.x - this.pan.last.x;
      const dy = point.y - this.pan.last.y;
      this.pan.total += Math.hypot(dx, dy);
      if (this.pan.total > DRAG_THRESHOLD) {
        this.pan.moved = true;
      }
      this.camera.panByScreen(dx, dy);
      this.terrainDirty = true;
      this.pan.last = point;
      return;
    }

    // 未拖曳時更新 hover 狀態。
    const city = this.hitCity(point);
    if (city !== this.hoverCityId) {
      this.hoverCityId = city;
      this.callbacks.onHoverCity(city);
    }
    this.hoverRouteId = city === null ? this.hitRoute(point) : null;
  };

  private onPointerUp = (event: PointerEvent): void => {
    const point = this.canvasPoint(event);
    this.pointers.delete(event.pointerId);

    if (this.pinch && this.pointers.size < 2) {
      this.pinch = null;
      this.pan = null;
      return;
    }
    if (this.pan && this.pan.pointerId === event.pointerId) {
      const moved = this.pan.moved;
      this.pan = null;
      if (!moved) {
        this.dispatchClick(point);
      }
    }
  };

  private dispatchClick(point: Point): void {
    const cityId = this.hitCity(point);
    if (cityId) {
      this.callbacks.onCityClick(cityId);
      return;
    }
    const routeId = this.hitRoute(point);
    if (routeId) {
      this.callbacks.onRouteClick(routeId);
      return;
    }
    this.callbacks.onEmptyClick();
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0016);
    this.camera.zoomAtScreen(this.canvasPoint(event), factor);
    this.terrainDirty = true;
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    this.callbacks.onSecondaryAction();
  };

  private hitCity(point: Point): ID | null {
    if (!this.world) {
      return null;
    }
    // 觸控裝置給更大的點擊容錯。
    const slop = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches ? 14 : 7;
    let best: ID | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const city of this.world.cities) {
      const screen = this.camera.worldToScreen(city.position);
      const radius = markerRadius(city) + slop;
      const d = Math.hypot(screen.x - point.x, screen.y - point.y);
      if (d < radius && d < bestDist) {
        best = city.id;
        bestDist = d;
      }
    }
    return best;
  }

  private hitRoute(point: Point): ID | null {
    let best: ID | null = null;
    let bestDist = ROUTE_HIT_RADIUS * ROUTE_HIT_RADIUS;
    for (const polyline of this.routePolylines) {
      const d = distToPolylineSq(point, polyline.points);
      if (d < bestDist) {
        bestDist = d;
        best = polyline.routeId;
      }
    }
    return best;
  }

  /* ------------------------------ 繪製 ------------------------------ */

  private frame = (): void => {
    if (this.destroyed) {
      return;
    }
    this.render();
    this.rafHandle = requestAnimationFrame(this.frame);
  };

  private render(): void {
    const ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    ctx.fillStyle = MAP_BACKGROUND;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    if (!this.world) {
      return;
    }

    this.drawTerrain();
    this.buildPolylines();
    this.drawRoutes();
    this.drawDraft();
    this.drawTrains();
    this.drawCities();
    this.drawLabels();
    this.updateCursor();
  }

  /**
   * 無限生態域地形：把視窗以降低的解析度取樣成點陣圖，再平滑放大繪製。
   * 只在相機變動（terrainDirty）時重新取樣。
   */
  private drawTerrain(): void {
    if (!this.sampler || !this.world) {
      return;
    }
    // 快速底層：保證任何時刻都有畫面。
    if (this.terrainDirty || this.biomeCanvas === null) {
      this.updateBiomeTerrain();
      this.terrainDirty = false;
    }
    const ctx = this.ctx;
    if (this.biomeCanvas) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        this.biomeCanvas,
        0,
        0,
        this.biomeCanvas.width,
        this.biomeCanvas.height,
        0,
        0,
        this.viewW,
        this.viewH,
      );
    }

    // 銳利圖磚：放大到一定程度後逐塊疊上高解析地形。
    const zoom = this.camera.zoom;
    if (zoom >= 0.2) {
      const level = zoom >= 0.8 ? NEAR_LEVEL : FAR_LEVEL;
      const halfW = this.viewW / 2 / zoom;
      const halfH = this.viewH / 2 / zoom;
      const minCx = Math.floor((this.camera.cx - halfW) / level.chunkUnits);
      const maxCx = Math.floor((this.camera.cx + halfW) / level.chunkUnits);
      const minCy = Math.floor((this.camera.cy - halfH) / level.chunkUnits);
      const maxCy = Math.floor((this.camera.cy + halfH) / level.chunkUnits);
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          const centerX = (cx + 0.5) * level.chunkUnits;
          const centerY = (cy + 0.5) * level.chunkUnits;
          const priority = Math.hypot(centerX - this.camera.cx, centerY - this.camera.cy);
          const chunk = this.chunkCache.request(level, cx, cy, priority);
          if (!chunk) {
            continue;
          }
          const topLeft = this.camera.worldToScreen({
            x: cx * level.chunkUnits,
            y: cy * level.chunkUnits,
          });
          const size = level.chunkUnits * zoom + 0.6; // 微幅重疊，避免接縫
          ctx.drawImage(chunk, topLeft.x, topLeft.y, size, size);
        }
      }
    }

    // 以小時間預算分批建立圖磚（不阻塞操作）。
    if (this.chunkCache.pendingCount > 0) {
      this.chunkCache.buildBudget(this.sampler, 8);
    }
  }

  /** 供外部（模擬計時器）推進圖磚建立；rAF 被節流時仍能完成快取。 */
  pumpChunkBuild(budgetMs: number): void {
    if (this.sampler && this.chunkCache.pendingCount > 0) {
      this.chunkCache.buildBudget(this.sampler, budgetMs);
    }
  }

  /** 開發除錯：地形圖磚快取狀態。 */
  debugTerrainInfo(): { cached: number; pending: number } {
    return { cached: this.chunkCache.cachedCount, pending: this.chunkCache.pendingCount };
  }

  private updateBiomeTerrain(): void {
    if (!this.sampler) {
      return;
    }
    // 控制取樣量（約 26k 點），確保任何視窗尺寸都流暢。
    const scale = Math.max(3, Math.round(Math.sqrt((this.viewW * this.viewH) / 26000)));
    const w = Math.max(32, Math.ceil(this.viewW / scale));
    const h = Math.max(32, Math.ceil(this.viewH / scale));
    if (
      !this.biomeCanvas ||
      this.biomeCanvas.width !== w ||
      this.biomeCanvas.height !== h ||
      !this.biomeImage
    ) {
      this.biomeCanvas = document.createElement("canvas");
      this.biomeCanvas.width = w;
      this.biomeCanvas.height = h;
      const bctx = this.biomeCanvas.getContext("2d");
      if (!bctx) {
        return;
      }
      this.biomeImage = bctx.createImageData(w, h);
    }
    const image = this.biomeImage;
    const data = image.data;
    const elevations = new Float32Array(w * h);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const worldPoint = this.camera.screenToWorld({
          x: (px + 0.5) * scale,
          y: (py + 0.5) * scale,
        });
        const sample = this.sampler.sampleAt(worldPoint);
        elevations[py * w + px] = sample.elevation;
        const rgb = BIOME_RGB[sample.biome];
        // 高度色調 + 地貌陰影讓山脈與河谷更有立體感。
        const shade = (sample.elevation - 0.5) * ALTITUDE_TINT;
        const index = (py * w + px) * 4;
        data[index] = clamp((rgb[0] as number) + shade, 0, 255);
        data[index + 1] = clamp((rgb[1] as number) + shade, 0, 255);
        data[index + 2] = clamp((rgb[2] as number) + shade, 0, 255);
        data[index + 3] = 255;
      }
    }
    // 地貌陰影：光源在西北方，與銳利圖磚採同一組參數。
    const worldPerPixel = scale / this.camera.zoom;
    for (let py = 1; py < h - 1; py++) {
      for (let px = 1; px < w - 1; px++) {
        const i = py * w + px;
        const relief = reliefShade(
          (elevations[i - 1] as number) - (elevations[i + 1] as number),
          (elevations[i - w] as number) - (elevations[i + w] as number),
          worldPerPixel,
        );
        if (relief === 0) {
          continue;
        }
        const index = i * 4;
        data[index] = clamp((data[index] as number) + relief, 0, 255);
        data[index + 1] = clamp((data[index + 1] as number) + relief, 0, 255);
        data[index + 2] = clamp((data[index + 2] as number) + relief, 0, 255);
      }
    }
    const bctx = this.biomeCanvas.getContext("2d");
    if (bctx) {
      bctx.putImageData(image, 0, 0);
    }
  }

  private buildPolylines(): void {
    if (!this.world || !this.state) {
      return;
    }
    const polylines: RoutePolyline[] = [];
    const selectedId = this.visual.selectedRouteId;
    // 先畫未選取，選取路線最後畫（置頂）。
    const ordered = this.state.routes
      .map((route, index) => ({ route, index }))
      .sort((a, b) => {
        const aSel = a.route.id === selectedId ? 1 : 0;
        const bSel = b.route.id === selectedId ? 1 : 0;
        return aSel - bSel;
      });
    for (const { route, index } of ordered) {
      const points = this.routeScreenPoints(route);
      if (points.length >= 2) {
        polylines.push({
          routeId: route.id,
          points: applyRouteOffset(points, route, index, this.visual.selectedRouteId),
        });
      }
    }
    this.routePolylines = polylines;
  }

  private routeScreenPoints(route: Route): Point[] {
    const points: Point[] = [];
    for (const stationId of route.stationIds) {
      const station = this.stationMap.get(stationId);
      if (station) {
        points.push(this.camera.worldToScreen(station.position));
      }
    }
    return points;
  }

  private drawRoutes(): void {
    if (!this.state) {
      return;
    }
    const ctx = this.ctx;
    for (const route of this.state.routes) {
      const polyline = this.routePolylines.find((p) => p.routeId === route.id);
      if (!polyline) {
        continue;
      }
      const selected = route.id === this.visual.selectedRouteId;
      const suspended = route.status === "suspended";
      const revealing = this.reveal?.routeId === route.id;
      if (revealing) {
        const elapsed = (performance.now() - (this.reveal?.start ?? 0)) / 900;
        if (elapsed >= 1.25) {
          this.reveal = null;
        } else {
          this.drawRevealRoute(route, polyline.points, clamp(elapsed, 0, 1));
          continue;
        }
      }
      if (suspended) {
        ctx.save();
        ctx.globalAlpha = 0.45;
      }
      this.strokeRoutePath(polyline.points, route.color, selected, ctx);
      if (suspended) {
        ctx.restore();
      }
    }
  }

  /** 繪製列車（位置完全由模擬狀態推導，不使用獨立動畫）。 */
  private drawTrains(): void {
    if (!this.state) {
      return;
    }
    const ctx = this.ctx;
    for (const train of this.state.trains) {
      if (train.routeId === null) {
        continue;
      }
      const route = this.state.routes.find((r) => r.id === train.routeId);
      if (!route) {
        continue;
      }
      const polyline = this.routePolylines.find((p) => p.routeId === route.id);
      if (!polyline) {
        continue;
      }
      const a = polyline.points[train.currentSegmentIndex];
      const b = polyline.points[train.currentSegmentIndex + 1];
      if (!a || !b) {
        continue;
      }
      const t = clamp(train.progressOnSegment, 0, 1);
      const from = train.direction === 1 ? a : b;
      const to = train.direction === 1 ? b : a;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const angle = Math.atan2(to.y - from.y, to.x - from.x);

      ctx.save();
      if (route.status === "suspended") {
        ctx.globalAlpha = 0.5;
      }
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      roundRect(ctx, -7.5, -4, 15, 8, 3);
      ctx.fillStyle = "#f2f7fc";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = route.color;
      ctx.stroke();
      // 車頭方向標記。
      ctx.beginPath();
      ctx.arc(4.5, 0, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = route.color;
      ctx.fill();
      ctx.restore();
    }
  }

  private strokeRoutePath(points: Point[], color: string, selected: boolean, ctx: CanvasRenderingContext2D): void {
    const width = selected ? 5 : 4;
    if (selected) {
      ctx.beginPath();
      traceSmoothPath(ctx, points);
      ctx.strokeStyle = hexAlpha(color, 0.3);
      ctx.lineWidth = width + 9;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    ctx.beginPath();
    traceSmoothPath(ctx, points);
    ctx.strokeStyle = selected ? "#e9f2fa" : "#0a141d";
    ctx.lineWidth = width + (selected ? 4 : 3);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.beginPath();
    traceSmoothPath(ctx, points);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  private drawRevealRoute(route: Route, points: Point[], progress: number): void {
    const ctx = this.ctx;
    const eased = 1 - (1 - progress) ** 3;
    const partial = partialPolyline(points, eased);
    if (partial.length < 2) {
      return;
    }
    ctx.beginPath();
    traceSmoothPath(ctx, partial);
    ctx.strokeStyle = hexAlpha(route.color, 0.35);
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.beginPath();
    traceSmoothPath(ctx, partial);
    ctx.strokeStyle = route.color;
    ctx.lineWidth = 5.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  private drawDraft(): void {
    const draft = this.visual.draft;
    if (!draft || draft.stops.length === 0 || !this.world) {
      return;
    }
    const ctx = this.ctx;
    const points: Point[] = [];
    for (const cityId of draft.stops) {
      const city = this.cityMap.get(cityId);
      if (city) {
        points.push(this.camera.worldToScreen(city.position));
      }
    }

    if (points.length >= 2) {
      ctx.save();
      ctx.setLineDash([9, 7]);
      ctx.beginPath();
      traceSmoothPath(ctx, points);
      ctx.strokeStyle = hexAlpha(draft.color, 0.95);
      ctx.lineWidth = 3.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
    }

    // 從最後一站到滑鼠 hover 城市的預覽線。
    const lastCity = this.cityMap.get(draft.stops[draft.stops.length - 1] as ID);
    const hoverCity = this.hoverCityId ? this.cityMap.get(this.hoverCityId) : null;
    if (lastCity && hoverCity && hoverCity.id !== lastCity.id && !draft.stops.includes(hoverCity.id)) {
      const from = this.camera.worldToScreen(lastCity.position);
      const to = this.camera.worldToScreen(hoverCity.position);
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = draft.hoverValid
        ? hexAlpha(draft.color, 0.75)
        : "rgba(232, 93, 93, 0.9)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.stroke();
      if (!draft.hoverValid) {
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(to.x, to.y, 9, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(232, 93, 93, 0.95)";
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(to.x - 4.5, to.y - 4.5);
        ctx.lineTo(to.x + 4.5, to.y + 4.5);
        ctx.moveTo(to.x + 4.5, to.y - 4.5);
        ctx.lineTo(to.x - 4.5, to.y + 4.5);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 停靠順序標記。
    ctx.font = `700 10px ${FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    points.forEach((point, index) => {
      const city = this.cityMap.get(draft.stops[index] as ID);
      if (!city) {
        return;
      }
      const r = markerRadius(city);
      const bx = point.x + r + 3;
      const by = point.y - r - 3;
      ctx.beginPath();
      ctx.arc(bx, by, 8.5, 0, Math.PI * 2);
      ctx.fillStyle = draft.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#0a141d";
      ctx.stroke();
      ctx.fillStyle = "#0a141d";
      ctx.fillText(String(index + 1), bx, by + 0.5);
    });
  }

  private drawCities(): void {
    if (!this.world) {
      return;
    }
    const ctx = this.ctx;
    const pulse = 1 + Math.sin(performance.now() / 380) * 0.12;

    for (const city of this.world.cities) {
      const screen = this.camera.worldToScreen(city.position);
      if (
        screen.x < -60 ||
        screen.y < -60 ||
        screen.x > this.viewW + 60 ||
        screen.y > this.viewH + 60
      ) {
        continue;
      }
      const r = markerRadius(city);
      const isHover = city.id === this.hoverCityId;
      const isSelected = city.id === this.visual.selectedCityId;
      // 未解鎖城市（生涯模式）以灰藍色與虛線外框標示。
      const isLocked =
        this.state !== null && this.state.mode !== "free" && !city.unlocked;

      if (isSelected) {
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, (r + 6) * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(233, 242, 250, 0.95)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, (r + 10) * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = hexAlpha(CITY_COLORS[city.cityType], 0.5);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (isHover) {
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, r + 4.5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(233, 242, 250, 0.75)";
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
      if (isLocked) {
        ctx.fillStyle = "#5b6b7d";
        ctx.fill();
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = "rgba(160, 176, 194, 0.7)";
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = CITY_COLORS[city.cityType];
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#0a141d";
        ctx.stroke();

        if (city.cityType === "capital") {
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, r * 0.42, 0, Math.PI * 2);
          ctx.fillStyle = "#0a141d";
          ctx.fill();
        }
      }
    }

    // 選取路線的停靠站白點。
    const selectedRoute = this.state?.routes.find((r) => r.id === this.visual.selectedRouteId);
    if (selectedRoute) {
      for (const stationId of selectedRoute.stationIds) {
        const station = this.stationMap.get(stationId);
        if (!station) {
          continue;
        }
        const screen = this.camera.worldToScreen(station.position);
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = "#f2f7fc";
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = hexAlpha("#0a141d", 0.8);
        ctx.stroke();
      }
    }
  }

  private drawLabels(): void {
    if (!this.world) {
      return;
    }
    const ctx = this.ctx;
    const zoom = this.camera.zoom;

    for (const city of this.world.cities) {
      if (!this.shouldShowLabel(city, zoom)) {
        continue;
      }
      const screen = this.camera.worldToScreen(city.position);
      if (
        screen.x < -140 ||
        screen.y < -60 ||
        screen.x > this.viewW + 140 ||
        screen.y > this.viewH + 60
      ) {
        continue;
      }
      const r = markerRadius(city);
      const showPop = zoom >= 1.15 || city.cityType === "capital";
      const label = cityDisplayName(city);
      const isLocked =
        this.state !== null && this.state.mode !== "free" && !city.unlocked;
      const pop = isLocked
        ? `未解鎖（等級 ${city.unlockLevel}）`
        : `${(city.population / 10_000).toFixed(1)} 萬人`;

      ctx.font = `600 12px ${FONT_STACK}`;
      const nameWidth = ctx.measureText(label).width;
      ctx.font = `400 10px ${FONT_STACK}`;
      const popWidth = showPop ? ctx.measureText(pop).width : 0;
      const width = Math.max(nameWidth, popWidth) + 14;
      const height = showPop ? 30 : 19;
      const x = screen.x - width / 2;
      const y = screen.y + r + 6;

      ctx.beginPath();
      roundRect(ctx, x, y, width, height, 7);
      ctx.fillStyle = "rgba(8, 18, 28, 0.78)";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isLocked ? "rgba(178, 190, 205, 0.8)" : "#e6eef7";
      ctx.font = `600 12px ${FONT_STACK}`;
      ctx.fillText(label, screen.x, y + (showPop ? 9.5 : height / 2 + 0.5));
      if (showPop) {
        ctx.fillStyle = isLocked ? "rgba(200, 168, 96, 0.95)" : "rgba(156, 178, 199, 0.95)";
        ctx.font = `400 10px ${FONT_STACK}`;
        ctx.fillText(pop, screen.x, y + 21.5);
      }
    }

    // 路線名稱標籤。
    const showRouteLabels = zoom >= 0.75;
    for (const polyline of this.routePolylines) {
      const route = this.state?.routes.find((r) => r.id === polyline.routeId);
      if (!route || (!showRouteLabels && route.id !== this.visual.selectedRouteId)) {
        continue;
      }
      const mid = labelAnchor(polyline.points);
      if (!mid) {
        continue;
      }
      if (mid.x < -80 || mid.y < -40 || mid.x > this.viewW + 80 || mid.y > this.viewH + 40) {
        continue;
      }
      ctx.font = `700 11px ${FONT_STACK}`;
      const text = route.name;
      const width = ctx.measureText(text).width + 16;
      const x = mid.x - width / 2;
      const y = mid.y - 11;
      ctx.beginPath();
      roundRect(ctx, x, y, width, 21, 6);
      ctx.fillStyle = "rgba(8, 18, 28, 0.88)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = route.color;
      ctx.stroke();
      ctx.fillStyle = route.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, mid.x, y + 11);
    }
  }

  private shouldShowLabel(city: City, zoom: number): boolean {
    if (city.cityType === "capital" || city.cityType === "port") {
      return true;
    }
    if (city.cityType === "town") {
      return zoom >= 0.9;
    }
    return zoom >= 0.55;
  }

  private updateCursor(): void {
    let cursor = "grab";
    if (this.pan?.moved || this.pinch) {
      cursor = "grabbing";
    } else if (this.visual.mode === "build") {
      cursor = "crosshair";
    } else if (this.hoverCityId ?? this.hoverRouteId) {
      cursor = "pointer";
    }
    if (this.canvas.style.cursor !== cursor) {
      this.canvas.style.cursor = cursor;
    }
  }
}

/* ------------------------------ 繪圖工具 ------------------------------ */

function markerRadius(city: City): number {
  return clamp(4.5 + Math.sqrt(city.population) / 95, 4.5, 15);
}

function applyRouteOffset(
  points: Point[],
  route: Route,
  index: number,
  selectedRouteId: ID | null,
): Point[] {
  const offset = route.id === selectedRouteId ? 0 : routeOffsetFor(index);
  return offsetPolyline(points, offset);
}

function labelAnchor(points: Point[]): Point | null {
  if (points.length < 2) {
    return null;
  }
  const middle = Math.floor((points.length - 1) / 2);
  const a = points[middle] as Point;
  const b = points[(middle + 1) as number] as Point;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 16 };
}

function hexAlpha(hex: string, alpha: number): string {
  const cleaned = hex.replace("#", "");
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
}


