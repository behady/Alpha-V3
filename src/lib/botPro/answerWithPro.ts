/**
 * The Pro brain's turn: Gemini Pro, with tools, answering a patient as the clinic's receptionist.
 *
 * The model searches the calendar, reads the file and looks prices up itself, then finishes with
 * one `reply` call. Code, not the prompt, has the last word on four things:
 *   - every reply is checked against the red lines (prices, clock times, medicine names, script,
 *     persona); one corrective round, then a person;
 *   - a slot can be booked only if it was shown (this turn or the last), and a number with any
 *     upcoming appointment books again only when the model says it is an extra appointment;
 *   - the calendar is read again before a booking is returned, in case the desk booked them
 *     while the model was thinking;
 *   - any failure, timeout or a turn that never reaches `reply` is `unavailable`, and the caller
 *     answers with the standard brain exactly as it does today.
 *
 * It returns the standard brain's AiReplyResult (plus the slots it showed), so nothing downstream
 * changes. Firestore lives behind ProContext/ProSink (proContext.ts): tests inject both.
 *
 * Run: npm run test:pro-answer
 */
import { FunctionCallingMode, GoogleGenerativeAI, type Content, type GenerativeModel, type Part } from "@google/generative-ai";
import { createUsageMeter, type AiUsageMeter } from "@/lib/aiCreditLog";
import { arabicDayLabel, arabicTimeLabel } from "@/lib/arabicDateTime";
import { AI_DEFAULT_ACK, type AiReplyResult, type AiThreadLine } from "@/lib/bot/aiReply";
import { briefLines, serviceNamesOnly } from "@/lib/bot/brief";
import { factLines, type BotPromptInput } from "@/lib/bot/botPrompt";
import { dossierLines } from "@/lib/bot/patientDossier";
import { allowedNumbers, checkReply, type Violation } from "./checks";
import type { ProAppointment } from "./person";
import { proClinicLayer, proRulebook, proTurnLayer } from "./proPrompt";
import { firestoreProSink, loadProContext, PRO_CREDITS_PER_REPLY, PRO_THREAD_LINES, type ProArgs, type ProContext, type ProSink } from "./proContext";
import { normalizeForMatch, PRO_TOOL_DECLARATIONS, runTool, type ToolEnv } from "./tools";

export { PRO_CREDITS_PER_REPLY };
export type { ProArgs };

/** The whole turn, context load included. Past it the standard brain answers instead. */
const DEADLINE_MS = 25_000;
/** Model calls per turn, corrective rounds included. */
const MAX_ROUNDS = 4;
/** Slots that may be offered and booked by id in one turn (same cap as find_slots). */
const MAX_SHOWN = 8;
/** Actions whose text the patient reads as the clinic's answer (the rest hand off). */
const SPOKEN = new Set(["answer", "open_booking", "book_slot", "reschedule", "cancel", "late", "suggest_medicine"]);

export type ProReplyResult = AiReplyResult & { slotsShown?: Array<{ key: string; label: string }> };

export interface ProTurn {
  functionCall?: { name: string; args: Record<string, unknown> };
  text?: string;
  /** The raw response, for the token meter (reads `usageMetadata`). */
  usage?: unknown;
  /** The model's own turn, verbatim, to append to the conversation (keeps Gemini thought signatures). */
  content?: unknown;
}

export interface ProModel {
  send(contents: unknown[], systemInstruction: string): Promise<ProTurn>;
}

/** The production model: Gemini Pro with the four tools, forced to call one every round. */
export function geminiProModel(apiKey: string, modelName: string): ProModel {
  const genAI = new GoogleGenerativeAI(apiKey);
  let built: { system: string; model: GenerativeModel } | null = null;
  return {
    async send(contents, systemInstruction) {
      if (!built || built.system !== systemInstruction) {
        built = {
          system: systemInstruction,
          // No explicit cache (it cannot hold tools); the fixed rulebook leads the system text so
          // Gemini's implicit prefix cache can reuse it.
          model: genAI.getGenerativeModel({
            model: modelName,
            systemInstruction,
            tools: [{ functionDeclarations: PRO_TOOL_DECLARATIONS }],
            toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.ANY } },
            generationConfig: { temperature: 0.35, maxOutputTokens: 8192 },
          }),
        };
      }
      const { response } = await built.model.generateContent({ contents: contents as Content[] });
      const call = response.functionCalls()?.[0];
      let text = "";
      try {
        text = response.text();
      } catch {
        /* a call-only response has no text */
      }
      // One function response follows, so only the first call stays in the replayed turn.
      const parts: Part[] = response.candidates?.[0]?.content?.parts ?? [];
      const first = parts.find((p) => p.functionCall);
      return {
        ...(call ? { functionCall: { name: call.name, args: (call.args ?? {}) as Record<string, unknown> } } : {}),
        text,
        usage: response,
        ...(first ? { content: { role: "model", parts: parts.filter((p) => !p.functionCall || p === first) } } : {}),
      };
    },
  };
}

type Reply = { action: string; reply: string; interest: string; slotId: string; medicineId: string; sendMedia: string; extraAppointment: boolean };

function readReply(a: Record<string, unknown>): Reply {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    action: s(a.action),
    reply: s(a.reply),
    interest: s(a.interest),
    slotId: s(a.slotId),
    medicineId: s(a.medicineId),
    sendMedia: s(a.sendMedia),
    extraAppointment: a.extraAppointment === true,
  };
}

const TITLE = /^(?:dr\.?|doctor|د\.?|دكتور[ةه]?)\s*/i;

/**
 * The clinic's dentist the model meant, or "" (any doctor) — never a name the model made up.
 * Whole words, either direction, and only when exactly one dentist fits: "Mohamed" at a clinic
 * with two is nobody in particular, and "Ali" is not "Alia".
 */
export function realDoctor(wanted: unknown, doctors: string[]): string {
  const w = normalizeForMatch(String(wanted ?? "").trim().replace(TITLE, ""));
  if (!w) return "";
  const words = (hay: string, needle: string) => ` ${hay} `.includes(` ${needle} `);
  const matches = doctors.filter((d) => {
    const n = normalizeForMatch(d.trim().replace(TITLE, ""));
    return !!n && (words(n, w) || words(w, n));
  });
  return matches.length === 1 ? matches[0] : "";
}

/** The last turn's offer as s1..sn, past days dropped, labels re-rendered as absolute dates. */
function seedPrevious(keys: string[] | undefined, ctx: ProContext, shown: ToolEnv["shown"]): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  for (const key of keys ?? []) {
    const [day = "", time = "", doctor = ""] = String(key || "").split("|");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !time.trim() || day < ctx.todayKey) continue;
    if (shown.size >= MAX_SHOWN) break;
    if ([...shown.values()].some((s) => s.key === key)) continue;
    const id = `s${shown.size + 1}`;
    const label = ctx.dayLabel(day, time, doctor);
    shown.set(id, { key, label });
    out.push({ id, label });
  }
  return out;
}

/** Patient lines as the user, every other voice as the model; the first turn must be the user's. */
function threadContents(thread: AiThreadLine[], question: string): Content[] {
  const lines = thread.filter((l) => l.text?.trim()).slice(-PRO_THREAD_LINES);
  const out: Content[] = lines.map((l) => ({
    role: l.author === "patient" ? "user" : "model",
    parts: [{ text: l.author === "patient" ? l.text : l.text.slice(0, 600) }],
  }));
  const last = lines[lines.length - 1];
  if (!(last?.author === "patient" && last.text.trim() === question.trim())) out.push({ role: "user", parts: [{ text: question }] });
  while (out.length && out[0].role !== "user") out.shift();
  if (!out.length) out.push({ role: "user", parts: [{ text: question }] });
  return out;
}

const apptLabel = (a: ProAppointment, hideDoctor = false) =>
  `${arabicDayLabel(a.date)} الساعة ${arabicTimeLabel(a.time)}${!hideDoctor && a.doctor?.trim() ? ` مع ${a.doctor.trim()}` : ""}`;

function violationNote(vs: Violation[], question: string): string {
  const arabicQuestion = (question.match(/[؀-ۿ]/g) || []).length >= (question.match(/[A-Za-z]/g) || []).length;
  const lines = vs.map((v) => {
    switch (v.rule) {
      case "price":
        return `الأرقام دي مش في قايمة الأسعار ولا في معلومات العيادة ولا رجعت من get_price: ${v.detail}. أعد نفس الرد من غيرها، ولو الرقم مش موجود متذكرش رقم خالص.`;
      case "clock":
        return `الساعات دي مش من اللي find_slots رجّعته ولا ميعاد محجوز ولا مواعيد العمل: ${v.detail}. متذكرش أي ساعة غير دول.`;
      case "drug":
        return `ممنوع تسمّي دوا مش مكتوب في روشتة المريض ومش هو اللي ذكره: ${v.detail}. أعد نفس الرد من غير أي اسم دوا — قول "المسكّن اللي حضرتك متعوّد عليه" وخلاص.`;
      case "script":
        return arabicQuestion
          ? "المريض كتب بالعربي وردك جه بالإنجليزي. أعد نفس الرد بالعامية المصرية."
          : "المريض كتب بالإنجليزي أو فرانكو وردك جه بالعربي. أعد نفس الرد بنفس لغة رسالته.";
      case "claims_human":
        return "ممنوع تقول إنك إنسان أو تنكر إنك مساعد آلي. لو المريض سأل، قول الحقيقة ببساطة.";
      case "never_say":
        return `العيادة طلبت متتقالش العبارات دي: ${v.detail}. أعد نفس الرد من غيرها.`;
      default:
        return "متقولش إنك بوت أو ذكاء اصطناعي من نفسك — المريض مسألش. أعد الرد من غير الكلام ده.";
    }
  });
  return `(ملاحظة من النظام: الرد ده متبعتش. ${lines.join(" ")} ابعت الرد الصح بـ reply.)`;
}

const bookedNote = (upcoming: ProAppointment[], action: string, hideDoctor = false) =>
  `(ملاحظة من النظام: الحجز ده متعملش. في ميعاد جاي محجوز بالفعل على الرقم ده: ${upcoming.map((a) => apptLabel(a, hideDoctor)).join("، ")}. لو المريض عايز ميعاد زيادة فعلاً (مش تغيير)، ابعت ${action} تاني ومعاه extraAppointment: true. لو عايز يغيّر ميعاده اختار reschedule. وإلا فكّره بميعاده.)`;

const newBookingNote = (added: ProAppointment[], hideDoctor = false) =>
  `(ملاحظة من النظام: لسه حالاً اتسجل ميعاد جديد على الرقم ده: ${added.map((a) => apptLabel(a, hideDoctor)).join("، ")}. راجع ردك على الأساس ده: متحجزش ولا تفتح الحجز تاني إلا لو المريض عايز ميعاد زيادة فعلاً (extraAppointment: true).)`;

type Trace = { rounds: number; toolsCalled: string[]; violations: string[]; modelMs: number; action: string; raw: string; degraded: boolean };

/** The loop itself. Throws only on a model error or the deadline; the caller turns that into unavailable. */
async function runTurn(
  args: ProArgs,
  ctx: ProContext,
  model: ProModel,
  timed: <T>(start: () => Promise<T>) => Promise<T>,
  meter: AiUsageMeter,
  trace: Trace
): Promise<ProReplyResult> {
  const { question } = args;
  const consult = args.brief?.prices === "consult";
  const canBook = args.canBook !== false;
  let person = ctx.person;
  trace.degraded = person.degraded;

  // The owner's "don't mention dentists' names" switch: every slot is labelled without the dentist,
  // while its key still carries the chair the booking will be written with.
  const hideDoctors = args.hideDoctorNames === true;
  const dayLabel: ToolEnv["dayLabel"] = hideDoctors ? (day, time) => ctx.dayLabel(day, time, "") : ctx.dayLabel;
  const shown: ToolEnv["shown"] = new Map();
  const previousSlots = seedPrevious(args.previousSlotKeys, { ...ctx, dayLabel }, shown);
  const env: ToolEnv = {
    todayKey: ctx.todayKey,
    openDays: ctx.openDays,
    freeTimes: ctx.freeTimes,
    dayLabel,
    person,
    patientFile: ctx.patientFile,
    prices: consult ? [] : ctx.prices,
    shown,
  };

  const coaching = args.coaching?.trim();
  const playbook = args.playbook?.trim();
  const knowledge = (args.knowledge || []).filter((k) => k.q?.trim() && k.a?.trim()).slice(0, 40);
  const dossierText = dossierLines(args.dossier);
  const input: BotPromptInput = {
    clinicName: args.clinicName,
    mode: "sales",
    clinical: args.clinical === true,
    canBook: args.canBook,
    photo: args.photo,
    ad: args.ad,
    hoursText: args.hoursText,
    addressText: args.addressText,
    clinicPhone: args.clinicPhone,
    // Owner switches; absent (not undefined) when off, so the input is Plan 1's.
    ...(args.branchesText?.trim() ? { branchesText: args.branchesText } : {}),
    ...(hideDoctors ? { hideDoctorNames: true } : {}),
    // "No prices on WhatsApp": the names stay, the figures leave the prompt and the number guard.
    priceLines: consult ? serviceNamesOnly(ctx.priceLines) : ctx.priceLines,
    brief: args.brief,
    facts: args.facts,
    patient: args.patient,
    patientName: args.patientName,
    personaName: args.personaName,
    coaching,
    knowledge,
    playbook,
    sessionGapMinutes: args.sessionGapMinutes,
    flaggedForStaff: args.flaggedForStaff,
    dossierText,
    memory: args.memory,
    offeredSlots: [],
    medicines: args.medicines,
    medicineScreened: args.medicineScreened,
    media: args.media,
  };
  // The clinic layer sits between the fixed rulebook and the turn; empty, it adds no line at all.
  const clinicLayer = proClinicLayer(ctx.layer);
  const system = `${proRulebook({ clinical: input.clinical, canBook, ...(hideDoctors ? { hideDoctorNames: true } : {}) })}\n${clinicLayer ? `${clinicLayer}\n` : ""}${proTurnLayer(input, person, { todayKey: ctx.todayKey, previousSlots })}`;
  const contents: unknown[] = threadContents(ctx.thread, question);

  // Every source a figure, a time or a medicine name may come from. Tool results join as they arrive.
  // A price may come only from the clinic's own words (moneySources, plus get_price and the
  // patient's file); the patient's message and the thread may only be repeated as plain numbers,
  // so "سمعت إنها بـ 2000" can never become "أيوه بـ 2000 جنيه".
  const [y, m, d] = ctx.todayKey.split("-").map(Number);
  const moneySources = proMoneySources(args, ctx.priceLines, dossierText);
  const plainSources = [
    args.hoursText || "",
    args.addressText || "",
    ...(args.branchesText ? [args.branchesText] : []),
    args.clinicPhone || "",
    args.memory || "",
    question,
    ...ctx.thread.map((l) => l.text),
    `${ctx.todayKey} ${d}/${m} ${y}`,
  ];
  const toolOutputs: string[] = [];
  const appts = () => [...ctx.person.upcoming, ...ctx.person.past, ...person.upcoming, ...person.past];
  const labels = () => [...shown.values()].map((s) => s.label);
  const check = (reply: string) =>
    checkReply({
      question,
      reply,
      allowedMoney: allowedNumbers([...moneySources, ...toolOutputs]),
      allowed: allowedNumbers([
        ...plainSources,
        ...labels(),
        ...appts().flatMap((a) => [a.date, arabicDayLabel(a.date), a.time, arabicTimeLabel(a.time)]),
      ]),
      clocks: new Set([
        ...labels(),
        ...[...ctx.person.upcoming, ...person.upcoming].flatMap((a) => [a.time, arabicTimeLabel(a.time)]),
        args.hoursText || "",
        // Times the clinic wrote itself ("الدكتور موجود الساعة 4") may be repeated.
        factLines(args.facts),
        briefLines(args.brief),
        coaching || "",
        // The patient's own times may be said back: "7:30 مش متاح" is not an invented time.
        question,
      ]),
      drugsAllowed: [question, ...(args.dossier?.prescriptions || []).flatMap((p) => p.items), ...toolOutputs].join(" \n "),
      neverSay: ctx.layer?.neverSay ?? [],
    });

  const firstIds = new Set(ctx.person.upcoming.map((a) => a.id));
  let corrected = false;
  let warnedBooked = false;
  let rechecked = false;
  let dropBooking = false;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const t0 = Date.now();
    const res = await timed(() => model.send(contents, system));
    trace.modelMs += Date.now() - t0;
    trace.rounds = round;
    meter.add(res.usage ?? {});
    const fc = res.functionCall;
    if (!fc) {
      trace.raw = String(res.text || "").slice(0, 1000);
      return { kind: "unavailable", reason: "no_reply_tool" };
    }
    trace.toolsCalled.push(fc.name);
    contents.push(res.content ?? { role: "model", parts: [{ functionCall: fc }] });
    const respond = (response: Record<string, unknown>) =>
      contents.push({ role: "user", parts: [{ functionResponse: { name: fc.name, response } }] });

    if (fc.name !== "reply") {
      const toolArgs = { ...(fc.args ?? {}) };
      if (fc.name === "find_slots") toolArgs.doctor = realDoctor(toolArgs.doctor, ctx.doctors);
      const safe = async (): Promise<Record<string, unknown>> => {
        try {
          return await runTool(fc.name, toolArgs, env);
        } catch {
          return { error: "tool_failed" };
        }
      };
      const out = await timed(safe);
      if (fc.name === "get_price" || fc.name === "get_patient_file") toolOutputs.push(JSON.stringify(out));
      respond(out);
      continue;
    }

    const r = readReply(fc.args ?? {});
    trace.action = r.action;
    trace.raw = r.reply.slice(0, 1000);
    const violations = check(r.reply);
    trace.violations.push(...violations.map((v) => `${v.rule}: ${v.detail}`));
    // The wrong script earns one nudge, never a hand-off: a wrong-language answer beats no answer.
    const blocking = violations.filter((v) => v.rule !== "script");

    if (!SPOKEN.has(r.action)) {
      // A hand-off's words are optional; ones that cross a red line are simply not sent.
      const text = blocking.length ? "" : r.reply.slice(0, 700);
      const topic =
        r.action === "handoff_medical" ? "medical" : r.action === "handoff_complaint" ? "complaint" : r.action === "handoff_staff" ? "staff" : "other";
      return { kind: "handoff", topic, ...(text ? { text } : {}) };
    }

    if (violations.length) {
      if (!corrected && round < MAX_ROUNDS) {
        corrected = true;
        respond({ rejected: true, note: violationNote(violations, question) });
        continue;
      }
      if (blocking.length) return { kind: "handoff", topic: blocking.some((v) => v.rule === "drug") ? "medical" : "other" };
    }

    // Any upcoming visit on the number, whoever's it is. A degraded read is not "none" but is not
    // "booked" either: the booking writer re-checks the slot itself. Opening the booking menu is
    // the same new booking, so it follows the same rule; once dropped, the text is still sent.
    const booking = r.action === "book_slot" || r.action === "open_booking";
    if (booking && canBook && person.upcoming.length > 0 && !person.degraded && !r.extraAppointment) {
      if (!warnedBooked && round < MAX_ROUNDS) {
        warnedBooked = true;
        respond({ rejected: true, note: bookedNote(person.upcoming, r.action, hideDoctors) });
        continue;
      }
      dropBooking = true;
    }

    if (!rechecked && !dropBooking && canBook && (r.action === "book_slot" || r.action === "open_booking")) {
      rechecked = true;
      const fresh = await timed(() => ctx.reloadPerson());
      const added = fresh.degraded ? [] : fresh.upcoming.filter((a) => !firstIds.has(a.id));
      if (added.length) {
        person = fresh;
        env.person = fresh;
        // No round left to tell the model: the standard brain, reading the calendar afresh, answers.
        if (round >= MAX_ROUNDS) return { kind: "unavailable", reason: "recheck_no_round" };
        respond({ rejected: true, note: newBookingNote(added, hideDoctors) });
        continue;
      }
    }

    return mapAnswer(r, args, shown, canBook, dropBooking);
  }
  return { kind: "unavailable", reason: "no_reply_tool" };
}

/**
 * The clinic's own words a price may come from: the price list, facts, brief, coaching, playbook,
 * approved answers, the patient's file, address and phone. Never the patient's message, the thread,
 * dates or the owner's layer. The turn and the publish test (replay.ts) both build `allowedMoney`
 * from this one list.
 */
export function proMoneySources(args: ProArgs, priceLines: string, dossierText = ""): string[] {
  const consult = args.brief?.prices === "consult";
  const knowledge = (args.knowledge || []).filter((k) => k.q?.trim() && k.a?.trim()).slice(0, 40);
  return [
    consult ? "" : priceLines,
    factLines(args.facts),
    briefLines(args.brief),
    args.coaching?.trim() || "",
    args.playbook?.trim() || "",
    ...knowledge.map((k) => k.a),
    dossierText,
    // The clinic's own address and phone: "12 ألف مسكن" is a district, not a price.
    args.addressText || "",
    // Each branch's address and phone, likewise (one line per branch); absent, the list is unchanged.
    ...(args.branchesText ? [args.branchesText] : []),
    args.clinicPhone || "",
  ];
}

/** The standard brain's mapping (aiReply.ts), with the slot id read from what this turn showed. */
function mapAnswer(r: Reply, args: ProArgs, shown: ToolEnv["shown"], canBook: boolean, dropBooking: boolean): ProReplyResult {
  const text = r.reply.slice(0, 900);
  const reschedule = r.action === "reschedule" && canBook;
  const appointmentChange = r.action === "cancel" || r.action === "late" ? (r.action as "cancel" | "late") : undefined;
  const chosen = shown.get(r.slotId) ?? [...shown.values()].find((s) => s.key === r.slotId);
  const bookSlot = r.action === "book_slot" && canBook && !dropBooking && chosen ? chosen.key : undefined;
  const openBooking = canBook && !dropBooking && (r.action === "open_booking" || (r.action === "book_slot" && !bookSlot));
  const medicineId = r.action === "suggest_medicine" && (args.medicines || []).some((m) => m.id === r.medicineId) ? r.medicineId : undefined;
  const sendMedia = (args.media || []).some((m) => m.id === r.sendMedia) ? r.sendMedia : undefined;
  if (!text && !openBooking && !bookSlot && !reschedule && !appointmentChange && !medicineId) return { kind: "handoff", topic: "other" };
  const interest = r.interest.slice(0, 60);
  return {
    kind: "answer",
    text: text || AI_DEFAULT_ACK,
    ...(openBooking ? { openBooking } : {}),
    ...(interest ? { interest } : {}),
    ...(bookSlot ? { bookSlot } : {}),
    ...(sendMedia ? { sendMedia } : {}),
    ...(reschedule ? { reschedule } : {}),
    ...(appointmentChange ? { appointmentChange } : {}),
    ...(medicineId ? { medicineId } : {}),
    slotsShown: [...shown.values()].map((s) => ({ key: s.key, label: s.label })),
  };
}

export async function answerWithPro(
  args: ProArgs,
  deps: { model?: ProModel; context?: ProContext; sink?: ProSink; charge?: boolean; record?: boolean; now?: () => number } = {}
): Promise<ProReplyResult> {
  const now = deps.now ?? Date.now;
  const deadlineAt = now() + DEADLINE_MS;
  const modelName = process.env.GEMINI_PRO_MODEL || "gemini-pro-latest";
  // The Pro key only: the standard brain's key is never spent here.
  const apiKey = process.env.GEMINI_PRO_API_KEY || "";
  if (!deps.model && !apiKey) return { kind: "unavailable", reason: "no_api_key" };
  const model = deps.model ?? geminiProModel(apiKey, modelName);
  const sink = deps.sink ?? firestoreProSink(args.clinicId, args.question);

  const timers: Array<ReturnType<typeof setTimeout>> = [];
  // A thunk, so nothing (above all a paid model call) starts once the deadline has passed; a call
  // that loses the race may still reject later, and that must never be an unhandled rejection.
  const timed = <T>(start: () => Promise<T>): Promise<T> => {
    const left = deadlineAt - now();
    if (left <= 0) return Promise.reject(new Error("ai_timeout"));
    const p = start();
    p.catch(() => {});
    return Promise.race([p, new Promise<never>((_, reject) => timers.push(setTimeout(() => reject(new Error("ai_timeout")), left)))]);
  };

  const meter = createUsageMeter(modelName);
  const trace: Trace = { rounds: 0, toolsCalled: [], violations: [], modelMs: 0, action: "", raw: "", degraded: false };
  let result: ProReplyResult;
  let failed = "";
  try {
    const ctx = deps.context ?? (await timed(() => loadProContext(args)));
    if (ctx.blocked) return { kind: "unavailable", reason: ctx.blocked };
    result = await runTurn(args, ctx, model, timed, meter, trace);
  } catch (e) {
    failed = e instanceof Error ? e.message || "model_error" : "model_error";
    result = { kind: "unavailable", reason: failed };
  } finally {
    timers.forEach(clearTimeout);
  }

  // Charged only for a delivered answer; a hand-off or a fall back costs the clinic nothing.
  if (result.kind === "answer" && deps.charge !== false) {
    await sink.charge(PRO_CREDITS_PER_REPLY, meter.snapshot()).catch(() => {});
  }
  if (deps.record !== false) {
    await sink
      .debug({
        brain: "pro",
        model: modelName,
        question: args.question.slice(0, 300),
        outcome: result.kind,
        ...(result.kind === "unavailable" ? { reason: result.reason } : {}),
        ...(result.kind === "handoff" ? { topic: result.topic } : {}),
        ...(result.kind === "answer" && result.bookSlot ? { bookSlot: result.bookSlot } : {}),
        ...(failed ? { failed } : {}),
        action: trace.action,
        rounds: trace.rounds,
        toolsCalled: trace.toolsCalled,
        violations: trace.violations,
        modelMs: trace.modelMs,
        degraded: trace.degraded,
        slotsShown: result.kind === "answer" ? result.slotsShown?.length ?? 0 : 0,
        raw: trace.raw,
      })
      .catch(() => {});
  }
  return result;
}
