import { GoogleGenerativeAI, SchemaType, type ModelParams } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { createUsageMeter, logAiCreditUsage } from "@/lib/aiCreditLog";
import { getAiCreditLimit, hasFeature } from "@/lib/subscriptions";
import type { Clinic } from "@/types/saas";
import type { BotFacts } from "@/types/whatsapp";
import { dossierLines, type PatientDossier } from "./patientDossier";
import { strayDrugNames } from "./drugGuard";
import { clinicAndPatientLayer, factLines, fixedPromptLayers, type AiPatientContext } from "./botPrompt";
import { getRulebookCache } from "./rulebookCache";

/**
 * The model's voice on the clinic's WhatsApp — receptionist by default, salesperson when the
 * clinic switches it on.
 *
 * Two modes share this one call. "assisted" is the original fallback: rare, cheap, three answers
 * per conversation, runs only after every free route failed. "sales" is the mode a clinic
 * chooses when it wants the model to carry the whole conversation: it sees the thread, the
 * patient's record, the clinic's own words, the owner's coaching notes, the answers staff have
 * given before, and the playbook distilled from what actually led to bookings — and it may
 * decide the moment has come to open the booking. Even then it books nothing itself: it hands
 * that decision to the deterministic flow, which is the only thing that writes to a calendar.
 *
 * In both modes the red lines are the same and are in the prompt verbatim: prices as ranges,
 * nothing medical, nothing invented, complaints and named dentists to a person.
 */

const MODEL = "gemini-flash-latest";
/** One WhatsApp answer costs one credit — same unit the in-app assistant charges. */
const CREDITS_PER_ANSWER = 1;
/** Measured tail latency runs past 12s; nobody waits on this since the webhook answers first. */
const TIMEOUT_MS = 25000;

/**
 * What stands in for a reply the model chose not to write.
 *
 * Exported because it is not evidence of anything: callers that read the reply to work out which
 * language the model answered in must not count this word as an answer in Arabic — doing so sent
 * an English patient an Arabic booking confirmation.
 */
export const AI_DEFAULT_ACK = "تمام 👍";

/**
 * Read the model's JSON, allowing for the wrapping it sometimes adds.
 *
 * The schema is enforced server-side and the reply is almost always clean, but "almost" was
 * costing whole conversations: one malformed response and a patient who had just chosen a time
 * was answered "sorry, I didn't understand, pick from the buttons". A fenced block or a stray
 * sentence in front of the object is not a reason to lose a booking, so the braces are found and
 * parsed. Genuinely broken output still fails, and still gets a retry.
 */
function parseModelJson(raw: string): Record<string, unknown> | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const value = JSON.parse(c);
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // Try the next shape.
    }
  }

  /*
   * Last resort: read the fields out of a response that stopped mid-string.
   *
   * A reply cut off at the token limit is not gibberish — the fields before the cut are exactly
   * what the model meant, and throwing them away costs the patient their turn. Only the two that
   * decide what happens next are salvaged, and both are validated by the caller anyway.
   */
  const action = text.match(/"action"\s*:\s*"([a-z_]+)"/)?.[1];
  if (!action) return null;
  const salvaged: Record<string, unknown> = { action };
  const reply = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  if (reply) {
    try {
      salvaged.reply = JSON.parse(`"${reply}"`);
    } catch {
      // A broken escape: better no sentence than a mangled one.
    }
  }
  const slot = text.match(/"slotKey"\s*:\s*"((?:[^"\\]|\\.)*)/)?.[1];
  if (slot) salvaged.slotKey = slot;
  return salvaged;
}

export type AiReplyResult =
  | {
      kind: "answer";
      text: string;
      /** Sales mode: the model judged the patient ready; the caller opens the booking lists. */
      openBooking?: boolean;
      /** Sales mode: the service the patient is interested in, as the model read it. */
      interest?: string;
      /** Sales mode: the patient agreed to one of the offered slots (a key the caller gave). */
      bookSlot?: string;
      /** Sales mode: a file from the clinic's library to attach after the reply. */
      sendMedia?: string;
      /** Sales mode: the patient wants to move an existing appointment. */
      reschedule?: boolean;
      /** Sales mode: the patient is cancelling or running late — the desk is told, the model replies. */
      appointmentChange?: "cancel" | "late";
      /**
       * One of the medicines the clinic authorised, by id.
       *
       * Not a sentence: the clinic wrote the words and the caller sends them verbatim, after the
       * safety questions have been answered. The model's job here is choosing, never wording.
       */
      medicineId?: string;
    }
  /**
   * The model classified the message as something a human must handle.
   *
   * `text` is what it wanted to say while handing over — the apology to an angry patient, the
   * "let me get the doctor for you". Used in place of the fixed sentence wherever the fixed
   * sentence is merely procedural; the medical wording stays fixed because it carries the
   * clinic's emergency number and must read the same every time.
   */
  | { kind: "handoff"; topic: "medical" | "complaint" | "staff" | "other"; text?: string }
  /** No key, no plan, no credits, timeout, or model error — caller falls back to the old path. */
  | { kind: "unavailable"; reason: string };

export interface AiThreadLine {
  author: "patient" | "bot" | "staff" | "system";
  text: string;
}

export type { AiPatientContext } from "./botPrompt";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ai_timeout")), ms)),
  ]);
}

export async function answerWithAi(args: {
  clinicId: string;
  clinicName: string;
  question: string;
  patientName?: string;
  hoursText?: string;
  addressText?: string;
  clinicPhone?: string;
  facts?: BotFacts;
  /** Prior AI exchanges in this conversation, oldest first — the assisted mode's memory. */
  history: Array<{ q: string; a: string }>;
  /** "sales" lets the model lead the conversation and open bookings; default "assisted". */
  mode?: "assisted" | "sales";
  /** The whole recent thread, oldest first, every voice — sales mode's memory. */
  thread?: AiThreadLine[];
  patient?: AiPatientContext;
  /** The owner's standing instructions, verbatim. */
  coaching?: string;
  /** The name the model signs in with, once, at the start of a conversation. */
  personaName?: string;
  /** The next free appointment slots the model may offer, key → how to say it. */
  slots?: Array<{ key: string; label: string }>;
  /** Files the model may attach after its reply. */
  media?: Array<{ id: string; label: string; when: string }>;
  /** What the assistant remembers about this patient from earlier conversations. */
  memory?: string;
  /** The patient's own record: money, treatments, prescriptions, their usual dentist. */
  dossier?: PatientDossier;
  /** Over-the-counter medicines this clinic authorised, for the model to choose between. */
  medicines?: Array<{ id: string; label: string; whenToUse?: string }>;
  /** True once the patient has answered the safety questions in this conversation. */
  medicineScreened?: boolean;
  /** The conversation is flagged for staff but nobody has picked it up: keep helping, say so once. */
  flaggedForStaff?: boolean;
  /** The patient is mid-booking-list; the options they were shown. */
  bookingStep?: string;
  /** Minutes since the previous exchange when this message opened a new sitting (0 = same sitting). */
  sessionGapMinutes?: number;
  /** Answers staff gave that the owner approved for reuse. */
  knowledge?: Array<{ q: string; a: string }>;
  /** What has worked with this clinic's patients, distilled weekly (or edited by the owner). */
  playbook?: string;
  /** Whether the caller can actually open a booking if asked to. */
  canBook?: boolean;
  /**
   * The message is a symptom and the clinic chose dentist mode. The medical hand-off rule is
   * replaced by the dentist's script: ask, reassure, then offer the earliest appointment. The
   * emergency red flags still hand off.
   */
  clinical?: boolean;
}): Promise<AiReplyResult> {
  const { clinicId, clinicName, question, patientName, hoursText, addressText, clinicPhone, facts, history } = args;
  const sales = args.mode === "sales";

  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) return { kind: "unavailable", reason: "no_api_key" };

  const db = adminDb();

  // The same plan gate and meter the in-app assistant answers to. One pool, one explanation.
  const clinicSnap = await db.collection("clinics").doc(clinicId).get();
  if (!clinicSnap.exists) return { kind: "unavailable", reason: "no_clinic" };
  const clinic = { id: clinicSnap.id, ...clinicSnap.data() } as Clinic;
  if (!hasFeature(clinic, "aiChat")) return { kind: "unavailable", reason: "plan" };

  const monthKey = new Date().toISOString().slice(0, 7);
  const usageRef = db.collection("clinics").doc(clinicId).collection("ai_usage").doc(monthKey);
  const usageSnap = await usageRef.get();
  const used = usageSnap.exists ? Number(usageSnap.data()?.creditsUsed) || 0 : 0;
  const limit = getAiCreditLimit(clinic);
  if (limit > 0 && used + CREDITS_PER_ANSWER > limit) {
    return { kind: "unavailable", reason: "no_credits" };
  }

  /*
   * Price context: names and starting prices from the clinic's own service list. The model is
   * ordered to speak in ranges ("يبدأ من") and to ALWAYS say reception confirms the final price —
   * the clinic's decision, made explicitly: a quoted-exact price that drifted from reality
   * arrives in a patient's hand as a promise the clinic never made.
   */
  let priceLines = "";
  try {
    const servicesSnap = await adminClinicCollection(clinicId, "services").limit(200).get();
    priceLines = servicesSnap.docs
      .map((d) => {
        const s = (d.data() || {}) as Record<string, unknown>;
        const name = String(s.name || "").trim();
        const price = Number(s.price) || 0;
        return name && price > 0 ? `${name}: يبدأ من ${price.toLocaleString("en-US")} ج.م` : "";
      })
      .filter(Boolean)
      .slice(0, 80)
      .join("\n");
  } catch {
    /* no prices in context simply means the model must refuse price questions */
  }

  /*
   * The slots the model may choose from, behind a short id.
   *
   * They used to be offered as their own storage key — "2026-09-07|03:00 PM|Mohamed Ehab" — and
   * asking a model to copy that back verbatim was the single largest cause of lost bookings: it
   * would start the string, fall into repeating the pipe-separated tail, and run to the token
   * limit, leaving JSON that could not be parsed and a patient who had already chosen a time
   * being told "sorry, I didn't catch that". "s1" is not a shape anything loops on.
   */
  const offeredSlots = (args.slots || []).slice(0, 8).map((s, i) => ({ id: `s${i + 1}`, key: s.key, label: s.label }));

  const coaching = args.coaching?.trim();
  const knowledge = (args.knowledge || []).filter((k) => k.q?.trim() && k.a?.trim()).slice(0, 40);
  const playbook = args.playbook?.trim();

  const promptInput = {
    clinicName,
    mode: sales ? "sales" : "assisted",
    clinical: args.clinical === true,
    canBook: args.canBook,
    hoursText,
    addressText,
    clinicPhone,
    priceLines,
    facts,
    patient: args.patient,
    patientName,
    personaName: args.personaName,
    coaching,
    knowledge,
    playbook,
    sessionGapMinutes: args.sessionGapMinutes,
    flaggedForStaff: args.flaggedForStaff,
    bookingStep: args.bookingStep,
    dossierText: dossierLines(args.dossier),
    memory: args.memory,
    offeredSlots,
    medicines: args.medicines,
    medicineScreened: args.medicineScreened,
    media: args.media,
  } as const;

  /*
   * The prompt in two halves, because one of them never changes.
   *
   * Layers 1-4 are byte-identical for every clinic on the system — this file's own note said
   * so before there was anything to cache them with. That block is uploaded to Google once and
   * billed at a tenth; layer 5, which is this clinic and this patient, travels with the turn.
   * The variants (sales/assisted, dentist mode, booking off) each produce their own text and
   * therefore their own cache, which is what the hash key in rulebookCache is for.
   *
   * Joined back together when there is no cache, so the model reads exactly the same prompt
   * either way.
   */
  const sharedSystem = fixedPromptLayers(promptInput.mode, promptInput.clinical, promptInput.canBook)
    .filter(Boolean)
    .join("\n");
  const turnText = clinicAndPatientLayer(promptInput).filter(Boolean).join("\n");

  // Kept outside the try so a parse failure can record what the model actually sent.
  let lastRaw = "";
  /*
   * What this turn actually costs, in tokens.
   *
   * The credit was always counted; the tokens behind it were not, so the one feature a clinic
   * runs thousands of times a month was the one with no cost data at all — 800 credits of
   * WhatsApp against seven logged API calls, all of them from elsewhere in the app. A credit is
   * a price the clinic pays; this is what it costs us, and the two need to be comparable.
   */
  const meter = createUsageMeter(MODEL);
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Null when caching is off or Google is unreachable; the inline path below is identical in
    // what the model reads, it just bills the rulebook at full price this once.
    const cache = await getRulebookCache({ apiKey, model: MODEL, systemText: sharedSystem });
    const modelParams: ModelParams = {
      model: MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            action: {
              type: SchemaType.STRING,
              enum: ["answer", "open_booking", "book_slot", "reschedule", "cancel", "late", "suggest_medicine", "handoff_medical", "handoff_complaint", "handoff_staff", "handoff_other"],
              format: "enum",
            },
            reply: { type: SchemaType.STRING },
            interest: { type: SchemaType.STRING },
            slotKey: { type: SchemaType.STRING },
            medicineId: { type: SchemaType.STRING },
            sendMedia: { type: SchemaType.STRING },
          },
          required: ["action"],
        },
        // Arabic is token-hungry and the reply travels inside JSON; 1500 leaves margin, and the
        // hard length guard on `reply` below caps what a rambling answer can cost regardless.
        // Gemini 2.5 counts its own thinking against this budget: at 1500 a reply was cut off
        // mid-word ("Unterminated string in JSON") after ~250 characters. Thinking is switched
        // off — a receptionist's reply needs no scratchpad — and the ceiling raised regardless.
        maxOutputTokens: 4096,
        temperature: sales ? 0.35 : 0.3,
        ...({ thinkingConfig: { thinkingBudget: 0 } } as Record<string, unknown>),
      },
    };
    const model = cache
      ? genAI.getGenerativeModelFromCachedContent({ name: cache.name, model: MODEL, contents: [] }, modelParams)
      : genAI.getGenerativeModel({ ...modelParams, systemInstruction: `${sharedSystem}\n${turnText}` });

    /*
     * Memory. Sales mode replays the real thread — every voice, including the bot's own menus
     * and a staff member's replies — so the model knows what has already been said and does not
     * quote the price a third time. Assisted mode keeps its cheap three-exchange memory.
     */
    const thread = (args.thread || []).filter((l) => l.text?.trim());
    const contents =
      sales && thread.length
        ? [
            ...thread.slice(-16).map((l) => ({
              role: l.author === "patient" ? ("user" as const) : ("model" as const),
              parts: [{ text: l.author === "patient" ? l.text : JSON.stringify({ action: "answer", reply: l.text.slice(0, 600) }) }],
            })),
            ...(thread[thread.length - 1]?.author === "patient" && thread[thread.length - 1]?.text.trim() === question.trim()
              ? []
              : [{ role: "user" as const, parts: [{ text: question }] }]),
          ]
        : [
            ...history.flatMap((h) => [
              { role: "user" as const, parts: [{ text: h.q }] },
              { role: "model" as const, parts: [{ text: JSON.stringify({ action: "answer", reply: h.a }) }] },
            ]),
            { role: "user" as const, parts: [{ text: question }] },
          ];
    // Gemini requires the first turn to be the user's; a thread that opens with a bot line
    // (a reminder, a template) is trimmed to the first patient message.
    while (contents.length && contents[0].role !== "user") contents.shift();
    if (!contents.length) contents.push({ role: "user" as const, parts: [{ text: question }] });
    if (cache) {
      /*
       * The clinic and the patient, as the opening exchange.
       *
       * A cached system instruction cannot be added to per call, so everything that used to
       * follow the rulebook inside it now precedes the conversation here, marked as coming from
       * the system rather than the patient. A neutral model turn after it keeps the user/model
       * alternation the API expects, in the same JSON shape every other model turn has.
       */
      contents.unshift(
        { role: "user" as const, parts: [{ text: `(معلومات من النظام عن العيادة والمريض — مش رسالة من المريض)\n${turnText}` }] },
        { role: "model" as const, parts: [{ text: JSON.stringify({ action: "answer", reply: "تمام." }) }] }
      );
    }

    /*
     * Every number the model may say. The price list, the clinic's facts, the coaching notes
     * and the hours are the only sources of figures in the prompt, so a figure in the reply that
     * appears in none of them was made up — the live probe quoted braces at 12,000 against a list
     * that says 15,000. One corrective retry, then a person.
     */
    const allowedNumbers = new Set<string>();
    // The clinic's own phone and address are in the prompt and belong in the reply; leaving them
    // out meant a correct answer to "where are you?" was thrown away as an invented figure.
    for (const src of [
      priceLines,
      factLines(facts),
      coaching || "",
      playbook || "",
      hoursText || "",
      addressText || "",
      clinicPhone || "",
      args.memory || "",
      (args.slots || []).map((s) => s.label).join(" "),
      question,
      ...thread.map((l) => l.text),
      ...knowledge.map((k) => k.a),
    ]) {
      for (const m of src.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).matchAll(/\d[\d,]*/g)) allowedNumbers.add(m[0].replace(/,/g, ""));
    }
    /*
     * A figure the clinic never supplied.
     *
     * Large numbers were the only ones checked, so "خصم 20%", "على 3 دفعات" and "12 ألف" — an
     * invented discount, an invented instalment plan and a price written in words — all shipped
     * unchecked. Anything attached to money, a percentage or the word thousand is now checked at
     * any size; everything else keeps the old threshold, so a time, a tooth count or a street
     * number does not trip the guard.
     */
    const strayNumbers = (reply: string): string[] => {
      const norm = reply.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
      const out: string[] = [];
      for (const m of norm.matchAll(/(\d[\d,]*)\s*(%|ج\.?م|جنيه|جنية|الف|ألف|EGP|LE|pound)?/gi)) {
        const n = m[1].replace(/,/g, "");
        if (allowedNumbers.has(n)) continue;
        const moneyish = Boolean(m[2]);
        if (moneyish || Number(n) >= 50) out.push(n);
      }
      return out;
    };

    let raw = "";
    let modelMs = 0;
    let parsed: { action?: string; reply?: string; interest?: string; slotKey?: string; sendMedia?: string; medicineId?: string } = {};
    let strays: string[] = [];
    /*
     * A medicine may be named only if the dentist wrote it in this patient's file or the patient
     * named it first. Both live in plain text, and both are checked as plain text — see drugGuard.
     */
    const drugsAllowed = [question, ...(args.dossier?.prescriptions || []).flatMap((p) => p.items)].join(" \n ");
    let namedDrugs: string[] = [];
    const ATTEMPTS = 3;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const t0 = Date.now();
      const result = await withTimeout(model.generateContent({ contents }), TIMEOUT_MS);
      modelMs += Date.now() - t0;
      meter.add(result.response);
      raw = result.response.text();
      lastRaw = raw;
      const decoded = parseModelJson(raw);
      if (!decoded) {
        // Cut off or malformed. Say so rather than re-asking the identical question into the void.
        parsed = {};
        if (attempt < ATTEMPTS - 1) {
          contents.push({ role: "model" as const, parts: [{ text: raw.slice(0, 400) }] });
          contents.push({
            role: "user" as const,
            parts: [{ text: "(ملاحظة من النظام: الرد السابق مكانش JSON صالح. ابعت الرد تاني كـ JSON بس، من غير أي كلام قبله أو بعده.)" }],
          });
          continue;
        }
        throw new Error("ai_bad_json");
      }
      parsed = decoded as typeof parsed;
      const spoken = ["answer", "open_booking", "book_slot", "reschedule", "cancel", "late", "suggest_medicine"].includes(String(parsed.action));
      strays = spoken ? strayNumbers(String(parsed.reply || "")) : [];
      namedDrugs = spoken ? strayDrugNames(String(parsed.reply || ""), drugsAllowed) : [];
      if (!strays.length && !namedDrugs.length) break;
      if (attempt === 0) {
        contents.push({ role: "model" as const, parts: [{ text: raw }] });
        const notes = [
          strays.length
            ? `الأرقام دي مش موجودة في قايمة الأسعار ولا في معلومات العيادة: ${strays.join("، ")}. أعد نفس الرد بالأرقام الصحيحة من القايمة فقط، ولو الرقم مش موجود متذكرش رقم خالص.`
            : "",
          namedDrugs.length
            ? `ممنوع تسمّي دوا مش مكتوب في روشتة المريض ومش هو اللي ذكره: ${namedDrugs.join("، ")}. أعد نفس الرد من غير أي اسم دوا — قول "المسكّن اللي حضرتك متعوّد عليه" وخلاص.`
            : "",
        ].filter(Boolean);
        contents.push({ role: "user" as const, parts: [{ text: `(ملاحظة من النظام: ${notes.join(" ")})` }] });
      }
    }

    // The flight recorder: one small doc per call, read only by debugging sessions.
    await adminClinicCollection(clinicId, "ai_debug")
      .doc(new Date().toISOString().replace(/[:.]/g, "-"))
      .set({
        question: question.slice(0, 300),
        raw: raw.slice(0, 1000),
        mode: sales ? "sales" : "assisted",
        modelMs,
        slotsGiven: args.slots?.length ?? 0,
        threadLines: thread.length,
        priceLineCount: priceLines ? priceLines.split("\n").length : 0,
        hoursGiven: Boolean(hoursText?.trim()),
        rulebookCached: Boolean(cache),
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {});

    if (strays.length || namedDrugs.length) {
      // Twice wrong: the safe answer is a person, and the flight recorder says why.
      await adminClinicCollection(clinicId, "ai_debug")
        .doc(new Date().toISOString().replace(/[:.]/g, "-") + (namedDrugs.length ? "-drug" : "-stray"))
        .set({ question: question.slice(0, 300), strayNumbers: strays, namedDrugs, raw: raw.slice(0, 1000), createdAt: FieldValue.serverTimestamp() })
        .catch(() => {});
      // A reply that reached for a medicine is a medical answer, whatever it was asked: it goes
      // to the dentist with the emergency number, not to the desk with a shrug.
      return { kind: "handoff", topic: namedDrugs.length ? "medical" : "other" };
    }

    const handoffText = String(parsed.reply || "").trim().slice(0, 700) || undefined;
    if (parsed.action === "handoff_medical") return { kind: "handoff", topic: "medical", text: handoffText };
    if (parsed.action === "handoff_complaint") return { kind: "handoff", topic: "complaint", text: handoffText };
    if (parsed.action === "handoff_staff") return { kind: "handoff", topic: "staff", text: handoffText };
    if (!["answer", "open_booking", "book_slot", "reschedule", "cancel", "late", "suggest_medicine"].includes(String(parsed.action)))
      return { kind: "handoff", topic: "other", text: handoffText };
    const reschedule = sales && parsed.action === "reschedule" && args.canBook !== false;
    const appointmentChange = sales && (parsed.action === "cancel" || parsed.action === "late") ? (parsed.action as "cancel" | "late") : undefined;

    const text = String(parsed.reply || "").trim().slice(0, 900);
    // A slot the model names must be one it was given; anything else is a wish, and opens the lists.
    const slotKey = String(parsed.slotKey || "").trim();
    // The id it was given, the storage key if it echoed one, or the prefix of a key it began to
    // repeat — all three name exactly one slot, and anything else names none.
    const chosenSlot = offeredSlots.find((s) => s.id === slotKey || s.key === slotKey || slotKey.startsWith(s.key));
    const bookSlot = sales && parsed.action === "book_slot" && args.canBook !== false && chosenSlot ? chosenSlot.key : undefined;
    const openBooking = sales && args.canBook !== false && (parsed.action === "open_booking" || (parsed.action === "book_slot" && !bookSlot));
    // A medicine the clinic did not authorise is not a medicine. An unknown id falls through to
    // an ordinary answer, where the drug guard is still watching every word.
    const wantedMedicine = String(parsed.medicineId || "").trim();
    const medicineId =
      parsed.action === "suggest_medicine" && (args.medicines || []).some((m) => m.id === wantedMedicine)
        ? wantedMedicine
        : undefined;
    const mediaId = String(parsed.sendMedia || "").trim();
    const sendMedia = (args.media || []).some((m) => m.id === mediaId) ? mediaId : undefined;
    if (!text && !openBooking && !bookSlot && !reschedule && !appointmentChange && !medicineId) return { kind: "handoff", topic: "other" };

    // Charged only for a delivered answer, after the model produced one. Handoffs cost nothing.
    await usageRef.set(
      { monthKey, creditsUsed: FieldValue.increment(CREDITS_PER_ANSWER), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await logAiCreditUsage({
      clinicId,
      feature: sales ? "whatsapp_sales" : "whatsapp_bot",
      credits: CREDITS_PER_ANSWER,
      userId: "whatsapp_bot",
      userName: "WhatsApp Bot",
      detail: question.slice(0, 120),
      usage: meter.snapshot(),
    }).catch(() => {});

    const interest = String(parsed.interest || "").trim().slice(0, 60) || undefined;
    return { kind: "answer", text: text || AI_DEFAULT_ACK, openBooking, interest, bookSlot, sendMedia, reschedule, appointmentChange, medicineId };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "model_error";
    await adminClinicCollection(clinicId, "ai_debug")
      .doc(new Date().toISOString().replace(/[:.]/g, "-"))
      .set({
        question: question.slice(0, 300),
        failed: reason,
        // What the model actually sent back. Without it a parse failure is unfalsifiable.
        raw: String(lastRaw || "").slice(0, 1200),
        mode: sales ? "sales" : "assisted",
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {});
    return { kind: "unavailable", reason };
  }
}
