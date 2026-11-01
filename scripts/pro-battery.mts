/**
 * Replay a clinic's saved real WhatsApp conversations through the Pro brain (answerWithPro) and
 * check every reply against the red lines.
 *
 *   CLINIC_ID=<id> npx tsx scripts/pro-battery.mts          real model (needs GEMINI_PRO_API_KEY)
 *   CLINIC_ID=<id> npx tsx scripts/pro-battery.mts --dry    scripted fake model, no key, no spend
 *
 *   ENV_FILE=../.env.local   read secrets from another checkout's env file
 *   ONLY=<id-prefix>,...     replay just these saved cases (document id prefixes)
 *   LIMIT=10                 replay at most N saved cases
 *   FIXTURE=file.json        replay cases from a local JSON array of SavedTestCase (plus an `id`)
 *                            instead of the clinic's bot_test_cases; the clinic data is still read
 *   DRY_REPLY="..."          (--dry only) the fixed reply the fake model sends
 *
 * Nothing leaves the machine and nothing is written:
 *   - Firestore is only READ (price list, schedule, doctors, free slots, saved cases, approved
 *     answers, settings). The ProSink handed to the brain keeps its rows in memory.
 *   - answerWithPro runs with charge:false, so no credit is spent; record:true only fills the
 *     in-memory sink, which is where rounds / tools called / model time come from.
 *   - The patient is always a stranger (no file, no appointments) and the thread is the saved
 *     conversation up to the turn being replayed.
 *
 * The run REFUSES to start (exit 2) when GEMINI_PRO_API_KEY is missing or equals GEMINI_API_KEY:
 * the battery must never spend the standard key, and a missing key would otherwise "pass" by
 * falling back. --dry is the only way to run without a Pro key.
 *
 * Exit code: 0 clean, 1 if any reply crossed a red line, 2 on refusal or a setup failure.
 */

import fs from "node:fs";
import path from "node:path";
import { adminDb } from "../src/lib/firebaseAdmin";
import { arabicClock } from "../src/lib/arabicDateTime";
import { briefLines, cleanBrief } from "../src/lib/bot/brief";
import { factLines } from "../src/lib/bot/botPrompt";
import { expectFromKind, type SavedTestCase } from "../src/lib/bot/testCases";
import { allowedNumbers, checkReply } from "../src/lib/botPro/checks";
import { answerWithPro, geminiProModel, type ProModel, type ProReplyResult } from "../src/lib/botPro/answerWithPro";
import { loadProContext, type ProArgs, type ProContext, type ProSink } from "../src/lib/botPro/proContext";
import type { ProPerson } from "../src/lib/botPro/person";
import type { AiThreadLine } from "../src/lib/bot/aiReply";

const DRY = process.argv.includes("--dry");
const ARABIC_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function loadEnv() {
  const f = path.resolve(process.cwd(), process.env.ENV_FILE || ".env.local");
  if (!fs.existsSync(f)) throw new Error(`No env file at ${f} — set ENV_FILE`);
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

function refuse(message: string): never {
  console.error(`REFUSED: ${message}`);
  process.exit(2);
}

/** A person nobody knows: no file, no appointments, and not a guess about who is writing. */
const STRANGER: ProPerson = { patientId: null, family: [], upcoming: [], past: [], degraded: false, writerKnown: false };

const isArabicText = (s: string) => /[؀-ۿ]/.test(s);

/** --dry: one round, a fixed safe reply in the patient's script. Proves the plumbing, not the brain. */
function dryModel(question: string): ProModel {
  return {
    async send() {
      const reply = process.env.DRY_REPLY
        ? process.env.DRY_REPLY
        : isArabicText(question)
        ? "أهلاً بحضرتك، هراجع الموضوع مع الفريق وأرجع لحضرتك في أقرب وقت."
        : "Thanks for your message, the team will get back to you shortly.";
      return { functionCall: { name: "reply", args: { action: "answer", reply } } };
    },
  };
}

type Usage = { calls: number; inTok: number; outTok: number; thoughtTok: number; cachedTok: number; seen: boolean };

/** Wraps a model to read the token counts off each response; a model without usage adds nothing. */
function metered(inner: ProModel, usage: Usage): ProModel {
  return {
    async send(contents, system) {
      const turn = await inner.send(contents, system);
      usage.calls += 1;
      const u = (turn.usage as { usageMetadata?: Record<string, unknown> } | undefined)?.usageMetadata;
      if (u) {
        const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        usage.seen = true;
        usage.inTok += n(u.promptTokenCount);
        usage.outTok += n(u.candidatesTokenCount);
        usage.thoughtTok += n(u.thoughtsTokenCount);
        usage.cachedTok += n(u.cachedContentTokenCount);
      }
      return turn;
    },
  };
}

/** The action the reply amounted to, in the vocabulary expectFromKind uses. */
function actionOf(r: ProReplyResult): string {
  if (r.kind === "unavailable") return "unavailable";
  if (r.kind === "handoff") return r.topic === "medical" ? "handoff_medical" : `handoff_${r.topic}`;
  if (r.bookSlot) return "book_slot";
  if (r.reschedule) return "reschedule";
  if (r.appointmentChange) return r.appointmentChange;
  if (r.medicineId) return "suggest_medicine";
  if (r.openBooking) return "open_booking";
  return "answer";
}

const replyTextOf = (r: ProReplyResult): string => (r.kind === "answer" ? r.text : r.kind === "handoff" ? r.text || "" : "");

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main() {
  loadEnv();
  const clinicId = (process.env.CLINIC_ID || "").trim();
  if (!clinicId) refuse("CLINIC_ID is required (CLINIC_ID=<id> npx tsx scripts/pro-battery.mts).");

  const proKey = (process.env.GEMINI_PRO_API_KEY || "").trim();
  const stdKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!DRY) {
    if (!proKey) refuse("GEMINI_PRO_API_KEY is not set. Create the Pro key in Google AI Studio and put it in .env.local (or run with --dry to smoke-test the plumbing).");
    if (stdKey && proKey === stdKey) refuse("GEMINI_PRO_API_KEY equals GEMINI_API_KEY. The battery must run on the separate Pro key, never the standard one.");
  }
  const modelName = process.env.GEMINI_PRO_MODEL || "gemini-pro-latest";

  const db = adminDb();
  const clinicRef = db.collection("clinics").doc(clinicId);
  const clinicDoc = await clinicRef.get();
  if (!clinicDoc.exists) refuse(`No clinic ${clinicId} in Firestore.`);
  const clinicName = String(clinicDoc.data()?.name || "Alpha Dental Clinic");

  // Saved real conversations (read-only).
  type CaseDoc = { id: string; data(): unknown };
  let all: CaseDoc[];
  if (process.env.FIXTURE) {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), process.env.FIXTURE), "utf8")) as Array<SavedTestCase & { id?: string }>;
    all = fixture.map((c, i) => ({ id: c.id || `fixture-${i + 1}`, data: () => c }));
  } else {
    all = (await clinicRef.collection("bot_test_cases").orderBy("atMs", "desc").limit(200).get()).docs;
  }
  const only = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
  let docs = all.filter((d) => !only.length || only.some((p) => d.id.startsWith(p)));
  const limit = Number(process.env.LIMIT) || 0;
  if (limit > 0) docs = docs.slice(0, limit);

  // The clinic's real prices, schedule, doctors and calendar through the production loader (reads
  // only). Its thread/person/gate parts are replaced per turn below.
  const baseArgs: ProArgs = { clinicId, clinicName, question: "", history: [], mode: "sales", chatId: "pro-battery-replay", canBook: true };
  const real = await loadProContext(baseArgs);
  const profileSchedule = await (async () => {
    // Hours, address and phone as the production caller shows them (respond.ts), read-only.
    const { loadPublicClinicProfile } = await import("../src/lib/publicBooking");
    return loadPublicClinicProfile(clinicId, { requireEnabled: false, loadDoctors: true }).catch(() => null);
  })();
  let hoursText = "";
  if (profileSchedule?.schedule?.isConfigured) {
    const s = profileSchedule.schedule;
    const lines = [`من ${arabicClock(s.startHour, s.startMinute)} إلى ${arabicClock(s.endHour, s.endMinute)}`];
    const off = s.offDays.map((d: string) => ARABIC_DAYS[DAY_KEYS.indexOf(d)]).filter(Boolean);
    if (off.length) lines.push(`الإجازة: ${off.join(" و")}`);
    hoursText = lines.join("\n");
  }
  const addressText = profileSchedule?.address || "";
  const clinicPhone = profileSchedule?.phone || "";

  const wa = (await clinicRef.collection("settings").doc("whatsapp").get()).data() || {};
  const facts = (wa.botFacts && typeof wa.botFacts === "object" ? wa.botFacts : {}) as ProArgs["facts"];
  const brief = cleanBrief(wa.botBrief);
  const coaching = typeof wa.botCoaching === "string" ? wa.botCoaching : "";
  const personaName = typeof wa.botPersonaName === "string" ? wa.botPersonaName.trim() : "";
  const knowledgeSnap = await clinicRef.collection("bot_knowledge").where("status", "==", "approved").limit(40).get().catch(() => null);
  const knowledge = (knowledgeSnap?.docs ?? []).map((d) => {
    const k = d.data() || {};
    return { q: String(k.question || ""), a: String(k.answer || "") };
  });

  console.log(`clinic: ${clinicName} (${clinicId})`);
  console.log(`mode: ${DRY ? "DRY (scripted fake model, no key, no spend)" : `REAL model ${modelName} on the Pro key`}`);
  console.log(`prices read: ${real.prices.length}   doctors: ${real.doctors.length}   saved cases: ${docs.length} of ${all.length}${process.env.FIXTURE ? " (from FIXTURE)" : ""}\n`);
  if (!docs.length) {
    console.log("No saved test cases for this clinic. Save some from the Chats page (Save as test case), then re-run.");
    return 0;
  }

  type Row = { id: string; q: string; expect: string[]; action: string; actionOk: boolean; breaks: string[]; ms: number; rounds: number; tools: string[]; modelMs: number; inTok: number; outTok: number };
  const rows: Row[] = [];
  const latencies: number[] = [];
  const usageTotal: Usage = { calls: 0, inTok: 0, outTok: 0, thoughtTok: 0, cachedTok: 0, seen: false };
  let replies = 0;

  for (const d of docs) {
    const c = d.data() as SavedTestCase;
    const turns = (c.turns || []).filter((t) => t.q.trim());
    if (!turns.length) continue;
    const caseId = d.id.slice(0, 18);
    console.log(`=== case ${caseId}${c.clinical ? " (dentist mode)" : ""}${c.note ? `  — ${c.note}` : ""}`);
    const thread: AiThreadLine[] = [];

    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      const expect = i === turns.length - 1 && c.expect?.length ? c.expect : expectFromKind(t.kind);
      const debugRows: Array<Record<string, unknown>> = [];
      const sink: ProSink = {
        async charge() {
          /* never called: charge:false */
        },
        async debug(row) {
          debugRows.push(row);
        },
      };
      const { blocked: _gate, ...open } = real; // the plan/credit gate is not what is under test
      const context: ProContext = { ...open, person: STRANGER, reloadPerson: async () => STRANGER, thread: [...thread] };
      const usage: Usage = { calls: 0, inTok: 0, outTok: 0, thoughtTok: 0, cachedTok: 0, seen: false };
      const model = metered(DRY ? dryModel(t.q) : geminiProModel(proKey, modelName), usage);
      const args: ProArgs = {
        ...baseArgs,
        question: t.q,
        clinical: c.clinical === true,
        hoursText,
        addressText,
        clinicPhone,
        facts,
        brief,
        coaching,
        personaName,
        knowledge,
        thread: [...thread],
      };

      const t0 = Date.now();
      const result = await answerWithPro(args, { model, context, sink, charge: false, record: true });
      const ms = Date.now() - t0;

      const action = actionOf(result);
      const text = replyTextOf(result);
      // An independent second look at the delivered text (the brain already checks, this proves it).
      const shown = result.kind === "answer" ? result.slotsShown ?? [] : [];
      const breaks = text
        ? checkReply({
            question: t.q,
            reply: text,
            allowed: allowedNumbers([
              real.priceLines,
              factLines(facts),
              briefLines(brief),
              coaching,
              hoursText,
              addressText,
              clinicPhone,
              t.q,
              ...thread.map((l) => l.text),
              ...knowledge.map((k) => k.a),
              ...shown.map((s) => s.label),
              `${real.todayKey}`,
            ]),
            clocks: new Set([...shown.map((s) => s.label), hoursText, t.q]),
            drugsAllowed: [t.q, ...thread.map((l) => l.text)].join(" \n "),
          }).map((v) => `${v.rule}: ${v.detail}`)
        : [];

      const dbg = debugRows[0] || {};
      const rounds = Number(dbg.rounds) || 0;
      const tools = Array.isArray(dbg.toolsCalled) ? (dbg.toolsCalled as string[]) : [];
      const modelMs = Number(dbg.modelMs) || 0;
      const actionOk = expect.includes(action);
      rows.push({ id: caseId, q: t.q, expect, action, actionOk, breaks, ms, rounds, tools, modelMs, inTok: usage.inTok, outTok: usage.outTok });
      latencies.push(ms);
      replies += 1;
      usageTotal.calls += usage.calls;
      usageTotal.inTok += usage.inTok;
      usageTotal.outTok += usage.outTok;
      usageTotal.thoughtTok += usage.thoughtTok;
      usageTotal.cachedTok += usage.cachedTok;
      usageTotal.seen ||= usage.seen;

      const why = result.kind === "unavailable" ? ` (${result.reason})` : "";
      console.log(`[${i + 1}/${turns.length}] ${t.q.replace(/\s+/g, " ").slice(0, 100)}`);
      console.log(`   expect ${expect.join("|")}   got ${action}${why}   ${actionOk ? "OK" : "OFF-EXPECTATION"}`);
      console.log(`   red lines: ${breaks.length ? `BREAK  ${breaks.join(" ; ")}` : "none"}`);
      console.log(
        `   rounds ${rounds}   tools [${tools.join(", ")}]   modelMs ${modelMs}   wall ${ms}ms` +
          (usage.seen ? `   tokens in ${usage.inTok} / out ${usage.outTok}${usage.thoughtTok ? ` / thought ${usage.thoughtTok}` : ""}` : "")
      );
      if (text) console.log(`   reply: ${JSON.stringify(text).slice(0, 220)}`);
      console.log("");

      // The thread the next turn sees: what actually happened in the saved chat.
      thread.push({ author: "patient", text: t.q });
      if (t.a?.trim()) thread.push({ author: "bot", text: t.a });
    }
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const matched = rows.filter((r) => r.actionOk).length;
  const broken = rows.filter((r) => r.breaks.length);
  const unavailable = rows.filter((r) => r.action === "unavailable").length;
  console.log("================ SUMMARY ================");
  console.log(`mode                 ${DRY ? "DRY (fake model; numbers below prove plumbing only)" : modelName}`);
  console.log(`replies              ${replies}`);
  console.log(`pass rate (action)   ${matched}/${replies}  ${replies ? Math.round((matched / replies) * 100) : 0}%`);
  console.log(`unavailable          ${unavailable}`);
  console.log(`RED-LINE BREAKS      ${broken.length}${broken.length ? `   <-- ${broken.map((r) => `${r.id}: ${r.breaks.join(" ; ")}`).join(" | ")}` : ""}`);
  console.log(`latency median / p90 ${percentile(sorted, 50)} ms / ${percentile(sorted, 90)} ms`);
  if (usageTotal.seen && replies) {
    console.log(`tokens per reply     in ${Math.round(usageTotal.inTok / replies)}   out ${Math.round(usageTotal.outTok / replies)}   thought ${Math.round(usageTotal.thoughtTok / replies)}   cached in ${Math.round(usageTotal.cachedTok / replies)}   model calls ${(usageTotal.calls / replies).toFixed(1)}`);
  }
  return broken.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(2);
  });
