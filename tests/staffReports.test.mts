// Owner alerts and reports on WhatsApp: the third channel, and the ways it would quietly go wrong.
//
//  - A WhatsApp switch on an alert the server cannot put on WhatsApp is a lie; the resolver must
//    answer "off" for those whatever the clinic saved.
//  - The six alerts that moved off the old Settings → WhatsApp grid must keep the tick a clinic
//    left there, or a practice that has had "finance › delete" on for a year loses it silently.
//  - The report text must never contain a money figure for a reader without money access, must
//    honour the sections the clinic switched off, and must not print an arrow against nothing.
//
// Run with tsx so the TS modules load directly: npm run test:staffreports
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOTIFY_EVENTS,
  notifyEvent,
  personWhatsapp,
  reportEvents,
  reportPrefs,
  resolveNotify,
} from "../src/lib/notificationCatalog";
import { renderStaffReport, reportPushLine } from "../src/lib/reports/staffReportText";
import { staffHelpText, staffIntent, staffLanguage } from "../src/lib/bot/staffLine";
import type { Briefing } from "../src/lib/automation/briefing/types";
import { FEATURE_CATALOG } from "../src/lib/featureCatalog";
import { TIER_LIMITS } from "../src/lib/subscriptions";

const REPO = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

// --- 1. The resolver ---------------------------------------------------------------------------
{
  // Off by default everywhere: WhatsApp follows a person home and has to be asked for.
  for (const e of NOTIFY_EVENTS) {
    const r = resolveNotify(e.id, {});
    ok(r && r.whatsapp === false, `"${e.id}" is on WhatsApp for a clinic that never opened the page`);
  }

  // Saved on, on an alert the server raises: on.
  eq(resolveNotify("paymentDeleted", { events: { paymentDeleted: { whatsapp: true } } })?.whatsapp, true, "a saved WhatsApp switch is ignored");

  // Saved on, on an alert only the Cloud Functions raise: still off, because nothing could honour it.
  const functionsOnly = NOTIFY_EVENTS.find((e) => !e.waReady);
  ok(functionsOnly, "every alert is waReady — then the flag has lost its meaning; check the Functions half really sends WhatsApp");
  eq(
    resolveNotify(functionsOnly!.id, { events: { [functionsOnly!.id]: { whatsapp: true } } })?.whatsapp,
    false,
    `"${functionsOnly!.id}" says WhatsApp although only a Cloud Function raises it`,
  );

  // The old grid's tick is honoured until the clinic answers on the new page.
  eq(resolveNotify("appointmentAdded", { legacyOwnerAlerts: { appointment_add: true } })?.whatsapp, true, "an old grid tick is lost");
  eq(
    resolveNotify("appointmentAdded", { legacyOwnerAlerts: { appointment_add: true }, events: { appointmentAdded: { whatsapp: false } } })?.whatsapp,
    false,
    "the clinic's new answer does not beat the old grid",
  );
  for (const key of ["appointment_add", "appointment_edit", "appointment_delete", "finance_add", "finance_edit", "finance_delete", "daily_digest"]) {
    ok(NOTIFY_EVENTS.some((e) => e.legacyOwnerKey === key), `old grid key "${key}" maps to no alert — that tick is now silently dead`);
  }

  // Money alerts cannot reach reception, whatever the clinic saves.
  for (const id of ["paymentAdded", "paymentEdited", "paymentDeleted"]) {
    const r = resolveNotify(id, { events: { [id]: { roles: ["Owner", "Receptionist"] } } });
    ok(r && !r.roles.includes("Receptionist"), `"${id}" can be sent to reception`);
  }

  // "Off" means all three switches: an alert with only WhatsApp on is still raised.
  const only = resolveNotify("eveningDigest", { events: { eveningDigest: { bell: false, push: false, whatsapp: true } } });
  ok(only && !only.bell && !only.push && only.whatsapp, "WhatsApp-only did not resolve");
  ok(
    /!resolved\.bell && !resolved\.push && !wantWhatsapp/.test(read("src/lib/notificationDelivery.ts")) && /wantWhatsapp = resolved \? resolved\.whatsapp/.test(read("src/lib/notificationDelivery.ts")),
    "notificationDelivery treats bell-off + push-off as 'off' and never reaches the WhatsApp leg",
  );
}

// --- 2. The reports and their settings --------------------------------------------------------
{
  const ids = reportEvents().map((e) => e.id).sort();
  eq(ids, ["eveningDigest", "morningBriefClinic", "morningBriefDentist", "ownerSummary"], "the set of scheduled reports changed");
  // The other session's "daily_digest" checkbox on Settings → WhatsApp maps onto the AI three-liner.
  eq(notifyEvent("ownerSummary")?.legacyOwnerKey, "daily_digest", "the old daily_digest tick would be lost");
  eq(resolveNotify("ownerSummary", { legacyOwnerAlerts: { daily_digest: true } })?.whatsapp, true, "daily_digest tick not honoured");
  for (const e of reportEvents()) {
    ok(e.waReady, `report "${e.id}" has no WhatsApp switch`);
    ok(e.timings?.some((t) => t.key === "hour" && t.kind === "hourOfDay"), `report "${e.id}" has no send hour`);
    ok(e.group === "reports", `report "${e.id}" is not under the Reports heading`);
  }

  const d = reportPrefs("eveningDigest", {});
  eq(d.sections, { money: true, appointments: true, patients: true, team: true }, "close-out defaults");
  eq(reportPrefs("morningBriefClinic", {}).sections.team, false, "the morning brief should not open with yesterday's attendance by default");
  eq(d.moneyDetail, "dentists", "default money detail");
  eq(d.language, "ar", "default language");
  eq(d.comparisons, true, "comparisons default on");
  eq(reportPrefs("eveningDigest", { reports: { eveningDigest: { moneyDetail: "weird" as never, language: "fr" as never } } }).moneyDetail, "dentists", "a bad detail value must fall back");
  eq(reportPrefs("eveningDigest", { reports: { eveningDigest: { language: "en", sections: { team: false } } } }), {
    sections: { money: true, appointments: true, patients: true, team: false },
    moneyDetail: "dentists",
    comparisons: true,
    language: "en",
    pdf: false,
  }, "saved report prefs are not read back");

  eq(personWhatsapp("u1", {}), { enabled: true, phone: "" }, "a person nobody configured is on, with no number");
  eq(personWhatsapp("u1", { people: { u1: { whatsapp: false, phone: " +20100 " } } }), { enabled: false, phone: "+20100" }, "person prefs");
}

// --- 3. The text -------------------------------------------------------------------------------
function briefing(over: Partial<Briefing> = {}): Briefing {
  const base: Briefing = {
    period: "day",
    generatedAt: "2026-09-27T19:00:00.000Z",
    startDate: "2026-09-27",
    endDate: "2026-09-27",
    dateKey: "2026-09-27",
    access: { money: true, hr: true },
    redacted: [],
    headline: { collected: 12500, patientsSeen: 11, stillToCome: 0, missed: 2, staffOnFloor: 0 },
    appointments: [
      { id: "a1", date: "2026-09-27", time: "10:00", patientId: "p1", patientName: "Mona Ali", doctor: "Dr Ahmed", treatment: "Filling", status: "Completed", duration: 30 },
      { id: "a2", date: "2026-09-27", time: "11:00", patientId: "p2", patientName: "Omar S", doctor: "Dr Ahmed", treatment: "", status: "No Show", duration: 30 },
      { id: "a3", date: "2026-09-27", time: "12:00", patientId: "p3", patientName: "Sara K", doctor: "Dr Sara", treatment: "Cleaning", status: "Cancelled", duration: 30 },
    ],
    counts: { total: 3, attended: 1, cancelled: 2, stillScheduled: 0 },
    money: {
      collected: 12500,
      byMethod: [{ method: "Cash", amount: 9000, count: 5 }, { method: "Visa", amount: 3500, count: 2 }],
      expenses: 1200,
      expensesByCategory: [],
      netCash: 11300,
      discounts: 500,
      labFees: 0,
      doctorCommissions: 0,
      clinicProfit: 0,
      billedUnpaid: 2000,
      comparison: { previousLabel: "2026-09-26", previousCollected: 9000, sameWeekdayLabel: "2026-09-20", sameWeekdayCollected: 10000 },
    },
    production: {
      doctors: [
        { key: "d1", name: "Dr Ahmed", patientsSeen: 7, procedures: 8, collected: 8000, commission: 0, labFee: 0, clinicProfit: 0 },
        { key: "d2", name: "Dr Sara", patientsSeen: 4, procedures: 4, collected: 4500, commission: 0, labFee: 0, clinicProfit: 0 },
      ],
      revenuePerPatientSeen: null,
      chairUtilisation: null,
      busiestHour: { hour: "18:00", count: 4 },
      biggestGap: null,
    },
    hr: {
      staff: [
        { staffId: "s1", uid: "u1", name: "Ahmed", role: "Dentist", hasSchedule: true, scheduledDays: 1, daysWorked: 1, minutesWorked: 480, lateMinutes: 20, lateDays: 1, absentDays: 0, activeNow: false, openShifts: 0, overtimeApprovedMinutes: 0, overtimePendingMinutes: 0, estimatedPay: 0, flags: [] },
        { staffId: "s2", uid: "u2", name: "Nour", role: "Receptionist", hasSchedule: true, scheduledDays: 1, daysWorked: 0, minutesWorked: 0, lateMinutes: 0, lateDays: 0, absentDays: 1, activeNow: false, openShifts: 0, overtimeApprovedMinutes: 0, overtimePendingMinutes: 0, estimatedPay: 0, flags: [] },
      ],
      onFloorNow: 0, lateDays: 1, absentDays: 1, openShifts: 0, totalMinutes: 480, overtimePendingMinutes: 0, overtimePendingCost: 0, labourCost: 0, withoutSchedule: 0,
    },
    actions: {
      unresolvedAppointments: [], unresolvedCount: 3,
      seenWithoutNextVisit: [], seenWithoutNextVisitCount: 4,
      billedWithoutBooking: [], billedWithoutBookingCount: 0,
      overdueFollowUps: [], overdueFollowUpCount: 2,
      unconfirmedAhead: 3,
      staleBalances: [{ patientId: "p9", patientName: "X", balance: 12000, daysSinceLastActivity: 60 }],
      staleBalanceTotal: 12000,
    },
    growth: { newPatients: 3, newLeads: 5, leadsBySource: [{ source: "Facebook", count: 3 }, { source: "WhatsApp", count: 2 }], leadsConverted: 1, leadsUntouched: 0 },
    stock: { low: [{ itemId: "i1", name: "Gloves M", stock: 1, minStock: 5, unit: "box", outOfStock: false }], lowCount: 1, outOfStockCount: 0, noThresholdCount: 0 },
    nextUp: { key: "tomorrow", startDate: "2026-09-28", endDate: "2026-09-28", appointments: 9, firstAppointmentTime: "10:00", doctors: ["Dr Ahmed"], unconfirmed: 3, staffRostered: ["Ahmed", "Nour"] },
    notes: [],
    staleBalances: [],
    staleBalanceTotal: 12000,
  };
  return { ...base, ...over };
}

{
  const prefs = reportPrefs("eveningDigest", {});
  const owner = renderStaffReport({ kind: "evening", clinicName: "Alpha Dental", today: briefing(), handoffsWaiting: 2, prefs, access: { money: true, hr: true } });
  ok(owner.startsWith("*Alpha Dental*"), "the report does not open with the clinic name");
  ok(owner.includes("12,500 ج.م"), "collected figure missing");
  ok(owner.includes("↑ 25%"), "no arrow against the same weekday last week (12,500 vs 10,000)");
  ok(owner.includes("Dr Ahmed") && owner.includes("8,000 ج.م"), "per-dentist lines missing at the default detail");
  ok(!owner.includes("Visa"), "the method split appears at 'per dentist' detail — that is 'full'");
  ok(owner.includes("3 محجوز") && owner.includes("1 اتشاف") && owner.includes("1 غاب") && owner.includes("1 اتلغى"), "appointment counts wrong");
  ok(owner.includes("بكرة: 9 ميعاد") && owner.includes("أول ميعاد 10:00") && owner.includes("3 غير مؤكد"), "tomorrow line wrong");
  ok(owner.includes("مرضى جداد: 3") && owner.includes("عملاء جداد: 5") && owner.includes("Facebook 3"), "growth line wrong");
  ok(owner.includes("مستنية حد يرد: 2"), "handoffs missing");
  ok(owner.includes("Ahmed — اتأخر 20 دقيقة") && owner.includes("Nour — غاب"), "team lines missing");
  ok(owner.includes("Gloves M"), "low stock missing");
  ok(owner.split("\n").length < 45, "the close-out is too long to read in ten seconds");

  const full = renderStaffReport({ kind: "evening", clinicName: "Alpha Dental", today: briefing(), prefs: { ...prefs, moneyDetail: "full" }, access: { money: true, hr: true } });
  ok(full.includes("Cash 9,000") && full.includes("Visa 3,500") && full.includes("خصومات 500"), "full detail lacks the method split or discounts");

  const totals = renderStaffReport({ kind: "evening", clinicName: "Alpha Dental", today: briefing(), prefs: { ...prefs, moneyDetail: "totals" }, access: { money: true, hr: true } });
  ok(!totals.includes("Dr Ahmed —"), "totals-only still lists dentists");

  // A receptionist: no money, no team, whatever the clinic's sections say.
  const reception = renderStaffReport({ kind: "evening", clinicName: "Alpha Dental", today: briefing(), prefs, access: { money: false, hr: false } });
  ok(!reception.includes("ج.م") && !reception.includes("12,500") && !reception.includes("اتأخر"), "a reader without money access can see money or attendance");
  ok(reception.includes("3 محجوز"), "the receptionist's report lost the diary");

  // Sections off stay off, even for the owner.
  const noMoney = renderStaffReport({ kind: "evening", clinicName: "Alpha Dental", today: briefing(), prefs: { ...prefs, sections: { ...prefs.sections, money: false, team: false } }, access: { money: true, hr: true } });
  ok(!noMoney.includes("12,500") && !noMoney.includes("الفريق"), "switched-off sections still render");

  // No arrow against nothing.
  const noBase = briefing();
  noBase.money!.comparison = { previousLabel: "x", previousCollected: 0, sameWeekdayLabel: "y", sameWeekdayCollected: 0 };
  const flat = renderStaffReport({ kind: "evening", clinicName: "Alpha Dental", today: noBase, prefs, access: { money: true, hr: true } });
  ok(!/[↑↓]/.test(flat), "an arrow was printed against a zero base");
  const noCompare = renderStaffReport({ kind: "evening", clinicName: "Alpha Dental", today: briefing(), prefs: { ...prefs, comparisons: false }, access: { money: true, hr: true } });
  ok(!/[↑↓]/.test(noCompare), "comparisons off still prints arrows");

  // English.
  const en = renderStaffReport({ kind: "evening", clinicName: "Alpha Dental", today: briefing(), prefs: { ...prefs, language: "en" }, access: { money: true, hr: true } });
  ok(en.includes("Collected: 12,500 EGP") && en.includes("Tomorrow: 9 appointments") && !/[؀-ۿ]/.test(en), "the English report has Arabic in it or the wrong figures");

  // Morning: today's diary, yesterday's money, things to chase.
  const morning = renderStaffReport({
    kind: "morning",
    clinicName: "Alpha Dental",
    today: briefing({ counts: { total: 3, attended: 0, cancelled: 1, stillScheduled: 2 } }),
    yesterday: briefing(),
    handoffsWaiting: 1,
    prefs: reportPrefs("morningBriefClinic", {}),
    access: { money: true, hr: true },
  });
  ok(morning.includes("صباح الخير"), "morning greeting missing");
  ok(morning.includes("2 ميعاد") && morning.includes("أول ميعاد 10:00"), "today's diary missing (cancelled ones must not count)");
  ok(morning.includes("إمبارح") && morning.includes("12,500"), "yesterday's money missing");
  ok(morning.includes("محتاج متابعة") && morning.includes("حسابات عليها رصيد وساكتة: 1 حساب"), "the chase block is missing");
  ok(!morning.includes("الفريق"), "the morning brief shows attendance although team is off by default");

  // A dentist's own day lists only their patients.
  const dentist = renderStaffReport({
    kind: "dentistDay",
    clinicName: "Alpha Dental",
    today: briefing(),
    prefs: reportPrefs("morningBriefDentist", {}),
    access: { money: false, hr: false },
    dentist: { name: "Dr Ahmed", appointments: briefing().appointments.filter((a) => a.doctor === "Dr Ahmed") },
  });
  ok(dentist.includes("Mona Ali") && dentist.includes("Omar S") && !dentist.includes("Sara K"), "the dentist's list has the wrong patients");
  ok(dentist.includes("2 مريض"), "the dentist's count is wrong");

  const pushLine = reportPushLine("evening", briefing(), "en");
  ok(pushLine.body.includes("12,500 EGP") && pushLine.body.includes("1 seen"), "push line wrong");
}

// --- 4. The wiring that has to agree -----------------------------------------------------------
{
  // The add-on exists on both lists and is sold, not bundled.
  ok(FEATURE_CATALOG.some((f) => f.key === "ownerAlertsLine"), "ownerAlertsLine is not in the feature catalogue");
  for (const tier of Object.keys(TIER_LIMITS) as (keyof typeof TIER_LIMITS)[]) {
    eq(TIER_LIMITS[tier].features.ownerAlertsLine, false, `${tier} bundles the alerts line — it is sold separately and free only via a connected number`);
  }

  // The platform line is reachable only from the staff sender.
  const users = ["src/lib/whatsappDelivery.ts", "src/lib/whatsapp.ts", "src/lib/patientNotifications.ts", "src/lib/bot/respond.ts"];
  for (const rel of users) {
    ok(!read(rel).includes("loadPlatformWapilotConfig"), `${rel} reaches the platform alerts line — a patient could be messaged from Alpha's number`);
  }
  ok(read("src/lib/staffWhatsapp.ts").includes("loadPlatformWapilotConfig"), "the staff sender no longer uses the platform line");
  ok(!read("src/lib/wapilotConfig.ts").includes("settings/wapilot\")") && !read("src/lib/wapilotConfig.ts").includes("LEGACY_WAPILOT"), "the legacy shared fallback for patient messages is back");

  // The old owner-alert route maps every grid key to a catalogue event, and nothing else.
  const route = read("src/app/api/whatsapp/owner-alert/route.ts");
  for (const m of route.matchAll(/^\s+[a-z_]+: "([a-zA-Z]+)",$/gm)) {
    if (/^(appointment|payment)/.test(m[1])) ok(notifyEvent(m[1]), `owner-alert route sends "${m[1]}", which is not catalogued`);
  }
  ok(route.includes("deliverClinicNotification"), "the owner-alert route bypasses the notification centre");
  ok(!route.includes("ownerNumber"), "the owner-alert route still reads the single owner number directly");

  // The other session's separate evening cron is gone: one tick sends every report.
  ok(!read("vercel.json").includes("owner-digest"), "the owner-digest cron is back beside the reports tick — the owner gets the evening twice");

  // The hourly cron exists and is scheduled.
  const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
  const cron = vercel.crons.find((c) => c.path === "/api/automation/staff-reports");
  ok(cron && cron.schedule === "0 * * * *", "the staff-reports cron is missing or not hourly — each clinic picks its own hour, so the tick must be hourly");

  // WhatsApp-only for the cron, so the Functions push is not doubled.
  ok(read("src/lib/reports/sendStaffReport.ts").includes("whatsappOnly: !args.test"), "the report cron would also push and write the bell, doubling the Functions job");
}

// --- 5. The staff line ---------------------------------------------------------------------------
{
  eq(staffIntent("تقرير"), "evening", "Arabic 'report'");
  eq(staffIntent("ابعتلي الاقفال"), "evening", "Arabic close-out");
  eq(staffIntent("report please"), "evening", "English report");
  eq(staffIntent("النهارده"), "morning", "Arabic today");
  eq(staffIntent("today"), "morning", "English today");
  eq(staffIntent("ملخص"), "summary", "Arabic summary");
  eq(staffIntent("Hi"), "help", "a greeting is help");
  eq(staffIntent("Do you know who am i?"), "help", "a question the line cannot answer is help");
  eq(staffLanguage("Hi"), "en", "Latin → English");
  eq(staffLanguage("ازيك"), "ar", "Arabic → Arabic");
  const help = staffHelpText({ uid: "u", role: "Owner", name: "Ahmed" }, "Alpha Dental", "en");
  ok(help.includes("Ahmed") && help.includes("Owner") && help.includes("not as a patient"), "the greeting does not say who the sender is");
  ok(!/STOP/.test(help), "the staff greeting carries the patient opt-out footer");
  const helpAr = staffHelpText({ uid: "u", role: "Dentist", name: "" }, "ألفا", "ar");
  ok(helpAr.includes("دكتور") && helpAr.includes("*تقرير*"), "the Arabic greeting lacks the role or the keywords");
  const respond = read("src/lib/bot/respond.ts");
  ok(respond.indexOf("findStaffByPhone(") < respond.indexOf("if (!settings.enabled)"), "the staff check runs after the patient gates — the owner is a patient again when the bot is off");
}

console.log(`staffReports: ${checks} checks passed`);
