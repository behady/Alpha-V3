/**
 * Ticks the "your appointment moved" sender every five minutes.
 *
 * The work itself lives in the web app (`/api/automation/appointment-notices`), which already
 * knows how to pick a template, honour an opt-out, write the thread line and fall back to the
 * queue. This function exists only because that schedule cannot live where the other crons do:
 * this project's Vercel plan rejects anything more frequent than daily, and a patient told their
 * visit moved tomorrow rather than in five minutes has not really been told.
 *
 * It authenticates with a token read from Firestore rather than a deploy-time secret, so that
 * deploying this function needs nothing configured by hand — the day a Cloud Function needs a
 * secret somebody forgot to set is the day the job silently stops, and a job that fails by doing
 * nothing is the worst kind here. The path is denied to every client in firestore.rules.
 *
 * Every failure is swallowed after a log line. A missed tick costs a few minutes: the marker
 * stays on the appointment until a message actually goes out, so the next run picks up exactly
 * the same work.
 */

const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore } = require("firebase-admin/firestore");

const db = () => getFirestore(admin.app(), "default");
const APP_BASE_URL = (process.env.APP_BASE_URL || "https://alpha-v3-live.vercel.app").replace(/\/$/, "");

async function automationToken() {
  try {
    const snap = await db().collection("system_secrets").doc("automation").get();
    return String((snap.data() || {}).token || "").trim();
  } catch (e) {
    console.warn("appointmentNotices: could not read the automation token:", e && e.message ? e.message : e);
    return "";
  }
}

exports.appointmentNotices = onSchedule(
  { schedule: "every 5 minutes", region: "us-central1", timeoutSeconds: 120 },
  async () => {
    const token = (process.env.CRON_SECRET || "").trim() || (await automationToken());
    if (!token) {
      console.warn("appointmentNotices: no automation token in system_secrets/automation; skipping");
      return;
    }
    try {
      const res = await fetch(`${APP_BASE_URL}/api/automation/appointment-notices`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.text();
      if (!res.ok) {
        console.warn(`appointmentNotices: ${res.status} ${body.slice(0, 200)}`);
        return;
      }
      // Only worth a line when something actually happened, or this logs the word "ok" twelve
      // times an hour for ever.
      const parsed = JSON.parse(body || "{}");
      if (parsed.sent || parsed.failed) console.log(`appointmentNotices: sent ${parsed.sent || 0}, failed ${parsed.failed || 0}`);
    } catch (e) {
      console.warn("appointmentNotices: call failed:", e && e.message ? e.message : e);
    }
  }
);
