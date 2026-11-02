/**
 * 使用者設定：音效、震動、動畫、地圖樣式與面板版面。
 * 獨立於存檔，使用另一個 localStorage 鍵保存。
 */

import type { GeographyChoice } from "../core/types.ts";

export interface AppSettings {
  sound: boolean;
  vibration: boolean;
  reducedMotion: boolean;
  /** 新遊戲預設使用的地圖地理樣式。 */
  mapStyle: GeographyChoice;
  /** 右側資訊面板寬度（px）。 */
  sidebarWidth: number;
  /** 右側面板預設收合（桌機版面）。 */
  sidebarCollapsed: boolean;
}

const SETTINGS_KEY = "metro-network-tycoon/settings";

const GEO_CHOICES: readonly GeographyChoice[] = ["auto", "continent", "islands"];

export const DEFAULT_SETTINGS: AppSettings = {
  sound: true,
  vibration: true,
  reducedMotion: false,
  mapStyle: "continent",
  sidebarWidth: 344,
  sidebarCollapsed: false,
};

export function loadSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      sound: parsed.sound !== false,
      vibration: parsed.vibration !== false,
      reducedMotion: parsed.reducedMotion === true,
      mapStyle: GEO_CHOICES.includes(parsed.mapStyle as GeographyChoice)
        ? (parsed.mapStyle as GeographyChoice)
        : DEFAULT_SETTINGS.mapStyle,
      sidebarWidth: clamp(
        typeof parsed.sidebarWidth === "number" ? parsed.sidebarWidth : DEFAULT_SETTINGS.sidebarWidth,
        248,
        680,
      ),
      sidebarCollapsed: parsed.sidebarCollapsed === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 忽略：無法存取時設定不會保存。
  }
}

/** 將設定套用到頁面（降低動畫）。 */
export function applySettings(settings: AppSettings): void {
  document.body.classList.toggle("reduce-motion", settings.reducedMotion);
}

/** 震動回饋（若支援且已開啟）。 */
export function vibrate(settings: AppSettings, pattern: number | number[]): void {
  if (!settings.vibration) {
    return;
  }
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch {
    // 忽略：不支援時正常運作。
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
