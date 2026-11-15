/**
 * The driver's round, and the visit the work has to be back for.
 *
 * Two moments the board did not serve. The lab's driver arrives: he takes today's bags and brings
 * back finished work, usually several pieces at once. And the day before a fitting, somebody
 * should already know that the crown is still at the lab. Both are readings of the same cases the
 * board shows, so nothing new is stored.
 */

import {
  addDays,
  formatPalmer,
  quickLabStep,
  statusFor,
  workTypeLabel,
  type LabCase,
  type LabCaseStatus,
} from "@/lib/labCases";
import { labKeyOf } from "@/lib/labBag";

/** The calendar day of a timestamp, where the clinic is standing. */
function localDay(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The day a case last went INTO the state it is in now. */
function movedInOn(labCase: LabCase): string {
  const last = labCase.events?.[labCase.events.length - 1];
  if (last && last.status === labCase.status) return localDay(last.at);
  return labCase.sentAt || "";
}

/**
 * What the driver takes today: sent for the first time, or going back after a try-in.
 *
 * An order is marked sent the moment it is created, which is usually hours before anybody carries
 * it out of the door. So "sent today" is the honest list of what should be in his hands.
 */
export function leavingToday(cases: LabCase[], today: string): LabCase[] {
  return cases.filter((c) => statusFor(c.status).atLab && movedInOn(c) === today);
}

/** Saved but never sent. Offered to go with the driver, never assumed to. */
export function draftsWaiting(cases: LabCase[]): LabCase[] {
  return cases.filter((c) => c.status === "draft");
}

/** Everything out at a lab, the work that is due soonest (so the late work) first. */
export function outAtLab(cases: LabCase[]): LabCase[] {
  return cases
    .filter((c) => statusFor(c.status).atLab)
    .sort(
      (a, b) =>
        (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || (a.codeNumber || 0) - (b.codeNumber || 0)
    );
}

/**
 * What "it came back" means for this piece of work.
 *
 * The same step the one-tap button takes: work that needs a try-in comes back as a try-in, the
 * rest comes back finished. Only work that is out can be received.
 */
export function receiveStep(labCase: Pick<LabCase, "status" | "needsTryIn">): LabCaseStatus | null {
  if (!statusFor(labCase.status).atLab) return null;
  return quickLabStep(labCase.status, labCase.needsTryIn);
}

export type RoundLab = { key: string; labId: string; labName: string; leaving: number; drafts: number; out: number };

/** One line per lab that has anything leaving or anything out, so the screen can ask which driver is here. */
export function roundLabs(cases: LabCase[], today: string): RoundLab[] {
  const rows: RoundLab[] = [];
  const byKey = new Map<string, RoundLab>();
  const leaving = new Set(leavingToday(cases, today).map((c) => c.id));
  for (const c of cases) {
    const isDraft = c.status === "draft";
    const isOut = statusFor(c.status).atLab;
    if (!isDraft && !isOut) continue;
    const key = labKeyOf(c);
    let row = byKey.get(key);
    if (!row) {
      row = { key, labId: c.labId || "", labName: String(c.labName || "").trim(), leaving: 0, drafts: 0, out: 0 };
      byKey.set(key, row);
      rows.push(row);
    }
    if (isDraft) row.drafts += 1;
    if (isOut) row.out += 1;
    if (leaving.has(c.id)) row.leaving += 1;
  }
  return rows;
}

function fmtDate(iso: string | undefined, language: "en" | "ar"): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(language === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "2 cases", and in Arabic the way Arabic counts: one, a pair, then a number. */
export function caseCountWord(n: number, language: "en" | "ar"): string {
  if (language === "ar") return n === 1 ? "حالة واحدة" : n === 2 ? "حالتين" : `${n} حالات`;
  return n === 1 ? "1 case" : `${n} cases`;
}

/** One line a technician can match to a bag: code, first name, the work, the teeth, the day it is due. */
function caseLine(labCase: LabCase, language: "en" | "ar"): string {
  return [
    labCase.code,
    labCase.patientFirstName,
    workTypeLabel(labCase.workType, language),
    labCase.teeth.length ? formatPalmer(labCase.teeth, language) : "",
    labCase.dueDate ? `${language === "ar" ? "ميعاد الرجوع" : "due"} ${fmtDate(labCase.dueDate, language)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Today's handover to one lab, as a message sent ahead of the driver. */
export function buildPickupMessage(
  cases: LabCase[],
  clinicName: string,
  language: "en" | "ar",
  today: string
): string {
  const isAr = language === "ar";
  const head = [
    isAr
      ? `*تسليم للمعمل · ${caseCountWord(cases.length, language)}*`
      : `*Handover to the lab · ${caseCountWord(cases.length, language)}*`,
    clinicName ? `${isAr ? "من" : "From"}: ${clinicName}` : "",
    fmtDate(today, language),
  ].filter(Boolean);
  return [...head, "", ...cases.map((c) => caseLine(c, language))].join("\n").trim();
}

/** The fields of an appointment this module reads. */
export type RoundAppointment = {
  id: string;
  patientId: string;
  patientName?: string;
  date: string;
  time?: string;
  status?: string;
  branchId?: string;
};

export type VisitAtRisk = { when: "today" | "tomorrow"; appointment: RoundAppointment; labCase: LabCase };

const NOT_HAPPENING = new Set(["cancelled", "canceled", "no show", "no-show", "noshow"]);

/**
 * Visits today and tomorrow whose lab work is not in the building.
 *
 * "Not in the building" is a draft that never left or a case out at the lab. Work that is back,
 * or back for its try-in, is exactly what the visit is for. The day after tomorrow is left out on
 * purpose: a list that is always long stops being read.
 */
export function visitsAtRisk(cases: LabCase[], appointments: RoundAppointment[], today: string): VisitAtRisk[] {
  const tomorrow = addDays(today, 1);
  const out: VisitAtRisk[] = [];
  for (const appointment of appointments) {
    if (!appointment.patientId) continue;
    if (appointment.date !== today && appointment.date !== tomorrow) continue;
    if (NOT_HAPPENING.has(String(appointment.status || "").trim().toLowerCase())) continue;
    for (const labCase of cases) {
      if (labCase.patientId !== appointment.patientId) continue;
      if (labCase.status !== "draft" && !statusFor(labCase.status).atLab) continue;
      out.push({ when: appointment.date === today ? "today" : "tomorrow", appointment, labCase });
    }
  }
  return out.sort(
    (a, b) =>
      a.appointment.date.localeCompare(b.appointment.date) ||
      String(a.appointment.time || "").localeCompare(String(b.appointment.time || "")) ||
      (a.labCase.codeNumber || 0) - (b.labCase.codeNumber || 0)
  );
}

/** Asking the lab about one piece of work a patient is coming for. */
export function buildChaseMessage(item: VisitAtRisk, clinicName: string, language: "en" | "ar"): string {
  const { labCase, appointment, when } = item;
  const what = [labCase.patientFirstName, workTypeLabel(labCase.workType, language)].filter(Boolean).join(" · ");
  const time = appointment.time ? String(appointment.time) : "";
  if (language === "ar") {
    const day = when === "today" ? "النهارده" : "بكرة";
    return [
      `محتاجين ${labCase.code}${what ? ` (${what})` : ""} يرجع العيادة.`,
      `المريض ميعاده ${day}${time ? ` الساعة ${time}` : ""}. هيكون جاهز؟`,
      clinicName,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `We need ${labCase.code}${what ? ` (${what})` : ""} back at the clinic.`,
    `The patient's visit is ${when}${time ? ` at ${time}` : ""}. Will it be ready?`,
    clinicName,
  ]
    .filter(Boolean)
    .join("\n");
}
