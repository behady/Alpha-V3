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
