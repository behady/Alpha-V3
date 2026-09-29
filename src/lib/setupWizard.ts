/**
 * The two-minute setup a brand-new clinic is walked through right after it is created.
 *
 * A fresh clinic starts with nothing: no opening hours, so the calendar offers Friday midnight;
 * no services, so the first invoice has nothing to pick from; no phone, so prescriptions print
 * without one. The welcome guide already lists those as missions, but a mission is something you
 * find later. This is the same three facts asked up front, on one screen each, with "Skip" always
 * on the button — and every step is optional, so the wizard can never trap anyone.
 *
 * Pure data and pure functions, no client imports, so the page, the tests and (one day) the
 * Android app read the same template. The page decides what to write; this file decides what to
 * offer.
 */

export const SETUP_ROUTE = "/setup";

/**
 * The first three are the facts every clinic needs on day one. The last three came later
 * ("quick clinic setup"): insurance, connecting the clinic's WhatsApp, and deciding what that
 * WhatsApp does — each still optional, each still writing only what the Settings screens write.
 */
export type SetupStepId = "hours" | "services" | "contact" | "insurance" | "whatsapp" | "assistant";
export const SETUP_STEPS: SetupStepId[] = ["hours", "services", "contact", "insurance", "whatsapp", "assistant"];

/**
 * The hours most Egyptian dental clinics keep: an afternoon-to-late-evening day, Friday closed.
 * Stored in the exact shape the Schedule settings screen saves (`settings/clinic_info.schedule`),
 * so the wizard and that screen are two doors into one record.
 */
export const DEFAULT_SCHEDULE = {
  start: "10:00",
  end: "22:00",
  slotDuration: "30",
  offDays: ["Friday"] as string[],
};

/** Day names exactly as the Schedule screen stores them — capitalised English. */
export const WEEK_DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

export interface ServiceTemplate {
  /** Stable id for the checkbox and the tests, never written to Firestore. */
  key: string;
  name: { en: string; ar: string };
  /** EGP. A starting point the clinic edits, not a recommendation. */
  price: number;
  durationMinutes: number;
  requiresLab?: boolean;
  estimatedLabFee?: number;
}

/**
 * A working price list for a general practice in Egypt, priced for 2026. The point is that every
 * name in it is something a receptionist will actually pick on the first day; niche work belongs
 * on the Prices screen later. Lab fees mark the crowns and dentures so the lab board has
 * something to estimate from.
 */
export const SERVICE_TEMPLATES: ServiceTemplate[] = [
  { key: "consult", name: { en: "Consultation", ar: "كشف" }, price: 200, durationMinutes: 20 },
  { key: "scaling", name: { en: "Scaling & Polishing", ar: "تنظيف وتلميع" }, price: 600, durationMinutes: 45 },
  { key: "composite", name: { en: "Composite Filling", ar: "حشو كومبوزيت" }, price: 800, durationMinutes: 45 },
  { key: "pedo-filling", name: { en: "Pediatric Filling", ar: "حشو أطفال" }, price: 600, durationMinutes: 30 },
  { key: "fluoride", name: { en: "Fluoride Application", ar: "فلورايد" }, price: 400, durationMinutes: 20 },
  { key: "rct-anterior", name: { en: "Root Canal — Anterior", ar: "علاج عصب — أمامي" }, price: 2500, durationMinutes: 60 },
  { key: "rct-molar", name: { en: "Root Canal — Molar", ar: "علاج عصب — ضرس" }, price: 3500, durationMinutes: 90 },
  { key: "post-core", name: { en: "Post & Core", ar: "دعامة وقلب" }, price: 1500, durationMinutes: 45 },
  { key: "ext-simple", name: { en: "Extraction — Simple", ar: "خلع بسيط" }, price: 700, durationMinutes: 30 },
  { key: "ext-surgical", name: { en: "Extraction — Surgical", ar: "خلع جراحي" }, price: 2000, durationMinutes: 60 },
  { key: "whitening", name: { en: "Teeth Whitening", ar: "تبييض الأسنان" }, price: 3500, durationMinutes: 60 },
  { key: "pano", name: { en: "Panoramic X-ray", ar: "أشعة بانوراما" }, price: 400, durationMinutes: 15 },
  { key: "ortho-consult", name: { en: "Orthodontic Consultation", ar: "استشارة تقويم" }, price: 300, durationMinutes: 30 },
  { key: "zirconia", name: { en: "Zirconia Crown", ar: "طربوش زركون" }, price: 5000, durationMinutes: 60, requiresLab: true, estimatedLabFee: 1800 },
  { key: "pfm", name: { en: "PFM Crown", ar: "طربوش بورسلين على معدن" }, price: 3000, durationMinutes: 60, requiresLab: true, estimatedLabFee: 1000 },
  { key: "veneer", name: { en: "E-max Veneer", ar: "فينير إيماكس" }, price: 6000, durationMinutes: 60, requiresLab: true, estimatedLabFee: 2000 },
  { key: "implant", name: { en: "Dental Implant (fixture)", ar: "زراعة أسنان (الفيكسشر)" }, price: 15000, durationMinutes: 90 },
  { key: "denture", name: { en: "Complete Denture", ar: "طقم كامل" }, price: 8000, durationMinutes: 60, requiresLab: true, estimatedLabFee: 3000 },
];

export type ServiceChoice = { key: string; price: number; selected: boolean };

/** Every template ticked, at its template price: the wizard's opening state. */
export function initialServiceChoices(): ServiceChoice[] {
  return SERVICE_TEMPLATES.map((t) => ({ key: t.key, price: t.price, selected: true }));
}

/**
 * The service documents to create from the ticked rows.
 *
 * Returns the fields the Prices screen writes for a hand-added service, minus `category` and
 * `icon` — those come from keyword matching that lives in a client module, so the page adds them
 * from the ENGLISH name whichever language the stored name is in. Rows with a zero or nonsense
 * price are dropped rather than written as free.
 */
export function serviceDocsFrom(
  choices: ServiceChoice[],
  language: "en" | "ar"
): Array<{ englishName: string; doc: Record<string, unknown> }> {
  const out: Array<{ englishName: string; doc: Record<string, unknown> }> = [];
  for (const choice of choices) {
    if (!choice.selected) continue;
    const t = SERVICE_TEMPLATES.find((x) => x.key === choice.key);
    if (!t) continue;
    const price = Number(choice.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({
      englishName: t.name.en,
      doc: {
        name: t.name[language],
        price,
        requiresLab: t.requiresLab === true,
        estimatedLabFee: t.estimatedLabFee ?? 0,
        durationMinutes: t.durationMinutes,
        pricingMode: "per_tooth",
        prices: {},
        createdAt: new Date().toISOString(),
        seededBy: "setup-wizard",
      },
    });
  }
  return out;
}

/** The nested `schedule` object the Schedule screen would save for these choices. */
export function scheduleDocFrom(input: {
  start: string;
  end: string;
  slotDuration: string;
  offDays: string[];
}): Record<string, unknown> {
  return {
    start: input.start,
    end: input.end,
    slotDuration: input.slotDuration,
    offDays: input.offDays.filter((d) => (WEEK_DAYS as readonly string[]).includes(d)),
    configuredAt: new Date().toISOString(),
  };
}

/** Egyptian mobile and landline numbers as people type them; anything else is stored as typed. */
export function normalizePhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, "");
  if (/^01\d{9}$/.test(digits)) return digits;
  if (/^\+201\d{9}$/.test(digits)) return "0" + digits.slice(3);
  if (/^201\d{9}$/.test(digits)) return "0" + digits.slice(2);
  return value.trim();
}

/* ---------- WhatsApp: the questions, and what each answer writes ------------------------------ */

/**
 * Who picks up when a patient writes — the same four choices as Settings → WhatsApp Bot, stored as
 * the same three fields (botEnabled + botMode + botAiEnabled) the server reads.
 */
export type AnswerMode = "off" | "bot" | "both" | "ai";

/**
 * The bot facts the wizard asks for: the six questions patients ask most that every clinic can
 * answer in one line. The rest of BotFacts (aftercare, sessions, dentists…) is longer writing and
 * stays on the Bot screen.
 */
export const SETUP_FACT_KEYS = ["consultation", "installments", "walkIn", "parking", "mapsUrl", "insurance"] as const;
export type SetupFactKey = (typeof SETUP_FACT_KEYS)[number];

export type WhatsAppAnswers = {
  /** Booking confirmations, the 24-hour reminder, the invoice — `isPatientAutomationEnabled`. */
  autoMessages: boolean;
  /** "We miss you" after six months without a visit — `isRecallEnabled`. */
  recall: boolean;
  /** Ask for a Google review the day after a visit — `isReviewRequestEnabled`. */
  reviews: boolean;
  answerMode: AnswerMode;
  answerStrangers: boolean;
  autoConfirm: boolean;
  personaName: string;
  facts: Record<SetupFactKey, string>;
};

/** What this clinic's plan allows, so an answer can never switch on something it has not bought. */
export type WhatsAppAllowance = { messages: boolean; bot: boolean; ai: boolean };

export function answerModeOf(doc: Record<string, unknown> | undefined): AnswerMode {
  if (doc?.botEnabled !== true) return "off";
  if (doc.botMode === "ai_first") return "ai";
  return doc.botAiEnabled === true ? "both" : "bot";
}

/**
 * The best choice the plan allows. AI modes fall back to the scripted bot rather than to nothing,
 * because a clinic that asked for "AI" still asked for an answer; the bot itself falls back to
 * "off" — nobody, which is what the clinic has without it.
 */
export function clampAnswerMode(mode: AnswerMode, allowed: WhatsAppAllowance): AnswerMode {
  if (mode === "off") return "off";
  if (!allowed.bot) return "off";
  if ((mode === "both" || mode === "ai") && !allowed.ai) return "bot";
  return mode;
}

/**
 * The wizard's opening answers, read from what is already stored — so running it a second time
 * shows the clinic's real settings and "Save" changes nothing that was not touched.
 *
 * A clinic that never opened the WhatsApp screens gets the recommended starting point instead:
 * messages on, the scripted bot answering its own patients, bookings reviewed by the desk. Every
 * one of those is the cautious setting of its pair.
 */
export function answersFromSettings(raw: Record<string, unknown> | undefined): WhatsAppAnswers {
  const facts = (raw?.botFacts && typeof raw.botFacts === "object" ? raw.botFacts : {}) as Record<string, unknown>;
  const fresh = !raw || Object.keys(raw).length === 0;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    autoMessages: fresh ? true : raw.isPatientAutomationEnabled === true,
    recall: raw?.isRecallEnabled === true,
    reviews: raw?.isReviewRequestEnabled === true,
    answerMode: fresh ? "bot" : answerModeOf(raw),
    answerStrangers: raw?.botAnswerStrangers === true,
    autoConfirm: raw?.botAutoConfirmBookings === true,
    personaName: str(raw?.botPersonaName),
    facts: Object.fromEntries(SETUP_FACT_KEYS.map((k) => [k, str(facts[k])])) as Record<SetupFactKey, string>,
  };
}

/** A maps link pasted without its scheme still has to open. Anything empty stays empty. */
export function normalizeLink(value: string): string {
  const v = value.trim();
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/**
 * The fields to merge into `settings/whatsapp`.
 *
 * Only what the plan allows is written: an answer about a locked feature is left out entirely
 * rather than written as off, so a clinic that later buys the add-on finds its old setting where
 * it left it. No value is ever `undefined` — Firestore refuses the whole write for one.
 *
 * `botFacts` is written key by key, including empty strings: the fields were prefilled from the
 * stored ones, so an emptied box is the clinic deleting that answer, and an empty fact already
 * means "a person will confirm" everywhere it is read. `setDoc(..., { merge: true })` merges the
 * map, so facts this wizard does not ask about are kept.
 */
export function whatsappDocFromAnswers(a: WhatsAppAnswers, allowed: WhatsAppAllowance): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (allowed.messages) {
    out.isPatientAutomationEnabled = a.autoMessages;
    out.isRecallEnabled = a.recall;
    out.isReviewRequestEnabled = a.reviews;
  }
  const mode = clampAnswerMode(a.answerMode, allowed);
  if (allowed.bot || mode === "off") {
    out.botEnabled = mode !== "off";
    out.botMode = mode === "ai" ? "ai_first" : "assisted";
    out.botAiEnabled = mode === "both" || mode === "ai";
  }
  if (mode !== "off") {
    out.botAnswerStrangers = a.answerStrangers;
    out.botAutoConfirmBookings = a.autoConfirm;
    out.botPersonaName = a.personaName.trim();
    const facts: Record<string, string> = {};
    for (const k of SETUP_FACT_KEYS) facts[k] = k === "mapsUrl" ? normalizeLink(a.facts[k]) : a.facts[k].trim();
    out.botFacts = facts;
  }
  return out;
}

/**
 * A starting answer to "do you take insurance?" from the insurers the clinic just set up. Only
 * offered when the clinic has not written its own; the clinic can reword it.
 */
export function insuranceFactFrom(names: string[], language: "en" | "ar"): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  return language === "ar"
    ? `بنتعامل مع: ${clean.join("، ")}. هات كارت التأمين معاك في الزيارة.`
    : `We work with: ${clean.join(", ")}. Please bring your insurance card to the visit.`;
}
