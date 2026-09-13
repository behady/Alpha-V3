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

/** A phone-sized viewport, where Sara's panel covers the lower half of the screen. */
export function isPhoneViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < 640;
}

/**
 * The app's own navigation breakpoint (Tailwind `lg`): below it there is no black bar with
 * menus and no Settings gear — a bottom bar and a Menu sheet instead. Stops that describe the
 * bar carry a phone variant, chosen with this.
 */
export const PHONE_NAV_QUERY = "(max-width: 1023px)";
export function usesPhoneNav(): boolean {
  return typeof window !== "undefined" && window.matchMedia(PHONE_NAV_QUERY).matches;
}

/**
 * Whether an element is already comfortably on screen for the tour: below the top bar, and on a
 * phone above the panel that sits over the lower half.
 */
export function isRevealed(rect: DOMRect): boolean {
  if (typeof window === "undefined") return true;
  const bottomLimit = isPhoneViewport() ? window.innerHeight * 0.5 : window.innerHeight - 40;
  return rect.top >= 80 && rect.bottom <= bottomLimit && rect.left >= 0 && rect.right <= window.innerWidth;
}

/**
 * Scrolls an element into the place the tour can show it. Desktop: the middle of the viewport.
 * Phone: the upper third, because the panel takes the lower half — `block: "center"` there
 * lands the target exactly under Sara. `scroll-margin-top` keeps this correct inside nested
 * scrollers, which a plain scrollBy on the window would not be.
 */
export function revealForTour(el: HTMLElement): void {
  try {
    if (isPhoneViewport()) {
      const previous = el.style.scrollMarginTop;
      el.style.scrollMarginTop = `${Math.round(window.innerHeight * 0.18)}px`;
      el.scrollIntoView({ block: "start", inline: "nearest", behavior: "smooth" });
      window.setTimeout(() => {
        el.style.scrollMarginTop = previous;
      }, 900);
    } else {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }
  } catch {
    /* ignore */
  }
}

/** Where to point a cursor at an element: its centre, in viewport pixels. */
export function centreOf(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Whitespace-collapsed, lower-cased, so "TRUE  NET" and "true net" are the same label. */
function norm(text: string): string {
  return (text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

const TEXT_TAGS = "h1,h2,h3,h4,p,span,button,a,th,td,label,dt,dd,legend,summary,div";

/**
 * The first visible element that SAYS this on screen.
 *
 * Only elements whose own text is short (a label, a heading, a button) are candidates — a
 * container that merely contains the words somewhere in a paragraph is not "the label". The
 * smallest matching element wins, so a `<span>` inside a button beats the button, and the
 * button beats the card. Matching is case-insensitive; `exact` needs the whole label.
 */
export function findByText(text: string, match: "exact" | "contains" = "contains"): FoundAnchor | null {
  const needle = norm(text);
  if (!needle) return null;
  let best: FoundAnchor | null = null;
  let bestLen = Infinity;
  const els = document.querySelectorAll<HTMLElement>(TEXT_TAGS);
  for (const el of els) {
    const own = norm(el.innerText || el.textContent || "");
    if (!own || own.length > 120) continue;
    if (match === "exact" ? own !== needle : !own.includes(needle)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 && rect.height < 2) continue;
    // Skip anything inside the tour's own chrome.
    if (el.closest("[data-tour-chrome]")) continue;
    if (own.length < bestLen) {
      best = { el, rect };
      bestLen = own.length;
    }
  }
  return best;
}

/**
 * What to frame when pointing at an element.
 *
 * "self" is the element; "card" walks up to the nearest rounded, bordered or tinted box (the
 * card a label sits in) but never past a third of the viewport, so a stat label lights its
 * whole stat card and a table header lights just itself; "row" is the nearest table row or
 * list item.
 */
export function spotlightContainerFor(el: HTMLElement, container: "self" | "card" | "row"): HTMLElement {
  if (container === "self") return el;
  if (container === "row") return (el.closest("tr, li, [role=row]") as HTMLElement | null) ?? el;
  const maxArea = window.innerWidth * window.innerHeight * 0.34;
  let node: HTMLElement | null = el;
  let best = el;
  for (let depth = 0; node && depth < 6; depth++) {
    const cls = node.className && typeof node.className === "string" ? node.className : "";
    const r = node.getBoundingClientRect();
    if (r.width * r.height > maxArea) break;
    if (/rounded-|border|shadow|bg-surface|bg-white|bg-ink|bg-slate|bg-\[/.test(cls) && r.height >= el.getBoundingClientRect().height) {
      best = node;
    }
    node = node.parentElement;
  }
  return best;
}
