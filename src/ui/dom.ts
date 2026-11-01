/** DOM 建立與共用元件工具。 */

export type Child = Node | string | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string;
  html?: string;
  title?: string;
  onClick?: (event: MouseEvent) => void;
  attrs?: Record<string, string | number | boolean>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElProps,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    if (props.class) {
      node.className = props.class;
    }
    if (props.text !== undefined) {
      node.textContent = props.text;
    }
    if (props.html !== undefined) {
      node.innerHTML = props.html;
    }
    if (props.title !== undefined) {
      node.title = props.title;
    }
    if (props.onClick) {
      node.addEventListener("click", props.onClick as EventListener);
    }
    if (props.attrs) {
      for (const [key, value] of Object.entries(props.attrs)) {
        if (value === false) {
          continue;
        }
        node.setAttribute(key, value === true ? "" : String(value));
      }
    }
  }
  appendChildren(node, children);
  return node;
}

export function appendChildren(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    parent.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

export function clearNode(node: Node): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

/* -------------------------------- 圖示 -------------------------------- */

export type IconName =
  | "select"
  | "route"
  | "help"
  | "close"
  | "up"
  | "down"
  | "trash"
  | "check"
  | "warn"
  | "info"
  | "money"
  | "fit"
  | "plus"
  | "minus"
  | "menu"
  | "city"
  | "train"
  | "pause"
  | "play"
  | "undo";

const ICON_PATHS: Record<IconName, string> = {
  select: "M6 3l13 7.5-5.8 1.4L10.5 18z",
  route:
    "M4 17.5m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M20 6.5m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M5.4 15.4C7.2 10.6 10.8 8 14.6 8.1",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.2a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1.1 1-1.1 1.9M12 16.8v.01",
  close: "M6 6l12 12M18 6L6 18",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  trash: "M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6",
  check: "M5 13l4 4L19 7",
  warn: "M12 3l10 17H2zM12 10v4M12 17.5v.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8v.01",
  money: "M3 7h18v10H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  menu: "M4 7h16M4 12h16M4 17h16",
  city: "M4 21V9l5-3v15M9 21V6l6-3v18M15 21v-9l5-2v11M2 21h20",
  train:
    "M7 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM5 11h14M9.5 17l-2.5 3M14.5 17l2.5 3M9 14h.01M15 14h.01",
  pause: "M9 5v14M15 5v14",
  play: "M7 4.5v15l13-7.5z",
  undo: "M9 14l-4-4 4-4M5 10h9a5 5 0 0 1 0 10h-4",
};

export function icon(name: IconName, size = 18): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICON_PATHS[name]);
  if (name === "select") {
    svg.setAttribute("stroke-width", "1.6");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("stroke", "none");
  }
  svg.appendChild(path);
  return svg;
}

/* -------------------------------- 對話框 -------------------------------- */

export interface ModalAction {
  label: string;
  kind?: "primary" | "ghost" | "danger";
  closeAfter?: boolean;
  onClick?: () => void;
}

export interface ModalOptions {
  title: string;
  body: Child | Child[];
  actions: ModalAction[];
  /** 點擊背景或按 Esc 是否可關閉，預設 true。 */
  dismissible?: boolean;
  onClose?: () => void;
}

export function openModal(options: ModalOptions): { close: () => void } {
  const dismissible = options.dismissible !== false;
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "modal", attrs: { role: "dialog", "aria-modal": "true" } });

  const close = (): void => {
    if (!overlay.isConnected) {
      return;
    }
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown);
    options.onClose?.();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && dismissible) {
      event.stopPropagation();
      close();
    }
  };

  const actionsRow = el("div", { class: "modal-actions" });
  for (const action of options.actions) {
    const button = el("button", {
      class: `btn ${action.kind ?? "ghost"}`,
      text: action.label,
      onClick: () => {
        action.onClick?.();
        if (action.closeAfter !== false) {
          close();
        }
      },
    });
    actionsRow.appendChild(button);
  }

  const bodyChildren = Array.isArray(options.body) ? options.body : [options.body];
  modal.appendChild(el("div", { class: "modal-title", text: options.title }));
  const bodyNode = el("div", { class: "modal-body" });
  appendChildren(bodyNode, bodyChildren);
  modal.appendChild(bodyNode);
  modal.appendChild(actionsRow);
  overlay.appendChild(modal);

  if (dismissible) {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close();
      }
    });
  }
  document.addEventListener("keydown", onKeyDown);
  document.body.appendChild(overlay);

  const firstButton = actionsRow.querySelector("button");
  firstButton?.focus();

  return { close };
}
