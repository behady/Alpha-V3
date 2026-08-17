const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const path = require("path");
const { DateTime } = require("luxon");
const pdfMake = require("pdfmake");

if (!admin.apps.length) {
  admin.initializeApp();
}

const { mergeWhatsappTemplate, resolveWhatsappTemplate } = require("./whatsappMessageDefaults");
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

/**
 * Writes an in-app notification-bell entry for staff.
 * @param {Object} eventContext - Contains { type }
 */
async function sendAlert(title, body, eventContext, actionUrl = "") {
  try {
    await admin.firestore().collection("notifications").add({
      title, body, eventType: eventContext.type, actionUrl,
      createdAt: admin.firestore.FieldValue.serverTimestamp(), read: false
    });
  } catch (error) {
    console.error("Alert Error:", error);
  }
}

// FORMATTER
const formatApptMessage = (appt) => {
  let msg = `👤 <b>Patient:</b> ${appt.patientName || 'Unknown'}\n`;
  const phone = appt.phone || appt.patientPhone;
  if (phone) msg += `📱 <b>Phone:</b> ${phone}\n`;
  const service = appt.treatment || appt.service || appt.notes;
  if (service) msg += `🦷 <b>Service:</b> ${service}\n`;
  if (appt.doctor) msg += `👨‍⚕️ <b>Doctor:</b> ${appt.doctor}\n`;
  msg += `📅 <b>Date:</b> ${appt.date}\n⏰ <b>Time:</b> ${appt.time}`;
  if (appt.addedBy || appt.modifiedBy) msg += `\n\n✍️ <b>By:</b> ${appt.addedBy || appt.modifiedBy}`;
  return msg;
};

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

/**
 * @param {string} patientId
 * @param {string} type - Template event: new | edit | cancel
 * @param {string} message - Outbound text (processed template)
 * @param {string} status - success | failed
 */
async function logWhatsAppMessage(patientId, type, message, status) {
  await admin.firestore().collection("whatsapp_logs").add({
    patientId: patientId || null,
    type,
    message,
    status,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function pickPatientPhone(patient) {
  if (!patient || typeof patient !== "object") return "";
  const keys = ["phone", "phoneNumber", "phoneE164", "patientPhone", "mobile", "whatsapp", "whatsApp", "contactNumber", "telephone", "primaryPhone"];
  for (const k of keys) {
    const v = patient[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Same field names as patient; used when automation runs from appointment triggers but phone lives only on the appointment doc (legacy / imports). */
function pickPhoneFromAppointment(appt) {
  if (!appt || typeof appt !== "object") return "";
  const keys = ["phone", "phoneNumber", "phoneE164", "patientPhone", "mobile", "whatsapp", "whatsApp", "contactNumber", "telephone", "primaryPhone"];
  for (const k of keys) {
    const v = appt[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Resolve patient record from appointment payload.
 * Primary key: patientId. Fallback: exact patientName match (same behavior as manual reminder endpoint).
 * @param {Record<string, unknown>} apptData
 * @returns {Promise<{ patientId: string, patient: Record<string, unknown> }|null>}
 */
async function resolvePatientFromAppointment(apptData) {
  const db = admin.firestore();
  const patientId = typeof apptData.patientId === "string" ? apptData.patientId.trim() : "";
  if (patientId) {
    const snap = await db.collection("patients").doc(patientId).get();
    if (snap.exists) return { patientId, patient: snap.data() || {} };
  }

  const patientName = typeof apptData.patientName === "string" ? apptData.patientName.trim() : "";
  if (!patientName) return null;

  const byName = await db.collection("patients").where("name", "==", patientName).limit(1).get();
  if (byName.empty) return null;
  return { patientId: byName.docs[0].id, patient: byName.docs[0].data() || {} };
}

async function getClinicDisplayName() {
  const db = admin.firestore();
  const prof = await db.collection("settings").doc("clinicProfile").get();
  if (prof.exists) {
    const p = prof.data();
    if (p && typeof p.clinicName === "string" && p.clinicName.trim()) return p.clinicName.trim();
  }
  const snap = await db.collection("settings").doc("clinic_info").get();
  if (!snap.exists) return "Alpha Dental";
  const c = snap.data();
  if (c && typeof c.clinicName === "string" && c.clinicName.trim()) return c.clinicName.trim();
  if (c && typeof c.name === "string" && c.name.trim()) return c.name.trim();
  return "Alpha Dental";
}

async function computePatientBalanceLedger(patientId) {
  const snap = await admin.firestore().collection("ledger").where("patientId", "==", patientId).get();
  let billed = 0;
  let paid = 0;
  snap.forEach((doc) => {
    const d = doc.data();
    if (d.status === "deleted" || d.status === "cancelled") return;
    if (d.type === "procedure") billed += Number(d.cost) || 0;
    if (d.type === "payment") paid += Number(d.paid) || 0;
  });
  return billed - paid;
}

/**
 * Patient WhatsApp: uses `settings/whatsapp` templates (see `whatsappMessageDefaults.js` fallbacks) or custom Firestore text.
 * @param {Record<string, unknown>} apptData
 * @param {'new'|'edit'|'cancel'} logType
 */
async function handlePatientWhatsAppFormatted(apptData, logType) {
  try {
    const settingsSnap = await admin.firestore().collection("settings").doc("whatsapp").get();
    const settings = settingsSnap.exists ? settingsSnap.data() : {};

    if (settings.isPatientAutomationEnabled !== true) {
      console.warn(
        "[patient WA] Skipped (appointment): enable 'Patient automation' in Settings → WhatsApp (settings/whatsapp.isPatientAutomationEnabled)."
      );
      return;
    }

    const template = resolveWhatsappTemplate(settings, logType);
    if (!template) {
      console.warn(`[patient WA] Skipped: template type "${logType}" is disabled in settings.`);
      return;
    }

    const resolved = await resolvePatientFromAppointment(apptData);
    if (!resolved) {
      console.warn("[patient WA] Skipped: could not resolve patient by patientId or patientName.");
      return;
    }
    const { patientId, patient } = resolved;
    if (patient.whatsappOptOut === true) return;

    let phone = pickPatientPhone(patient) || pickPhoneFromAppointment(apptData);
    if (!phone) {
      console.warn(
        `[patient WA] Skipped (${logType}): no phone on patients/${patientId} (and none on appointment). Add a phone on the patient profile — both automation and /api/automation/reminders read from there.`
      );
      return;
    }

    const ownerForTestWarning =
      typeof settings.ownerNumber === "string" ? settings.ownerNumber.trim() : "";
    if (
      ownerForTestWarning &&
      normalizeToInternationalDigits(phone) === normalizeToInternationalDigits(ownerForTestWarning)
    ) {
      console.warn(
        "[patient WA] Recipient digits match settings/whatsapp.ownerNumber. That is allowed. If this is also the phone logged into WhatsApp/Wapilot for this instance, some setups will not show API messages on that device—use a different test number to confirm automation."
      );
    }

    const clinicName = await getClinicDisplayName();
    const patientName = apptData.patientName || patient.name || "Unknown";
    const doctor = apptData.doctor || "—";
    const date = apptData.date || "—";
    const time = apptData.time || "—";

    const processed = mergeWhatsappTemplate(template, {
      patient_name: patientName,
      clinic_name: clinicName,
      doctor,
      date,
      time,
    });

    try {
      await sendWapilotWhatsApp(phone, processed);
      console.info(`[patient WA] sent ok type=${logType} patientId=${patientId}`);
      await logWhatsAppMessage(patientId, logType, processed, "success");
    } catch (err) {
      console.error("Wapilot patient message failed:", err);
      await logWhatsAppMessage(patientId, logType, processed, "failed");
    }
  } catch (error) {
    console.error("handlePatientWhatsAppFormatted:", error);
  }
}

/**
 * One-off patient receipt when a payment is posted to the ledger.
 * @param {Record<string, unknown>} ledgerData
 */
async function handlePatientWhatsAppPayment(ledgerData) {
  try {
    const settingsSnap = await admin.firestore().collection("settings").doc("whatsapp").get();
    const settings = settingsSnap.exists ? settingsSnap.data() : {};

    if (settings.isPatientAutomationEnabled !== true) {
      console.warn("[patient WA] Skipped (payment): patient automation not enabled in settings/whatsapp.");
      return;
    }

    const template = resolveWhatsappTemplate(settings, "invoice");
    if (!template) {
      console.warn("[patient WA] Skipped (payment): invoice template disabled or missing.");
      return;
    }

    const patientId = typeof ledgerData.patientId === "string" ? ledgerData.patientId : "";
    if (!patientId) return;

    const patientSnap = await admin.firestore().collection("patients").doc(patientId).get();
    if (!patientSnap.exists) return;

    const patient = patientSnap.data();
    if (patient.whatsappOptOut === true) return;

    const phone = pickPatientPhone(patient);
    if (!phone) {
      console.warn(`[patient WA] Skipped (payment): no phone on patients/${patientId}.`);
      return;
    }

    const clinicName = await getClinicDisplayName();
    const balance = await computePatientBalanceLedger(patientId);
    const amount = Number(ledgerData.paid) || 0;
    const patientName = typeof ledgerData.patientName === "string" && ledgerData.patientName.trim()
      ? ledgerData.patientName
      : (patient.name || "Unknown");
    const description = String(ledgerData.description || "—");
    const method = String(ledgerData.method || "—");

    const processed = mergeWhatsappTemplate(template, {
      patient_name: patientName,
      amount: amount.toLocaleString("en-US"),
      method,
      description,
      balance: balance.toLocaleString("en-US"),
      clinic_name: clinicName,
    });

    try {
      await sendWapilotWhatsApp(phone, processed);
      await logWhatsAppMessage(patientId, "invoice", processed, "success");
    } catch (err) {
      console.error("Wapilot payment WhatsApp failed:", err);
      await logWhatsAppMessage(patientId, "invoice", processed, "failed");
    }
  } catch (e) {
    console.error("handlePatientWhatsAppPayment:", e);
  }
}

// ----------------------------------------------------------------------
// EVENT TRIGGERS (Supplying Context)
// ----------------------------------------------------------------------

exports.notifyDoctorOnNewAppointment = onDocumentCreated("appointments/{appointmentId}", async (event) => {
  const newAppt = event.data.data();
  await sendAlert("New Booking | حجز جديد 📅", formatApptMessage(newAppt), {
    type: "newAppointment",
  }, `/patients/${newAppt.patientId}`);
  await handlePatientWhatsAppFormatted(newAppt, "new");
  return null;
});

exports.notifyDoctorOnUpdateAppointment = onDocumentUpdated("appointments/{appointmentId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();

  if (after.status === "Cancelled" && before.status !== "Cancelled") {
    await sendAlert("Cancelled | إلغاء موعد ❌", formatApptMessage(after), { type: "cancellation" }, `/patients/${after.patientId}`);
    await handlePatientWhatsAppFormatted(after, "cancel");
  } else if (after.status === "Delayed" && before.status !== "Delayed") {
    await sendAlert("Delayed | تأخير ⚠️", formatApptMessage(after), { type: "reschedule" }, `/patients/${after.patientId}`);
    await handlePatientWhatsAppFormatted(after, "edit");
  } else if (after.status !== "Cancelled" && (before.date !== after.date || before.time !== after.time)) {
    await sendAlert("Rescheduled | إعادة جدولة 🔄", formatApptMessage(after), { type: "reschedule" }, `/patients/${after.patientId}`);
    await handlePatientWhatsAppFormatted(after, "edit");
  }
  return null;
});

exports.notifyDoctorOnDeleteAppointment = onDocumentDeleted("appointments/{appointmentId}", async (event) => {
  const deletedAppt = event.data.data();
  await sendAlert("Deleted | حذف موعد 🗑️", formatApptMessage(deletedAppt), { type: "appointmentDeleted" }, `/appointments`);
  await handlePatientWhatsAppFormatted(deletedAppt, "cancel");
  return null;
});

exports.notifyOnLowInventory = onDocumentUpdated("inventory/{itemId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const threshold = Number(after.lowAlert) || 5;
  if (Number(after.stock) <= threshold && Number(before.stock) > threshold) {
    await sendAlert(
      "Low Stock | نواقص المخزون ⚠️",
      `📦 <b>Item:</b> ${after.name}\n📉 <b>Dropped to:</b> ${after.stock} ${after.unit}\n💡 <b>Threshold:</b> ${threshold}`,
      { type: "lowInventory" },
      `/inventory`
    );
  }
  return null;
});

exports.notifyOnNewPayment = onDocumentCreated("ledger/{ledgerId}", async (event) => {
  const data = event.data.data();
  if (data.type === 'payment' || data.type === 'expense') {
    let msg = ``;
    if(data.type === 'payment') msg += `👤 <b>Patient:</b> ${data.patientName || 'Unknown'}\n`;
    if(data.type === 'expense') msg += `🔻 <b>Expense Logged</b>\n`;
    
    msg += `💰 <b>Amount:</b> ${data.paid || data.amount} EGP\n`;
    if (data.method) msg += `💳 <b>Method:</b> ${data.method}\n`;
    if (data.description) msg += `📝 <b>Note:</b> ${data.description}\n`;
    if (data.addedBy) msg += `\n\n✍️ <b>By:</b> ${data.addedBy}`;

    await sendAlert(data.type === 'payment' ? "Payment Received | تم الدفع 💵" : "Expense Logged | مصروف جديد 🔻", msg, {
       type: "finance",
    }, `/patients/${data.patientId}`);

    if (data.type === "payment" && data.patientId) {
      await handlePatientWhatsAppPayment(data);
    }
  }
  return null;
});

exports.notifyOnClockIn = onDocumentCreated("attendance/{recordId}", async (event) => {
   const data = event.data.data();
   if (data.type === 'clock_in' || data.type === 'clock_out') {
      const title = data.type === 'clock_in' ? "Clock In | تسجيل حضور 🟢" : "Clock Out | تسجيل انصراف 🔴";
      const msg = `👤 <b>Staff:</b> ${data.staffName}\n⌚ <b>Time:</b> ${data.time}\n📍 <b>Status:</b> ${data.status || 'On Time'}`;
      
      await sendAlert(title, msg, { type: "hr" }, '/reports');
   }
   return null;
});
// Add this to the very bottom of functions/index.js
exports.notifyOnLabOrder = onDocumentCreated("lab_orders/{orderId}", async (event) => {
  const data = event.data.data();
  const msg = `🦷 <b>New Lab Case Required</b>\n\n👤 <b>Patient:</b> ${data.patientName || 'Unknown'}\n👨‍⚕️ <b>Doctor:</b> ${data.doctorName || 'Unknown'}\n⚙️ <b>Procedure:</b> ${data.serviceName}\n💰 <b>Estimated Lab Fee:</b> ${data.labFee} EGP`;

  await sendAlert("Lab Case Required 🔬", msg, { type: "lab" }, `/patients/${data.patientId}`);
  return null;
});

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

const { handleMetaWebhook } = require("./metaLeads");
const { getFirestore } = require("firebase-admin/firestore");

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
