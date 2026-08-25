import type { TrebolSelectedElement } from "./agent/types";

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function uniqueSelector(selector: string, documentRef: Document): boolean {
  try {
    return documentRef.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

export function stableElementSelector(element: HTMLElement, documentRef = document): string {
  if (element.id) {
    const selector = `#${cssEscape(element.id)}`;
    if (uniqueSelector(selector, documentRef)) return selector;
  }

  for (const attribute of ["data-trebol-id", "data-testid", "aria-label"] as const) {
    const value = element.getAttribute(attribute)?.trim();
    if (!value) continue;
    const selector = `[${attribute}="${cssEscape(value)}"]`;
    if (uniqueSelector(selector, documentRef)) return selector;
  }

  const parts: string[] = [];
  let current: HTMLElement | null = element;
  while (current && current !== documentRef.body && parts.length < 6) {
    const tag = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((child) => child.tagName === current?.tagName)
      : [];
    const index = siblings.indexOf(current);
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index + 1})` : tag);
    const selector = parts.join(" > ");
    if (uniqueSelector(selector, documentRef)) return selector;
    current = current.parentElement;
  }
  return parts.join(" > ") || element.tagName.toLowerCase();
}

export function canSelectTrebolElement(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("[data-trebol-ui]")) return false;
  if (target.closest("input, textarea, select, option, [contenteditable='true']")) return false;
  return true;
}

export function describeTrebolElement(element: HTMLElement, documentRef = document): TrebolSelectedElement {
  const rect = element.getBoundingClientRect();
  const text = element.innerText?.replace(/\s+/g, " ").trim().slice(0, 300) || undefined;
  const componentHint = element.dataset.component
    ?? element.getAttribute("data-component")
    ?? Array.from(element.classList).find((item) => /^[A-Z]|component|card|panel/i.test(item));
  return {
    selector: stableElementSelector(element, documentRef),
    tag: element.tagName.toLowerCase(),
    text,
    ariaLabel: element.getAttribute("aria-label")?.slice(0, 200) || undefined,
    componentHint: componentHint?.slice(0, 120),
    boundingRect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    },
  };
}
