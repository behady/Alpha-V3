// src/lib/tourDemo.ts
/**
 * What Sara does with her hands.
 *
 * Two kinds of scripted action share one small language:
 *
 *  - **Navigation plans**: how to get from wherever the user is to a stop's screen the way a
 *    person would — open the Front Desk menu, click Patients — instead of a silent route push.
 *    Built by `navPlanFor()` from the stop; nothing is hand-written per stop.
 *  - **Demos**: a stop that says "here you add a patient" actually adds one. Written by hand on
 *    the stop (`demo`), run only after the user has said yes once, and undone by a cleanup stop
 *    that deletes everything it made — through the real delete buttons, so deleting is taught by
 *    being watched too.
 *
 * Every action names a `[data-tour]` anchor. The runner moves a visible cursor to the element,
 * then performs the real click or types into the real field; the app's own handlers do the rest.
 * Sara never reaches into state. What she can do is exactly what the person watching could do.
 *
 * Pure data and pure functions: no DOM here (that is tourDom.ts / the runner), no React.
 */

import type { Localized, TourStop } from "@/lib/grandTour";
import { SETTINGS_SECTIONS } from "@/config/settingsRegistry";

export type DemoAction =
  /** Say a line and wait for it to be read. */
  | { kind: "say"; text: Localized }
  /**
   * Move to the anchor and click it. If the anchor is inside something closed, the element that
   * advertises it with `data-tour-opens` is clicked first. `inRowContaining` narrows to the
   * matching element whose enclosing row's text contains the (templated) string — for "the
   * delete button on the row I just added".
   */
  | { kind: "click"; anchor: string; say?: Localized; inRowContaining?: string; optional?: boolean; timeoutMs?: number }
  /** Move to the field and type into it, one character at a time. Templates apply to `text`. */
  | { kind: "type"; anchor: string; text: string; say?: Localized; optional?: boolean }
  /** Wait for an anchor to be on screen. */
  | { kind: "wait"; anchor: string; timeoutMs?: number; optional?: boolean }
  /**
   * Wait for an anchor to LEAVE the screen — the proof that a delete went through. A refused
   * delete leaves the row where it was, and Sara must not announce it gone.
   */
  | { kind: "waitGone"; anchor: string; inRowContaining?: string; timeoutMs?: number; optional?: boolean }
  /** Open the demo patient's file (resolved by name at run time). */
  | { kind: "openDemoPatient"; tab?: string; say?: Localized }
  /**
   * Mark the test patient as never-to-be-messaged. A real payment sends a real WhatsApp receipt;
   * on Sara's patient the send layer must find `whatsappOptOut` and stop.
   */
  | { kind: "markDemoPatient"; say?: Localized }
  /** Go straight to a route — for a cleanup that spans screens. */
  | { kind: "route"; path: string; say?: Localized }
  /** A beat. */
  | { kind: "pause"; ms: number };

/** Every template value a script may use. Filled in by the runner. */
export interface DemoValues {
  patientName: string;
  phone: string;
  serviceName: string;
  servicePrice: string;
  paymentAmount: string;
  paymentNote: string;
}

/** The names Sara gives her test records — one look at Recently Deleted says whose they were. */
export function demoValues(isAr: boolean): DemoValues {
  // A phone that is almost certainly not on file. Egyptian mobiles are 010/011/012/015 + 8
  // digits; the 0199 prefix is unassigned, so it can neither collide nor reach anyone.
  const digits = String(Math.floor(10_000_000 + Math.random() * 89_999_999));
  return {
    patientName: isAr ? "مريض تجريبي (سارة)" : "Test patient (Sara)",
    phone: `199${digits.slice(0, 7)}`,
    serviceName: isAr ? "علاج تجريبي (سارة)" : "Test treatment (Sara)",
    servicePrice: "100",
    paymentAmount: "50",
    paymentNote: isAr ? "دفعة تجريبية من سارة" : "Sara's test payment",
  };
}

export function fillTemplate(text: string, values: DemoValues): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    key in values ? String(values[key as keyof DemoValues]) : `{{${key}}}`,
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Navigation plans                                                                            */
/* ------------------------------------------------------------------------------------------ */

/** A route → the top-bar anchor a person clicks to get there. */
function navAnchorForRoute(route: string): string | null {
  if (route === "/") return "nav-dashboard";
  const first = route.split("/")[1];
  if (!first) return null;
  return `nav-${first}`;
}

/**
 * The clicks that take a person to this stop's screen, in order.
 *
 * Empty when there is nothing to click for (already there is decided by the caller). Each click
 * resolves its anchor through the `data-tour-opens` fallback, so "click Patients" on a desktop
 * opens the Front Desk menu first, and on a phone opens the bottom Menu sheet first.
 */
export function navPlanFor(stop: TourStop, resolvedRoute?: string | null): DemoAction[] {
  if (stop.route === "/welcome") return [{ kind: "click", anchor: "menu-welcome" }];
  if (stop.route === "/help") return [{ kind: "click", anchor: "menu-help" }];

  if (stop.settingsId) {
    const section = SETTINGS_SECTIONS.find((s) => s.id === stop.settingsId);
    if (!section) return [];
    return [
      { kind: "click", anchor: "nav-settings", optional: true },
      { kind: "wait", anchor: `settings-group-${section.group}` },
      { kind: "click", anchor: `settings-group-${section.group}`, optional: true },
      { kind: "click", anchor: section.tourAnchor ?? `settings-${section.id}` },
    ];
  }
  if (stop.route === "/settings") return [{ kind: "click", anchor: "nav-settings" }];

  if (stop.dynamic) {
    // The provider resolved which patient this is: walk to Patients like a person, then open
    // that exact file — it may be on the second page of the list, where no row can be clicked.
    if (resolvedRoute) {
      return [
        { kind: "click", anchor: "nav-patients", optional: true, timeoutMs: 2500 },
        { kind: "route", path: resolvedRoute },
      ];
    }
    if (stop.dynamic === "firstPatient") {
      return [
        { kind: "click", anchor: "nav-patients" },
        { kind: "wait", anchor: "patient-row" },
        { kind: "click", anchor: "patient-row" },
      ];
    }
    return [{ kind: "openDemoPatient", tab: stop.demoPatientTab }];
  }

  const anchor = navAnchorForRoute(stop.route);
  return anchor ? [{ kind: "click", anchor }] : [];
}

/**
 * Whether `pathname` already counts as being at this stop.
 *
 * A dynamic stop with a resolved route must be on THAT patient's file: "any patient's file" once
 * matched the payment demo onto whichever patient happened to be open, and it took a payment on
 * a real person. Unresolved means not there yet.
 */
export function stopRouteMatches(stop: TourStop, pathname: string, resolvedRoute?: string | null): boolean {
  if (stop.dynamic) {
    if (!resolvedRoute) return false;
    return pathname === resolvedRoute.split("?")[0];
  }
  return pathname === stop.route;
}
