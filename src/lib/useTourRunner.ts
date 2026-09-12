"use client";

import { useCallback, useRef, useState } from "react";
import type { Localized } from "@/lib/grandTour";
import { fillTemplate, type DemoAction, type DemoValues, type TourCheck, type TourOffer } from "@/lib/tourDemo";
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
 *  - One script at a time, abortable between steps and resumable from where it stopped: when
 *    the person clicks something themselves the hand stops, and "Continue" picks up at the same
 *    action.
 *
 * Pacing: in "auto" the hand moves on after each line has been read; in "step" it waits for the
 * person to press Next after every line. The gate is a promise the overlay resolves.
 */

export interface CursorState {
  x: number;
  y: number;
  visible: boolean;
  clicking: boolean;
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
  /** Waiting for the person to press Next (step pacing). */
  waitingForNext: boolean;
  /** An offer is on screen waiting for yes/no. */
  pendingOffer: TourOffer | null;
}

export type RunOutcome = "done" | "failed" | "aborted";
export interface RunResult {
  outcome: RunOutcome;
  /** The action the script stopped on — where a resume starts. */
  index: number;
}

export type Pace = "auto" | "step";

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

/** The editable control inside (or being) an element: a wrapper anchor still gets typed into. */
function editableIn(el: HTMLElement): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return el;
  return el.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
}

const INTERACTIVE = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY"]);

/**
 * What a click on an anchor should land on. An anchor is often a wrapper `<div>` around the
 * real button (a drug row, a list row with one action), and a synthetic click on the wrapper
 * never reaches the button inside it. When the wrapper is not itself clickable — no native
 * control, no React onClick of its own — its first button or link is clicked instead (a row's
 * main action comes first in the markup). A wrapper with its own handler (a patient row) is
 * clicked as it is.
 */
export function clickTarget(el: HTMLElement): HTMLElement {
  if (INTERACTIVE.has(el.tagName) || el.getAttribute("role") === "button") return el;
  const propsKey = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  const props = propsKey ? ((el as unknown as Record<string, { onClick?: unknown }>)[propsKey] ?? {}) : {};
  if (typeof props.onClick === "function") return el;
  return el.querySelector<HTMLElement>('button, a[href], [role="button"]') ?? el;
}

export function useTourRunner(opts: {
  isAr: boolean;
  speak: (text: string) => Promise<void>;
  navigate: (path: string) => void;
  resolveDemoPatient: () => Promise<string | null>;
  markDemoPatient: () => Promise<boolean>;
  /** Answers an `if` check. */
  check: (name: TourCheck) => Promise<boolean>;
  /** Shows an offer and resolves with the person's answer. */
  askOffer: (offer: TourOffer, say: Localized) => Promise<boolean>;
  /** Performs an accepted offer (writes the wizard's documents). */
  applyOffer: (offer: TourOffer) => Promise<boolean>;
  /** Switches the home screen. */
  setHomeView: (view: "desk" | "owner" | "chair") => void;
  /** Current pacing. Read at every step, so switching mid-walk takes effect at once. */
  getPace: () => Pace;
}) {
  const { isAr, speak, navigate, resolveDemoPatient, markDemoPatient, check, askOffer, applyOffer, setHomeView, getPace } = opts;

  const [cursor, setCursor] = useState<CursorState>({ x: -100, y: -100, visible: false, clicking: false, typing: false });
  const [state, setState] = useState<RunnerState>({
    running: false, say: null, anchor: null, target: null, failedAnchor: null, waitingForNext: false, pendingOffer: null,
  });
  const controller = useRef<AbortController | null>(null);
  /** Resolves the step gate. */
  const nextResolver = useRef<(() => void) | null>(null);

  const abort = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    nextResolver.current?.();
    nextResolver.current = null;
    setState((s) => ({ ...s, running: false, say: null, anchor: null, target: null, waitingForNext: false, pendingOffer: null }));
    setCursor((c) => ({ ...c, visible: false, clicking: false, typing: false }));
  }, []);

  /** The person pressed Next while the hand was waiting. */
  const pressNext = useCallback(() => {
    nextResolver.current?.();
    nextResolver.current = null;
  }, []);

  /** In step pacing, hold here until Next. Aborting releases it. */
  const gate = useCallback(
    async (signal: AbortSignal) => {
      if (getPace() !== "step" || signal.aborted) return;
      setState((s) => ({ ...s, waitingForNext: true }));
      await new Promise<void>((resolve) => {
        nextResolver.current = resolve;
        signal.addEventListener("abort", () => resolve());
      });
      setState((s) => ({ ...s, waitingForNext: false }));
    },
    [getPace],
  );

  const moveTo = useCallback(async (found: FoundAnchor, signal: AbortSignal) => {
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
      await Promise.all([sleep(readMsFor(line), signal), speak(line)]);
    },
    [isAr, speak],
  );

  const clickEl = useCallback(async (el: HTMLElement, signal: AbortSignal) => {
    setCursor((c) => ({ ...c, clicking: true }));
    clickTarget(el).click();
    await sleep(CLICK_HOLD_MS, signal);
    setCursor((c) => ({ ...c, clicking: false }));
  }, []);

  const run = useCallback(
    async (actions: DemoAction[], values: DemoValues, from = 0): Promise<RunResult> => {
      controller.current?.abort();
      const ctl = new AbortController();
      controller.current = ctl;
      const { signal } = ctl;
      setState({ running: true, say: null, anchor: null, target: null, failedAnchor: null, waitingForNext: false, pendingOffer: null });

      const finish = (outcome: RunOutcome, index: number, failedAnchor: string | null = null): RunResult => {
        setState({ running: false, say: null, anchor: null, target: null, failedAnchor, waitingForNext: false, pendingOffer: null });
        setCursor((c) => ({ ...c, visible: false, clicking: false, typing: false }));
        return { outcome, index };
      };

      /** Runs a nested list (an `if` / `offer` body); false = failed. */
      const runList = async (list: DemoAction[]): Promise<{ ok: boolean; failed?: string; aborted?: boolean }> => {
        for (const a of list) {
          const r = await step(a);
          if (r.aborted) return { ok: false, aborted: true };
          if (!r.ok) return r;
        }
        return { ok: true };
      };

      const step = async (action: DemoAction): Promise<{ ok: boolean; failed?: string; aborted?: boolean }> => {
        if (signal.aborted) return { ok: false, aborted: true };

        switch (action.kind) {
          case "pause":
            await sleep(action.ms, signal);
            return { ok: true };

          case "say":
            await sayLine(action.text, signal);
            await gate(signal);
            return { ok: true };

          case "wait": {
            setState((s) => ({ ...s, anchor: action.anchor }));
            const found = await waitFor(() => findDirectAnchor(action.anchor), action.timeoutMs ?? FIND_TIMEOUT_MS, signal);
            if (!found && !action.optional) return { ok: false, failed: action.anchor };
            return { ok: true };
          }

          case "waitGone": {
            const rowText = action.inRowContaining ? fillTemplate(action.inRowContaining, values) : undefined;
            const find = () => (rowText ? findAnchorInRowContaining(action.anchor, rowText) : findDirectAnchor(action.anchor));
            const until = Date.now() + (action.timeoutMs ?? FIND_TIMEOUT_MS);
            let gone = false;
            while (Date.now() < until) {
              if (signal.aborted) return { ok: false, aborted: true };
              if (!find()) {
                gone = true;
                break;
              }
              await sleep(200, signal);
            }
            if (!gone && !action.optional) return { ok: false, failed: action.anchor };
            return { ok: true };
          }

          case "markDemoPatient": {
            if (action.say) void sayLine(action.say, signal);
            let ok = false;
            for (let attempt = 0; attempt < 6 && !ok; attempt++) {
              if (signal.aborted) return { ok: false, aborted: true };
              ok = await markDemoPatient();
              if (!ok) await sleep(700, signal);
            }
            return ok ? { ok: true } : { ok: false, failed: "demo-patient" };
          }

          case "route":
            if (action.say) void sayLine(action.say, signal);
            navigate(action.path);
            setState((s) => ({ ...s, anchor: "page-main", target: null }));
            await sleep(900, signal);
            return { ok: true };

          case "openDemoPatient": {
            if (action.say) void sayLine(action.say, signal);
            const id = await resolveDemoPatient();
            if (!id) return { ok: false, failed: "demo-patient" };
            navigate(`/patients/${id}${action.tab ? `?tab=${action.tab}` : ""}`);
            setState((s) => ({ ...s, anchor: "page-main", target: null }));
            const landed = await waitFor(() => findDirectAnchor("patient-tab-clinical"), FIND_TIMEOUT_MS, signal);
            if (!landed) return { ok: false, failed: "patient-file" };
            await sleep(600, signal);
            return { ok: true };
          }

          case "homeView":
            setHomeView(action.view);
            if (action.say) await sayLine(action.say, signal);
            else await sleep(600, signal);
            return { ok: true };

          case "if": {
            const value = await check(action.check);
            if (signal.aborted) return { ok: false, aborted: true };
            if (value !== (action.is ?? true)) return { ok: true };
            return runList(action.then);
          }

          case "offer": {
            setState((s) => ({ ...s, pendingOffer: action.offer, say: action.say }));
            const yes = await askOffer(action.offer, action.say);
            setState((s) => ({ ...s, pendingOffer: null }));
            if (signal.aborted) return { ok: false, aborted: true };
            if (!yes) return { ok: true };
            const applied = await applyOffer(action.offer);
            if (!applied) return { ok: false, failed: action.offer };
            return action.then ? runList(action.then) : { ok: true };
          }

          case "point": {
            const label = action.text ? (isAr ? action.text.ar : action.text.en) : "";
            const find = () =>
              action.anchor ? findDirectAnchor(action.anchor) : label ? findByText(label, action.match ?? "contains") : null;
            const found = await waitFor(find, action.timeoutMs ?? 3000, signal);
            if (signal.aborted) return { ok: false, aborted: true };
            if (!found) {
              if (action.optional !== false) return { ok: true };
              return { ok: false, failed: action.anchor ?? label };
            }
            const box = spotlightContainerFor(found.el, action.container ?? "card");
            setState((s) => ({ ...s, anchor: action.anchor ?? null, target: box }));
            await moveTo(found, signal);
            await sayLine(action.say, signal);
            await gate(signal);
            return { ok: true };
          }

          case "selectFirst": {
            setState((s) => ({ ...s, anchor: action.anchor }));
            const found = await reach(action.anchor, undefined, signal);
            if (signal.aborted) return { ok: false, aborted: true };
            if (!found) return action.optional ? { ok: true } : { ok: false, failed: action.anchor };
            const sel = editableIn(found.el);
            setState((s) => ({ ...s, target: found.el }));
            const said = action.say ? sayLine(action.say, signal) : Promise.resolve();
            await moveTo(found, signal);
            if (sel instanceof HTMLSelectElement) {
              const opt = Array.from(sel.options).find((o) => o.value && !o.disabled);
              if (opt) setNativeValue(sel, opt.value);
            }
            await said;
            await sleep(350, signal);
            return { ok: true };
          }

          case "click":
          case "type": {
            setState((s) => ({ ...s, anchor: action.anchor }));
            const rowText = action.kind === "click" && action.inRowContaining ? fillTemplate(action.inRowContaining, values) : undefined;
            const found = await reach(action.anchor, rowText, signal, action.kind === "click" ? action.timeoutMs : undefined);
            if (signal.aborted) return { ok: false, aborted: true };
            if (!found) return action.optional ? { ok: true } : { ok: false, failed: action.anchor };
            setState((s) => ({ ...s, target: found.el }));
            const said = action.say ? sayLine(action.say, signal) : Promise.resolve();
            await moveTo(found, signal);
            if (action.kind === "click") {
              await clickEl(found.el, signal);
              await said;
              await sleep(AFTER_CLICK_MS, signal);
            } else {
              const el = editableIn(found.el);
              if (!el) return action.optional ? { ok: true } : { ok: false, failed: action.anchor };
              const text = fillTemplate(action.text, values);
              setCursor((c) => ({ ...c, typing: true }));
              try {
                el.focus();
              } catch {
                /* ignore */
              }
              if (el instanceof HTMLSelectElement) {
                // A select is picked by option text or value, not typed.
                const opt = Array.from(el.options).find((o) => o.value === text || o.text.trim() === text);
                setNativeValue(el, opt ? opt.value : text);
              } else {
                for (let i = 1; i <= text.length; i++) {
                  if (signal.aborted) return { ok: false, aborted: true };
                  setNativeValue(el, text.slice(0, i));
                  await sleep(TYPE_MS_PER_CHAR, signal);
                }
              }
              setCursor((c) => ({ ...c, typing: false }));
              await said;
              await sleep(350, signal);
            }
            return { ok: true };
          }
        }
      };

      try {
        for (let i = from; i < actions.length; i++) {
          if (signal.aborted) return finish("aborted", i);
          const r = await step(actions[i]);
          if (r.aborted) return finish("aborted", i);
          if (!r.ok) return finish("failed", i, r.failed ?? null);
        }
        return finish(signal.aborted ? "aborted" : "done", actions.length);
      } finally {
        if (controller.current === ctl) controller.current = null;
      }
    },
    [sayLine, waitFor, reach, moveTo, navigate, resolveDemoPatient, markDemoPatient, isAr, gate, check, askOffer, applyOffer, setHomeView, clickEl],
  );

  return { cursor, state, run, abort, pressNext };
}
