const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const path = require("path");
const { DateTime } = require("luxon");
const pdfMake = require("pdfmake");

if (!admin.apps.length) {
  admin.initializeApp();
}

const { sendWapilotWhatsApp, getWapilotConfig, normalizeToInternationalDigits } = require("./wapilotClient");

/** IANA timezone for end-of-day reports (11:50 PM local cron). Override with CLINIC_TIMEZONE env. */
const { getFirestore } = require("firebase-admin/firestore");

const CLINIC_TIMEZONE = process.env.CLINIC_TIMEZONE || "Africa/Cairo";

/**
 * This project's Firestore database is literally named "default", not the conventional
 * "(default)". `admin.firestore()` binds the latter — a database that does not exist here — and
 * every query against it succeeds while matching nothing. That is precisely how this report ran
 * nightly for months finding no data and reporting no error. Every module written after that was
 * discovered uses this binding; the scheduled report never got the fix.
 */
const db = () => getFirestore(admin.app(), "default");

const PDFMAKE_FONTS = {
  Roboto: {
    normal: path.join(__dirname, "node_modules/pdfmake/fonts/Roboto/Roboto-Regular.ttf"),
    bold: path.join(__dirname, "node_modules/pdfmake/fonts/Roboto/Roboto-Medium.ttf"),
    italics: path.join(__dirname, "node_modules/pdfmake/fonts/Roboto/Roboto-Italic.ttf"),
    bolditalics: path.join(__dirname, "node_modules/pdfmake/fonts/Roboto/Roboto-MediumItalic.ttf"),
  },
};
pdfMake.setFonts(PDFMAKE_FONTS);
pdfMake.setUrlAccessPolicy(() => false);

// ==========================================
// WAPILOT — see `wapilotClient.js` (same env contract as Next.js `src/lib/whatsapp.ts`)
// ==========================================

/**
 * Attempts Wapilot document send if the instance exposes send-document; falls back to false.
 * PDF must be reachable via HTTPS (e.g. signed Storage URL).
 */
async function trySendWapilotDocument(phone, fileUrl, filename, caption) {
  const { token, instanceId, apiRoot } = await getWapilotConfig();
  const baseUrl = apiRoot;
  if (!token || !instanceId || !fileUrl) return false;
  const digits = normalizeToInternationalDigits(phone);
  if (!digits) return false;
  const tryUrls = [
    `${baseUrl}/${encodeURIComponent(instanceId)}/send-document`,
    `${baseUrl}/${encodeURIComponent(instanceId)}/send-media`,
  ];
  const bodies = [
    { chat_id: `${digits}@c.us`, url: fileUrl, filename: filename || "report.pdf", caption: caption || "" },
    { chat_id: `${digits}@c.us`, media_url: fileUrl, filename: filename || "report.pdf", caption: caption || "" },
    { chat_id: `${digits}@c.us`, file: fileUrl, filename: filename || "report.pdf", caption: caption || "" },
  ];
  for (const docUrl of tryUrls) {
    for (const body of bodies) {
      try {
        const res = await fetch(docUrl, {
          method: "POST",
          headers: { Token: token, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) return true;
      } catch (_) {
        /* try next */
      }
    }
  }
  return false;
}

function ledgerRowAmount(d) {
  const typ = d.type;
  if (typ === "payment") return Number(d.paid) || 0;
  if (typ === "income") return Number(d.paid || d.amount || d.cost) || 0;
  if (typ === "expense") return Number(d.cost ?? d.amount ?? 0) || 0;
  return 0;
}

function isLedgerDeleted(d) {
  return d.status === "deleted" || d.status === "cancelled";
}

/**
 * The clinics this job should report on.
 *
 * Same shape as marketingClinics() in marketingAutomations.js: read the whole collection and
 * filter in memory, treating a missing `status` as Active so a clinic created before the field
 * existed is not silently skipped. Carries the clinic document along, so the name is available
 * without a second read.
 */
async function reportableClinics() {
  const snap = await db().collection("clinics").get();
  return snap.docs
    .map((doc) => ({ id: doc.id, data: doc.data() || {} }))
    .filter(({ data }) => !data.status || data.status === "Active");
}

/** The clinic's own name for the report header, falling back the way the other jobs do. */
async function clinicNameFor(clinicId, clinicData) {
  try {
    const snap = await db().doc(`clinics/${clinicId}/settings/clinicProfile`).get();
    const profile = snap.exists ? snap.data() || {} : {};
    const fromProfile = typeof profile.clinicName === "string" ? profile.clinicName.trim() : "";
    if (fromProfile) return fromProfile;
  } catch (e) {
    console.warn(`dailyClinicReport: clinicProfile unreadable for ${clinicId}`, e);
  }
  const fromClinic = typeof clinicData.name === "string" ? clinicData.name.trim() : "";
  return fromClinic || "Clinic";
}

function renderPdfTableRows(rows, cols) {
  const header = cols.map((c) => ({ text: c.label, style: "tableHeader" }));
  const body = [header, ...rows.map((r) => cols.map((c) => String(r[c.key] ?? "")))];
  return body;
}

/**
 * A caption that admits when the table below it is not the whole story.
 *
 * The tables are capped, but the Summary counts come from the untruncated arrays — so a busy day
 * printed "Procedures logged: 95" above a table of 80 with nothing to explain the gap. One tenant
 * rarely reached the cap; several will.
 */
function tableCaption(label, shown, total) {
  return total > shown ? `${label} — showing ${shown} of ${total}` : label;
}

async function buildDailyClinicPdfBuffer(report) {
  const fmtMoney = (n) => `${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} EGP`;

  const docDefinition = {
    pageMargins: [40, 50, 40, 50],
    content: [
      { text: "Daily Clinic Report", style: "title" },
      // Which clinic. With one tenant this was obvious; with several, an unlabelled PDF forwarded
      // or downloaded is indistinguishable from anyone else's.
      { text: report.clinicName || "Clinic", style: "h2", margin: [0, 2, 0, 0] },
      { text: `Generated: ${report.generatedAt} (${CLINIC_TIMEZONE})`, style: "muted" },
      { text: `Report date: ${report.dateLabel}`, style: "muted", margin: [0, 0, 0, 16] },
      {
        columns: [
          { width: "*", stack: [{ text: "Summary", style: "h2" }, { text: `Payments (income): ${fmtMoney(report.totals.income)}`, style: "li" }, { text: `Expenses: ${fmtMoney(report.totals.expenses)}`, style: "li" }, { text: `Net: ${fmtMoney(report.totals.net)}`, style: "liBold" }] },
          { width: "*", stack: [{ text: "Activity", style: "h2" }, { text: `Procedures logged: ${report.counts.procedures}`, style: "li" }, { text: `Appointments completed: ${report.counts.completedAppts}`, style: "li" }, { text: `Appointments cancelled: ${report.counts.cancelledAppts}`, style: "li" }] },
        ],
        margin: [0, 0, 0, 20],
      },
      { text: tableCaption("Completed appointments (same day)", Math.min(60, report.completedAppts.length), report.completedAppts.length), style: "h2", margin: [0, 8, 0, 6] },
      {
        table: {
          widths: ["*", 70, "*", 70],
          body: renderPdfTableRows(report.completedAppts.slice(0, 60), [
            { key: "patientName", label: "Patient" },
            { key: "time", label: "Time" },
            { key: "doctor", label: "Doctor" },
            { key: "status", label: "Status" },
          ]),
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 16],
      },
      { text: tableCaption("Cancelled appointments (same day)", Math.min(60, report.cancelledAppts.length), report.cancelledAppts.length), style: "h2", margin: [0, 8, 0, 6] },
      {
        table: {
          widths: ["*", 70, "*", 70],
          body: renderPdfTableRows(report.cancelledAppts.slice(0, 60), [
            { key: "patientName", label: "Patient" },
            { key: "time", label: "Time" },
            { key: "doctor", label: "Doctor" },
            { key: "status", label: "Status" },
          ]),
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 16],
      },
      { text: tableCaption("Procedures logged (ledger)", Math.min(80, report.procedures.length), report.procedures.length), style: "h2", margin: [0, 8, 0, 6] },
      {
        table: {
          widths: ["*", "*", 60],
          body: renderPdfTableRows(report.procedures.slice(0, 80), [
            { key: "patientName", label: "Patient" },
            { key: "description", label: "Procedure" },
            { key: "cost", label: "Cost" },
          ]),
        },
        layout: "lightHorizontalLines",
      },
    ],
    styles: {
      title: { fontSize: 20, bold: true },
      h2: { fontSize: 12, bold: true, color: "#1e293b" },
      muted: { fontSize: 9, color: "#64748b" },
      li: { fontSize: 10, margin: [0, 2, 0, 0] },
      liBold: { fontSize: 10, bold: true, margin: [0, 4, 0, 0] },
      tableHeader: { bold: true, fillColor: "#e2e8f0", fontSize: 9 },
    },
    defaultStyle: { font: "Roboto", fontSize: 9 },
  };

  const pdfDoc = pdfMake.createPdf(docDefinition);
  return pdfDoc.getBuffer();
}

/**
 * One clinic's day, reported to that clinic's owner.
 *
 * This job was written when the system served a single practice, and never migrated. It read the
 * ROOT `ledger`, `appointments` and `settings/whatsapp` — paths this database has never held,
 * since everything lives under `clinics/{clinicId}/` — through `admin.firestore()`, which binds a
 * database that does not exist here. Both mistakes fail the same silent way: the queries succeed
 * and match nothing. So it ran every night at 23:50, found an empty clinic, rendered a PDF of
 * zeros, and then returned early because the owner's number was read from the same empty root.
 * Nobody was ever sent anything, and nothing ever errored.
 *
 * Now it walks the clinics and reports each one to its own owner. The shape follows eveningDigest
 * in pushPhase1.js deliberately — same clinic enumeration, same `date` field, same cash-basis rule
 * — so the nightly report and the 21:00 push cannot disagree about what the day earned.
 */
async function runDailyClinicReportForClinic(clinic, dateLabel, generatedAt) {
  const clinicId = clinic.id;

  // Queried on the `date` string, not a createdAt range. `date` is the field the whole system
  // treats as authoritative — a payment entered next morning for yesterday belongs to yesterday,
  // and a createdAt window would file it under the wrong day or lose it between two reports.
  const [ledgerSnap, apptSnap, waSnap] = await Promise.all([
    db().collection(`clinics/${clinicId}/ledger`).where("date", "==", dateLabel).get(),
    db().collection(`clinics/${clinicId}/appointments`).where("date", "==", dateLabel).get(),
    db().doc(`clinics/${clinicId}/settings/whatsapp`).get(),
  ]);

  let income = 0;
  let expenses = 0;
  const procedures = [];

  ledgerSnap.forEach((doc) => {
    const d = doc.data();
    if (isLedgerDeleted(d)) return;
    if (d.type === "procedure") {
      procedures.push({
        patientName: d.patientName || "—",
        description: (d.description || d.serviceName || "Procedure").slice(0, 120),
        cost: String(Number(d.cost) || 0),
      });
      return;
    }
    if (d.type === "payment" || d.type === "income") {
      income += ledgerRowAmount(d);
      return;
    }
    if (d.type === "expense") {
      expenses += ledgerRowAmount(d);
    }
  });

  const apptRows = [];
  apptSnap.forEach((doc) => {
    const a = doc.data();
    apptRows.push({
      patientName: a.patientName || "—",
      time: a.time || "—",
      doctor: a.doctor || "—",
      status: a.status || "—",
    });
  });

  const completedAppts = apptRows.filter((r) => r.status === "Completed");
  const cancelledAppts = apptRows.filter((r) => r.status === "Cancelled");

  // A clinic that saw nobody gets no message. Reporting zeros is worse than saying nothing: it
  // reads as a measurement, and a closed Friday would look identical to a broken job — which is
  // exactly how the old version hid for so long.
  const hadActivity =
    income !== 0 || expenses !== 0 || procedures.length > 0 || apptRows.length > 0;
  if (!hadActivity) {
    return { clinicId, skipped: "no activity" };
  }

  const clinicName = await clinicNameFor(clinicId, clinic.data);
  const report = {
    clinicName,
    dateLabel,
    generatedAt,
    totals: { income, expenses, net: income - expenses },
    counts: {
      procedures: procedures.length,
      completedAppts: completedAppts.length,
      cancelledAppts: cancelledAppts.length,
    },
    completedAppts,
    cancelledAppts,
    procedures,
  };

  const pdfBuffer = await buildDailyClinicPdfBuffer(report);
  const safeDay = dateLabel.replace(/[^0-9-]/g, "");
  // Clinic-prefixed. The old path was `daily-reports/{date}/Daily-Clinic-Report.pdf` with nothing
  // identifying the tenant, so two clinics on one day wrote the same object and the second
  // overwrote the first — handing one practice's owner a link to another practice's patients.
  const filePath = `clinics/${clinicId}/daily-reports/${safeDay}/Daily-Clinic-Report.pdf`;
  const file = admin.storage().bucket().file(filePath);
  await file.save(pdfBuffer, {
    contentType: "application/pdf",
    metadata: {
      cacheControl: "private, max-age=0",
      contentDisposition: `attachment; filename="Daily-Clinic-Report-${safeDay}.pdf"`,
    },
  });

  // 48 hours, not a week. The URL needs no authentication and the PDF carries every patient seen
  // that day by name, so its lifetime is the whole of its access control — and a report is read
  // the morning after or not at all.
  const [signedUrl] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 48 * 60 * 60 * 1000,
  });

  const waSettings = waSnap.exists ? waSnap.data() || {} : {};
  const ownerRaw = typeof waSettings.ownerNumber === "string" ? waSettings.ownerNumber.trim() : "";
  if (!ownerRaw) {
    console.warn(`dailyClinicReport: no ownerNumber for ${clinicId}; PDF stored, nobody notified.`);
    return { clinicId, report, filePath, ownerNotified: false };
  }

  const summary = [
    `📊 *Daily Clinic Report* — ${clinicName}`,
    "",
    `📅 *Date:* ${dateLabel}`,
    "",
    `💵 *Payments (income):* ${report.totals.income.toLocaleString()} EGP`,
    `🔻 *Expenses:* ${report.totals.expenses.toLocaleString()} EGP`,
    `📈 *Net:* ${report.totals.net.toLocaleString()} EGP`,
    "",
    `🦷 *Procedures logged:* ${report.counts.procedures}`,
    `✅ *Appts completed:* ${report.counts.completedAppts}`,
    `❌ *Appts cancelled:* ${report.counts.cancelledAppts}`,
    "",
    `📎 *Download PDF:*`,
    signedUrl,
  ].join("\n");

  const docCaption = `Daily Clinic Report — ${clinicName} — ${dateLabel}`;
  const docSent = await trySendWapilotDocument(
    ownerRaw,
    signedUrl,
    `Daily-Clinic-Report-${safeDay}.pdf`,
    docCaption
  );
  if (!docSent) await sendWapilotWhatsApp(ownerRaw, summary);

  return { clinicId, report, filePath, ownerNotified: true };
}

async function runDailyClinicReportJob() {
  const dateLabel = DateTime.now().setZone(CLINIC_TIMEZONE).toFormat("yyyy-MM-dd");
  const generatedAt = DateTime.now().setZone(CLINIC_TIMEZONE).toFormat("yyyy-MM-dd HH:mm");
  const clinics = await reportableClinics();

  const outcomes = [];
  for (const clinic of clinics) {
    try {
      outcomes.push(await runDailyClinicReportForClinic(clinic, dateLabel, generatedAt));
    } catch (e) {
      // One clinic's failure must not cost every other clinic its report. The previous version
      // rethrew, which with a single tenant meant "the job failed" and now would mean "everyone
      // after the first broken clinic gets nothing".
      console.error(`dailyClinicReportToOwner failed for ${clinic.id}:`, e);
      outcomes.push({ clinicId: clinic.id, error: String(e && e.message ? e.message : e) });
    }
  }

  const sent = outcomes.filter((o) => o.ownerNotified).length;
  const skipped = outcomes.filter((o) => o.skipped).length;
  const failed = outcomes.filter((o) => o.error).length;
  console.log(
    `dailyClinicReportToOwner: ${clinics.length} clinic(s) — ${sent} sent, ${skipped} idle, ${failed} failed`
  );
  return outcomes;
}

exports.dailyClinicReportToOwner = onSchedule(
  {
    schedule: "50 23 * * *",
    timeZone: CLINIC_TIMEZONE,
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async () => {
    try {
      await runDailyClinicReportJob();
    } catch (e) {
      console.error("dailyClinicReportToOwner failed:", e);
    }
  }
);
// ==========================================
// META LEAD ADS — see `metaLeads.js`
// ==========================================

// Push phase 1: targeted pushes — arrival to the treating dentist, the morning
// brief, lead follow-ups due, and the owner's evening digest. See pushPhase1.js.
// Marketing automations (Phase 2b): nightly review requests with the happy-check link,
// birthday campaigns, lead speed alerts, and the occasion radar. See marketingAutomations.js.
const marketingAutomations = require("./marketingAutomations");
exports.reviewRequestsNightly = marketingAutomations.reviewRequestsNightly;
exports.birthdayCampaigns = marketingAutomations.birthdayCampaigns;
exports.leadSpeedAlerts = marketingAutomations.leadSpeedAlerts;
exports.occasionRadarPush = marketingAutomations.occasionRadarPush;

const pushPhase1 = require("./pushPhase1");
exports.onPatientCheckedIn = pushPhase1.onPatientCheckedIn;
exports.onSlotFreed = pushPhase1.onSlotFreed;
exports.onLowStock = pushPhase1.onLowStock;
exports.morningBrief = pushPhase1.morningBrief;
exports.leadsDueToday = pushPhase1.leadsDueToday;
exports.eveningDigest = pushPhase1.eveningDigest;
exports.stuckMessagesAlert = pushPhase1.stuckMessagesAlert;
exports.handoffSla = require("./handoffSla").handoffSla;

const { handleMetaWebhook, retryPendingLeadEvents } = require("./metaLeads");

/** Both Meta functions bind the named "default" database explicitly. */
const metaDb = () => getFirestore(admin.app(), "default");
const metaToday = () => DateTime.now().setZone(CLINIC_TIMEZONE).toFormat("yyyy-MM-dd");

/**
 * Receiving door for Facebook/Instagram lead forms. Reads and writes the project's
 * named "default" database — `admin.firestore()` would silently target the
 * non-existent "(default)" one.
 */
exports.metaLeadsWebhook = onRequest({ timeoutSeconds: 60 }, async (req, res) => {
  const db = getFirestore(admin.app(), "default");
  const todayStr = DateTime.now().setZone(CLINIC_TIMEZONE).toFormat("yyyy-MM-dd");
  try {
    await handleMetaWebhook(req, res, db, todayStr);
  } catch (e) {
    console.error("metaLeadsWebhook fatal:", e);
    if (!res.headersSent) res.status(500).send("Internal error");
  }
});

/**
 * Second chance for every lead Meta would not hand over on the first ping, and for leads
 * that arrived before their page was connected to a clinic. Stubs heal in place; nothing
 * waits on a human noticing. Fifteen minutes is a compromise between Graph rate limits and
 * how fast an ad lead goes cold.
 */
exports.retryMetaLeadEvents = onSchedule(
  { schedule: "*/15 * * * *", timeZone: CLINIC_TIMEZONE, timeoutSeconds: 300 },
  async () => {
    try {
      const summary = await retryPendingLeadEvents(metaDb(), metaToday());
      if (summary.examined > 0) console.log("retryMetaLeadEvents:", JSON.stringify(summary));
    } catch (e) {
      console.error("retryMetaLeadEvents failed:", e);
    }
  }
);
