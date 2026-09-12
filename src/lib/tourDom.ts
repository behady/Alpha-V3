// src/lib/tourDom.ts
"use client";

/**
 * Finding the thing on screen that a `data-tour` name refers to.
 *
 * Shared by the lesson overlay (the pulsing ring) and Sara's tour (the spotlight), which must
 * agree on what "visible" means — the DOM they point into has the same traps for both:
 *
 *  - The mobile bottom bar and the top bar are both permanently in the DOM with CSS hiding one,
 *    so the same `nav-*` value appears on several elements. `display:none` collapses the rect to
 *    0×0, so "has a real rect" is the visibility test — it also naturally picks "any patient card"
 *    for repeated anchors.
 *  - A destination inside a closed dropdown is not in the DOM until the menu opens. An element
 *    that CONTAINS the anchor once opened advertises it with `data-tour-opens="a b c"`, and the
 *    ring or spotlight lands on that instead.
 */

export interface FoundAnchor {
  el: HTMLElement;
  rect: DOMRect;
}

function pick(selector: string): FoundAnchor | null {
  const els = document.querySelectorAll<HTMLElement>(selector);
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    if (rect.width >= 2 || rect.height >= 2) return { el, rect };
  }
  return null;
}

/** First VISIBLE element carrying the anchor, else the visible element that opens onto it. */
export function findVisibleAnchor(anchor: string): FoundAnchor | null {
  const direct = pick(`[data-tour="${anchor}"]`);
  if (direct) return direct;
  return pick(`[data-tour-opens~="${anchor}"]`);
}

/** The first of several anchors that is on screen, in the order given. */
export function findFirstVisibleAnchor(anchors: readonly string[]): FoundAnchor | null {
  for (const anchor of anchors) {
    const found = findVisibleAnchor(anchor);
    if (found) return found;
  }
  return null;
}

/** The anchor itself, on screen — never the opener. */
export function findDirectAnchor(anchor: string): FoundAnchor | null {
  return pick(`[data-tour="${anchor}"]`);
}

/** The element that opens onto the anchor, if any is on screen. */
export function findOpenerFor(anchor: string): FoundAnchor | null {
  return pick(`[data-tour-opens~="${anchor}"]`);
}

/**
 * The visible anchor whose own row mentions `text` — "the delete button on the row I just added".
 *
 * A row is the nearest ancestor that mentions the text AND holds exactly one element carrying
 * the anchor. Without the second condition the walk reaches the list's container, which mentions
 * every row's text, and the FIRST button in the list matches — which is how a cleanup once
 * reached for the wrong treatment.
 */
export function findAnchorInRowContaining(anchor: string, text: string): FoundAnchor | null {
  const needle = text.trim().toLowerCase();
  if (!needle) return null;
  const selector = `[data-tour="${anchor}"]`;
  const els = document.querySelectorAll<HTMLElement>(selector);
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 && rect.height < 2) continue;
    let node: HTMLElement | null = el.parentElement;
    for (let depth = 0; node && depth < 8; depth++) {
      if (node.querySelectorAll(selector).length > 1) break; // past the row: this holds siblings too
      if ((node.innerText || "").toLowerCase().includes(needle)) return { el, rect };
      node = node.parentElement;
    }
  }
  return null;
}

/**
 * Sets a React-controlled input's value so React sees it.
 *
 * Assigning `el.value` directly is swallowed: React tracks the value through the native setter
 * and ignores an `input` event whose value it thinks it already set. Calling the prototype's
 * setter, then dispatching `input`, is the documented way round it.
 */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

/** Where to point a cursor at an element: its centre, in viewport pixels. */
export function centreOf(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
