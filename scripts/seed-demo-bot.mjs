/**
 * Switches the WhatsApp assistant on for the DEMO clinic and fills in what it is allowed to say.
 *
 *   node scripts/seed-demo-bot.mjs [--dry-run] [--mode assisted|ai_first]
 *
 * Without this the demo clinic carries `whatsappIntegration` and `aiChat` but not the
 * `whatsappBot` add-on, and has no `settings/whatsapp` document at all — so the in-app
 * playground accepts a message and never answers, which is the one screen you cannot show a
 * dentist while claiming the bot works.
 *
 * What it writes, and why each part matters to the demo:
 *
 *  - `botEnabled` + `botMode` + `botAiEnabled` — the Bot page's 4-way chooser. "assisted" is the
 *    honest default to demonstrate: the free scripted layers answer first and the AI only picks
 *    up what they cannot, capped at 3 replies per conversation. "ai_first" sends everything to
 *    the model with no cap, which is the expensive setting.
 *  - `botScripts` — the clinic's own trigger→reply notes. These are the FREE half of the story:
 *    matched before every built-in answer and before the AI, and sent verbatim, so a clinic can
 *    add scenarios without paying a model. Triggers match with the definite article stripped from
 *    both sides, so "تقويم" also fires on "التقويم".
 *  - `botFacts` — the ten "ready answers". The engine's rule is that a layer may only state a
 *    fact the clinic supplied; an EMPTY field routes to a human and is deliberately never handed
 *    to the AI, because durations, instalments and warranties are exactly what a model answers
 *    confidently and wrongly in the clinic's voice. Filling them is what makes the bot look
 *    knowledgeable instead of evasive.
 *
 * Demo clinic only — it finds the clinic by `__demo` and will not touch anything else.
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
const MODE = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "assisted";

/** The clinic's own sticky notes: matched verbatim, before the AI, and free. */
const SCRIPTS = [
  {
    id: "script_ortho",
    title: "التقويم",
    triggers: ["تقويم", "تقويم شفاف", "براكت"],
    reply: "عندنا التقويم المعدني والشفاف 🦷\nالكشف والاستشارة ٢٠٠ ج.م، وبنحدد الخطة والسعر بعد الأشعة.\nتحب أحجزلك استشارة تقويم؟",
    enabled: true,
  },
  {
    id: "script_whitening",
    title: "التبييض",
    triggers: ["تبييض", "بليتشنج"],
    reply: "التبييض بالليزر جلسة واحدة حوالي ساعة، والنتيجة بتبان من أول جلسة ✨\nالسعر من ٢٥٠٠ لـ ٣٥٠٠ ج.م حسب حالة الأسنان.",
    enabled: true,
  },
  {
    id: "script_kids",
    title: "أطفال",
    triggers: ["اطفال", "طفل", "ابني", "بنتي"],
    reply: "أيوه بنستقبل أطفال 👶\nد. هنا متخصصة أطفال، والكشف ١٥٠ ج.م.\nأحسن معاد للأطفال الصبح، بيكونوا مرتاحين أكتر.",
    enabled: true,
  },
];

/**
 * The ten ready answers. Deliberately all filled: an empty one is not a smaller answer, it is a
 * handoff to a human, and a demo full of handoffs shows nothing.
 */
const FACTS = {
  walkIn: "تقدر تيجي من غير حجز، بس الأولوية للي حاجز — ممكن تستنى من ١٥ لـ ٣٠ دقيقة.",
  installments: "أيوه، فيه تقسيط على ٣ أو ٦ شهور للعلاجات فوق ٥٠٠٠ ج.م، من غير فوايد.",
  offers: "خصم ١٥٪ على التنظيف والتبييض لحد آخر الشهر.",
  offersUntil: "آخر الشهر",
  mapsUrl: "https://maps.google.com/?q=Nasr+City+Cairo",
  parking: "فيه جراج تحت العمارة، والوقوف مجاني لمرضى العيادة.",
  insurance: "بنتعامل مع أغلب شركات التأمين — ابعتلنا صورة الكارنيه ونقولك على طول.",
  notOffered: "مش بنعمل جراحات الوجه والفكين، بنحوّلها لمستشفى متخصص.",
  durations: "الكشف ٢٠ دقيقة، الحشو من ٣٠ لـ ٦٠ دقيقة، وعلاج العصب جلستين كل واحدة ساعة.",
  sessions: "علاج العصب جلستين، التقويم متابعة كل ٤ أسابيع، وزرع السن على مرحلتين بينهم ٣ شهور.",
  aftercare: "بعد أي علاج بنبعتلك تعليمات على الواتساب، وفيه متابعة مجانية خلال أسبوع.",
  whyUs: "عيادة من ٢٠١٤، فريق من ٣ دكاترة متخصصين، وتعقيم بمعايير عالمية.",
  consultation: "الاستشارة ١٥٠ ج.م، وبتتخصم من قيمة العلاج لو كمّلت معانا.",
  dentists: "د. عمر شريف (تركيبات وزراعة)، د. هنا مصطفى (أطفال وتقويم)، د. يوسف كمال (جراحة وعلاج جذور).",
};

async function main() {
  const demo = await db.collection("clinics").where(DEMO_MARKER, "==", true).limit(1).get();
  if (demo.empty) throw new Error("No demo clinic found — run seed-demo-clinic.mjs first.");
  const clinicDoc = demo.docs[0];
  const clinicId = clinicDoc.id;

  const features = { ...(clinicDoc.data().features || {}) };
  const already = features.whatsappBot === true;
  features.whatsappBot = true;

  const settings = {
    botEnabled: true,
    /**
     * Required for the playground to answer at all. The rehearsal thread is keyed to a FAKE phone
     * ("a stranger to the clinic, so the new-patient path is exercised" — see the route), and the
     * engine refuses to answer strangers unless this is on. Without it the playground accepts the
     * message, writes it to the thread, and silently returns nothing — which looks exactly like a
     * broken bot.
     */
    botAnswerStrangers: true,
    // "assisted": scripts and keyword routes answer first, the AI only catches the rest (max 3).
    botMode: MODE === "ai_first" ? "ai_first" : "assisted",
    botAiEnabled: true,
    botScripts: SCRIPTS,
    botFacts: FACTS,
    updatedAt: new Date().toISOString(),
    [DEMO_MARKER]: true,
  };

  console.log(`Demo clinic : ${clinicId}`);
  console.log(`whatsappBot : ${already ? "already on" : "turning ON"}`);
  console.log(`Mode        : ${settings.botMode}${settings.botMode === "assisted" ? "  (bot first, AI catches the rest, capped at 3)" : "  (every message to the model, no cap)"}`);
  console.log(`Scripts     : ${SCRIPTS.length} (${SCRIPTS.map((s) => s.title).join(", ")})`);
  console.log(`Ready answers: ${Object.keys(FACTS).length} filled`);

  if (DRY) {
    console.log("\nDry run — nothing written.");
    return;
  }

  await clinicDoc.ref.set({ features }, { merge: true });
  await db.doc(`clinics/${clinicId}/settings/whatsapp`).set(settings, { merge: true });
  console.log("\nDone. The in-app bot playground can now answer.");
}

main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
