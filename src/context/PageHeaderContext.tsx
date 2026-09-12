"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * The plumbing behind the dark header strip.
 *
 * The strip lives in the dashboard layout, but the words in it belong to the page — a page knows
 * its own title, and more importantly it owns the buttons ("New patient", "Export") along with the
 * state and handlers behind them. Lifting those into the layout would mean the layout importing
 * every page's modals.
 *
 * So the layout renders an empty slot and each page portals a <PageHeader> into it. The handlers
 * stay in the page's own React tree; only the DOM node moves. Nothing is serialised through
 * context except two primitives, which is deliberate: putting React nodes in context state and
 * setting them from an effect is the classic way to build an infinite render loop.
 */

interface PageHeaderCtx {
  /** The element in the layout's dark strip that <PageHeader> portals into. */
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
  /** How many <PageHeader>s are mounted. Zero means the layout shows its route-name fallback. */
  count: number;
  /** True when the mounted header asked for the slim one-line strip. */
  compact: boolean;
  register: (compact: boolean) => void;
  unregister: (compact: boolean) => void;
}

const Ctx = createContext<PageHeaderCtx | null>(null);

export function PageHeaderProvider({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [count, setCount] = useState(0);
  const [compactCount, setCompactCount] = useState(0);

  const register = useCallback((compact: boolean) => {
    setCount((n) => n + 1);
    if (compact) setCompactCount((n) => n + 1);
  }, []);

  const unregister = useCallback((compact: boolean) => {
    setCount((n) => Math.max(0, n - 1));
    if (compact) setCompactCount((n) => Math.max(0, n - 1));
  }, []);

  const value = useMemo(
    () => ({ slot, setSlot, count, compact: compactCount > 0, register, unregister }),
    [slot, count, compactCount, register, unregister]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Returns null rather than throwing when there is no provider above it. Pages are also rendered
 * outside the dashboard layout in places (the print views, and tests), and a header that quietly
 * renders nothing there is better than a page that crashes.
 */
export function usePageHeaderSlot() {
  return useContext(Ctx);
}
