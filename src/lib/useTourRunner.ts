"use client";

import { useCallback, useRef, useState } from "react";
import type { Localized } from "@/lib/grandTour";
import { fillTemplate, type DemoAction, type DemoValues } from "@/lib/tourDemo";
import {
  centreOf,
  findAnchorInRowContaining,
  findByText,
  findDirectAnchor,
  findOpenerFor,
  setNativeValue,
  spotlightContainerFor,
  type FoundAnchor,
} from "@/lib/tourDom";

/**
 * Sara's hands: runs a list of actions against the real page with a visible cursor.
 *
 * The rules that make this safe to point at a live clinic:
 *  - Every click is `element.click()` on the real control, so the app's own handler — with its
 *    own permission checks, confirmations and validation — is what runs. There is no back door.
 *  - Every keystroke goes through React's native value setter, so the field's own state updates
 *    and its own validation fires, exactly as if typed.
 *  - Anything the runner cannot find within a few seconds ends the script (or skips the step
 *    when it is marked optional). It never guesses at a different element.
 *  - One script at a time, abortable between steps. Leaving the tour mid-demo stops the hand
 *    where it is; nothing half-typed is submitted.
 *
 * `point` is the action that only looks: the hand rests on an element, the spotlight frames it
 * (or the card it sits in), Sara says her line, and nothing is clicked. A page walkthrough is a
 * list of these.
 */

export interface CursorState {
  x: number;
  y: number;
  visible: boolean;
  /** A click is landing right now — the ripple. */
  clicking: boolean;
  /** Keys are going in — the cursor holds still and the field is spotlit. */
  typing: boolean;
}

export interface RunnerState {
  running: boolean;
  /** The sub-line Sara is saying for the current step, if any. */
  say: Localized | null;
  /** The anchor the current step is acting on, for the spotlight (when it has one). */
  anchor: string | null;
  /** The element to spotlight — measured live by the overlay, so it follows scrolling. */
  target: HTMLElement | null;
  /** Set when a script ended early: what could not be found. */
  failedAnchor: string | null;
}

export type RunOutcome = "done" | "failed" | "aborted";

const MOVE_MS = 650;
const CLICK_HOLD_MS = 320;
const AFTER_CLICK_MS = 500;
const TYPE_MS_PER_CHAR = 45;
const FIND_TIMEOUT_MS = 8000;
const OPENER_TIMEOUT_MS = 3500;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

/** How long a person needs to read a line. Bounded so a long line never stalls the demo. */
export function readMsFor(text: string): number {
  return Math.min(8000, Math.max(1600, text.length * 38));
}

export function useTourRunner(opts: {
  isAr: boolean;
  /** Speaks a line and resolves when it has been said (immediately when voice is off). */
  speak: (text: string) => Promise<void>;
  /** Navigates the app. */
  navigate: (path: string) => void;
  /** The demo patient's id, looked up by name; null when there is none. */
  resolveDemoPatient: () => Promise<string | null>;
  /** Flags the demo patient so no automated message can ever reach its number. */
  markDemoPatient: () => Promise<boolean>;
}) {
  const { isAr, speak, navigate, resolveDemoPatient, markDemoPatient } = opts;

  const [cursor, setCursor] = useState<CursorState>({ x: -100, y: -100, visible: false, clicking: false, typing: false });
  const [state, setState] = useState<RunnerState>({ running: false, say: null, anchor: null, target: null, failedAnchor: null });
  const controller = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState((s) => ({ ...s, running: false, say: null, anchor: null, target: null }));
    setCursor((c) => ({ ...c, visible: false, clicking: false, typing: false }));
  }, []);

  const moveTo = useCallback(async (found: FoundAnchor, signal: AbortSignal) => {
    // Bring it on screen first, then measure again: the rect we found may be off the viewport.
    const r = found.el.getBoundingClientRect();
    if (r.top < 80 || r.bottom > window.innerHeight - 40 || r.left < 0 || r.right > window.innerWidth) {
      try {
        found.el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      } catch {
        /* ignore */
      }
      await sleep(500, signal);
    }
    const { x, y } = centreOf(found.el.getBoundingClientRect());
    setCursor((c) => ({ ...c, x, y, visible: true }));
    await sleep(MOVE_MS, signal);
  }, []);

  const waitFor = useCallback(
    async (finder: () => FoundAnchor | null, timeoutMs: number, signal: AbortSignal): Promise<FoundAnchor | null> => {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        if (signal.aborted) return null;
        const found = finder();
        if (found) return found;
        await sleep(150, signal);
      }
      return null;
    },
    [],
  );

  /**
   * The anchor, on screen — opening whatever hides it first. Returns null when it never
   * appeared, which the caller treats as the end of the script (or a skipped optional step).
   */
  const reach = useCallback(
    async (anchor: string, rowText: string | undefined, signal: AbortSignal, timeoutMs = FIND_TIMEOUT_MS): Promise<FoundAnchor | null> => {
      const find = () => (rowText ? findAnchorInRowContaining(anchor, rowText) : findDirectAnchor(anchor));
      let found = await waitFor(find, Math.min(600, timeoutMs), signal);
      if (found) return found;

      const opener = findOpenerFor(anchor);
      if (opener) {
        await moveTo(opener, signal);
        setCursor((c) => ({ ...c, clicking: true }));
        opener.el.click();
        await sleep(CLICK_HOLD_MS, signal);
        setCursor((c) => ({ ...c, clicking: false }));
        found = await waitFor(find, OPENER_TIMEOUT_MS, signal);
        if (found) return found;
      }
      return waitFor(find, timeoutMs, signal);
    },
    [moveTo, waitFor],
  );

  const sayLine = useCallback(
    async (text: Localized, signal: AbortSignal) => {
      setState((s) => ({ ...s, say: text }));
      const line = isAr ? text.ar : text.en;
      // Reading time and speaking time run together; whichever is longer sets the pace.
      await Promise.all([sleep(readMsFor(line), signal), speak(line)]);
    },
    [isAr, speak],
  );

  const run = useCallback(
    async (actions: DemoAction[], values: DemoValues): Promise<RunOutcome> => {
      controller.current?.abort();
      const ctl = new AbortController();
      controller.current = ctl;
      const { signal } = ctl;
      setState({ running: true, say: null, anchor: null, target: null, failedAnchor: null });

      const fail = (anchor: string): RunOutcome => {
        setState({ running: false, say: null, anchor: null, target: null, failedAnchor: anchor });
        setCursor((c) => ({ ...c, visible: false, clicking: false, typing: false }));
        return "failed";
      };

      try {
        for (const action of actions) {
          if (signal.aborted) return "aborted";

          if (action.kind === "pause") {
            await sleep(action.ms, signal);
            continue;
          }

          if (action.kind === "say") {
            await sayLine(action.text, signal);
            continue;
          }

          if (action.kind === "wait") {
            setState((s) => ({ ...s, anchor: action.anchor }));
            const found = await waitFor(() => findDirectAnchor(action.anchor), action.timeoutMs ?? FIND_TIMEOUT_MS, signal);
            if (!found && !action.optional) return fail(action.anchor);
            continue;
          }

          if (action.kind === "waitGone") {
            const rowText = action.inRowContaining ? fillTemplate(action.inRowContaining, values) : undefined;
            const find = () => (rowText ? findAnchorInRowContaining(action.anchor, rowText) : findDirectAnchor(action.anchor));
            const until = Date.now() + (action.timeoutMs ?? FIND_TIMEOUT_MS);
            let gone = false;
            while (Date.now() < until) {
              if (signal.aborted) return "aborted";
              if (!find()) {
                gone = true;
                break;
              }
              await sleep(200, signal);
            }
            if (!gone && !action.optional) return fail(action.anchor);
            continue;
          }

          if (action.kind === "markDemoPatient") {
            if (action.say) void sayLine(action.say, signal);
            let ok = false;
            for (let attempt = 0; attempt < 6 && !ok; attempt++) {
              if (signal.aborted) return "aborted";
              ok = await markDemoPatient();
              if (!ok) await sleep(700, signal);
            }
            if (!ok) return fail("demo-patient");
            continue;
          }

          if (action.kind === "route") {
            if (action.say) void sayLine(action.say, signal);
            navigate(action.path);
            setState((s) => ({ ...s, anchor: "page-main", target: null }));
            await sleep(900, signal);
            continue;
          }

          if (action.kind === "openDemoPatient") {
            if (action.say) void sayLine(action.say, signal);
            const id = await resolveDemoPatient();
            if (!id) return fail("demo-patient");
            navigate(`/patients/${id}${action.tab ? `?tab=${action.tab}` : ""}`);
            setState((s) => ({ ...s, anchor: "page-main", target: null }));
            const landed = await waitFor(() => findDirectAnchor("patient-tab-clinical"), FIND_TIMEOUT_MS, signal);
            if (!landed) return fail("patient-file");
            await sleep(600, signal);
            continue;
          }

          if (action.kind === "point") {
            // By anchor, or by what it says on screen. Text is matched in the tour's language.
            const label = action.text ? (isAr ? action.text.ar : action.text.en) : "";
            const find = () =>
              action.anchor
                ? findDirectAnchor(action.anchor)
                : label
                  ? findByText(label, action.match ?? "contains")
                  : null;
            const found = await waitFor(find, action.timeoutMs ?? 3000, signal);
            if (signal.aborted) return "aborted";
            if (!found) {
              if (action.optional !== false) continue; // pointing is optional by default
              return fail(action.anchor ?? label);
            }
            const box = spotlightContainerFor(found.el, action.container ?? "card");
            setState((s) => ({ ...s, anchor: action.anchor ?? null, target: box }));
            await moveTo(found, signal);
            await sayLine(action.say, signal);
            continue;
          }

          // click / type
          setState((s) => ({ ...s, anchor: action.anchor }));
          const rowText = action.kind === "click" && action.inRowContaining ? fillTemplate(action.inRowContaining, values) : undefined;
          const found = await reach(action.anchor, rowText, signal, action.kind === "click" ? action.timeoutMs : undefined);
          if (signal.aborted) return "aborted";
          if (!found) {
            if (action.optional) continue;
            return fail(action.anchor);
          }
          setState((s) => ({ ...s, target: found.el }));

          // Narrate the step while the cursor travels — the words and the movement are one act.
          const said = action.say ? sayLine(action.say, signal) : Promise.resolve();
          await moveTo(found, signal);

          if (action.kind === "click") {
            setCursor((c) => ({ ...c, clicking: true }));
            found.el.click();
            await sleep(CLICK_HOLD_MS, signal);
            setCursor((c) => ({ ...c, clicking: false }));
            await said;
            await sleep(AFTER_CLICK_MS, signal);
          } else {
            const el = found.el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
            const text = fillTemplate(action.text, values);
            setCursor((c) => ({ ...c, typing: true }));
            try {
              el.focus();
            } catch {
              /* ignore */
            }
            if (el instanceof HTMLSelectElement) {
              setNativeValue(el, text);
            } else {
              for (let i = 1; i <= text.length; i++) {
                if (signal.aborted) return "aborted";
                setNativeValue(el, text.slice(0, i));
                await sleep(TYPE_MS_PER_CHAR, signal);
              }
            }
            setCursor((c) => ({ ...c, typing: false }));
            await said;
            await sleep(350, signal);
          }
        }
        setState({ running: false, say: null, anchor: null, target: null, failedAnchor: null });
        setCursor((c) => ({ ...c, visible: false, clicking: false, typing: false }));
        return signal.aborted ? "aborted" : "done";
      } finally {
        if (controller.current === ctl) controller.current = null;
      }
    },
    [sayLine, waitFor, reach, moveTo, navigate, resolveDemoPatient, markDemoPatient, isAr],
  );

  return { cursor, state, run, abort };
}
