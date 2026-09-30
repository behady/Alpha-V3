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
  reportDueOn,
  reportEvents,
  reportPrefs,
  resolveNotify,
} from "../src/lib/notificationCatalog";
import { buildReportPdf, arabicPdfAvailable } from "../src/lib/reports/staffReportPdf";
import { lastDayOfPreviousMonth, reportEndDate } from "../src/lib/reports/sendStaffReport";
import { matchesComplaint } from "../src/lib/alerts/complaint";
import { discountPercentOf } from "../src/lib/alerts/moneyAlerts";
import { groupQueued } from "../src/lib/alerts/sweep";
import { notifyTiming } from "../src/lib/notificationCatalog";
import { renderStaffReport, reportPushLine } from "../src/lib/reports/staffReportText";
import { samePhone, staffHelpText, staffIntent, staffLanguage, staffThrottle } from "../src/lib/bot/staffLine";
import { confirmPrompt, pendingToLines, staffDecision, toStaffPending } from "../src/lib/bot/staffAssistant";
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
  eq(ids, ["eveningDigest", "monthlyReport", "morningBriefClinic", "morningBriefDentist", "ownerSummary", "payrollReport", "weeklyReport"], "the set of scheduled reports changed");
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
    growth: { newPatients: 3, newPatientsSeen: 2, newLeads: 5, leadsBySource: [{ source: "Facebook", count: 3 }, { source: "WhatsApp", count: 2 }], leadsConverted: 1, leadsUntouched: 0 },
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
  eq(staffIntent("ازيك"), "help", "an Arabic greeting is help");
  eq(staffIntent("Do you know who am i?"), "ask", "a free question goes to the assistant");
  eq(staffIntent("كام مريض جه النهارده؟"), "ask", "a question containing a report word is still a question");
  eq(staffIntent("How much did Dr Ahmed collect this week?"), "ask", "an English question goes to the assistant");
  eq(staffIntent("رصيد محمد علي"), "ask", "a balance question goes to the assistant");
  const route = read("src/app/api/gemini/route.ts");
  ok(/WHATSAPP_STAFF_EXCLUDED_TOOLS/.test(route) && route.includes('client === "whatsapp-staff"'), "the assistant route has no tool rule for the staff line");
  const excluded = route.slice(route.indexOf("const WHATSAPP_STAFF_EXCLUDED_TOOLS"), route.indexOf("]);", route.indexOf("const WHATSAPP_STAFF_EXCLUDED_TOOLS")));
  // Screens cannot be shown in a WhatsApp bubble; everything else stays, gated by the person's own permissions.
  for (const screenOnly of ["navigate_to", "trigger_pdf_generation", "open_appointment", "start_tutorial", "open_tour_stop", "file_bug_report", "file_feature_request"]) {
    ok(excluded.includes(`"${screenOnly}"`), `${screenOnly} is offered on WhatsApp, where it can only fail`);
  }
  for (const acting of ["set_appointment_status", "reschedule_appointment", "record_payment", "db_write", "db_delete"]) {
    ok(!excluded.includes(`"${acting}"`), `${acting} is withheld on WhatsApp although the owner asked for the app's reach`);
  }
  ok(route.includes('client !== "web-widget" && client !== "whatsapp-staff"'), "the staff line is told it has an appointment panel");

  // The yes/no round.
  for (const t of ["نعم", "ايوه", "تمام", "yes", "Yes.", "ok", "do it", "أكد"]) eq(staffDecision(t), "approve", `not read as yes: ${t}`);
  for (const t of ["لا", "الغي", "cancel", "No", "بلاش"]) eq(staffDecision(t), "reject", `not read as no: ${t}`);
  for (const t of ["نعم بس بكرة", "who is booked", "yes please move it to 5"]) eq(staffDecision(t), null, `read as a decision although it is a new instruction: ${t}`);
  const card = toStaffPending({ id: "a1", kind: "appointment_update", title: "Move appointment", summary: { patientName: "Mona Ali", date: "2026-09-28", time: "10:00" }, changes: [{ label: "Time", from: "10:00", to: "12:00" }] });
  ok(card && card.title === "Move appointment" && card.lines[0] === "Mona Ali · 2026-09-28 10:00" && card.lines[1] === "Time: 10:00 → 12:00", "the staged action does not read as a card");
  eq(pendingToLines({ id: "p", kind: "payment", summary: { patientName: "Omar" }, amount: 1500 }), ["Omar", "1,500 EGP"], "payment card lines");
  eq(toStaffPending({ kind: "delete" }), null, "a preview without an id must not become a pending action");
  ok(confirmPrompt("ar").includes("نعم") && confirmPrompt("en").includes("yes"), "confirm prompt");
  const line = read("src/lib/bot/staffLine.ts");
  ok(line.indexOf("loadStaffPending(") < line.indexOf('if (intent === "evening" || intent === "morning" || intent === "summary")'), "a pending action is not checked before the report keywords — 'yes' would fetch nothing");
  ok(read("src/lib/bot/staffAssistant.ts").includes("/api/gemini/confirm-action"), "the staff line does not use the app's own confirm route");

  // Voice notes: both webhooks hand the staff line a transcriber; the staff line echoes what it heard.
  for (const rel of ["src/app/api/webhooks/meta-whatsapp/route.ts", "src/app/api/webhooks/whatsapp-inbound/route.ts"]) {
    const w = read(rel);
    const call = w.slice(w.indexOf("interceptStaffInbound({"), w.indexOf("})", w.indexOf("interceptStaffInbound({")) + 2);
    ok(call.includes("transcribe:") && call.includes("media:"), `${rel} sends the owner's voice note to the staff line as an empty message`);
  }
  ok(line.includes('media === "audio" && transcribe') && line.includes("heard"), "the staff line does not transcribe a voice note or echo what it heard");
  ok(read("src/lib/bot/staffAssistant.ts").includes("run_clinic_report (and generate_financial_summary"), "the assistant is not told to read the clinic's figures before recommending");
  ok(read("src/lib/bot/staffAssistant.ts").includes("createCustomToken(uid"), "the staff line does not sign in as the real person — permissions would be nobody's");
  // The owner types 01551552440 on the page; Meta delivers 201551552440; both are the same phone.
  ok(samePhone("01551552440", "201551552440"), "a local number does not match its international form");
  ok(samePhone("01551552440", "+201551552440"), "a local number does not match E.164");
  ok(!samePhone("01551552440", "01551552441"), "different numbers match");
  ok(!samePhone("", "201551552440"), "an empty number matches");
  ok(!read("src/lib/staffWhatsapp.ts").includes("normalizeToE164(args.to)"), "the staff sender uses the strict normaliser and drops every 01x number typed on the page");
  eq(staffLanguage("Hi"), "en", "Latin → English");
  eq(staffLanguage("ازيك"), "ar", "Arabic → Arabic");
  const help = staffHelpText({ uid: "u", role: "Owner", name: "Ahmed" }, "Alpha Dental", "en");
  ok(help.includes("Ahmed") && help.includes("Owner") && help.includes("not as a patient"), "the greeting does not say who the sender is");
  ok(!/STOP/.test(help), "the staff greeting carries the patient opt-out footer");
  const helpAr = staffHelpText({ uid: "u", role: "Dentist", name: "" }, "ألفا", "ar");
  ok(helpAr.includes("دكتور") && helpAr.includes("*تقرير*"), "the Arabic greeting lacks the role or the keywords");
  // The owner's chat never reaches the inbox: both webhooks intercept before the thread write,
  // and the inbox hides anything flagged staffLine.
  const meta = read("src/app/api/webhooks/meta-whatsapp/route.ts");
  ok(meta.indexOf("interceptStaffInbound(") > 0 && meta.indexOf("interceptStaffInbound(") < meta.indexOf("const lineId = "), "the Meta webhook records the owner's message in the inbox before asking whether he is staff");
  const wap = read("src/app/api/webhooks/whatsapp-inbound/route.ts");
  ok(wap.indexOf("interceptStaffInbound(") > 0 && wap.indexOf("interceptStaffInbound(") < wap.indexOf("const lineId = await recordThreadMessage("), "the Wapilot webhook records the owner's message in the inbox before asking whether he is staff");
  ok(/staffLine !== true/.test(read("src/components/ai/ChatsPanel.tsx")), "the Chats inbox shows staff-line conversations to the whole desk");
  ok(/needsHuman: false/.test(read("src/lib/bot/staffLine.ts")), "an owner's old handoff row keeps paging staff about a waiting patient");
  const respond = read("src/lib/bot/respond.ts");
  ok(respond.indexOf("findStaffByPhone(") < respond.indexOf("if (!settings.enabled)"), "the staff check runs after the patient gates — the owner is a patient again when the bot is off");

  // The regression the owner hit: every free question came back as the morning brief, because the
  // report branch caught everything that was not a greeting. Only the three report words may.
  const staffLine = read("src/lib/bot/staffLine.ts");
  ok(!staffLine.includes('if (intent !== "help")'), "the report branch still swallows free questions — 'ايه اخبار الأسبوع' becomes the morning brief");
  ok(staffLine.includes('if (intent === "evening" || intent === "morning" || intent === "summary")'), "the report branch is not limited to the report intents");

  // Two bots must not talk to each other.
  const now = 1_000_000;
  eq(staffThrottle([], now), { allow: true }, "first message is answered");
  eq(staffThrottle([now - 30_000], now), { allow: true }, "a reply half a minute later is answered");
  eq(staffThrottle([now - 3_000], now).reason, "echo", "a reply three seconds after our own message is a machine");
  eq(staffThrottle([now - 100_000, now - 80_000, now - 60_000, now - 40_000, now - 20_000], now).reason, "burst", "six answers in two minutes is a loop");
  eq(staffThrottle([now - 130_000, now - 125_000, now - 124_000, now - 123_000, now - 122_000], now), { allow: true }, "old bursts expire");
}

// --- 6. The week, the month, the pay sheet ---------------------------------------------------------
{
  // Due-on: hour alone for the daily ones; hour + weekday for the week; hour + day for the month.
  ok(reportDueOn("eveningDigest", {}, { hour: 21, weekday: 2, dayOfMonth: 15 }), "the close-out is not due at its default hour");
  ok(!reportDueOn("eveningDigest", {}, { hour: 20, weekday: 2, dayOfMonth: 15 }), "the close-out is due at the wrong hour");
  ok(reportDueOn("weeklyReport", {}, { hour: 8, weekday: 6, dayOfMonth: 15 }), "the weekly report is not due Saturday 08:00 by default");
  ok(!reportDueOn("weeklyReport", {}, { hour: 8, weekday: 5, dayOfMonth: 15 }), "the weekly report goes out on the wrong weekday");
  ok(reportDueOn("weeklyReport", { timings: { weeklyReport: { weekday: 1, hour: 10 } } }, { hour: 10, weekday: 1, dayOfMonth: 3 }), "a clinic's own weekday and hour are ignored");
  ok(reportDueOn("monthlyReport", {}, { hour: 8, weekday: 0, dayOfMonth: 1 }), "the monthly report is not due on the 1st");
  ok(!reportDueOn("monthlyReport", {}, { hour: 8, weekday: 0, dayOfMonth: 2 }), "the monthly report goes out on the 2nd");
  ok(reportDueOn("payrollReport", {}, { hour: 9, weekday: 0, dayOfMonth: 1 }), "the pay sheet is not due on the 1st at 09:00");
  ok(!reportDueOn("patientArrived", {}, { hour: 9, weekday: 0, dayOfMonth: 1 }), "a non-report is 'due'");
  for (const e of reportEvents()) {
    const kinds = (e.timings || []).map((t) => t.kind);
    ok(kinds.includes("hourOfDay"), `report "${e.id}" has no hour`);
    if (e.report === "weekly") ok(kinds.includes("weekday"), "the weekly report has no weekday");
    if (e.report === "monthly" || e.report === "payroll") ok(kinds.includes("dayOfMonth"), `${e.id} has no day of month`);
  }

  // Which days a report covers.
  eq(reportEndDate("weekly", "2026-09-27"), "2026-09-26", "the week should end yesterday");
  eq(reportEndDate("monthly", "2026-10-01"), "2026-09-30", "the month sent on the 1st should be last month");
  eq(reportEndDate("monthly", "2026-10-05"), "2026-09-30", "the month sent on the 5th is still last month");
  eq(reportEndDate("payroll", "2027-01-01"), "2026-12-31", "December's pay sheet crosses the year");
  eq(lastDayOfPreviousMonth("2026-03-15"), "2026-02-28", "February");
  eq(reportEndDate("evening", "2026-09-27"), "2026-09-27", "the close-out is today");

  // The weekly text: comparisons against the previous period, the best day, top procedures, team.
  const week = briefing({
    period: "week",
    startDate: "2026-09-20",
    endDate: "2026-09-26",
    trend: {
      points: [
        { key: "collected", current: 85000, previous: 76000, changePercent: 12, isMoney: true },
        { key: "patients_seen", current: 61, previous: 55, changePercent: 11, isMoney: false },
        { key: "missed", current: 9, previous: 12, changePercent: -25, isMoney: false },
        { key: "new_patients", current: 14, previous: 10, changePercent: 40, isMoney: false },
      ],
      daily: [{ dateKey: "2026-09-20", weekday: 0, collected: 12000, patientsSeen: 9 }],
      previousDaily: [],
      bestDay: "2026-09-24",
      quietestDay: "2026-09-20",
      topProcedures: [{ name: "Filling", count: 12, revenue: 24000 }, { name: "Cleaning", count: 8, revenue: 8000 }],
      collectionRate: 78,
      payrollMonthToDate: 40000,
    },
  });
  week.money!.collected = 85000;
  week.counts = { total: 70, attended: 61, cancelled: 9, stillScheduled: 0 };
  const prefs = reportPrefs("weeklyReport", {});
  ok(prefs.sections.team, "the weekly report should include the team by default");
  const weekly = renderStaffReport({ kind: "weekly", clinicName: "Alpha Dental", today: week, prefs, access: { money: true, hr: true } });
  ok(weekly.includes("تقرير الأسبوع") && weekly.includes("20/9 – 26/9"), "weekly heading or range missing");
  ok(weekly.includes("85,000 ج.م") && weekly.includes("↑ 12%"), "weekly collected or its arrow missing");
  ok(weekly.includes("نسبة التحصيل من الفواتير: 78%"), "collection rate missing");
  ok(weekly.includes("أحسن يوم") && weekly.includes("الخميس"), "best day missing");
  ok(weekly.includes("Filling 12"), "top procedures missing");
  ok(weekly.includes("70 محجوز") && weekly.includes("61 اتشاف") && weekly.includes("↓ 25%"), "weekly appointment counts or the missed arrow are wrong");
  ok(weekly.includes("1 أيام تأخير") && weekly.includes("1 أيام غياب"), "weekly team line missing");
  const weeklyReception = renderStaffReport({ kind: "weekly", clinicName: "Alpha Dental", today: week, prefs, access: { money: false, hr: false } });
  ok(!weeklyReception.includes("ج.م") && !weeklyReception.includes("تكلفة العمالة"), "a receptionist's weekly report leaks money or labour cost");

  // The month.
  const monthly = renderStaffReport({ kind: "monthly", clinicName: "Alpha Dental", today: { ...week, period: "month", startDate: "2026-09-01", endDate: "2026-09-30" }, prefs: { ...reportPrefs("monthlyReport", {}), language: "en" }, access: { money: true, hr: true } });
  ok(monthly.includes("The month — September 2026"), "monthly heading missing");
  ok(monthly.includes("Collected: 85,000 EGP"), "monthly collected missing");

  // The pay sheet: per person, with the total; HR-only.
  const payroll = renderStaffReport({ kind: "payroll", clinicName: "Alpha Dental", today: { ...week, period: "month", startDate: "2026-09-01", endDate: "2026-09-30" }, prefs: reportPrefs("payrollReport", {}), access: { money: true, hr: true } });
  ok(payroll.includes("كشف الحضور والمرتبات") && payroll.includes("سبتمبر 2026"), "payroll heading missing");
  ok(payroll.includes("Ahmed (دكتور)") && payroll.includes("اتأخر 20 دقيقة") && payroll.includes("Nour") && payroll.includes("غاب 1"), "payroll rows missing");
  ok(payroll.includes("إجمالي المرتبات التقديري"), "payroll total missing");
  ok(payroll.includes("العمولات في شاشة المرتبات"), "payroll note missing");

  // The PDF: a real file, the reader's access respected, and an honest fallback without an Arabic font.
  const pdfEn = await buildReportPdf({ kind: "evening", clinicName: "Alpha Dental", briefing: briefing(), prefs: { ...reportPrefs("eveningDigest", {}), language: "en" }, access: { money: true, hr: true } });
  ok(pdfEn.bytes.length > 2000 && String.fromCharCode(...pdfEn.bytes.slice(0, 5)) === "%PDF-", "the English PDF is not a PDF");
  eq(pdfEn.language, "en", "English PDF language");
  eq(pdfEn.filename, "close-out-2026-09-27.pdf", "PDF filename");
  const arabicFont = await arabicPdfAvailable();
  const pdfAr = await buildReportPdf({ kind: "weekly", clinicName: "ألفا دنتال", briefing: week, prefs, access: { money: false, hr: false } });
  eq(pdfAr.language, arabicFont ? "ar" : "en", "an Arabic PDF without an Arabic font must fall back to English, never to blank glyphs");
  ok(pdfAr.bytes.length > 2000, "the weekly PDF is empty");
  const pdfPay = await buildReportPdf({ kind: "payroll", clinicName: "Alpha Dental", briefing: { ...week, period: "month", startDate: "2026-09-01", endDate: "2026-09-30" }, prefs: { ...reportPrefs("payrollReport", {}), language: "en" }, access: { money: true, hr: true } });
  ok(pdfPay.filename === "payroll-2026-09-30.pdf", "payroll PDF filename");
  // The Cairo file the site ships is Latin-only; the PDF must never be pointed at it.
  ok(!read("src/lib/reports/staffReportPdf.ts").includes("Cairo-Regular"), "the PDF uses Cairo-Regular.ttf, which has no Arabic glyphs");
}

// --- 7. The real-time alerts: thresholds, batching, the complaint words ------------------------------
{
  // The owner's numbers, as defaults.
  eq(notifyTiming("discountAbove", "percent", {}), 20, "discount threshold");
  eq(notifyTiming("expenseAbove", "amount", {}), 2000, "expense threshold");
  eq(notifyTiming("patientWaitingLong", "minutes", {}), 20, "waiting threshold");
  eq(notifyTiming("staffLate", "minutes", {}), 15, "late threshold");
  eq(notifyTiming("staffAbsent", "hour", {}), 11, "absent hour");
  eq(notifyTiming("labCaseOverdue", "days", {}), 1, "lab overdue days");
  eq(notifyTiming("aiCreditsLow", "credits", {}), 20, "credits floor");
  eq(notifyTiming("expenseAbove", "amount", { timings: { expenseAbove: { amount: 5000 } } }), 5000, "a clinic's own threshold is ignored");
  for (const id of ["discountAbove", "expenseAbove", "paymentBackdated", "noShowMarked", "sameDayCancellation", "walkInBooked", "patientWaitingLong", "complaintKeyword", "staffLate", "staffAbsent", "labCaseOverdue", "aiCreditsLow"]) {
    ok(notifyEvent(id)?.waReady, `"${id}" has no WhatsApp switch although the web server raises it`);
  }
  for (const id of ["discountAbove", "expenseAbove", "paymentBackdated", "staffLate", "staffAbsent"]) {
    const r = resolveNotify(id, { events: { [id]: { roles: ["Owner", "Receptionist"] } } });
    ok(r && !r.roles.includes("Receptionist"), `"${id}" can reach reception`);
  }

  // Batching: instant unless asked; never for a report; the settings value survives.
  eq(resolveNotify("noShowMarked", {})?.batching, "instant", "default batching");
  eq(resolveNotify("noShowMarked", { events: { noShowMarked: { batching: "hourly" } } })?.batching, "hourly", "saved batching");
  eq(resolveNotify("noShowMarked", { events: { noShowMarked: { batching: "weird" as never } } })?.batching, "instant", "a bad batching value must fall back");
  eq(resolveNotify("eveningDigest", { events: { eveningDigest: { batching: "daily" } } })?.batching, "instant", "a report must never be batched");
  const delivery = read("src/lib/notificationDelivery.ts");
  ok(/resolved\.batching !== "instant" && !uids && !flushingBatch/.test(delivery), "the queue check lost its test/flush exceptions — a digest would queue itself forever");
  ok(delivery.indexOf("alert_queue") > delivery.indexOf("bellWritten = true"), "batched alerts skip the bell row — the record must always be written");

  // The digest wording.
  const grouped = groupQueued([
    { id: "1", event: "noShowMarked", title: "No-show", body: "Mona — 10:00", whatsappText: "", bucket: "hourly", date: "2026-09-27" },
    { id: "2", event: "noShowMarked", title: "No-show", body: "Omar — 11:00", whatsappText: "", bucket: "hourly", date: "2026-09-27" },
    { id: "3", event: "walkInBooked", title: "Walk-in", body: "Sara — 12:00", whatsappText: "", bucket: "hourly", date: "2026-09-27" },
  ], "en");
  eq(grouped.length, 2, "one message per event");
  ok(grouped[0].title === "2 × A patient did not show up" && grouped[0].whatsappText.includes("• Mona — 10:00") && grouped[0].whatsappText.includes("• Omar — 11:00"), "grouped digest wording");
  ok(groupQueued([{ id: "1", event: "noShowMarked", title: "", body: "x", whatsappText: "", bucket: "daily", date: "" }], "ar")[0].title.includes("مريض مجاش"), "Arabic digest label");

  // Complaints.
  for (const t of ["انا زعلان جدا من المعاملة", "عايز استرجاع فلوسي", "This is unacceptable, I want a refund", "هرفع شكوى", "الخدمة وحشة"]) ok(matchesComplaint(t), `not seen as a complaint: ${t}`);
  for (const t of ["عايز احجز بكرة", "شكرا جدا", "Hi", "ممكن ميعاد الساعة ٥", "تمام"]) ok(!matchesComplaint(t), `wrongly seen as a complaint: ${t}`);

  // Discounts.
  eq(discountPercentOf({ listPrice: 1000, discountAmount: 250 }), 25, "discount percent from list price");
  eq(discountPercentOf({ cost: 750, discountAmount: 250 }), 25, "discount percent from cost + discount");
  eq(discountPercentOf({ listPrice: 1000 }), 0, "no discount");

  // The sweep is scheduled, and every money write path calls the hooks.
  const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
  ok(vercel.crons.some((c) => c.path === "/api/automation/alert-sweep" && c.schedule === "*/10 * * * *"), "the alert sweep is not scheduled every ten minutes");
  const ledger = read("src/app/api/finance/ledger/route.ts");
  ok((ledger.match(/afterLedgerCreate\(/g) || []).length === 2 && ledger.includes("afterLedgerUpdate(") && ledger.includes("afterLedgerDelete("), "a ledger write path has no money-alert hook");
  ok(read("src/app/api/clinical/procedures/route.ts").includes("afterChargeCreate("), "a discounted charge from the clinical route raises nothing");
  const svc = read("src/lib/bookingService.ts");
  ok(svc.includes('"appointment_no_show"') && svc.includes('"appointment_same_day_cancel"') && svc.includes('"appointment_walk_in"'), "the booking service does not raise the flow alerts");
  for (const rel of ["src/components/dashboard/DesktopDashboard.tsx", "src/components/dashboard/MobileDashboard.tsx"]) {
    ok(read(rel).includes('"appointment_no_show"'), `${rel} status buttons do not raise the no-show alert`);
  }
  for (const rel of ["src/app/api/webhooks/meta-whatsapp/route.ts", "src/app/api/webhooks/whatsapp-inbound/route.ts"]) {
    ok(read(rel).includes("raiseComplaintIfAny("), `${rel} never checks for complaints`);
  }
}

console.log(`staffReports: ${checks} checks passed`);
