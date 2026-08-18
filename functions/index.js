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
const CLINIC_TIMEZONE = process.env.CLINIC_TIMEZONE || "Africa/Cairo";

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

function getReportDayBounds(now = new Date()) {
  const zoned = DateTime.fromJSDate(now, { zone: CLINIC_TIMEZONE });
  const dateLabel = zoned.toFormat("yyyy-MM-dd");
  const start = DateTime.fromISO(dateLabel, { zone: CLINIC_TIMEZONE }).startOf("day");
  const end = start.endOf("day");
  return {
    dateLabel,
    startTs: admin.firestore.Timestamp.fromDate(start.toJSDate()),
    endTs: admin.firestore.Timestamp.fromDate(end.toJSDate()),
  };
}

function renderPdfTableRows(rows, cols) {
  const header = cols.map((c) => ({ text: c.label, style: "tableHeader" }));
  const body = [header, ...rows.map((r) => cols.map((c) => String(r[c.key] ?? "")))];
  return body;
}

async function buildDailyClinicPdfBuffer(report) {
  const fmtMoney = (n) => `${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} EGP`;

  const docDefinition = {
    pageMargins: [40, 50, 40, 50],
    content: [
      { text: "Daily Clinic Report", style: "title" },
      { text: `Generated: ${report.generatedAt} (${CLINIC_TIMEZONE})`, style: "muted" },
      { text: `Report date: ${report.dateLabel}`, style: "muted", margin: [0, 0, 0, 16] },
      {
        columns: [
          { width: "*", stack: [{ text: "Summary", style: "h2" }, { text: `Payments (income): ${fmtMoney(report.totals.income)}`, style: "li" }, { text: `Expenses: ${fmtMoney(report.totals.expenses)}`, style: "li" }, { text: `Net: ${fmtMoney(report.totals.net)}`, style: "liBold" }] },
          { width: "*", stack: [{ text: "Activity", style: "h2" }, { text: `Procedures logged: ${report.counts.procedures}`, style: "li" }, { text: `Appointments completed: ${report.counts.completedAppts}`, style: "li" }, { text: `Appointments cancelled: ${report.counts.cancelledAppts}`, style: "li" }] },
        ],
        margin: [0, 0, 0, 20],
      },
      { text: "Completed appointments (same day)", style: "h2", margin: [0, 8, 0, 6] },
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
      { text: "Cancelled appointments (same day)", style: "h2", margin: [0, 8, 0, 6] },
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
      { text: "Procedures logged (ledger)", style: "h2", margin: [0, 8, 0, 6] },
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

async function runDailyClinicReportJob() {
  const { dateLabel, startTs, endTs } = getReportDayBounds();
  const generatedAt = DateTime.now().setZone(CLINIC_TIMEZONE).toFormat("yyyy-MM-dd HH:mm");

  const [ledgerSnap, apptSnap, settingsSnap] = await Promise.all([
    admin.firestore().collection("ledger").where("createdAt", ">=", startTs).where("createdAt", "<=", endTs).get(),
    admin.firestore().collection("appointments").where("date", "==", dateLabel).get(),
    admin.firestore().collection("settings").doc("whatsapp").get(),
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

  const report = {
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
  const bucket = admin.storage().bucket();
  const safeDay = dateLabel.replace(/[^0-9-]/g, "");
  const filePath = `daily-reports/${safeDay}/Daily-Clinic-Report.pdf`;
  const file = bucket.file(filePath);
  await file.save(pdfBuffer, {
    contentType: "application/pdf",
    metadata: { cacheControl: "private, max-age=0", contentDisposition: `attachment; filename="Daily-Clinic-Report-${safeDay}.pdf"` },
  });

  const [signedUrl] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  const waSettings = settingsSnap.exists ? settingsSnap.data() : {};
  const ownerRaw = typeof waSettings.ownerNumber === "string" ? waSettings.ownerNumber.trim() : "";
  if (!ownerRaw) {
    console.warn("dailyClinicReport: settings/whatsapp.ownerNumber missing; PDF uploaded only.");
    return { report, signedUrl, ownerNotified: false };
  }

  const summary = [
    "📊 *Daily Clinic Report*",
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

  try {
    const docCaption = `Daily Clinic Report — ${dateLabel}`;
    const docSent = await trySendWapilotDocument(ownerRaw, signedUrl, `Daily-Clinic-Report-${safeDay}.pdf`, docCaption);
    if (!docSent) {
      await sendWapilotWhatsApp(ownerRaw, summary);
    }
  } catch (e) {
    console.error("dailyClinicReport: Wapilot notify failed", e);
    throw e;
  }

  return { report, signedUrl, ownerNotified: true };
}

/** Daily PDF clinic report → Firebase Storage signed URL → owner WhatsApp (settings/whatsapp.ownerNumber). */
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
const pushPhase1 = require("./pushPhase1");
exports.onPatientCheckedIn = pushPhase1.onPatientCheckedIn;
exports.morningBrief = pushPhase1.morningBrief;
exports.leadsDueToday = pushPhase1.leadsDueToday;
exports.eveningDigest = pushPhase1.eveningDigest;

const { handleMetaWebhook, retryPendingLeadEvents } = require("./metaLeads");
const { getFirestore } = require("firebase-admin/firestore");

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
