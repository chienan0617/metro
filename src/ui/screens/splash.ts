/** 開場動畫：CA STUDIO 標誌與遊戲名稱。 */

import { clearNode, el } from "../dom.ts";
import { GAME_TITLE, logoSvg, STUDIO_NAME } from "../brand.ts";

export function showSplash(root: HTMLElement, durationMs = 2900): Promise<void> {
  return new Promise((resolve) => {
    clearNode(root);
    const screen = el("div", { class: "screen splash" });

    const logoWrap = el("div", { class: "splash-logo", html: logoSvg(132) });
    const lineWrap = el("div", { class: "splash-line" });
    lineWrap.innerHTML = `
      <svg viewBox="0 0 260 46" width="260" height="46" aria-hidden="true">
        <path class="splash-track" d="M8 36 L52 36 L74 12 L118 12 L140 36 L186 36 L208 14 L252 14" />
        <circle class="splash-stop" cx="8" cy="36" r="4.5" style="--delay: 0.55s; --c: #e85d5d" />
        <circle class="splash-stop" cx="74" cy="12" r="4.5" style="--delay: 0.85s; --c: #f2b23c" />
        <circle class="splash-stop" cx="140" cy="36" r="4.5" style="--delay: 1.15s; --c: #43c59e" />
        <circle class="splash-stop" cx="208" cy="14" r="4.5" style="--delay: 1.45s; --c: #4f8ef7" />
      </svg>`;

    const studio = el("div", { class: "splash-studio", text: STUDIO_NAME });
    const present = el("div", { class: "splash-present", text: `呈獻《${GAME_TITLE}》` });

    const inner = el("div", { class: "splash-inner" }, logoWrap, lineWrap, studio, present);
    screen.appendChild(inner);
    root.appendChild(screen);

    let finished = false;
    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      screen.removeEventListener("pointerdown", finish);
      screen.classList.add("leaving");
      setTimeout(() => resolve(), 430);
    };
    const onKey = (): void => finish();
    const timer = setTimeout(finish, durationMs);
    screen.addEventListener("pointerdown", finish);
    window.addEventListener("keydown", onKey);
  });
}
