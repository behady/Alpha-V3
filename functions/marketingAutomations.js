/**
 * Marketing automations — the scheduled half of the Marketing studio (Phase 2b).
 *
 *  - 09:30 daily            birthdayCampaigns      → queue today's birthday wishes for review
 *  - 10:15 daily            occasionRadarPush      → "Eid is 10 days away" to admins
 *  - 20:30 daily            reviewRequestsNightly  → happy-check links to today's completed visits
 *  - every 10 min, 9am-11pm leadSpeedAlerts        → "a lead has waited 15+ min unanswered"
 *
 * Design rules, same as the rest of the system:
 *  - Nothing here ever sends a WhatsApp message. The jobs queue message_drafts (reason
 *    "marketing_campaign") that a person reviews and sends from the Campaigns tab — the robot
 *    proposes, the human decides. Pushes to STAFF are the exception; those are just nudges.
 *  - Everything is opt-in per clinic via clinics/{id}/marketing_settings/automations, and the
 *    whole module only touches clinics whose marketingText feature override is on.
 */

const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { DateTime } = require("luxon");
const { sendClinicPush } = require("./clinicPush");
const { resolveWhatsappTemplate, mergeWhatsappTemplate } = require("./whatsappMessageDefaults");

const TIMEZONE = process.env.CLINIC_TIMEZONE || "Africa/Cairo";
/** This project's database is literally named "default" — see firebase.json. */
const db = () => getFirestore(admin.app(), "default");
const todayKey = () => DateTime.now().setZone(TIMEZONE).toFormat("yyyy-MM-dd");

/** Where patients' rating links point. The stable production domain, not a per-deploy URL. */
const APP_BASE_URL = process.env.APP_BASE_URL || "https://alpha-v3-live.vercel.app";

/** How long after a review ask before the same patient may be asked again. */
const REVIEW_COOLDOWN_DAYS = 90;
const LEAD_ALERT_AFTER_MINUTES = 15;

/**
 * Twin of OCCASION_DATES in src/types/marketing.ts — functions can't import TS, so keep the
 * two lists in step when extending them yearly (same situation as the dental icons).
 */
const OCCASION_DATES = [
  { id: "back_to_school", date: "2026-09-20" },
  { id: "new_year", date: "2027-01-01" },
  { id: "ramadan", date: "2027-02-08" },
  { id: "eid_fitr", date: "2027-03-10" },
  { id: "mothers_day", date: "2027-03-21" },
  { id: "eid_adha", date: "2027-05-17" },
  { id: "back_to_school", date: "2027-09-20" },
  { id: "new_year", date: "2028-01-01" },
  { id: "ramadan", date: "2028-01-28" },
  { id: "eid_fitr", date: "2028-02-27" },
  { id: "mothers_day", date: "2028-03-21" },
  { id: "eid_adha", date: "2028-05-05" },
];
const OCCASION_NAMES = {
  back_to_school: { ar: "العودة للمدارس", en: "Back to school" },
  new_year: { ar: "رأس السنة", en: "New year" },
  ramadan: { ar: "شهر رمضان", en: "Ramadan" },
  eid_fitr: { ar: "عيد الفطر", en: "Eid al-Fitr" },
  mothers_day: { ar: "عيد الأم", en: "Mother's Day" },
  eid_adha: { ar: "عيد الأضحى", en: "Eid al-Adha" },
};

const DEFAULT_BIRTHDAY_TEMPLATE = `🎂 كل سنة وحضرتك طيب يا {{patient_name}}!

كل عيلة *{{clinic_name}}* بتتمنالك سنة سعيدة مليانة صحة وابتسامة أحلى ✨`;

/** Clinics the marketing automations may touch at all: add-on ON and clinic not suspended. */
async function marketingClinics() {
  const snap = await db().collection("clinics").get();
  return snap.docs
    .filter((doc) => {
      const d = doc.data() || {};
      const active = !d.status || d.status === "Active";
      return active && d.features && d.features.marketingText === true;
    })
    .map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

async function automationSettings(clinicId) {
  const snap = await db().doc(`clinics/${clinicId}/marketing_settings/automations`).get();
  return snap.exists ? snap.data() || {} : {};
}

async function clinicDisplayName(clinicId, clinicData) {
  const snap = await db().doc(`clinics/${clinicId}/settings/clinicProfile`).get();
  const profile = snap.exists ? snap.data() || {} : {};
  return (
    (typeof profile.clinicName === "string" && profile.clinicName.trim()) ||
    (typeof clinicData.name === "string" && clinicData.name.trim()) ||
    "our clinic"
  );
}

function pickPhone(p) {
  for (const key of ["phone", "phoneNumber", "phoneE164", "mobile", "whatsapp", "primaryPhone"]) {
    if (typeof p[key] === "string" && p[key].trim()) return p[key].trim();
  }
  return "";
}

/**
 * One auto-campaign: a marketing_campaigns row plus one reviewable draft per recipient —
 * exactly what a manual launch from the Campaigns tab writes, so the existing UI shows it
 * with zero new client code. Dedupes on (campaignId, patientId): re-runs are no-ops.
 */
async function createAutoCampaign(clinicId, { campaignId, name, segment, recipients }) {
  if (recipients.length === 0) return 0;

  const campaignRef = db().doc(`clinics/${clinicId}/marketing_campaigns/${campaignId}`);
  if (!(await campaignRef.get()).exists) {
    await campaignRef.set({
      name,
      segment,
      body: "(automatic)",
      recipientCount: recipients.length,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "system",
    });
  }

  const existingSnap = await db()
    .collection(`clinics/${clinicId}/message_drafts`)
    .where("context.campaignId", "==", campaignId)
    .get();
  const already = new Set(existingSnap.docs.map((d) => String(d.data().patientId || "")));

  let created = 0;
  for (const r of recipients) {
    if (already.has(r.patientId)) continue;
    await db().collection(`clinics/${clinicId}/message_drafts`).add({
      patientId: r.patientId,
      patientName: r.patientName,
      phone: r.phone,
      body: r.body,
      reason: "marketing_campaign",
      context: { campaignId, campaignName: name, segment },
      channel: "whatsapp",
      status: "pending_review",
      createdBy: "system",
      createdAt: FieldValue.serverTimestamp(),
    });
    created++;
  }
  return created;
}

// ---------------------------------------------------------------------------
// 20:30 — happy-check review requests for today's completed visits.
// ---------------------------------------------------------------------------

exports.reviewRequestsNightly = onSchedule(
  { schedule: "30 20 * * *", timeZone: TIMEZONE, timeoutSeconds: 540, memory: "256MiB" },
  async () => {
    const date = todayKey();
    for (const clinic of await marketingClinics()) {
      try {
        const auto = await automationSettings(clinic.id);
        if (auto.reviewEnabled !== true) continue;

        const profileSnap = await db().doc(`clinics/${clinic.id}/settings/clinicProfile`).get();
        const profile = profileSnap.exists ? profileSnap.data() || {} : {};
        const googleLink =
          (typeof profile.googleReviewUrl === "string" && profile.googleReviewUrl.trim()) ||
          (typeof profile.googleMapsUrl === "string" && profile.googleMapsUrl.trim());
        // Without a Google destination the happy half of the funnel dead-ends — skip loudly.
        if (!googleLink) {
          console.warn(`reviewRequestsNightly: ${clinic.id} has no Google review link; skipped.`);
          continue;
        }

        const waSnap = await db().doc(`clinics/${clinic.id}/settings/whatsapp`).get();
        const tpl = resolveWhatsappTemplate(waSnap.exists ? waSnap.data() : undefined, "google_review");
        if (!tpl) continue; // clinic explicitly disabled the template

        const clinicName = await clinicDisplayName(clinic.id, clinic.data);

        const apptSnap = await db()
          .collection(`clinics/${clinic.id}/appointments`)
          .where("date", "==", date)
          .get();
        const completedPatientIds = [
          ...new Set(
            apptSnap.docs
              .filter((d) => String(d.data().status || "") === "Completed")
              .map((d) => String(d.data().patientId || ""))
              .filter(Boolean)
          ),
        ];
        if (completedPatientIds.length === 0) continue;

        // One range read covers the cooldown for every candidate.
        const since = DateTime.now().minus({ days: REVIEW_COOLDOWN_DAYS }).toJSDate();
        const recentSnap = await db()
          .collection(`clinics/${clinic.id}/review_requests`)
          .where("createdAt", ">=", since)
          .get();
        const recentlyAsked = new Set(recentSnap.docs.map((d) => String(d.data().patientId || "")));

        const recipients = [];
        for (const patientId of completedPatientIds) {
          if (recentlyAsked.has(patientId)) continue;
          const pSnap = await db().doc(`clinics/${clinic.id}/patients/${patientId}`).get();
          if (!pSnap.exists) continue;
          const p = pSnap.data() || {};
          if (p.whatsappOptOut === true) continue;
          const phone = pickPhone(p);
          if (!phone) continue;

          const reqRef = await db().collection(`clinics/${clinic.id}/review_requests`).add({
            patientId,
            patientName: String(p.name || "Patient"),
            phone,
            appointmentDate: date,
            status: "queued",
            createdAt: FieldValue.serverTimestamp(),
          });

          // The clinic's own google_review template, but the link is OUR happy-check page:
          // 4–5 stars continue to Google, 1–3 stay private. Same words, smarter destination.
          const ratingUrl = `${APP_BASE_URL}/review/${clinic.id}/${reqRef.id}`;
          recipients.push({
            patientId,
            patientName: String(p.name || "Patient"),
            phone,
            body: mergeWhatsappTemplate(tpl, {
              patient_name: String(p.name || "Patient"),
              clinic_name: clinicName,
              google_link: ratingUrl,
            }),
          });
        }

        const created = await createAutoCampaign(clinic.id, {
          campaignId: `auto_reviews_${date}`,
          name: `Review requests — ${date}`,
          segment: "reviews",
          recipients,
        });

        if (created > 0) {
          await sendClinicPush(
            db(),
            clinic.id,
            {
              title: `⭐ ${created} review request${created === 1 ? "" : "s"} ready`,
              body: "Today's happy patients are one tap from a Google review — open Marketing → Campaigns to send.",
            },
            { roles: ["Admin", "Receptionist"], channel: "alpha_clinic", data: { screen: "marketing" } }
          );
        }
      } catch (e) {
        console.error(`reviewRequestsNightly failed for ${clinic.id}:`, e);
      }
    }
  }
);

// ---------------------------------------------------------------------------
// 09:30 — birthday wishes for today's birthdays.
// ---------------------------------------------------------------------------

exports.birthdayCampaigns = onSchedule(
  { schedule: "30 9 * * *", timeZone: TIMEZONE, timeoutSeconds: 540, memory: "256MiB" },
  async () => {
    const now = DateTime.now().setZone(TIMEZONE);
    const date = now.toFormat("yyyy-MM-dd");
    const monthDay = now.toFormat("MM-dd");

    for (const clinic of await marketingClinics()) {
      try {
        const auto = await automationSettings(clinic.id);
        if (auto.birthdayEnabled !== true) continue;

        const template =
          (typeof auto.birthdayTemplate === "string" && auto.birthdayTemplate.trim()) ||
          DEFAULT_BIRTHDAY_TEMPLATE;
        const clinicName = await clinicDisplayName(clinic.id, clinic.data);

        const patientsSnap = await db().collection(`clinics/${clinic.id}/patients`).limit(4000).get();
        const recipients = [];
        patientsSnap.forEach((doc) => {
          const p = doc.data() || {};
          if (p.whatsappOptOut === true) return;
          const dob = typeof p.dateOfBirth === "string" ? p.dateOfBirth : "";
          // dateOfBirth is a YYYY-MM-DD string from a date input; anything else is skipped.
          if (dob.slice(5, 10) !== monthDay) return;
          const phone = pickPhone(p);
          if (!phone) return;
          recipients.push({
            patientId: doc.id,
            patientName: String(p.name || "Patient"),
            phone,
            body: mergeWhatsappTemplate(template, {
              patient_name: String(p.name || "Patient"),
              clinic_name: clinicName,
            }),
          });
        });

        const created = await createAutoCampaign(clinic.id, {
          campaignId: `auto_birthdays_${date}`,
          name: `Birthdays — ${date}`,
          segment: "birthdays",
          recipients,
        });

        if (created > 0) {
          await sendClinicPush(
            db(),
            clinic.id,
            {
              title: `🎂 ${created} birthday wish${created === 1 ? "" : "es"} ready`,
              body: "Open Marketing → Campaigns to review and send them.",
            },
            { roles: ["Admin", "Receptionist"], channel: "alpha_clinic", data: { screen: "marketing" } }
          );
        }
      } catch (e) {
        console.error(`birthdayCampaigns failed for ${clinic.id}:`, e);
      }
    }
  }
);

// ---------------------------------------------------------------------------
// Every 10 minutes, 09:00–22:59 — leads left unanswered past the mark.
// ---------------------------------------------------------------------------

exports.leadSpeedAlerts = onSchedule(
  { schedule: "*/10 9-22 * * *", timeZone: TIMEZONE, timeoutSeconds: 300, memory: "256MiB" },
  async () => {
    const cutoffMs = Date.now() - LEAD_ALERT_AFTER_MINUTES * 60 * 1000;

    for (const clinic of await marketingClinics()) {
      try {
        const auto = await automationSettings(clinic.id);
        if (auto.leadAlerts === false) continue; // on by default — a push costs nothing

        const snap = await db()
          .collection(`clinics/${clinic.id}/leads`)
          .where("stage", "==", "new")
          .get();

        const waiting = snap.docs.filter((doc) => {
          const d = doc.data() || {};
          if (d.speedAlertAt) return false; // one alert per lead, not one per 10 minutes
          const created = d.createdAt && typeof d.createdAt.toMillis === "function" ? d.createdAt.toMillis() : 0;
          return created > 0 && created < cutoffMs;
        });
        if (waiting.length === 0) continue;

        const names = waiting
          .map((doc) => String(doc.data().name || "").trim())
          .filter(Boolean)
          .slice(0, 3)
          .join(", ");

        await sendClinicPush(
          db(),
          clinic.id,
          {
            title: `⏱ ${waiting.length} lead${waiting.length === 1 ? "" : "s"} waiting ${LEAD_ALERT_AFTER_MINUTES}+ min`,
            body: names
              ? `Still unanswered: ${names}${waiting.length > 3 ? "…" : ""}. The first minutes win the lead.`
              : "Open the Leads inbox — someone is waiting for a reply.",
          },
          { roles: ["Admin", "Receptionist"], channel: "alpha_leads", data: { screen: "leads" } }
        );

        await Promise.all(
          waiting.map((doc) => doc.ref.update({ speedAlertAt: FieldValue.serverTimestamp() }).catch(() => {}))
        );
      } catch (e) {
        console.error(`leadSpeedAlerts failed for ${clinic.id}:`, e);
      }
    }
  }
);

// ---------------------------------------------------------------------------
// 10:15 — occasion radar: 10 days ahead of each occasion, once.
// ---------------------------------------------------------------------------

exports.occasionRadarPush = onSchedule(
  { schedule: "15 10 * * *", timeZone: TIMEZONE, timeoutSeconds: 300, memory: "256MiB" },
  async () => {
    const today = DateTime.now().setZone(TIMEZONE).startOf("day");
    // Fires only on the exact -10-days day, so the daily schedule itself is the dedupe.
    const hit = OCCASION_DATES.find((o) => {
      const days = DateTime.fromISO(o.date, { zone: TIMEZONE }).startOf("day").diff(today, "days").days;
      return Math.round(days) === 10;
    });
    if (!hit) return;
    const name = OCCASION_NAMES[hit.id] || { ar: hit.id, en: hit.id };

    for (const clinic of await marketingClinics()) {
      try {
        await sendClinicPush(
          db(),
          clinic.id,
          {
            title: `📣 ${name.en} is 10 days away`,
            body: `«${name.ar}» بعد ١٠ أيام — افتح صفحة التسويق وجهّز المحتوى والعروض من الآن.`,
          },
          { roles: ["Admin"], channel: "alpha_clinic", data: { screen: "marketing" } }
        );
      } catch (e) {
        console.error(`occasionRadarPush failed for ${clinic.id}:`, e);
      }
    }
  }
);
