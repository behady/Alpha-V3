/**
 * The publish test: before a clinic's new layer goes live, the built-in conversations (and a few
 * of the clinic's saved real chats) run through the Pro brain with the DRAFT layer. Nothing is
 * sent and nothing is charged or recorded (the sink is a no-op, charge:false, record:false).
 * Every delivered text is checked once more, independently, against the red lines (checkReply,
 * with the owner's never-say list). A single break refuses the publish; replies the brain could
 * not give at all ("unavailable") are tolerated up to a quarter of the turns, and conversations
 * where the action was not the expected one are only reported.
 *
 * This file also owns the known-patient / stranger set-ups and the "what did the reply amount
 * to" helpers that scripts/pro-battery.mts shares, so there is one copy.
 */
import { arabicDayLabel, arabicTimeLabel } from "@/lib/arabicDateTime";
import { briefLines } from "@/lib/bot/brief";
import { factLines } from "@/lib/bot/botPrompt";
import type { AiPatientContext } from "@/lib/bot/botPrompt";
import type { AiThreadLine } from "@/lib/bot/aiReply";
import { expectFromKind } from "@/lib/bot/testCases";
import { allowedNumbers, checkReply } from "./checks";
import { answerWithPro, proMoneySources, type ProModel, type ProReplyResult } from "./answerWithPro";
import type { ProAppointment, ProPerson } from "./person";
import type { ClinicLayer, ReplaySummary } from "./layer";
import type { ProArgs, ProContext, ProSink } from "./proContext";
import { CONVERSATIONS } from "./replayCases";

export type ReplayCase = {
  id: string;
  clinical: boolean;
  known: boolean;
  turns: Array<{ q: string; expect: string[] }>;
};

/** A person nobody knows: no file, no appointments, and not a guess about who is writing. */
export const PRO_STRANGER: ProPerson = { patientId: null, family: [], upcoming: [], past: [], degraded: false, writerKnown: false };

/** A patient with one appointment a few days out, absolute date, for conversations that assume a known patient. */
export function proKnownPerson(todayKey: string, doctor: string): { person: ProPerson; patient: AiPatientContext } {
  const d = new Date(`${todayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4);
  const appt: ProAppointment = { id: "battery-appt", patientId: "battery-patient", patientName: "منى", date: d.toISOString().slice(0, 10), time: "06:00 PM", doctor, status: "Scheduled", service: "تنظيف" };
  const person: ProPerson = { patientId: "battery-patient", family: [{ id: "battery-patient", name: "منى" }], upcoming: [appt], past: [], degraded: false, writerKnown: true };
  const label = `${arabicDayLabel(appt.date)} الساعة ${arabicTimeLabel(appt.time)}${doctor ? ` مع ${doctor}` : ""}`;
  return { person, patient: { known: true, name: "منى", gender: "female", upcomingAppointment: label } };
}

/** The action the reply amounted to, in the vocabulary expectFromKind uses. */
export function actionOf(r: ProReplyResult): string {
  if (r.kind === "unavailable") return "unavailable";
  if (r.kind === "handoff") return r.topic === "medical" ? "handoff_medical" : `handoff_${r.topic}`;
  if (r.bookSlot) return "book_slot";
  if (r.reschedule) return "reschedule";
  if (r.appointmentChange) return r.appointmentChange;
  if (r.medicineId) return "suggest_medicine";
  if (r.openBooking) return "open_booking";
  return "answer";
}

/** The words the patient would have received. */
export const replyTextOf = (r: ProReplyResult): string => (r.kind === "answer" ? r.text : r.kind === "handoff" ? r.text || "" : "");

/** The built-in conversation set as replay cases; the known patient unless the case says otherwise. */
export function builtinReplayCases(): ReplayCase[] {
  return CONVERSATIONS.map((c) => ({
    id: `builtin:${c.id}`,
    clinical: c.clinical,
    known: c.patient?.known !== false,
    turns: c.turns.map((t) => ({ q: t.q, expect: t.expect })),
  }));
}

/** The clinic's saved real chats (`bot_test_cases` docs, newest first), as strangers. */
export function savedReplayCases(raw: Array<Record<string, unknown>>, max = 10): ReplayCase[] {
  const out: ReplayCase[] = [];
  raw.forEach((c, n) => {
    if (out.length >= max) return;
    const rows = Array.isArray(c.turns) ? (c.turns as Array<Record<string, unknown>>) : [];
    const turns = rows.filter((t) => typeof t?.q === "string" && t.q.trim());
    if (!turns.length) return;
    const expectOverride = Array.isArray(c.expect) ? (c.expect as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const id = typeof c.id === "string" && c.id ? c.id : `saved-${n + 1}`;
    out.push({
      id,
      clinical: c.clinical === true,
      known: false,
      turns: turns.map((t, i) => ({
        q: String(t.q).trim(),
        expect: i === turns.length - 1 && expectOverride.length ? expectOverride : expectFromKind(String(t.kind ?? "")),
      })),
    });
  });
  return out;
}

const NOOP_SINK: ProSink = {
  async charge() {},
  async debug() {},
};

type CaseResult = {
  turns: number;
  unavailable: number;
  actionMisses: number;
  breaks: ReplaySummary["breaks"];
};

async function runCase(
  c: ReplayCase,
  input: { layer: ClinicLayer; baseArgs: ProArgs; context: ProContext; model: () => ProModel; answer: typeof answerWithPro }
): Promise<CaseResult> {
  const { layer, baseArgs, context, model, answer } = input;
  const res: CaseResult = { turns: 0, unavailable: 0, actionMisses: 0, breaks: [] };
  const thread: AiThreadLine[] = [];
  const who = c.known
    ? proKnownPerson(context.todayKey, context.doctors[0] || "")
    : { person: PRO_STRANGER, patient: { known: false, gender: "unknown" } as AiPatientContext };
  const open: ProContext = { ...context }; // the plan/credit gate is not what is under test
  delete open.blocked;

  for (const t of c.turns) {
    res.turns += 1;
    const args: ProArgs = { ...baseArgs, question: t.q, clinical: c.clinical, patient: who.patient, thread: [...thread] };
    const ctx: ProContext = { ...open, person: who.person, reloadPerson: async () => who.person, thread: [...thread], layer };
    let result: ProReplyResult;
    try {
      result = await answer(args, { model: model(), context: ctx, sink: NOOP_SINK, charge: false, record: false });
    } catch {
      result = { kind: "unavailable", reason: "replay_error" };
    }

    if (result.kind === "unavailable") res.unavailable += 1;
    if (!t.expect.includes(actionOf(result))) res.actionMisses += 1;

    const text = replyTextOf(result);
    if (text) {
      // An independent second look at the delivered text: the brain already checks, this proves it.
      const shown = result.kind === "answer" ? result.slotsShown ?? [] : [];
      const apptTimes = who.person.upcoming.flatMap((a) => [a.time, arabicTimeLabel(a.time)]);
      const apptDates = who.person.upcoming.flatMap((a) => [a.date, arabicDayLabel(a.date)]);
      // What the owner wrote into the layer may be repeated: a figure or a time in a rule is theirs.
      const layerText = [...layer.rules, ...layer.handoffWhen, layer.promptSection];
      const rules = checkReply({
        question: t.q,
        reply: text,
        // A price may come only from the clinic's own words (the same list Pro's own check uses);
        // the question, the thread, dates and the owner's layer text never count as a price source.
        allowedMoney: allowedNumbers(proMoneySources(baseArgs, context.priceLines)),
        allowed: allowedNumbers([
          context.priceLines,
          factLines(baseArgs.facts),
          briefLines(baseArgs.brief),
          baseArgs.coaching || "",
          baseArgs.hoursText || "",
          baseArgs.addressText || "",
          baseArgs.clinicPhone || "",
          t.q,
          ...thread.map((l) => l.text),
          ...(baseArgs.knowledge || []).map((k) => k.a),
          ...shown.map((s) => s.label),
          ...apptTimes,
          ...apptDates,
          ...layerText,
          context.todayKey,
        ]),
        clocks: new Set([
          ...shown.map((s) => s.label),
          ...apptTimes,
          baseArgs.hoursText || "",
          factLines(baseArgs.facts),
          briefLines(baseArgs.brief),
          baseArgs.coaching || "",
          ...layerText,
          t.q,
        ]),
        drugsAllowed: [t.q, ...thread.map((l) => l.text)].join(" \n "),
        neverSay: layer.neverSay,
      }).map((v) => v.rule);
      if (rules.length) res.breaks.push({ caseId: c.id, q: t.q, reply: text, rules });
    }

    thread.push({ author: "patient", text: t.q });
    if (text.trim()) thread.push({ author: "bot", text });
  }
  return res;
}

export async function runReplay(input: {
  cases: ReplayCase[];
  layer: ClinicLayer;
  baseArgs: ProArgs;
  context: ProContext;
  model: () => ProModel;
  concurrency?: number;
  answer?: typeof answerWithPro;
}): Promise<ReplaySummary> {
  const t0 = Date.now();
  const answer = input.answer ?? answerWithPro;
  const results: CaseResult[] = new Array(input.cases.length);
  let next = 0;
  const worker = async () => {
    while (next < input.cases.length) {
      const i = next++;
      results[i] = await runCase(input.cases[i], { layer: input.layer, baseArgs: input.baseArgs, context: input.context, model: input.model, answer });
    }
  };
  const width = Math.max(1, Math.min(input.concurrency ?? 6, input.cases.length || 1));
  await Promise.all(Array.from({ length: width }, worker));

  const turns = results.reduce((n, r) => n + r.turns, 0);
  const unavailable = results.reduce((n, r) => n + r.unavailable, 0);
  const actionMisses = results.reduce((n, r) => n + r.actionMisses, 0);
  const breaks = results.flatMap((r) => r.breaks);
  return {
    passed: turns > 0 && breaks.length === 0 && unavailable <= Math.floor(turns * 0.25),
    turns,
    unavailable,
    actionMisses,
    breaks,
    ms: Date.now() - t0,
  };
}
