/**
 * Gives the demo clinic a WhatsApp inbox: a handful of finished conversations.
 *
 *   node scripts/seed-demo-chats.mjs [--dry-run]
 *
 * `seed-demo-clinic.mjs` fills every screen except this one — it writes two rows to
 * `whatsapp_outbox` (messages waiting to go out) but no `whatsapp_conversations`, which is what
 * the Chats screen actually reads. The result is a clinic with eight weeks of history whose
 * headline feature renders an empty state, which is exactly the screen you do not want in a
 * sales demo.
 *
 * The threads are written the way the bot would have left them: the patient's turn last when the
 * bot has handed over, the clinic's turn last when it answered, `unreadCount` only where nobody
 * has opened it, and `needsHuman` on the one thread the bot correctly refused to handle. Every
 * document carries `__demo: true`, so `delete-demo-clinic.mjs` takes them with the rest.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { DEMO_MARKER } from "./demo-clinic-data.mjs";

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) throw new Error("Missing .env.local — run this from the project root.");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "")
        .replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").trim(),
    }),
  });
}
// This project's Firestore database is named "default", not "(default)".
const db = getFirestore(getApps()[0], "default");

const DRY = process.argv.includes("--dry-run");

/**
 * Firestore rejects a write containing `undefined` outright — it does not skip the field. An
 * optional value left unset (a thread with no patient match, an outbound-only thread with no
 * last inbound) would otherwise fail the whole document.
 */
function defined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
const MIN = 60 * 1000;

/**
 * Conversations, newest last within each thread.
 *
 * `minsAgo` is measured from the run, like the appointment dates the main seeder writes — a
 * thread stamped with a fixed date reads as abandoned within a week.
 */
const THREADS = [
  {
    key: "booking",
    phone: "+201000000117",
    patientName: "Ziad Refaat",
    minsAgo: 14,
    unread: 0,
    lines: [
      { dir: "in", author: "patient", text: "مساء الخير، عايز أحجز كشف" },
      { dir: "out", author: "bot", text: "أهلاً بيك في Demo Clinic — Alpha Dental 🦷\nتحب الكشف إمتى؟ عندنا النهاردة ٥:٣٠ م، وبكرة ١١:٠٠ ص أو ٦:٠٠ م." },
      { dir: "in", author: "patient", text: "بكرة بالليل يبقى أحسن" },
      { dir: "out", author: "bot", text: "تمام ✅ حجزتلك بكرة الساعة ٦:٠٠ م مع د. عمر.\nالعنوان: Main Branch — Nasr City. لو حصل أي تغيير ابعتلي هنا." },
      { dir: "in", author: "patient", text: "شكراً" },
    ],
  },
  {
    key: "reminder",
    phone: "+201000000115",
    patientName: "Sherif Adly",
    minsAgo: 95,
    unread: 0,
    lines: [
      { dir: "out", author: "bot", text: "تذكير من Demo Clinic — Alpha Dental ⏰\nمعاك ميعاد بكرة الساعة ٩:٣٠ ص مع د. يوسف.\nردّ بـ (تأكيد) أو (تأجيل)." },
      { dir: "in", author: "patient", text: "تأكيد" },
      { dir: "out", author: "bot", text: "تمام، الميعاد اتأكد ✅ شكراً، نشوفك بكرة." },
    ],
  },
  {
    key: "reschedule",
    phone: "+201000000120",
    patientName: "Salma Ezzat",
    minsAgo: 6,
    unread: 2,
    lines: [
      { dir: "out", author: "bot", text: "تذكير من Demo Clinic — Alpha Dental ⏰\nمعاك ميعاد النهاردة ١٠:٠٠ ص مع د. عمر." },
      { dir: "in", author: "patient", text: "معلش مش هعرف أجي النهاردة، ينفع أأجل؟" },
      { dir: "out", author: "bot", text: "مفيش مشكلة 👌 أقرب مواعيد فاضية:\n• بكرة ١٢:٣٠ م\n• بعد بكرة ٥:٠٠ م\nتحب أنهي واحد؟" },
      { dir: "in", author: "patient", text: "بعد بكرة ٥ المساء" },
    ],
  },
  {
    key: "handoff",
    phone: "+201000000108",
    patientName: "Hossam Ali",
    minsAgo: 32,
    unread: 1,
    needsHuman: true,
    handoffReason: "clinical",
    severity: "urgent",
    lines: [
      { dir: "in", author: "patient", text: "الضرس اللي اتحشى امبارح بيوجعني أوي والوجع مش بيهدى مع المسكن" },
      { dir: "out", author: "bot", text: "سلامتك 🙏 الموضوع ده محتاج حد من العيادة يشوفه بنفسه — حوّلت المحادثة للاستقبال ودلوقتي هيردوا عليك." },
      { dir: "in", author: "patient", text: "تمام مستني، شكراً" },
    ],
  },
  {
    key: "price",
    phone: "+201000000103",
    patientName: "Ayaa Nour",
    minsAgo: 210,
    unread: 0,
    lines: [
      { dir: "in", author: "patient", text: "بكام تنظيف الجير؟" },
      { dir: "out", author: "bot", text: "تنظيف الجير عندنا ٦٠٠ ج.م، والجلسة حوالي ٣٠ دقيقة.\nتحب أحجزلك؟" },
      { dir: "in", author: "patient", text: "أيوه لو فيه ميعاد الأسبوع الجاي" },
      { dir: "out", author: "bot", text: "عندنا الأحد ٢:٠٠ م والاتنين ٧:٠٠ م. تختار أنهي؟" },
      { dir: "in", author: "patient", text: "الاتنين" },
      { dir: "out", author: "bot", text: "اتحجز ✅ الاتنين ٧:٠٠ م مع د. هنا. نشوفك قريب!" },
    ],
  },
];

async function main() {
  const demo = await db.collection("clinics").where(DEMO_MARKER, "==", true).limit(1).get();
  if (demo.empty) throw new Error("No demo clinic found — run seed-demo-clinic.mjs first.");
  const clinicId = demo.docs[0].id;
  const root = db.collection(`clinics/${clinicId}/whatsapp_conversations`);

  // Match each thread to a real seeded patient, so opening one lands on a populated file rather
  // than a dead link. Matching on phone, which the seeder writes in E.164.
  const patients = await db.collection(`clinics/${clinicId}/patients`).get();
  const byPhone = new Map();
  for (const doc of patients.docs) {
    const p = doc.data();
    if (p.phone) byPhone.set(String(p.phone), { id: doc.id, name: p.name });
  }

  console.log(`Demo clinic : ${clinicId}`);
  console.log(`Patients     : ${patients.size} (${byPhone.size} with a phone)\n`);

  const now = Date.now();
  let written = 0;

  for (const thread of THREADS) {
    const match = byPhone.get(thread.phone);
    // The document id is the phone digits — the same key the bot derives from an inbound message.
    const chatId = thread.phone.replace(/\D/g, "");
    const lastAt = now - thread.minsAgo * MIN;

    // Lines are spaced backwards from the thread's last activity, two minutes apart, so the
    // timestamps read like a real exchange instead of arriving all at once.
    const step = 2 * MIN;
    const stamps = thread.lines.map((_, i) => lastAt - (thread.lines.length - 1 - i) * step);
    const last = thread.lines[thread.lines.length - 1];
    const lastInbound = [...thread.lines].reverse().find((l) => l.dir === "in");
    const lastInboundAt = lastInbound ? stamps[thread.lines.lastIndexOf(lastInbound)] : undefined;

    const row = {
      phone: thread.phone,
      patientId: match?.id,
      patientName: match?.name || thread.patientName,
      lastText: last.text,
      lastAt,
      lastMessageAt: lastAt,
      lastDirection: last.dir,
      lastAuthor: last.author,
      lastInboundAt,
      unreadCount: thread.unread || 0,
      needsHuman: thread.needsHuman === true,
      channel: "meta",
      archived: false,
      [DEMO_MARKER]: true,
    };
    if (thread.handoffReason) row.handoffReason = thread.handoffReason;
    if (thread.severity) row.severity = thread.severity;
    if (thread.needsHuman) row.handoffAtMs = lastAt;

    console.log(`  ${chatId}  ${(match?.name || thread.patientName).padEnd(18)} ${thread.lines.length} msgs${thread.unread ? `  ${thread.unread} unread` : ""}${thread.needsHuman ? "  NEEDS HUMAN" : ""}${match ? "" : "  (no patient match)"}`);
    if (DRY) continue;

    await root.doc(chatId).set(defined(row), { merge: true });
    // Replace any previous run's messages rather than stacking a second copy of the same script.
    const existing = await root.doc(chatId).collection("messages").get();
    for (const doc of existing.docs) await doc.ref.delete();

    const batch = db.batch();
    thread.lines.forEach((line, i) => {
      batch.set(root.doc(chatId).collection("messages").doc(), defined({
        direction: line.dir,
        author: line.author,
        text: line.text,
        at: stamps[i],
        status: line.dir === "out" ? "read" : undefined,
        [DEMO_MARKER]: true,
      }));
    });
    await batch.commit();
    written += thread.lines.length + 1;
  }

  console.log(DRY ? "\nDry run — nothing written." : `\nDone. ${written} documents across ${THREADS.length} conversations.`);
}

main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
