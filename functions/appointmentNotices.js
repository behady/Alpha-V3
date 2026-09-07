/**
 * Ticks the "your appointment moved" sender every five minutes.
 *
 * The work itself lives in the web app (`/api/automation/appointment-notices`), which already
 * knows how to pick a template, honour an opt-out, write the thread line and fall back to the
 * queue. This function exists only because that schedule cannot live where the other crons do:
 * this project's Vercel plan rejects anything more frequent than daily, and a patient who is told
 * their visit moved tomorrow rather than in five minutes has not really been told.
 *
 * Every failure is swallowed after a log line. A missed tick costs a few minutes of delay; the
 * next one picks up exactly the same appointments, because the marker stays on the document
 * until a message actually goes out.
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");

const APP_BASE_URL = (process.env.APP_BASE_URL || "https://alpha-v3-live.vercel.app").replace(/\/$/, "");

exports.appointmentNotices = onSchedule(
  { schedule: "every 5 minutes", region: "us-central1", timeoutSeconds: 120, secrets: ["CRON_SECRET"] },
  async () => {
    const secret = (process.env.CRON_SECRET || "").trim();
    if (!secret) {
      console.warn("appointmentNotices: no CRON_SECRET configured; skipping");
      return;
    }
    try {
      const res = await fetch(`${APP_BASE_URL}/api/automation/appointment-notices`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      const body = await res.text();
      if (!res.ok) {
        console.warn(`appointmentNotices: ${res.status} ${body.slice(0, 200)}`);
        return;
      }
      // Only worth a line when something actually went out, or the log is five entries an hour
      // of the word "ok" forever.
      const parsed = JSON.parse(body || "{}");
      if (parsed.sent || parsed.failed) console.log(`appointmentNotices: sent ${parsed.sent || 0}, failed ${parsed.failed || 0}`);
    } catch (e) {
      console.warn("appointmentNotices: call failed:", e && e.message ? e.message : e);
    }
  }
);
