/** 主選單：遊戲模式、繼續遊戲、地圖種子、設定與資料管理。 */

import { formatMoneyCompact } from "../../core/format.ts";
import type { GameMode, GeographyChoice } from "../../core/types.ts";
import { DEFAULT_SEED } from "../../game/config.ts";
import { exportSaveText, importSaveText, type SaveSlotMeta } from "../../game/save.ts";
import { formatGameDate } from "../../game/time.ts";
import { GAME_SUBTITLE, GAME_TITLE, logoSvg, STUDIO_NAME } from "../brand.ts";
import { clearNode, el, openModal } from "../dom.ts";
import { openHelpModal } from "../panels/helpModal.ts";
import { applySettings, saveSettings, type AppSettings } from "../settings.ts";
import { sound } from "../sound.ts";

export interface MenuOptions {
  /** 所有存檔欄位（新到舊）。 */
  slots: SaveSlotMeta[];
  message?: { kind: "error" | "info"; text: string };
  settings: AppSettings;
  /** 取得最新的設定（設定視窗或地圖樣式變更後，選單內的快照可能過期）。 */
  getSettings(): AppSettings;
  onNewGame(seed: number, mode: GameMode): void;
  onContinue(slotId: string): void;
  onDeleteSlot(slotId: string): void;
  onSettingsChanged(settings: AppSettings): void;
  onSaveImported(): void;
}

const MAP_STYLE_OPTIONS: ReadonlyArray<{ value: GeographyChoice; label: string; hint: string }> = [
  { value: "auto", label: "自動", hint: "依地圖種子混合大陸與海洋" },
  { value: "continent", label: "大陸（廣闊內陸）", hint: "大片內陸，山脈、湖泊與多樣生態域" },
  { value: "islands", label: "群島", hint: "海洋較多，島嶼與港灣散布" },
];

export function showMenu(root: HTMLElement, options: MenuOptions): void {
  clearNode(root);
  const screen = el("div", { class: "screen menu" });

  const bgLines = el("div", { class: "menu-bg-lines" });
  bgLines.innerHTML = `
    <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path d="M-40 620 C 220 620, 300 420, 520 420 S 820 560, 1080 300 S 1250 240, 1320 120" />
      <path d="M-40 720 C 260 740, 420 560, 640 560 S 900 680, 1240 430" />
      <path d="M-60 200 C 180 260, 320 120, 560 190 S 900 320, 1260 60" />
      <circle cx="220" cy="556" r="5" />
      <circle cx="520" cy="420" r="5" />
      <circle cx="860" cy="500" r="5" />
      <circle cx="640" cy="560" r="5" />
      <circle cx="560" cy="190" r="5" />
    </svg>`;
  screen.appendChild(bgLines);

  const topBrand = el(
    "div",
    { class: "menu-top" },
    el("span", { class: "menu-top-logo", html: logoSvg(22) }),
    el("span", { class: "menu-top-studio", text: STUDIO_NAME }),
  );
  screen.appendChild(topBrand);

  const card = el(
    "div",
    { class: "menu-card" },
    el("div", { class: "menu-logo", html: logoSvg(76) }),
    el("h1", { class: "menu-title", text: GAME_TITLE }),
    el("p", { class: "menu-subtitle", text: GAME_SUBTITLE }),
  );

  if (options.message) {
    card.appendChild(
      el("div", { class: `menu-message kind-${options.message.kind}`, text: options.message.text }),
    );
  }

  // 存檔欄位清單（多存檔，不會互相覆蓋）。
  if (options.slots.length > 0) {
    card.appendChild(
      el(
        "div",
        { class: "save-section-head" },
        el("span", { class: "field-label", text: "存檔欄位" }),
        el("span", { class: "save-section-count", text: `${options.slots.length} 個` }),
      ),
    );
    const list = el("div", { class: "save-list" });
    for (const slot of options.slots) {
      const modeLabel = slot.mode === "free" ? "自由經營" : "生涯模式";
      const meta: string[] = [
        modeLabel,
        formatGameDate(slot.minutes, true),
        formatMoneyCompact(slot.money),
        `${slot.routeCount} 條路線`,
      ];
      if (slot.trainCount > 0) {
        meta.push(`${slot.trainCount} 輛列車`);
      }
      const row = el("div", { class: "save-row" });
      const continueButton = el(
        "button",
        { class: "save-continue" },
        el("span", { class: "save-main", text: meta.join(" · ") }),
        el("span", {
          class: "save-sub",
          text: `種子 ${slot.seed} · 最後儲存 ${formatSavedAt(slot.savedAt)}`,
        }),
      );
      continueButton.addEventListener("click", () => options.onContinue(slot.id));
      row.appendChild(continueButton);

      const exportButton = el("button", {
        class: "icon-btn",
        title: "匯出此存檔（JSON）",
      });
      exportButton.innerHTML =
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M7 9l5 5 5-5M5 19h14"/></svg>';
      exportButton.addEventListener("click", () => {
        const text = exportSaveText(slot.id);
        if (text) {
          downloadFile(`metro-save-seed-${slot.seed}.json`, text, "application/json");
        }
      });
      row.appendChild(exportButton);

      const deleteButton = el("button", {
        class: "icon-btn danger",
        title: "刪除此存檔",
      });
      deleteButton.innerHTML =
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>';
      deleteButton.addEventListener("click", () => {
        openModal({
          title: "刪除此存檔欄位？",
          body: `將永久刪除「${meta.join(" · ")}」。其他存檔欄位不受影響，此操作無法復原。`,
          actions: [
            { label: "取消", kind: "ghost" },
            { label: "刪除", kind: "danger", onClick: () => options.onDeleteSlot(slot.id) },
          ],
        });
      });
      row.appendChild(deleteButton);
      list.appendChild(row);
    }
    card.appendChild(list);
  }

  // 地圖種子。
  const seedInput = el("input", { class: "text-input seed-input" });
  seedInput.type = "number";
  seedInput.min = "1";
  seedInput.step = "1";
  seedInput.value = String(DEFAULT_SEED);
  const seedError = el("div", { class: "field-error hidden", text: "請輸入有效的正整數種子" });
  const randomButton = el("button", { class: "btn ghost sm", text: "隨機" });
  randomButton.addEventListener("click", () => {
    seedInput.value = String(Math.floor(Math.random() * 900000) + 100000);
    seedError.classList.add("hidden");
  });
  card.appendChild(
    el(
      "div",
      { class: "menu-seed-row" },
      el("label", { class: "field-label", text: "地圖種子" }),
      seedInput,
      randomButton,
    ),
  );
  card.appendChild(seedError);

  // 地圖樣式選擇（會記住上次的選擇）。
  const styleLabel = el("div", { class: "style-head" });
  styleLabel.appendChild(el("span", { class: "field-label", text: "地圖樣式" }));
  const styleHint = el("span", { class: "style-hint" });
  styleLabel.appendChild(styleHint);
  card.appendChild(styleLabel);
  const styleChips = el("div", { class: "chip-row style-chips" });
  const chipNodes = new Map<GeographyChoice, HTMLElement>();
  const initialStyle = options.settings.mapStyle;
  for (const option of MAP_STYLE_OPTIONS) {
    const button = el("button", {
      class: `chip chip-button${option.value === initialStyle ? " selected" : ""}`,
      text: option.label,
      title: option.hint,
      onClick: () => {
        for (const [value, node] of chipNodes) {
          node.classList.toggle("selected", value === option.value);
        }
        styleHint.textContent = option.hint;
        const updated: AppSettings = { ...options.getSettings(), mapStyle: option.value };
        saveSettings(updated);
        options.onSettingsChanged(updated);
      },
    });
    chipNodes.set(option.value, button);
    styleChips.appendChild(button);
  }
  styleHint.textContent =
    MAP_STYLE_OPTIONS.find((o) => o.value === initialStyle)?.hint ?? "";
  card.appendChild(styleChips);

  const readSeed = (): number | null => {
    const value = Number.parseInt(seedInput.value, 10);
    if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
      seedError.classList.remove("hidden");
      seedInput.focus();
      return null;
    }
    return value;
  };

  // 遊戲模式。
  const modeRow = el("div", { class: "menu-modes" });
  const careerButton = el(
    "button",
    { class: "btn primary big mode-btn" },
    el("span", { class: "mode-name", text: "新遊戲（生涯模式）" }),
    el("span", {
      class: "mode-desc",
      text: "城市逐步解鎖；任務、科技與事件帶你從一條路線成長為大型路網。",
    }),
  );
  careerButton.addEventListener("click", () => {
    const seed = readSeed();
    if (seed !== null) {
      options.onNewGame(seed, "career");
    }
  });
  const freeButton = el(
    "button",
    { class: "btn big mode-btn" },
    el("span", { class: "mode-name", text: "自由經營模式" }),
    el("span", {
      class: "mode-desc",
      text: "全部城市解鎖、起始資金充裕，沒有任務壓力，專心規劃你的路網。",
    }),
  );
  freeButton.addEventListener("click", () => {
    const seed = readSeed();
    if (seed !== null) {
      options.onNewGame(seed, "free");
    }
  });
  modeRow.appendChild(careerButton);
  modeRow.appendChild(freeButton);
  card.appendChild(modeRow);

  card.appendChild(
    el("div", {
      class: "menu-seed-note",
      text: "同一組種子會產生完全相同的地圖，方便重複遊玩或與朋友挑戰同一張圖。",
    }),
  );

  const links = el("div", { class: "menu-links" });
  links.appendChild(
    el("button", {
      class: "link-btn",
      text: "操作說明",
      onClick: () => openHelpModal({ firstTime: true }),
    }),
  );
  links.appendChild(
    el("button", { class: "link-btn", text: "設定", onClick: () => openSettingsModal(options) }),
  );
  links.appendChild(
    el("button", {
      class: "link-btn",
      text: "資料管理",
      onClick: () => openDataModal(options),
    }),
  );
  card.appendChild(links);

  const center = el(
    "div",
    { class: "menu-center" },
    card,
    el("div", { class: "menu-footer", text: `${STUDIO_NAME} · v2.0 · 無限世界與生態域` }),
  );
  screen.appendChild(center);
  root.appendChild(screen);
}

/* ------------------------------ 設定 ------------------------------ */

function openSettingsModal(options: MenuOptions): void {
  const settings = { ...options.getSettings() };
  const rows = el("div", { class: "settings-rows" });

  const makeToggle = (
    label: string,
    description: string,
    key: "sound" | "vibration" | "reducedMotion",
  ): HTMLElement => {
    const input = el("input");
    input.type = "checkbox";
    input.checked = settings[key];
    input.addEventListener("change", () => {
      settings[key] = input.checked;
    });
    return el(
      "label",
      { class: "settings-row" },
      el("span", { class: "settings-text" }, el("span", { class: "settings-label", text: label }), el("span", { class: "settings-desc", text: description })),
      input,
    );
  };

  rows.appendChild(makeToggle("音效", "按鈕、建設、任務完成的提示音", "sound"));
  rows.appendChild(
    makeToggle("震動回饋", "支援的裝置會在重要操作時短暫震動", "vibration"),
  );
  rows.appendChild(makeToggle("降低動畫", "減少介面動畫與過場效果", "reducedMotion"));

  openModal({
    title: "設定",
    body: [
      rows,
      el("p", {
        text: "設定與存檔分開保存，不會因新遊戲而重置。",
      }),
    ],
    actions: [
      { label: "取消", kind: "ghost" },
      {
        label: "儲存設定",
        kind: "primary",
        onClick: () => {
          saveSettings(settings);
          sound.setEnabled(settings.sound);
          applySettings(settings);
          options.onSettingsChanged(settings);
        },
      },
    ],
  });
}

/* ------------------------------ 資料管理 ------------------------------ */

function openDataModal(options: MenuOptions): void {
  const body: HTMLElement[] = [];

  const fileInput = el("input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.classList.add("hidden");
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    void file.text().then((text) => {
      const result = importSaveText(text);
      if (result.ok) {
        openModal({
          title: "匯入成功",
          body: "存檔已匯入為「新的欄位」，不會覆蓋既有存檔。回到主選單即可在欄位清單中看到它。",
          actions: [{ label: "好", kind: "primary", onClick: () => options.onSaveImported() }],
        });
      } else {
        openModal({
          title: "匯入失敗",
          body: `無法匯入此存檔：${result.error}`,
          actions: [{ label: "關閉", kind: "ghost" }],
        });
      }
    });
  });
  const importButton = el("button", {
    class: "btn primary",
    text: "匯入存檔（選擇 JSON）",
  });
  importButton.addEventListener("click", () => fileInput.click());
  body.push(fileInput);

  body.push(
    el("p", {
      text: "匯入的存檔一律建立為新的欄位，不會覆蓋任何現有進度。若要匯出，請使用各存檔欄位右側的下載按鈕。",
    }),
  );

  openModal({
    title: "資料管理",
    body,
    actions: [
      { label: "關閉", kind: "ghost" },
      {
        label: "匯入存檔",
        kind: "primary",
        closeAfter: false,
        onClick: () => importButton.click(),
      },
    ],
  });
}

function formatSavedAt(timestamp: number): string {
  if (!timestamp) {
    return "—";
  }
  const date = new Date(timestamp);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function downloadFile(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
