/**
 * Replay a clinic's saved real WhatsApp conversations through the Pro brain (answerWithPro) and
 * check every reply against the red lines.
 *
 *   CLINIC_ID=<id> npx tsx scripts/pro-battery.mts          real model (needs GEMINI_PRO_API_KEY)
 *   CLINIC_ID=<id> npx tsx scripts/pro-battery.mts --dry    scripted fake model, no key, no spend
 *
 *   ENV_FILE=../.env.local   read secrets from another checkout's env file
 *   SAVED_ONLY=1             skip the built-in conversation set; replay saved cases only
 *   ONLY=<id-prefix>,...     replay just these cases (built-in ids, or saved document id prefixes)
 *   LIMIT=10                 replay at most N cases
 *   FIXTURE=file.json        replay cases from a local JSON array of SavedTestCase (plus an `id`)
 *                            instead of the clinic's bot_test_cases; the clinic data is still read
 *   DRY_REPLY="..."          (--dry only) the fixed reply the fake model sends
 *
 * By default the built-in conversation set (scripts/lib/battery-conversations.ts, the same one
 * probe-model-battery.mts uses) is replayed first, then the clinic's saved cases. Built-in
 * conversations that assume a known patient get a synthetic in-memory patient with one upcoming
 * appointment; the rest, and every saved case, are strangers.
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
 * Exit code: 0 clean; 1 a reply crossed a red line; 2 refusal or setup failure; 3 nothing was
 * tested, or (real run) at least one reply was `unavailable` so the result proves nothing.
 */

import fs from "node:fs";
import path from "node:path";
import { adminDb } from "../src/lib/firebaseAdmin";
import { briefLines } from "../src/lib/bot/brief";
import { factLines } from "../src/lib/bot/botPrompt";
import { expectFromKind, type SavedTestCase } from "../src/lib/bot/testCases";
import { allowedNumbers, checkReply } from "../src/lib/botPro/checks";
import { answerWithPro, geminiProModel, type ProModel } from "../src/lib/botPro/answerWithPro";
import type { ProArgs, ProContext, ProSink } from "../src/lib/botPro/proContext";
import { loadReplayContext } from "../src/lib/botPro/replayContext";
import type { AiThreadLine } from "../src/lib/bot/aiReply";
import type { AiPatientContext } from "../src/lib/bot/botPrompt";
import { CONVERSATIONS } from "./lib/battery-conversations";
import { PRO_STRANGER, proKnownPerson, actionOf, replyTextOf } from "../src/lib/botPro/replay";

const DRY = process.argv.includes("--dry");

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

  // The clinic's real prices, schedule, doctors, calendar, facts, brief and approved answers, through
  // the same loader the publish test uses (reads only). The loader's own thread/person/gate reads
  // are cheap and their results are replaced per turn below.
  const world = await loadReplayContext(clinicId, { chatId: "pro-battery-replay" });
  if (!world) refuse(`No clinic ${clinicId} in Firestore.`);
  const { clinicName, baseArgs, context: real } = world;
  const hoursText = baseArgs.hoursText || "";
  const addressText = baseArgs.addressText || "";
  const clinicPhone = baseArgs.clinicPhone || "";
  const facts = baseArgs.facts;
  const brief = baseArgs.brief;
  const coaching = baseArgs.coaching || "";
  const knowledge = baseArgs.knowledge || [];
  const clinicRef = adminDb().collection("clinics").doc(clinicId);

  // The cases to replay: built-in set first (unless SAVED_ONLY), then saved real chats (read-only).
  type Case = { id: string; clinical: boolean; known: boolean; note: string; builtin: boolean; turns: Array<{ q: string; a: string; expect: string[] }> };
  const cases: Case[] = [];
  if (!process.env.SAVED_ONLY && !process.env.FIXTURE) {
    for (const c of CONVERSATIONS) {
      cases.push({ id: `builtin:${c.id}`, clinical: c.clinical, known: c.patient?.known !== false, note: "", builtin: true, turns: c.turns.map((t) => ({ q: t.q, a: "", expect: t.expect })) });
    }
  }
  type CaseDoc = { id: string; data(): unknown };
  let saved: CaseDoc[];
  if (process.env.FIXTURE) {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), process.env.FIXTURE), "utf8")) as Array<SavedTestCase & { id?: string }>;
    saved = fixture.map((c, i) => ({ id: c.id || `fixture-${i + 1}`, data: () => c }));
  } else {
    saved = (await clinicRef.collection("bot_test_cases").orderBy("atMs", "desc").limit(200).get()).docs;
  }
  for (const d of saved) {
    const c = d.data() as SavedTestCase;
    const turns = (c.turns || []).filter((t) => (t?.q || "").trim());
    if (!turns.length) continue;
    cases.push({
      id: d.id.slice(0, 18),
      clinical: c.clinical === true,
      known: false,
      note: c.note || "",
      builtin: false,
      turns: turns.map((t, i) => ({ q: (t.q || "").trim(), a: t.a || "", expect: i === turns.length - 1 && c.expect?.length ? c.expect : expectFromKind(t.kind) })),
    });
  }
  const only = (process.env.ONLY || "").split(",").map((x) => x.trim()).filter(Boolean);
  let plan = cases.filter((c) => !only.length || only.some((p) => c.id.startsWith(p) || c.id.startsWith(`builtin:${p}`)));
  const limit = Number(process.env.LIMIT) || 0;
  if (limit > 0) plan = plan.slice(0, limit);

  console.log(`clinic: ${clinicName} (${clinicId})`);
  console.log(`mode: ${DRY ? "DRY (scripted fake model, no key, no spend)" : `REAL model ${modelName} on the Pro key`}`);
  console.log(`prices read: ${real.prices.length}   doctors: ${real.doctors.length}   cases: ${plan.length} (${plan.filter((c) => c.builtin).length} built-in, ${plan.filter((c) => !c.builtin).length} saved${process.env.FIXTURE ? ", from FIXTURE" : ""})\n`);
  if (!plan.length) {
    console.error("NOTHING TESTED: 0 cases to replay. Save some from the Chats page (Save as test case), or drop SAVED_ONLY / ONLY / LIMIT, then re-run.");
    return 3;
  }

  type Row = { id: string; turn: number; q: string; expect: string[]; action: string; actionOk: boolean; breaks: string[]; ms: number; rounds: number; tools: string[]; modelMs: number; inTok: number; outTok: number };
  const rows: Row[] = [];
  const latencies: number[] = [];
  const usageTotal: Usage = { calls: 0, inTok: 0, outTok: 0, thoughtTok: 0, cachedTok: 0, seen: false };
  let replies = 0;

  for (const c of plan) {
    const turns = c.turns;
    const caseId = c.id;
    console.log(`=== case ${caseId}${c.clinical ? " (dentist mode)" : ""}${c.known ? " (known patient)" : ""}${c.note ? `  — ${c.note}` : ""}`);
    const thread: AiThreadLine[] = [];
    const who = c.known ? proKnownPerson(real.todayKey, real.doctors[0] || "") : { person: PRO_STRANGER, patient: { known: false, gender: "unknown" } as AiPatientContext };

    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      const expect = t.expect;
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
      const context: ProContext = { ...open, person: who.person, reloadPerson: async () => who.person, thread: [...thread] };
      const usage: Usage = { calls: 0, inTok: 0, outTok: 0, thoughtTok: 0, cachedTok: 0, seen: false };
      const model = metered(DRY ? dryModel(t.q) : geminiProModel(proKey, modelName), usage);
      const args: ProArgs = {
        ...baseArgs, // facts, brief, coaching, hours, address, phone, persona, approved answers
        question: t.q,
        clinical: c.clinical,
        patient: who.patient,
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
      rows.push({ id: caseId, turn: i + 1, q: t.q, expect, action, actionOk, breaks, ms, rounds, tools, modelMs, inTok: usage.inTok, outTok: usage.outTok });
      if (result.kind !== "unavailable") latencies.push(ms);
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
      // Saved chats continue with what the bot actually said; built-in ones with the Pro brain's own words.
      thread.push({ author: "patient", text: t.q });
      const said = c.builtin ? text : t.a;
      if (said?.trim()) thread.push({ author: "bot", text: said });
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
  console.log(`latency median / p90 ${percentile(sorted, 50)} ms / ${percentile(sorted, 90)} ms   (unavailable replies excluded)`);
  if (usageTotal.seen && replies) {
    console.log(`tokens per reply     in ${Math.round(usageTotal.inTok / replies)}   out ${Math.round(usageTotal.outTok / replies)}   thought ${Math.round(usageTotal.thoughtTok / replies)}   cached in ${Math.round(usageTotal.cachedTok / replies)}   model calls ${(usageTotal.calls / replies).toFixed(1)}`);
  }
  const off = rows.filter((r) => !r.actionOk);
  if (off.length) {
    console.log(`\nOFF-EXPECTATION (${off.length}):`);
    for (const r of off) console.log(`  ${r.id} turn ${r.turn}: expected ${r.expect.join("|")}, got ${r.action}   "${r.q.replace(/\s+/g, " ").slice(0, 60)}"`);
  }
  if (broken.length) {
    console.log("\nRESULT: RED-LINE BREAK  (exit 1)");
    return 1;
  }
  if (!DRY && unavailable > 0) {
    console.log(`\nRESULT: ${unavailable} reply(ies) UNAVAILABLE on a real run: the brain fell back, so this run proves nothing for those turns (exit 3)`);
    return 3;
  }
  console.log("\nRESULT: no red-line breaks");
  return 0;
}

main()
  .then((code) => {
    // Let stdout flush and in-flight sockets close before exiting: process.exit() with a request
    // still pending aborts node on Windows (libuv assertion) and loses the exit code.
    process.exitCode = code;
    setTimeout(() => process.exit(code), 250).unref();
  })
  .catch((e) => {
    console.error(e);
    process.exit(2);
  });
