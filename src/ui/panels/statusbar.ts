/** 底部狀態列與通知訊息。 */

import { el, icon, type IconName } from "../dom.ts";

export type ToastKind = "info" | "success" | "warn" | "error";

const TOAST_ICONS: Record<ToastKind, IconName> = {
  info: "info",
  success: "check",
  warn: "warn",
  error: "warn",
};

export interface Statusbar {
  root: HTMLElement;
  setHint(text: string): void;
  toast(message: string, kind?: ToastKind): void;
}

export function createStatusbar(
  host: HTMLElement,
  onToast?: (kind: ToastKind, message: string) => void,
): Statusbar {
  const hint = el("span", { class: "statusbar-hint", text: "" });
  const phase = el("span", { class: "phase-chip", text: "v1.0 · 完整營運" });
  const root = el("footer", { class: "statusbar" }, hint, phase);

  const toasts = el("div", { class: "toasts" });
  host.appendChild(toasts);

  const setHint = (text: string): void => {
    hint.textContent = text;
  };

  const toast = (message: string, kind: ToastKind = "info"): void => {
    onToast?.(kind, message);
    const node = el(
      "div",
      { class: `toast kind-${kind}` },
      icon(TOAST_ICONS[kind], 16),
      el("span", { text: message }),
    );
    toasts.appendChild(node);
    while (toasts.children.length > 4) {
      toasts.firstChild?.remove();
    }
    setTimeout(() => {
      node.classList.add("leaving");
      setTimeout(() => node.remove(), 320);
    }, 4200);
  };

  return { root, setHint, toast };
}
