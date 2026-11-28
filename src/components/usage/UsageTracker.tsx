"use client";

import { useEffect, useRef } from "react";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { effectiveHomeView } from "@/lib/homeView";
import { BEAT_EVERY_MS, IDLE_AFTER_MS, linkTargetFor, pageKeyFor, targetKey, type UsageBeat } from "@/lib/usage";

/**
 * Counts, in the browser, how long each screen is actually used and what is pressed on it, and
 * sends the totals to /api/usage/beat about once a minute. Draws nothing.
 *
 * See lib/usage for what is and is not kept. The rules this file must not break:
 *
 * - SILENT. Every failure is swallowed. A clinic must never see an error, a spinner or a slow
 *   page because a counter could not be saved.
 * - NO PATIENT DATA. A press is named only from `data-track` / `data-tour`, a tab's own label, or
 *   a link's route with ids removed. Never the text of an ordinary button or a table row.
 * - CHEAP. One 5-second timer and three passive listeners for the whole app; one small request a
 *   minute, and none at all while nobody is touching the screen.
 */

const TICK_MS = 5000;

type Acc = UsageBeat;

function emptyAcc(): Acc {
  return { pages: {}, hits: {} };
}

/** The fixed name of what was pressed, or null when it has none we may keep. */
function nameOf(target: EventTarget | null): string | null {
  const el = target instanceof Element ? target : null;
  if (!el) return null;
  const named = el.closest("[data-track],[data-tour]");
  if (named) {
    const name = named.getAttribute("data-track") || named.getAttribute("data-tour") || "";
    return targetKey(name) || null;
  }
  const tab = el.closest('[role="tab"]');
  if (tab) {
    // Digits out: a row of day chips ("Today 28", "Sun 29") is one control, not thirty.
    const label = (tab.getAttribute("aria-label") || tab.getAttribute("title") || tab.textContent || "")
      .split("—")[0]
      .replace(/[\d٠-٩]+/g, "");
    const key = targetKey(`tab:${label}`);
    return key.length > 4 ? key : null;
  }
  const link = el.closest("a[href]");
  if (link) return linkTargetFor(link.getAttribute("href"));
  return null;
}

export default function UsageTracker() {
  const { user } = useAuth();
  const { clinicId, role } = useClinic();
  const { homeView, homeViewChosen } = useUI();

  // Read by the timer, which must not be torn down and rebuilt on every render.
  const live = useRef({ clinicId: "", view: "desk", enabled: false });
  live.current = {
    clinicId: clinicId || "",
    view: effectiveHomeView(homeView, homeViewChosen, role),
    // A superadmin looking into a clinic they hold no role in is support, not use.
    enabled: !!user && !!clinicId && !!user.clinicRoles?.[clinicId],
  };

  useEffect(() => {
    let acc = emptyAcc();
    let lastKey = "";
    let lastTouch = Date.now();
    let lastTick = Date.now();
    let lastBeat = Date.now();
    let sending = false;

    const currentKey = () => {
      const tab = new URLSearchParams(window.location.search).get("tab");
      return pageKeyFor(window.location.pathname, { homeView: live.current.view, tab });
    };

    const page = (key: string) => (acc.pages[key] = acc.pages[key] || { sec: 0, opens: 0, taps: 0, phoneSec: 0 });

    const send = async () => {
      if (sending) return;
      const clinic = live.current.clinicId;
      if (!live.current.enabled || !clinic || Object.keys(acc.pages).length === 0) {
        acc = emptyAcc();
        return;
      }
      const batch = acc;
      acc = emptyAcc();
      lastBeat = Date.now();
      sending = true;
      try {
        const token = await auth.currentUser?.getIdToken();
        if (token) {
          await fetch("/api/usage/beat", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ clinicId: clinic, pages: batch.pages, hits: batch.hits }),
            keepalive: true,
          });
        }
      } catch {
        /* A lost minute of counting is not worth anything the clinic could notice. */
      } finally {
        sending = false;
      }
    };

    const tick = () => {
      const now = Date.now();
      // Capped: a laptop that slept reports one huge gap, which is not use.
      const elapsed = Math.min(now - lastTick, TICK_MS * 2);
      lastTick = now;
      if (!live.current.enabled) return;

      const key = currentKey();
      if (key !== lastKey) {
        lastKey = key;
        page(key).opens += 1;
      }
      const active = document.visibilityState === "visible" && now - lastTouch < IDLE_AFTER_MS;
      if (active) {
        const p = page(key);
        const sec = elapsed / 1000;
        p.sec += sec;
        if (window.innerWidth < 1024) p.phoneSec += sec;
      }
      if (now - lastBeat >= BEAT_EVERY_MS) void send();
    };

    const touched = () => {
      lastTouch = Date.now();
    };

    const clicked = (e: MouseEvent) => {
      lastTouch = Date.now();
      if (!live.current.enabled) return;
      try {
        const key = currentKey();
        if (key !== lastKey) {
          lastKey = key;
          page(key).opens += 1;
        }
        page(key).taps += 1;
        const name = nameOf(e.target);
        if (name) {
          const hits = (acc.hits[key] = acc.hits[key] || {});
          if (name in hits || Object.keys(hits).length < 40) hits[name] = (hits[name] || 0) + 1;
        }
      } catch {
        /* never let counting break a click */
      }
    };

    const hidden = () => {
      if (document.visibilityState === "hidden") void send();
    };

    const timer = window.setInterval(tick, TICK_MS);
    window.addEventListener("click", clicked, { capture: true, passive: true });
    window.addEventListener("keydown", touched, { passive: true });
    window.addEventListener("scroll", touched, { capture: true, passive: true });
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", send);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("click", clicked, { capture: true });
      window.removeEventListener("keydown", touched);
      window.removeEventListener("scroll", touched, { capture: true });
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", send);
      void send();
    };
  }, []);

  return null;
}
