// src/lib/tourDemo.ts
/**
 * What Sara does with her hands.
 *
 * Two kinds of scripted action share one small language:
 *
 *  - **Navigation plans**: how to get from wherever the user is to a stop's screen the way a
 *    person would — open the Front Desk menu, click Patients — instead of a silent route push.
 *    Built by `navPlanFor()` from the stop; nothing is hand-written per stop.
 *  - **Walks and demos**: a stop's `walk` points at each part of the screen; a stop's `demo` does
 *    the thing for real — adds the test patient, books the test appointment — through the real
 *    controls, and cleanup stops delete it all through the real delete buttons.
 *
 * Every action names a `[data-tour]` anchor or the words on screen. The runner moves a visible
 * cursor to the element, then performs the real click or types into the real field; the app's
 * own handlers do the rest. Sara never reaches into state. What she can do is exactly what the
 * person watching could do — plus the two "offers" (a starter price list, default hours), which
 * write the same documents the setup wizard writes, only after the person says yes.
 *
 * Pure data and pure functions: no DOM here (that is tourDom.ts / the runner), no React.
 */

import type { Localized, TourStop } from "@/lib/grandTour";
import { SETTINGS_SECTIONS } from "@/config/settingsRegistry";

/** Facts the runner can ask the provider about, for `if` actions. */
export type TourCheck =
  | "anyService"
  | "scheduleSet"
  | "anyDentist"
  | "demoPatientExists"
  | "demoAppointmentExists"
  | "demoDentistExists"
  | "isAdmin";

/** The two things Sara may write for real, after a yes. */
export type TourOffer = "starterServices" | "defaultHours";

export type DemoAction =
  /** Say a line and wait for it to be read. */
  | { kind: "say"; text: Localized }
  /**
   * Move to the anchor and click it. If the anchor is inside something closed, the element that
   * advertises it with `data-tour-opens` is clicked first. `inRowContaining` narrows to the
   * matching element whose enclosing row's text contains the (templated) string.
   */
  | { kind: "click"; anchor: string; say?: Localized; inRowContaining?: string; optional?: boolean; timeoutMs?: number }
  /** Move to the field and type into it, one character at a time. Templates apply to `text`. */
  | { kind: "type"; anchor: string; text: string; say?: Localized; optional?: boolean }
  /** Pick the first real option of a `<select>` — "any free time will do". */
  | { kind: "selectFirst"; anchor: string; say?: Localized; optional?: boolean }
  /** Wait for an anchor to be on screen. */
  | { kind: "wait"; anchor: string; timeoutMs?: number; optional?: boolean }
  /** Wait for an anchor to LEAVE the screen — the proof that a delete went through. */
  | { kind: "waitGone"; anchor: string; inRowContaining?: string; timeoutMs?: number; optional?: boolean }
  /** Open the demo patient's file (resolved by name at run time). */
  | { kind: "openDemoPatient"; tab?: string; say?: Localized }
  /** Mark the test patient as never-to-be-messaged. */
  | { kind: "markDemoPatient"; say?: Localized }
  /** Go straight to a route — for a cleanup that spans screens. */
  | { kind: "route"; path: string; say?: Localized }
  /** A beat. */
  | { kind: "pause"; ms: number }
  /** Look, don't touch: the hand rests on the element and Sara says her line. */
  | {
      kind: "point";
      anchor?: string;
      text?: Localized;
      match?: "exact" | "contains";
      container?: "self" | "card" | "row";
      say: Localized;
      optional?: boolean;
      timeoutMs?: number;
    }
  /** Switch the person's home screen (desk / owner / chair) — restored when the stop ends. */
  | { kind: "homeView"; view: "desk" | "owner" | "chair"; say?: Localized }
  /** Run `then` only when the check is `is` (default true). */
  | { kind: "if"; check: TourCheck; is?: boolean; then: DemoAction[] }
  /**
   * Ask, then do for real. The overlay shows the offer with Yes / No; on yes the provider writes
   * the same documents the setup wizard writes. `then` runs only after a yes.
   */
  | { kind: "offer"; offer: TourOffer; say: Localized; then?: DemoAction[] };

/** Every template value a script may use. Filled in by the runner. */
export interface DemoValues {
  /** The patient a walkthrough searches for — the test patient, or the clinic's first. */
  targetPatientName: string;
  patientName: string;
  phone: string;
  serviceName: string;
  servicePrice: string;
  /**
   * The treatment the clinical demo records — Sara's test treatment when the price list holds
   * it, otherwise the clinic's own first service (TourContext.liveDemoValues). Kept apart from
   * `serviceName` so the cleanup only ever deletes the test treatment, never a real service.
   */
  procedureName: string;
  paymentAmount: string;
  paymentNote: string;
  dentistName: string;
  dentistEmail: string;
  dentistPassword: string;
  expenseNote: string;
  expenseAmount: string;
  leadName: string;
  leadPhone: string;
  itemName: string;
  itemStock: string;
  /** The reorder threshold the inventory demo sets — required by the save. */
  itemMin: string;
  drugQuery: string;
  noteText: string;
}

/**
 * The names Sara gives her test records — one look at Recently Deleted says whose they were.
 * `clinicId` salts the dentist's login email so two clinics never collide on one address.
 */
export function demoValues(isAr: boolean, clinicId?: string | null): DemoValues {
  // Phones that reach nobody: the 0199 prefix is unassigned in Egypt.
  const digits = () => String(Math.floor(10_000_000 + Math.random() * 89_999_999)).slice(0, 7);
  const patientName = isAr ? "مريض تجريبي (سارة)" : "Test patient (Sara)";
  const salt = (clinicId || "clinic").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "clinic";
  return {
    targetPatientName: patientName,
    patientName,
    phone: `199${digits()}`,
    serviceName: isAr ? "علاج تجريبي (سارة)" : "Test treatment (Sara)",
    servicePrice: "100",
    procedureName: isAr ? "علاج تجريبي (سارة)" : "Test treatment (Sara)",
    paymentAmount: "50",
    paymentNote: isAr ? "دفعة تجريبية من سارة" : "Sara's test payment",
    dentistName: isAr ? "د. تجريبي (سارة)" : "Dr. Test (Sara)",
    dentistEmail: `sara.test.dentist.${salt}@example.com`,
    dentistPassword: `Sara-${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 6)}`,
    expenseNote: isAr ? "مصروف تجريبي من سارة" : "Sara's test expense",
    expenseAmount: "10",
    leadName: isAr ? "عميل تجريبي (سارة)" : "Test lead (Sara)",
    leadPhone: `199${digits()}`,
    itemName: isAr ? "صنف تجريبي (سارة)" : "Test item (Sara)",
    itemStock: "5",
    itemMin: "2",
    drugQuery: isAr ? "بارا" : "para",
    noteText: isAr ? "ملاحظة تجريبية من سارة" : "Sara's test note",
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
export function navPlanFor(stop: TourStop, resolvedRoute?: string | null, targetPatientName?: string | null): DemoAction[] {
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
    // The way a person opens a file: Patients, type the name in the search, click the row.
    // The route is the fallback if the row never appears (a name the search does not match).
    if (resolvedRoute && targetPatientName) {
      return [
        { kind: "click", anchor: "nav-patients", optional: true, timeoutMs: 2500 },
        { kind: "wait", anchor: "patients-search", timeoutMs: 6000 },
        {
          kind: "type",
          anchor: "patients-search",
          text: "{{targetPatientName}}",
          say: { en: "Type any part of the name — or the phone — and the list narrows.", ar: "اكتب أي جزء من الاسم — أو التليفون — والقايمة بتضيق." },
        },
        { kind: "click", anchor: "patient-row", inRowContaining: "{{targetPatientName}}", optional: true, timeoutMs: 5000 },
        { kind: "route", path: resolvedRoute },
      ];
    }
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
