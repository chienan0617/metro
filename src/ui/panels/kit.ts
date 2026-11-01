/** 面板共用的小元件。 */

import type { Child } from "../dom.ts";
import { appendChildren, el } from "../dom.ts";

export function sectionTitle(text: string, extra?: Child): HTMLElement {
  return el("div", { class: "section-title" }, el("span", { text }), extra);
}

export function statRow(
  label: string,
  value: string | HTMLElement,
  options?: { strong?: boolean },
): HTMLElement {
  const valueNode =
    typeof value === "string" ? el("span", { class: "stat-value", text: value }) : value;
  if (options?.strong) {
    valueNode.classList.add("strong");
  }
  return el("div", { class: "stat-row" }, el("span", { class: "stat-label", text: label }), valueNode);
}

export function chip(text: string, color?: string, small = false): HTMLElement {
  const node = el("span", { class: `chip${small ? " chip-sm" : ""}`, text });
  if (color) {
    node.style.setProperty("--chip-color", color);
    node.classList.add("chip-colored");
  }
  return node;
}

export function colorDots(
  colors: readonly string[],
  selected: string,
  onPick: (color: string) => void,
): HTMLElement {
  const row = el("div", { class: "color-dots" });
  for (const color of colors) {
    const dot = el("button", {
      class: `color-dot${color === selected ? " selected" : ""}`,
      title: "選擇路線顏色",
      onClick: () => onPick(color),
    });
    dot.style.background = color;
    dot.setAttribute("aria-label", "選擇路線顏色");
    row.appendChild(dot);
  }
  return row;
}

export function emptyCard(text: string, action?: { label: string; onClick: () => void }): HTMLElement {
  const card = el("div", { class: "empty-card" }, el("div", { class: "empty-text", text }));
  if (action) {
    card.appendChild(
      el("button", { class: "btn primary sm", text: action.label, onClick: action.onClick }),
    );
  }
  return card;
}

export function panelHeader(title: string, onClose?: () => void, extra?: Child): HTMLElement {
  const header = el("div", { class: "panel-header" }, el("h2", { text: title }));
  if (extra !== undefined && extra !== null && extra !== false) {
    appendChildren(header, [extra]);
  }
  if (onClose) {
    const close = el("button", { class: "icon-btn", title: "關閉", onClick: onClose });
    close.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    close.setAttribute("aria-label", "關閉");
    header.appendChild(close);
  }
  return header;
}

export function infoNote(text: string): HTMLElement {
  return el("div", { class: "info-note", text });
}

export function warningBox(children: Child[]): HTMLElement {
  const box = el("div", { class: "warning-box" });
  appendChildren(box, children);
  return box;
}
