/**
 * 遊戲主畫面：版面配置與操作流程控制。
 * 僅負責 UI 互動與呼叫遊戲邏輯；不做模擬計算，也不各自複製遊戲狀態。
 */

import { formatMoney } from "../../core/format.ts";
import { Store } from "../../core/store.ts";
import type { GameSpeed, GameState, ID, ResearchLine } from "../../core/types.ts";
import { TIME_CONFIG, TRAIN_CONFIG, WORLD_CONFIG } from "../../game/config.ts";
import {
  addStop,
  canAddStop,
  confirmDraft,
  createDraft,
  deleteRoute,
  DRAFT_ERROR_MESSAGES,
  moveStop,
  nextRouteColor,
  removeStopAt,
  renameRoute,
  setRouteColor,
  type ConfirmResult,
  type RouteDraft,
} from "../../game/routes.ts";
import { installAutosave, writeSaveSlot } from "../../game/save.ts";
import { startResearch } from "../../game/research.ts";
import { SimulationRunner } from "../../game/simulationRunner.ts";
import { upgradeStation as upgradeStationCommand } from "../../game/stations.ts";
import {
  ASSIGN_ERROR_MESSAGES,
  assignTrainToRoute,
  purchaseTrain,
  PURCHASE_ERROR_MESSAGES,
  sellTrain,
  setRouteInterval,
  setRouteOperationStatus,
  upgradeTrain as upgradeTrainCommand,
} from "../../game/trains.ts";
import { trainModelById } from "../../game/trainModels.ts";
import {
  materializeTilesAround,
  stationById,
  type MaterializeContext,
} from "../../world/worldgen.ts";
import { pushNotification } from "../../game/progression.ts";
import { clearNode, el, icon, openModal } from "../dom.ts";
import { MapView } from "../map/mapView.ts";
import { renderCityPanel } from "../panels/cityPanel.ts";
import { renderFinancePanel } from "../panels/financePanel.ts";
import { renderGaragePanel } from "../panels/garagePanel.ts";
import { openHelpModal } from "../panels/helpModal.ts";
import { renderMissionsPanel } from "../panels/missionsPanel.ts";
import { renderOverviewPanel } from "../panels/overviewPanel.ts";
import { renderResearchPanel } from "../panels/researchPanel.ts";
import { renderRouteBuilderPanel } from "../panels/routeBuilderPanel.ts";
import { renderRoutePanel } from "../panels/routePanel.ts";
import { createStatusbar, type ToastKind } from "../panels/statusbar.ts";
import { createTopbar } from "../panels/topbar.ts";
import { createTutorialCard, type TutorialCard } from "../panels/tutorialCard.ts";
import {
  applySettings,
  loadSettings,
  saveSettings,
  vibrate,
  type AppSettings,
} from "../settings.ts";
import { sound } from "../sound.ts";
import { clamp } from "../../core/math.ts";

type PanelMode = "auto" | "garage" | "finance" | "missions" | "research";

const PANEL_TAB_CHEVRON_LEFT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 6.5 9 12l5.5 5.5"/></svg>';
const PANEL_TAB_CHEVRON_RIGHT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 6.5 15 12l-5.5 5.5"/></svg>';

type UiMode = "select" | "build";

export interface GameScreenOptions {
  /** 這場遊戲對應的存檔欄位（自動／手動存檔都寫入此欄位）。 */
  slotId: string;
  onExitToMenu(): void;
}

export class GameScreen {
  private options: GameScreenOptions;
  private slotId: string;
  private store: Store<GameState>;
  private mapView: MapView;
  private topbar: ReturnType<typeof createTopbar>;
  private statusbar: ReturnType<typeof createStatusbar>;
  private sideContent: HTMLElement;
  private selectButton: HTMLButtonElement;
  private buildButton: HTMLButtonElement;
  private garageButton: HTMLButtonElement;
  private financeButton: HTMLButtonElement;
  private missionsButton: HTMLButtonElement;
  private researchButton: HTMLButtonElement;
  private mode: UiMode = "select";
  private draft: RouteDraft | null = null;
  private selectedCityId: ID | null = null;
  private selectedRouteId: ID | null = null;
  private panelMode: PanelMode = "auto";
  /** 使用者手動開關面板的暫時覆寫（"open" / "closed"，null = 自動）。 */
  private panelOverride: "open" | "closed" | null = null;
  private screenEl: HTMLElement;
  private sidePanelEl: HTMLElement;
  private panelTab: HTMLButtonElement;
  private tutorialCard: TutorialCard;
  private settings: AppSettings;
  private simRunner: SimulationRunner;
  private simTimer: ReturnType<typeof setInterval> | null = null;
  private lastSimTick = 0;
  private secondsSinceAutosave = 0;
  private lastEmittedHour = -1;
  private lastNotificationId = 0;
  /** 無限世界：已生成圖磚集合（與存檔同步）。 */
  private tilesSet: Set<string>;
  private discoveryAccumulator = 0;
  private lastNonZeroSpeed: GameSpeed = 1;
  private disposed = false;
  private disposers: Array<() => void> = [];

  constructor(root: HTMLElement, state: GameState, options: GameScreenOptions) {
    this.options = options;
    this.slotId = options.slotId;
    this.store = new Store(state);
    this.simRunner = new SimulationRunner(state);
    this.settings = loadSettings();
    sound.setEnabled(this.settings.sound);
    applySettings(this.settings);
    this.lastNotificationId = state.notifications.reduce((max, n) => Math.max(max, n.id), 0);
    this.lastEmittedHour = Math.floor(state.clock.minutes / 60);
    this.tilesSet = new Set(state.materializedTiles);

    clearNode(root);
    const screen = el("div", { class: "screen game" });
    this.screenEl = screen;
    screen.style.setProperty("--sidepanel-width", `${Math.round(this.settings.sidebarWidth)}px`);

    this.topbar = createTopbar({
      onFit: () => this.focusStartArea(),
      onHelp: () => openHelpModal(),
      onMenu: () => this.confirmExit(),
      onSetSpeed: (speed) => this.setSpeed(speed),
    });

    // 左側工具列。
    this.selectButton = el(
      "button",
      { class: "tool-btn active", title: "選取城市與路線", onClick: () => this.handleSelectTool() },
      icon("select", 20),
      el("span", { text: "選取" }),
    );
    this.buildButton = el(
      "button",
      { class: "tool-btn", title: "建立新路線", onClick: () => this.handleBuildTool() },
      icon("route", 20),
      el("span", { text: "建立路線" }),
    );
    this.garageButton = el(
      "button",
      { class: "tool-btn", title: "車庫與列車", onClick: () => this.handlePanelTool("garage") },
      icon("train", 20),
      el("span", { text: "車庫" }),
    );
    this.financeButton = el(
      "button",
      { class: "tool-btn", title: "財務報表", onClick: () => this.handlePanelTool("finance") },
      icon("money", 20),
      el("span", { text: "財務" }),
    );
    this.missionsButton = el(
      "button",
      { class: "tool-btn", title: "任務", onClick: () => this.handlePanelTool("missions") },
      icon("check", 20),
      el("span", { text: "任務" }),
    );
    this.researchButton = el(
      "button",
      { class: "tool-btn", title: "科技研究", onClick: () => this.handlePanelTool("research") },
      icon("info", 20),
      el("span", { text: "研究" }),
    );
    const helpTool = el(
      "button",
      { class: "tool-btn", title: "操作說明", onClick: () => openHelpModal() },
      icon("help", 20),
      el("span", { text: "說明" }),
    );
    const toolbar = el(
      "nav",
      { class: "toolbar" },
      this.selectButton,
      this.buildButton,
      this.garageButton,
      this.financeButton,
      this.missionsButton,
      this.researchButton,
      helpTool,
    );

    // 地圖區。
    const mapWrap = el("div", { class: "map-wrap" });
    const mapControls = el("div", { class: "map-controls" });
    mapControls.appendChild(
      el("button", {
        class: "map-control-btn",
        title: "放大",
        onClick: () => this.mapView.zoomBy(1.3),
        html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
      }),
    );
    mapControls.appendChild(
      el("button", {
        class: "map-control-btn",
        title: "縮小",
        onClick: () => this.mapView.zoomBy(1 / 1.3),
        html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>',
      }),
    );
    mapControls.appendChild(
      el("button", {
        class: "map-control-btn",
        title: "回到起始區域",
        onClick: () => this.focusStartArea(),
        html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
      }),
    );
    mapWrap.appendChild(mapControls);

    // 新手引導卡片（生涯模式）。
    this.tutorialCard = createTutorialCard(() => {
      this.store.update((s) => {
        s.tutorialStep = 99;
      });
    });
    mapWrap.appendChild(this.tutorialCard.root);

    // 面板開關（浮動於地圖右緣）。
    this.panelTab = el("button", {
      class: "panel-tab",
      title: "顯示資訊面板",
      onClick: () => this.togglePanel(),
    });
    this.panelTab.innerHTML = PANEL_TAB_CHEVRON_LEFT;
    mapWrap.appendChild(this.panelTab);

    // 右側資訊面板（可拖曳調整寬度、可收合；窄螢幕時變為底部抽屜）。
    const sidePanel = el("aside", { class: "sidepanel" });
    this.sidePanelEl = sidePanel;
    this.sideContent = el("div", { class: "sidepanel-content" });
    sidePanel.appendChild(this.sideContent);

    const resizer = el("div", { class: "panel-resizer", title: "拖曳調整面板寬度" });
    this.wireResizer(resizer);

    const body = el("div", { class: "game-body" }, toolbar, mapWrap, resizer, sidePanel);

    this.statusbar = createStatusbar(screen, (kind) => this.onToast(kind));
    screen.appendChild(this.topbar.root);
    screen.appendChild(body);
    screen.appendChild(this.statusbar.root);
    root.appendChild(screen);

    this.mapView = new MapView(mapWrap, {
      onCityClick: (cityId) => this.handleCityClick(cityId),
      onRouteClick: (routeId) => this.handleRouteClick(routeId),
      onEmptyClick: () => this.handleEmptyClick(),
      onSecondaryAction: () => this.handleSecondaryAction(),
      onHoverCity: () => this.updateMapVisual(),
    });
    this.mapView.setWorld(state.world);
    this.mapView.attachState(state);

    if (import.meta.env.DEV) {
      // 開發模式除錯掛鉤（僅供自動化測試與除錯使用，正式版本不會存在）。
      (window as unknown as Record<string, unknown>)["__metro"] = {
        getState: () => this.store.get(),
        getScreenPosition: (cityId: ID) => this.mapView.screenPositionOf(cityId),
        isBuildMode: () => this.mode === "build",
        draftStops: () => (this.draft ? this.draft.stops.length : 0),
        setSpeed: (speed: GameSpeed) => this.setSpeed(speed),
        renderOnce: () => this.mapView.debugRender(),
        terrainInfo: () => this.mapView.debugTerrainInfo(),
        flyTo: (x: number, y: number, zoom?: number) => {
          this.mapView.debugSetCamera(x, y, zoom);
          this.materializeDiscovery(true);
        },
      };
    }
  }

  start(): void {
    this.disposers.push(this.store.subscribe(() => this.onStateChanged()));
    this.disposers.push(installAutosave(this.store, this.slotId));

    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
        return;
      }
      if (event.key === "Escape") {
        if (this.mode === "build") {
          this.exitBuildMode();
        } else if (
          this.selectedCityId !== null ||
          this.selectedRouteId !== null ||
          this.panelMode !== "auto" ||
          this.panelOverride === "open"
        ) {
          this.selectedCityId = null;
          this.selectedRouteId = null;
          this.panelMode = "auto";
          this.panelOverride = null;
          this.refreshUi();
        }
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        this.togglePause();
        return;
      }
      if (event.key === "0") {
        this.setSpeed(0);
      } else if (event.key === "1") {
        this.setSpeed(1);
      } else if (event.key === "2") {
        this.setSpeed(2);
      } else if (event.key === "4") {
        this.setSpeed(4);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    this.disposers.push(() => document.removeEventListener("keydown", onKeyDown));

    // 視窗尺寸跨越斷點時，更新面板顯示方式。
    const onResize = (): void => this.updatePanelVisibility();
    window.addEventListener("resize", onResize);
    this.disposers.push(() => window.removeEventListener("resize", onResize));

    this.onStateChanged();
    this.mapView.focusStart();
    this.statusbar.setHint(
      "用右上角的速度控制（或空白鍵）開始營運；點選城市或路線查看資訊。按「建立路線」規劃新路線。",
    );

    // 模擬主迴圈：以固定節奏的計時器驅動（不使用 requestAnimationFrame，
    // 避免視窗被遮擋或分頁節流時模擬完全停止）；固定步進在 SimulationRunner 內處理。
    this.lastSimTick = performance.now();
    this.simTimer = setInterval(() => {
      if (this.disposed) {
        return;
      }
      const now = performance.now();
      const dt = (now - this.lastSimTick) / 1000;
      this.lastSimTick = now;
      const stepped = this.simRunner.update(dt);
      if (stepped <= 0) {
        // 即使暫停也持續完成地形圖磚快取（rAF 被節流時的後備）。
        this.mapView.pumpChunkBuild(4);
        return;
      }
      const state = this.store.get();
      this.topbar.update(state);
      this.consumeNotifications(state);
      this.secondsSinceAutosave += dt;
      if (this.secondsSinceAutosave >= TIME_CONFIG.autosaveSeconds) {
        this.secondsSinceAutosave = 0;
        writeSaveSlot(this.slotId, state);
      }
      // 無限世界探索：定期依相機位置生成周邊圖磚。
      this.discoveryAccumulator += dt;
      if (this.discoveryAccumulator >= 1.5) {
        this.discoveryAccumulator = 0;
        this.materializeDiscovery();
      }
      // 每小時刷新一次面板（任務進度、營運數據、財務）。
      const hour = Math.floor(state.clock.minutes / 60);
      if (hour !== this.lastEmittedHour) {
        this.lastEmittedHour = hour;
        this.tutorialCard.update(state);
        this.store.notify();
      }
    }, 100);
  }

  /** 依目前相機位置生成周邊圖磚（無限世界的探索）。 */
  private materializeDiscovery(force = false): void {
    const center = this.mapView.getCameraCenter();
    this.materializeAt(center.x, center.y, WORLD_CONFIG.discoveryRadiusTiles, force);
  }

  /** 在指定座標附近生成圖磚；有新城市時同步世界資料並通知 UI。 */
  private materializeAt(x: number, y: number, radiusTiles: number, force = false): number {
    const state = this.store.get();
    const ctx: MaterializeContext = {
      world: state.world,
      tiles: this.tilesSet,
      freeUnlock: state.mode === "free",
    };
    const before = state.world.cities.length;
    materializeTilesAround(ctx, x, y, radiusTiles);
    const added = state.world.cities.length - before;
    if (added > 0 || force) {
      state.materializedTiles = [...this.tilesSet];
      this.mapView.refreshWorldData();
      this.store.notify();
      if (added >= 3) {
        pushNotification(state, "info", `探索到新區域：+${added} 座城市`);
      }
    }
    return added;
  }

  /** 回到起始區域並確保該區已生成。 */
  private focusStartArea(): void {
    this.mapView.focusStart();
    this.materializeDiscovery(true);
  }

  /* ------------------------------ 通知、音效與震動 ------------------------------ */

  private onToast(kind: ToastKind): void {
    if (kind === "success") {
      sound.play("success");
      vibrate(this.settings, 30);
    } else if (kind === "warn") {
      sound.play("error");
    } else if (kind === "error") {
      sound.play("error");
      vibrate(this.settings, [40, 60, 40]);
    }
  }

  /** 將模擬產生的通知轉為畫面提示（只顯示尚未看過的）。 */
  private consumeNotifications(state: GameState): void {
    for (const notification of state.notifications) {
      if (notification.id <= this.lastNotificationId) {
        continue;
      }
      this.lastNotificationId = notification.id;
      this.statusbar.toast(notification.text, notification.kind);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.simTimer !== null) {
      clearInterval(this.simTimer);
      this.simTimer = null;
    }
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
    this.mapView.destroy();
  }

  /* ------------------------------ 彈性面板 ------------------------------ */

  private isNarrow(): boolean {
    return window.matchMedia("(max-width: 920px)").matches;
  }

  /** 依內容與使用者偏好決定面板是否顯示；同時更新浮動開關圖示。 */
  private updatePanelVisibility(): void {
    const narrow = this.isNarrow();
    const contentActive =
      this.panelMode !== "auto" ||
      this.selectedCityId !== null ||
      this.selectedRouteId !== null ||
      (this.mode === "build" && this.draft !== null);

    let visible: boolean;
    if (this.panelOverride === "open") {
      visible = true;
    } else if (this.panelOverride === "closed") {
      visible = false;
    } else if (contentActive) {
      visible = true;
    } else {
      visible = narrow ? false : !this.settings.sidebarCollapsed;
    }

    this.screenEl.classList.toggle("panel-hidden", !visible);
    this.screenEl.classList.toggle("narrow-panel", narrow);
    this.panelTab.innerHTML = visible ? PANEL_TAB_CHEVRON_RIGHT : PANEL_TAB_CHEVRON_LEFT;
    this.panelTab.title = visible ? "隱藏資訊面板" : "顯示資訊面板";
  }

  private togglePanel(): void {
    const hidden = this.screenEl.classList.contains("panel-hidden");
    if (hidden) {
      this.panelOverride = "open";
      if (!this.isNarrow()) {
        this.settings.sidebarCollapsed = false;
        saveSettings(this.settings);
      }
    } else {
      this.panelOverride = "closed";
      if (!this.isNarrow()) {
        this.settings.sidebarCollapsed = true;
        saveSettings(this.settings);
      }
    }
    this.refreshUi();
  }

  /** 拖曳調整面板寬度；放開時記住寬度設定。 */
  private wireResizer(resizer: HTMLElement): void {
    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener("pointerdown", (event) => {
      dragging = true;
      startX = event.clientX;
      startWidth = this.sidePanelEl.getBoundingClientRect().width;
      try {
        resizer.setPointerCapture(event.pointerId);
      } catch {
        // 合成事件無法捕獲指標，仍可繼續。
      }
      this.screenEl.classList.add("resizing");
      event.preventDefault();
    });

    resizer.addEventListener("pointermove", (event) => {
      if (!dragging) {
        return;
      }
      const maxWidth = Math.min(680, window.innerWidth * 0.6);
      const width = clamp(startWidth - (event.clientX - startX), 248, maxWidth);
      this.screenEl.style.setProperty("--sidepanel-width", `${Math.round(width)}px`);
    });

    const endDrag = (): void => {
      if (!dragging) {
        return;
      }
      dragging = false;
      this.screenEl.classList.remove("resizing");
      const width = clamp(Math.round(this.sidePanelEl.getBoundingClientRect().width), 248, 680);
      this.settings.sidebarWidth = width;
      saveSettings(this.settings);
    };
    resizer.addEventListener("pointerup", endDrag);
    resizer.addEventListener("pointercancel", endDrag);
  }

  /* ------------------------------ 時間控制 ------------------------------ */

  private setSpeed(speed: GameSpeed): void {
    if (speed > 0) {
      this.lastNonZeroSpeed = speed;
    }
    this.store.update((state) => {
      state.clock.speed = speed;
    });
  }

  private togglePause(): void {
    const speed = this.store.get().clock.speed;
    this.setSpeed(speed === 0 ? this.lastNonZeroSpeed : 0);
  }

  /* ------------------------------ 狀態訂閱 ------------------------------ */

  private onStateChanged(): void {
    const state = this.store.get();
    this.topbar.update(state);
    this.consumeNotifications(state);
    this.tutorialCard.update(state);
    if (this.selectedRouteId && !state.routes.some((r) => r.id === this.selectedRouteId)) {
      this.selectedRouteId = null;
    }
    this.refreshUi();
  }

  private refreshUi(): void {
    this.renderPanels();
    this.updateMapVisual();
    this.updateToolbarState();
    this.updatePanelVisibility();
  }

  private updateToolbarState(): void {
    this.selectButton.classList.toggle("active", this.mode === "select" && this.panelMode === "auto");
    this.buildButton.classList.toggle("active", this.mode === "build");
    this.garageButton.classList.toggle("active", this.panelMode === "garage");
    this.financeButton.classList.toggle("active", this.panelMode === "finance");
    this.missionsButton.classList.toggle("active", this.panelMode === "missions");
    this.researchButton.classList.toggle("active", this.panelMode === "research");
  }

  private updateMapVisual(): void {
    const state = this.store.get();
    const draftCityIds: ID[] = [];
    let hoverValid = true;
    if (this.draft) {
      for (const stationId of this.draft.stops) {
        const station = stationById(state.world, stationId);
        if (station) {
          draftCityIds.push(station.cityId);
        }
      }
      const hoverCityId = this.mapView.hoverCityId;
      if (hoverCityId && this.draft.stops.length > 0) {
        const hoverCity = state.world.cities.find((c) => c.id === hoverCityId);
        if (hoverCity && hoverCity.stationIds[0]) {
          hoverValid = canAddStop(state, this.draft, hoverCity.stationIds[0]).ok;
        }
      }
    }
    this.mapView.setVisual({
      mode: this.mode,
      selectedCityId: this.selectedCityId,
      selectedRouteId: this.selectedRouteId,
      draft: this.draft ? { stops: draftCityIds, color: this.draft.color, hoverValid } : null,
    });
  }

  private renderPanels(): void {
    const state = this.store.get();
    clearNode(this.sideContent);

    if (this.panelMode === "garage") {
      this.renderGarage(state);
      return;
    }
    if (this.panelMode === "finance") {
      renderFinancePanel(this.sideContent, state, { onClose: () => this.setPanelMode("auto") });
      return;
    }
    if (this.panelMode === "missions") {
      renderMissionsPanel(this.sideContent, state, { onClose: () => this.setPanelMode("auto") });
      return;
    }
    if (this.panelMode === "research") {
      renderResearchPanel(this.sideContent, state, {
        onClose: () => this.setPanelMode("auto"),
        onStart: (line, tier) => this.startResearch(line, tier),
      });
      return;
    }
    if (this.mode === "build" && this.draft) {
      this.renderBuilderPanel(state);
      return;
    }
    if (this.selectedRouteId) {
      const routeId = this.selectedRouteId;
      renderRoutePanel(this.sideContent, state, routeId, {
        onRename: (name) => this.store.update((s) => renameRoute(s, routeId, name)),
        onSetColor: (color) => this.store.update((s) => setRouteColor(s, routeId, color)),
        onDelete: () => this.confirmDeleteRoute(routeId),
        onClose: () => {
          this.selectedRouteId = null;
          this.refreshUi();
        },
        onSelectCity: (cityId) => {
          this.selectedCityId = cityId;
          this.selectedRouteId = null;
          this.refreshUi();
        },
        onToggleOperation: () => this.toggleRouteOperation(routeId),
        onSetInterval: (minutes) => {
          this.store.update((s) => setRouteInterval(s, routeId, minutes));
        },
        onAssignTrain: (trainId) => this.assignTrain(trainId, routeId),
        onUnassignTrain: (trainId) => this.assignTrain(trainId, null),
        onOpenGarage: () => this.openGarage(),
      });
      return;
    }
    if (this.selectedCityId) {
      renderCityPanel(this.sideContent, state, this.selectedCityId, {
        onStartBuildFrom: (cityId) => this.enterBuildMode(cityId),
        onSelectRoute: (routeId) => {
          this.selectedRouteId = routeId;
          this.selectedCityId = null;
          this.refreshUi();
        },
        onUpgradeStation: (stationId) => this.upgradeStationById(stationId),
        onClose: () => {
          this.selectedCityId = null;
          this.refreshUi();
        },
      });
      return;
    }
    renderOverviewPanel(this.sideContent, state, {
      onStartBuild: () => this.enterBuildMode(),
      onSelectRoute: (routeId) => {
        this.selectedRouteId = routeId;
        this.refreshUi();
      },
    });
  }

  private renderBuilderPanel(state: GameState): void {
    const draft = this.draft;
    if (!draft) {
      return;
    }
    renderRouteBuilderPanel(this.sideContent, state, draft, {
      onRemoveStop: (index) => {
        removeStopAt(draft, index);
        this.refreshUi();
      },
      onMoveStop: (index, delta) => {
        if (moveStop(draft, index, delta)) {
          this.refreshUi();
        }
      },
      onUndoLast: () => {
        if (draft.stops.length > 0) {
          draft.stops.pop();
          this.refreshUi();
        }
      },
      onClear: () => {
        draft.stops = [];
        this.refreshUi();
      },
      onCancel: () => this.exitBuildMode(),
      onConfirm: () => this.confirmBuild(),
      onSetColor: (color) => {
        draft.color = color;
        this.refreshUi();
      },
    });
  }

  /* ------------------------------ 側面板（車庫／財務／任務／研究） ------------------------------ */

  private handlePanelTool(mode: Exclude<PanelMode, "auto">): void {
    if (this.mode === "build") {
      this.statusbar.toast("請先完成或取消目前的路線建設", "warn");
      return;
    }
    this.panelOverride = null;
    this.setPanelMode(this.panelMode === mode ? "auto" : mode);
  }

  private setPanelMode(mode: PanelMode): void {
    this.panelMode = mode;
    if (mode !== "auto") {
      this.selectedCityId = null;
      this.selectedRouteId = null;
    }
    this.refreshUi();
  }

  private openGarage(): void {
    this.setPanelMode("garage");
  }

  private renderGarage(state: GameState): void {
    renderGaragePanel(this.sideContent, state, {
      onBuy: (modelId) => this.buyTrain(modelId),
      onAssign: (trainId, routeId) => this.assignTrain(trainId, routeId),
      onSell: (trainId) => this.confirmSellTrain(trainId),
      onUpgrade: (trainId) => this.upgradeTrainById(trainId),
      onSelectRoute: (routeId) => {
        this.panelMode = "auto";
        this.selectedRouteId = routeId;
        this.refreshUi();
      },
      onClose: () => this.setPanelMode("auto"),
    });
  }

  private upgradeTrainById(trainId: ID): void {
    const holder: { result: ReturnType<typeof upgradeTrainCommand> | null } = { result: null };
    this.store.update((state) => {
      holder.result = upgradeTrainCommand(state, trainId);
    });
    if (holder.result?.ok) {
      sound.play("coin");
      this.statusbar.toast("列車升級完成：容量提升、能源消耗降低", "success");
      writeSaveSlot(this.slotId, this.store.get());
    } else if (holder.result) {
      this.statusbar.toast(holder.result.error, "error");
    }
  }

  private upgradeStationById(stationId: ID): void {
    const holder: { result: ReturnType<typeof upgradeStationCommand> | null } = { result: null };
    this.store.update((state) => {
      holder.result = upgradeStationCommand(state, stationId);
    });
    if (holder.result?.ok) {
      sound.play("build");
      this.statusbar.toast("車站升級完成：容量與商業收入提升", "success");
      writeSaveSlot(this.slotId, this.store.get());
    } else if (holder.result) {
      this.statusbar.toast(holder.result.error, "error");
    }
  }

  private startResearch(line: ResearchLine, tier: number): void {
    const holder: { result: ReturnType<typeof startResearch> | null } = { result: null };
    this.store.update((state) => {
      holder.result = startResearch(state, line, tier);
    });
    if (holder.result?.ok) {
      sound.play("success");
      this.statusbar.toast("研究已開始", "success");
      writeSaveSlot(this.slotId, this.store.get());
    } else if (holder.result) {
      this.statusbar.toast(holder.result.error, "error");
    }
  }

  private buyTrain(modelId: string): void {
    const holder: { result: ReturnType<typeof purchaseTrain> | null } = { result: null };
    this.store.update((state) => {
      holder.result = purchaseTrain(state, modelId);
    });
    const result = holder.result;
    if (!result) {
      return;
    }
    if (result.ok) {
      const model = trainModelById(result.train.modelId);
      this.statusbar.toast(`已購買列車：${model?.name ?? result.train.modelId}`, "success");
      writeSaveSlot(this.slotId, this.store.get());
    } else {
      this.statusbar.toast(PURCHASE_ERROR_MESSAGES[result.error], "error");
    }
  }

  private assignTrain(trainId: ID, routeId: ID | null): void {
    const holder: { result: ReturnType<typeof assignTrainToRoute> | null } = { result: null };
    this.store.update((state) => {
      holder.result = assignTrainToRoute(state, trainId, routeId);
    });
    const result = holder.result;
    if (!result) {
      return;
    }
    if (!result.ok) {
      this.statusbar.toast(ASSIGN_ERROR_MESSAGES[result.error], "error");
      return;
    }
    if (routeId === null) {
      this.statusbar.toast("已解除列車指派", "info");
    } else {
      const route = this.store.get().routes.find((r) => r.id === routeId);
      this.statusbar.toast(`已將列車配置到「${route?.name ?? routeId}」`, "success");
      if (route && route.status === "active" && this.store.get().clock.speed === 0) {
        this.statusbar.toast("按空白鍵或右上角 ▶ 開始營運", "info");
      }
    }
    writeSaveSlot(this.slotId, this.store.get());
  }

  private confirmSellTrain(trainId: ID): void {
    const state = this.store.get();
    const train = state.trains.find((t) => t.id === trainId);
    if (!train) {
      return;
    }
    const model = trainModelById(train.modelId);
    const refund = Math.round((model?.purchasePrice ?? 0) * TRAIN_CONFIG.sellRefundRatio);
    openModal({
      title: "賣出列車？",
      body: `將賣出「${model?.name ?? train.modelId}」，退回 ${formatMoney(refund)}（原價的 ${Math.round(TRAIN_CONFIG.sellRefundRatio * 100)}%）。此操作無法復原。`,
      actions: [
        { label: "取消", kind: "ghost" },
        {
          label: "賣出",
          kind: "danger",
          onClick: () => {
            const holder: { result: ReturnType<typeof sellTrain> | null } = { result: null };
            this.store.update((s) => {
              holder.result = sellTrain(s, trainId);
            });
            if (holder.result?.ok) {
              this.statusbar.toast(`已賣出列車，退回 ${formatMoney(holder.result.refund)}`, "info");
              writeSaveSlot(this.slotId, this.store.get());
            }
          },
        },
      ],
    });
  }

  private toggleRouteOperation(routeId: ID): void {
    const state = this.store.get();
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) {
      return;
    }
    const next = route.status === "active" ? "suspended" : "active";
    this.store.update((s) => setRouteOperationStatus(s, routeId, next));
    this.statusbar.toast(
      next === "suspended" ? `已暫停「${route.name}」營運` : `已恢復「${route.name}」營運`,
      next === "suspended" ? "warn" : "success",
    );
  }

  /* ------------------------------ 地圖互動 ------------------------------ */

  private handleCityClick(cityId: ID): void {
    const state = this.store.get();
    if (this.mode === "build" && this.draft) {
      const city = state.world.cities.find((c) => c.id === cityId);
      const stationId = city?.stationIds[0];
      if (!stationId) {
        return;
      }
      const result = addStop(state, this.draft, stationId);
      if (!result.ok) {
        this.statusbar.toast(DRAFT_ERROR_MESSAGES[result.error], "warn");
        return;
      }
      this.refreshUi();
      return;
    }
    this.selectedCityId = cityId;
    this.selectedRouteId = null;
    this.panelMode = "auto";
    this.panelOverride = null;
    this.refreshUi();
  }

  private handleRouteClick(routeId: ID): void {
    if (this.mode === "build") {
      return;
    }
    this.selectedRouteId = routeId;
    this.selectedCityId = null;
    this.panelMode = "auto";
    this.panelOverride = null;
    this.refreshUi();
  }

  private handleEmptyClick(): void {
    if (this.mode === "build") {
      return;
    }
    if (this.selectedCityId !== null || this.selectedRouteId !== null) {
      this.selectedCityId = null;
      this.selectedRouteId = null;
      this.panelOverride = null;
      this.refreshUi();
    }
  }

  private handleSecondaryAction(): void {
    if (this.mode === "build" && this.draft) {
      if (this.draft.stops.length > 0) {
        this.draft.stops.pop();
        this.refreshUi();
        this.statusbar.toast("已復原上一站", "info");
      }
      return;
    }
    this.handleEmptyClick();
  }

  /* ------------------------------ 建設流程 ------------------------------ */

  private handleSelectTool(): void {
    if (this.mode === "build") {
      this.exitBuildMode();
      return;
    }
    this.mode = "select";
    this.refreshUi();
  }

  private handleBuildTool(): void {
    if (this.mode === "build") {
      this.exitBuildMode();
      return;
    }
    this.enterBuildMode();
  }

  private enterBuildMode(initialCityId?: ID): void {
    const state = this.store.get();
    this.mode = "build";
    this.selectedCityId = null;
    this.selectedRouteId = null;
    this.panelOverride = null;
    if (!this.draft) {
      this.draft = createDraft(nextRouteColor(state));
    }
    if (initialCityId) {
      const city = state.world.cities.find((c) => c.id === initialCityId);
      const stationId = city?.stationIds[0];
      if (stationId) {
        const result = addStop(state, this.draft, stationId);
        if (!result.ok) {
          this.statusbar.toast(DRAFT_ERROR_MESSAGES[result.error], "warn");
        }
      }
    }
    this.statusbar.setHint(
      "建設模式：依序點選停靠城市。右鍵或「復原一站」退回上一站；Esc 取消建設。",
    );
    this.refreshUi();
  }

  private exitBuildMode(): void {
    const draft = this.draft;
    if (draft && draft.stops.length >= 2) {
      openModal({
        title: "取消建設？",
        body: `目前已規劃 ${draft.stops.length} 個停靠站，取消後草稿不會保存。`,
        actions: [
          { label: "繼續建設", kind: "ghost" },
          {
            label: "放棄草稿",
            kind: "danger",
            onClick: () => this.doExitBuildMode(),
          },
        ],
      });
      return;
    }
    this.doExitBuildMode();
  }

  private doExitBuildMode(): void {
    this.mode = "select";
    this.draft = null;
    this.statusbar.setHint("點選城市或路線查看資訊；拖曳平移、滾輪縮放。按「建立路線」開始規劃。");
    this.refreshUi();
  }

  private confirmBuild(): void {
    const draft = this.draft;
    if (!draft) {
      return;
    }
    const holder: { result: ConfirmResult | null } = { result: null };
    this.store.update((state) => {
      holder.result = confirmDraft(state, draft);
    });
    const result = holder.result;
    if (!result || !result.ok) {
      const error = result ? result.error : "insufficient_funds";
      this.statusbar.toast(DRAFT_ERROR_MESSAGES[error], "error");
      return;
    }
    const route = result.route;
    const spent = result.route.constructionCost;
    this.mode = "select";
    this.draft = null;
    this.selectedRouteId = route.id;
    this.selectedCityId = null;
    this.mapView.revealRoute(route.id);
    this.statusbar.toast(
      `路線「${route.name}」建設完成，花費 ${formatMoney(spent)}`,
      "success",
    );
    this.statusbar.setHint("路線已建成。到「車庫」購買列車並配置到路線，即可開始營運。");
    // 連接新城市時，一併生成路線端點周邊的區域。
    const builtState = this.store.get();
    const endpoints = new Set<ID>([
      route.stationIds[0] as ID,
      route.stationIds[route.stationIds.length - 1] as ID,
    ]);
    for (const stationId of endpoints) {
      const station = stationById(builtState.world, stationId);
      if (station) {
        this.materializeAt(station.position.x, station.position.y, WORLD_CONFIG.discoveryRadiusTiles);
      }
    }
    // 重要事件立即存檔。
    writeSaveSlot(this.slotId, this.store.get());
    this.refreshUi();
  }

  private confirmDeleteRoute(routeId: ID): void {
    const state = this.store.get();
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) {
      return;
    }
    const assignedTrains = route.assignedTrainIds.length;
    openModal({
      title: `刪除路線「${route.name}」？`,
      body: `已投入的建設費 ${formatMoney(route.constructionCost)} 不會退還，沿線城市將失去此路線的服務。${
        assignedTrains > 0 ? `路線上配置的 ${assignedTrains} 輛列車將回到待命狀態。` : ""
      }`,
      actions: [
        { label: "取消", kind: "ghost" },
        {
          label: "刪除路線",
          kind: "danger",
          onClick: () => {
            this.store.update((s) => deleteRoute(s, routeId));
            this.selectedRouteId = null;
            this.statusbar.toast(`已刪除路線「${route.name}」`, "info");
            this.refreshUi();
          },
        },
      ],
    });
  }

  private confirmExit(): void {
    openModal({
      title: "返回主選單？",
      body: "進度會自動保存，下次可從主選單按「繼續遊戲」回到這裡。也可以先手動存檔。",
      actions: [
        { label: "繼續遊戲", kind: "ghost" },
        {
          label: "立即存檔",
          kind: "ghost",
          closeAfter: false,
          onClick: () => {
            writeSaveSlot(this.slotId, this.store.get());
            this.statusbar.toast("已手動存檔", "success");
          },
        },
        {
          label: "返回主選單",
          kind: "primary",
          onClick: () => {
            this.dispose();
            this.options.onExitToMenu();
          },
        },
      ],
    });
  }
}
