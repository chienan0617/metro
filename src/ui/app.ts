/** 應用程式入口：開場 → 主選單 ⇄ 遊戲畫面（多存檔欄位）。 */

import type { GameMode } from "../core/types.ts";
import { clearNode } from "./dom.ts";
import { createNewGame } from "../game/state.ts";
import {
  createSaveSlot,
  deleteSaveSlot,
  listSaveSlots,
  migrateLegacySave,
  readSaveSlot,
} from "../game/save.ts";
import { GameScreen } from "./screens/game.ts";
import { showMenu } from "./screens/menu.ts";
import { showSplash } from "./screens/splash.ts";
import { applySettings, loadSettings, type AppSettings } from "./settings.ts";
import { sound } from "./sound.ts";

export class App {
  private root: HTMLElement;
  private game: GameScreen | null = null;
  private settings: AppSettings;

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = loadSettings();
    sound.setEnabled(this.settings.sound);
    applySettings(this.settings);
    // 舊版單一存檔自動搬移成新的存檔欄位（不會被覆蓋）。
    migrateLegacySave();
  }

  async start(): Promise<void> {
    await showSplash(this.root);
    this.showMenu();
  }

  private clearRoot(): void {
    if (this.game) {
      this.game.dispose();
      this.game = null;
    }
    clearNode(this.root);
  }

  showMenu(message?: { kind: "error" | "info"; text: string }): void {
    this.clearRoot();
    showMenu(this.root, {
      slots: listSaveSlots(),
      message,
      settings: this.settings,
      getSettings: () => this.settings,
      onNewGame: (seed, mode) => this.startNewGame(seed, mode),
      onContinue: (slotId) => this.continueGame(slotId),
      onDeleteSlot: (slotId) => {
        deleteSaveSlot(slotId);
        this.showMenu({ kind: "info", text: "已刪除存檔欄位。" });
      },
      onSettingsChanged: (settings) => {
        this.settings = settings;
      },
      onSaveImported: () => {
        this.showMenu({ kind: "info", text: "存檔已匯入為新的欄位，可以「繼續遊戲」載入。" });
      },
    });
  }

  private startNewGame(seed: number, mode: GameMode): void {
    this.clearRoot();
    // 新遊戲建立全新欄位，不會覆蓋任何既有存檔。
    const slotId = createSaveSlot();
    const state = createNewGame(seed, mode, { geoStyle: this.settings.mapStyle });
    this.game = new GameScreen(this.root, state, {
      slotId,
      onExitToMenu: () => this.showMenu(),
    });
    this.game.start();
  }

  private continueGame(slotId: string): void {
    const result = readSaveSlot(slotId);
    if (!result) {
      this.showMenu({ kind: "error", text: "找不到這個存檔欄位。" });
      return;
    }
    if (!result.ok) {
      this.showMenu({
        kind: "error",
        text: `無法讀取存檔：${result.error}`,
      });
      return;
    }
    this.clearRoot();
    this.game = new GameScreen(this.root, result.state, {
      slotId,
      onExitToMenu: () => this.showMenu(),
    });
    this.game.start();
  }
}
