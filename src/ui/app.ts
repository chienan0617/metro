/** 應用程式入口：開場 → 主選單 ⇄ 遊戲畫面。 */

import type { GameMode } from "../core/types.ts";
import { clearNode } from "./dom.ts";
import { createNewGame } from "../game/state.ts";
import { clearSave, hasSave, readSave, readSaveSummary } from "../game/save.ts";
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
    const hasSaveData = hasSave();
    showMenu(this.root, {
      hasSaveData,
      saveSummary: hasSaveData ? readSaveSummary() : null,
      message,
      settings: this.settings,
      getSettings: () => this.settings,
      onNewGame: (seed, mode) => this.startNewGame(seed, mode),
      onContinue: () => this.continueGame(),
      onClearSave: () => {
        clearSave();
        this.showMenu({ kind: "info", text: "存檔已清除，可以開始新遊戲。" });
      },
      onSettingsChanged: (settings) => {
        this.settings = settings;
      },
      onSaveImported: () => {
        this.showMenu({ kind: "info", text: "存檔匯入完成，可以按「繼續遊戲」載入。" });
      },
    });
  }

  private startNewGame(seed: number, mode: GameMode): void {
    this.clearRoot();
    const state = createNewGame(seed, mode, { geoStyle: this.settings.mapStyle });
    this.game = new GameScreen(this.root, state, {
      onExitToMenu: () => this.showMenu(),
    });
    this.game.start();
  }

  private continueGame(): void {
    const result = readSave();
    if (!result) {
      this.showMenu({ kind: "error", text: "找不到存檔，請開始新遊戲。" });
      return;
    }
    if (!result.ok) {
      this.showMenu({
        kind: "error",
        text: `無法讀取存檔：${result.error}。可清除存檔後重新開始。`,
      });
      return;
    }
    this.clearRoot();
    this.game = new GameScreen(this.root, result.state, {
      onExitToMenu: () => this.showMenu(),
    });
    this.game.start();
  }
}
