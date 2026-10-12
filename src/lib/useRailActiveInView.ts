"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keep the selected item of a horizontal rail (tabs, staff strip, report sub-tabs) in view.
 *
 * On a phone these rails scroll sideways, and after a reload or a deep link (`?tab=settings`,
 * `?report=…`) the selected item could sit off the edge with nothing saying it was there.
 *
 * Only the rail's own `scrollLeft` is moved — never `scrollIntoView`, which also scrolls every
 * ancestor vertically and would jump the page. Rect deltas make it direction-agnostic: adding to
 * `scrollLeft` always moves the view rightward, in LTR and RTL alike.
 *
 * Does nothing when the rail does not overflow (desktop columns, phone grids).
 */
export function useRailActiveInView(
  /**
   * A ref, or the element itself. Pass the element (kept in state by a callback ref) when the rail
   * can mount AFTER the hook first runs — behind a permission or feature gate — because a ref that
   * fills in later never re-runs an effect, and the rail would never be revealed.
   */
  railRef: RefObject<HTMLElement | null> | HTMLElement | null,
  activeKey: unknown,
  selector = '[aria-selected="true"]',
) {
  useEffect(() => {
    const rail = railRef && "current" in railRef ? railRef.current : railRef;
    if (!rail) return;
    const reveal = () => {
      if (rail.scrollWidth <= rail.clientWidth + 1) return;
      const item = rail.querySelector<HTMLElement>(selector);
      if (!item) return;
      const r = rail.getBoundingClientRect();
      const i = item.getBoundingClientRect();
      const pad = 12;
      if (i.left < r.left + pad) rail.scrollLeft -= r.left + pad - i.left;
      else if (i.right > r.right - pad) rail.scrollLeft += i.right - (r.right - pad);
    };
    // Now (layout is readable inside an effect), and once more after late layout — web fonts,
    // avatars — has settled. Not requestAnimationFrame: it never fires in a background tab.
    reveal();
    const late = window.setTimeout(reveal, 300);
    return () => window.clearTimeout(late);
  }, [railRef, activeKey, selector]);
}
