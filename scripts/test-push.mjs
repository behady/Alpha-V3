/**
 * Fires one of every notification the system sends, at ONE device, so a person
 * holding that phone can say which arrived.
 *
 *   node scripts/test-push.mjs <uid> [--dry]
 *
 * Deliberately not sent by role. sendClinicPush targets whole roles, so a naive
 * test would put seventeen alerts on every staff phone in the clinic, several of
 * them alarming ("paid leads still unanswered"). Each is prefixed TEST n/17 and
 * carries the real title and the real Android channel underneath, because a
 * muted channel is one of the likelier reasons a notification never arrives and
 * the test has to be able to expose that.
 */
import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (process.env[k]) continue;
    process.env[k] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();
const PK = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/^["']|["']$/g, "");
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
      privateKey: PK.split(String.fromCharCode(92) + "n").join("\n").trim(),
    }),
  });
}
const db = getFirestore(getApps()[0], "default");

const uid = process.argv[2];
const dry = process.argv.includes("--dry");
if (!uid) throw new Error("Usage: node scripts/test-push.mjs <uid> [--dry]");

const user = await db.collection("users").doc(uid).get();
const tokens = Array.isArray(user.data()?.fcmTokens) ? user.data().fcmTokens.filter(Boolean) : [];
console.log(`Target: ${user.data()?.name || uid} — ${tokens.length} device(s)`);
if (tokens.length === 0) throw new Error("That account has no registered device, so nothing can be delivered.");

/** id, the real title, the real Android channel. */
const CASES = [
  ["morning-brief",   "Today at the clinic",                 "alpha_reminders", "3 booked · first at 09:00"],
  ["dentist-day",     "Your day",                            "alpha_reminders", "2 patients · first at 09:30"],
  ["birthdays",       "🎂 2 birthday wishes ready",           "alpha_clinic",    "Open Marketing → Campaigns to send them."],
  ["leads-due",       "2 lead follow-ups due",               "alpha_leads",     "Waiting on a call: Sara, Omar"],
  ["occasion",        "📣 Mother's Day is 10 days away",      "alpha_clinic",    "Prepare the offer and the content now."],
  ["review-requests", "⭐ 3 review requests ready",           "alpha_clinic",    "Today's happy patients are one tap from a Google review."],
  ["evening-digest",  "Today, closed out",                   "alpha_money",     "3 seen · 1,850 EGP collected"],
  ["lead-speed",      "⏱ 1 lead waiting 5+ min",             "alpha_leads",     "Nobody has answered it yet."],
  ["lead-abandoned",  "🚨 1 paid lead still unanswered after 2h", "alpha_leads", "A paid click nobody replied to."],
  ["arrival",         "Dina Samir has arrived",              "alpha_arrivals",  "In the waiting room · 09:00"],
  ["slot-freed",      "09:30 just freed",                    "alpha_bookings",  "Hossam Ali cancelled — the waitlist could take it."],
  ["low-stock",       "Gloves is running low",               "alpha_clinic",    "4 boxes left · reorder point is 5."],
  ["meta-lead",       "New lead | عميل محتمل جديد 📣",         "alpha_leads",     "Facebook · Alpha Dental page"],
  ["online-booking",  "حجز جديد أونلاين",                     "alpha_bookings",  "Test Patient — today 10:00 · New online booking"],
  ["bot-booking",     "حجز جديد من واتساب 🤖",                 "alpha_bookings",  "Test Patient — today 11:00"],
  ["bot-cancel",      "طلب إلغاء ميعاد ❌",                    "alpha_bookings",  "Test Patient — today 12:00"],
  ["review-unhappy",  "⭐2 — unhappy visit",                   "alpha_clinic",    "Test Patient rated their visit 2/5."],
  ["whatsapp-queued", "رسالة واتساب في الانتظار",              "alpha_clinic",    "A WhatsApp message is waiting in the app."],
  ["summon",          "Doctor needs you | الطبيب يطلبك",      "alpha_clinic",    "Dr. Test is calling you to the desk"],
];

const messaging = getMessaging();
let n = 0;
for (const [id, title, channel, body] of CASES) {
  n += 1;
  const label = `TEST ${n}/${CASES.length} · ${title}`;
  if (dry) {
    console.log(`  [dry] ${String(n).padStart(2)} ${channel.padEnd(17)} ${title}`);
    continue;
  }
  const res = await messaging.sendEachForMulticast({
    tokens,
    notification: { title: label, body },
    android: { priority: "high", notification: { channelId: channel } },
    data: { type: "delivery_test", testId: id, channel },
  });
  const ok = res.successCount > 0;
  console.log(`  ${String(n).padStart(2)}. ${ok ? "sent   " : "FAILED "} ${channel.padEnd(17)} ${title}`);
  if (!ok) {
    for (const r of res.responses) if (r.error) console.log(`       ${r.error.code}: ${r.error.message}`);
  }
  // Spaced out so Android lists them in order instead of collapsing them.
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(dry ? "\nDry run — nothing sent." : "\nAll fired. Tell me which numbers arrived.");
