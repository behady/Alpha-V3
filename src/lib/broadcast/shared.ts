/**
 * Patient broadcasts — one message the clinic writes, sent to its whole patient list, slowly.
 *
 * Shared by the page and the server: the starter templates, the free checks every message gets
 * before the AI ever sees it, and the arithmetic that turns "1,250 patients" into "about 11 days".
 *
 * Why a broadcast is its own feature and not a campaign draft queue: a campaign hands the desk
 * one draft per patient to approve, which is right for twenty win-back messages and absurd for
 * twelve hundred. A broadcast is approved ONCE, as a message, and the server then releases it a
 * few at a time inside clinic hours, under a daily ceiling the clinic chose — the pace a person
 * with a phone would keep, which is the pace WhatsApp does not punish.
 */

import { appendOptOutFooter } from "@/lib/patientMessaging";
import { mergeWhatsAppTemplate } from "@/lib/whatsappTemplateMerge";

/** Merge tokens the server fills per patient. Bracketed `[...]` text is for the clinic to replace. */
export const BROADCAST_TOKENS = ["{{first_name}}", "{{patient_name}}", "{{clinic_name}}"] as const;

/** `building`: the recipient rows are still being written; the cron never touches it. */
export type BroadcastStatus = "building" | "running" | "paused" | "done" | "cancelled";

export type BroadcastRecipientStatus = "queued" | "sent" | "skipped" | "failed";

export type BroadcastSummary = {
  id: string;
  name: string;
  versions: string[];
  status: BroadcastStatus;
  /** Why it is paused, when the server paused it (the clinic pausing it leaves this empty). */
  pausedReason?: string | null;
  dailyLimit: number;
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Removed before the list was built: asked to stop, or a number shared with another patient. */
  excludedOptedOut: number;
  excludedDuplicates: number;
  excludedNoPhone: number;
  createdAt: number;
  createdByName?: string | null;
  lastSentAt?: number | null;
  finishedAt?: number | null;
};

/* ------------------------------------------------------------------------------------------ */
/* Starter templates                                                                           */
/* ------------------------------------------------------------------------------------------ */

export type BroadcastTemplate = { id: string; en: string; ar: string; body: { ar: string; en: string } };

/**
 * Starting points, not finished messages: every one carries `[...]` the clinic must fill in, and
 * launching is refused while any is left — a patient receiving "[address]" is the message that
 * makes the whole list look automated.
 *
 * Each follows the rules the checks below enforce: a person introduces themselves, one idea, no
 * link, a question that invites a one-character reply, and the stop line written in.
 */
export const BROADCAST_TEMPLATES: BroadcastTemplate[] = [
  {
    id: "new_branch",
    en: "New branch opening",
    ar: "افتتاح فرع جديد",
    body: {
      ar: `أهلاً أ/ {{first_name}} 🌷
معاك [اسم المرسل] من {{clinic_name}}.
حبينا نبلغ حضرتك إننا افتتحنا فرعنا الجديد في [المنطقة]، وعشان حضرتك من مرضانا ليك خصم [10%] في الفرع الجديد.
📍 العنوان: [العنوان بالتفصيل]
لو حابب نحجزلك ميعاد ابعتلنا 1 ✅
لو مش حابب توصلك رسايل مننا تاني ابعت STOP`,
      en: `Hello {{first_name}} 🌷
This is [your name] from {{clinic_name}}.
We have just opened our new branch in [area], and as one of our patients you get [10%] off there.
📍 Address: [full address]
Reply 1 and we will book you in ✅
If you would rather not hear from us again, reply STOP`,
    },
  },
  {
    id: "offer",
    en: "Offer for our patients",
    ar: "عرض لمرضانا",
    body: {
      ar: `أهلاً أ/ {{first_name}} 🌷
معاك [اسم المرسل] من {{clinic_name}}.
عندنا عرض لمرضانا لحد [التاريخ]: [العرض].
لو حابب نحجزلك ابعتلنا 1 ✅
لو مش حابب توصلك رسايل مننا تاني ابعت STOP`,
      en: `Hello {{first_name}} 🌷
This is [your name] from {{clinic_name}}.
Until [date] we have an offer for our patients: [the offer].
Reply 1 and we will book you in ✅
If you would rather not hear from us again, reply STOP`,
    },
  },
  {
    id: "checkup",
    en: "Check-up reminder",
    ar: "تذكير بالكشف الدوري",
    body: {
      ar: `أهلاً أ/ {{first_name}} 🌷
معاك [اسم المرسل] من {{clinic_name}}.
بقالنا فترة مشفناش حضرتك، والكشف الدوري كل ٦ شهور بيحمي سنانك من مشاكل أكبر.
لو حابب نحجزلك ميعاد ابعتلنا 1 ✅
لو مش حابب توصلك رسايل مننا تاني ابعت STOP`,
      en: `Hello {{first_name}} 🌷
This is [your name] from {{clinic_name}}.
It has been a while since your last visit, and a check-up every 6 months keeps small problems small.
Reply 1 and we will book you in ✅
If you would rather not hear from us again, reply STOP`,
    },
  },
  {
    id: "holiday",
    en: "Holiday greeting",
    ar: "تهنئة بمناسبة",
    body: {
      ar: `أهلاً أ/ {{first_name}} 🌷
معاك [اسم المرسل] من {{clinic_name}}.
كل سنة وحضرتك طيب بمناسبة [المناسبة] 🎉
لو محتاج أي حاجة إحنا موجودين، ابعتلنا في أي وقت.
لو مش حابب توصلك رسايل مننا تاني ابعت STOP`,
      en: `Hello {{first_name}} 🌷
This is [your name] from {{clinic_name}}.
Wishing you a happy [occasion] 🎉
If you need anything at all, just message us.
If you would rather not hear from us again, reply STOP`,
    },
  },
];

/* ------------------------------------------------------------------------------------------ */
/* Free checks                                                                                  */
/* ------------------------------------------------------------------------------------------ */

export type CheckLevel = "block" | "warn" | "good";

export type BroadcastCheck = { id: string; level: CheckLevel; en: string; ar: string };

const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|app|eg|me|ly|link|io)\b|wa\.me|bit\.ly|goo\.gl|maps\.app)/i;
const PLACEHOLDER_RE = /\[[^\]\n]{1,60}\]/;
// The stop line, in either language: the word, and a verb asking for it to be sent.
const STOP_WORD_RE = /(\bstop\b|ستوب|إيقاف|ايقاف)/i;
const SEND_VERB_RE = /(ابعت|ارسل|أرسل|اكتب|رد|send|reply|text)/i;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/** Every merge token the text uses that the server does not know how to fill. */
function unknownTokens(text: string): string[] {
  const found = text.match(/\{\{[^}]*\}\}|\{[a-z_]+\}/gi) || [];
  return found.filter((t) => !(BROADCAST_TOKENS as readonly string[]).includes(t));
}

/**
 * The rules every broadcast is held to, checked without spending anything.
 *
 * `block` stops the launch; `warn` is advice the clinic may overrule; `good` is a rule already
 * met, shown so the screen teaches what a safe message looks like rather than only scolding.
 */
export function checkBroadcastMessage(raw: string): BroadcastCheck[] {
  const text = String(raw || "").trim();
  const out: BroadcastCheck[] = [];
  if (!text) {
    return [{ id: "empty", level: "block", en: "Write the message first.", ar: "اكتب الرسالة الأول." }];
  }

  const placeholder = text.match(PLACEHOLDER_RE);
  if (placeholder) {
    out.push({
      id: "placeholder",
      level: "block",
      en: `Replace ${placeholder[0]} with the real text — patients would receive the brackets.`,
      ar: `غيّر ${placeholder[0]} بالكلام الحقيقي — المريض هيستلم الأقواس زي ما هي.`,
    });
  }

  const unknown = unknownTokens(text);
  if (unknown.length) {
    out.push({
      id: "token",
      level: "block",
      en: `${unknown[0]} is not something the system can fill. Use {{first_name}}, {{patient_name}} or {{clinic_name}}.`,
      ar: `${unknown[0]} مش حاجة السيستم يقدر يملاها. استخدم {{first_name}} أو {{patient_name}} أو {{clinic_name}}.`,
    });
  }

  if (LINK_RE.test(text)) {
    out.push({
      id: "link",
      level: "block",
      en: "Remove the link. Links in a message to people who did not write first are the strongest spam signal WhatsApp has. Write the address as words; send the map to whoever replies.",
      ar: "شيل اللينك. اللينك في رسالة لناس مبعتتش الأول هو أقوى علامة سبام عند واتساب. اكتب العنوان بالكلام، وابعت اللوكيشن للي يرد بس.",
    });
  } else {
    out.push({ id: "link", level: "good", en: "No links — good.", ar: "مفيش لينكات — ممتاز." });
  }

  if (STOP_WORD_RE.test(text) && SEND_VERB_RE.test(text)) {
    out.push({ id: "stop", level: "good", en: "Tells people how to stop — good.", ar: "بيقول للناس إزاي يوقفوا الرسايل — ممتاز." });
  } else {
    out.push({
      id: "stop",
      level: "warn",
      en: "No stop line. The system will add one at the end; writing your own (\"reply STOP\") reads friendlier.",
      ar: "مفيش سطر إيقاف. السيستم هيضيف واحد في الآخر، بس لو كتبته بنفسك (\"ابعت STOP\") هيبان أحسن.",
    });
  }

  if (/\{\{(first_name|patient_name)\}\}/.test(text)) {
    out.push({ id: "name", level: "good", en: "Greets each patient by name — good.", ar: "بيسلّم على كل مريض باسمه — ممتاز." });
  } else {
    out.push({
      id: "name",
      level: "warn",
      en: "Add {{first_name}} so every patient is greeted by name. Identical messages to hundreds of people look automated.",
      ar: "ضيف {{first_name}} علشان كل مريض يتسلّم عليه باسمه. نفس الرسالة بالظبط لمئات الناس بتبان آلية.",
    });
  }

  if (/(\b1\b|١|ابعت(لنا)?\s|رد\s|reply|send us|let us know|\?|؟)/i.test(text)) {
    out.push({ id: "reply", level: "good", en: "Invites a reply — the best protection a number has.", ar: "بيطلب رد — ودي أحسن حماية للرقم." });
  } else {
    out.push({
      id: "reply",
      level: "warn",
      en: "Ask for a reply (\"reply 1 to book\"). Every patient who answers tells WhatsApp the number is wanted.",
      ar: "اطلب رد (\"ابعت 1 للحجز\"). كل مريض بيرد بيقول لواتساب إن الرقم ده مرغوب فيه.",
    });
  }

  const chars = Array.from(text).length;
  if (chars > 700) {
    out.push({
      id: "length",
      level: "warn",
      en: `Long message (${chars} characters). Under ~400 gets read; long ones get muted or reported.`,
      ar: `الرسالة طويلة (${chars} حرف). أقل من ٤٠٠ تقريباً بتتقري، والطويلة بتتكتم أو تتبلّغ.`,
    });
  }

  const emojis = (text.match(EMOJI_RE) || []).length;
  if (emojis > 6) {
    out.push({
      id: "emoji",
      level: "warn",
      en: `${emojis} emojis — keep it to a few. A wall of them reads as an advert.`,
      ar: `${emojis} إيموجي — خليهم قليلين. كتير منهم بيخلي الرسالة شكلها إعلان.`,
    });
  }

  const latin = text.replace(/\{\{[^}]*\}\}/g, "").match(/[A-Za-z]{4,}/g) || [];
  const shouting = latin.filter((w) => w === w.toUpperCase() && w !== "STOP");
  if (shouting.length >= 3) {
    out.push({ id: "caps", level: "warn", en: "Several words in CAPITALS read as shouting.", ar: "كلمات كتير كابيتال بتبان زعيق." });
  }

  const bigDiscount = (text.match(/(\d{1,3})\s*[%٪]/g) || []).map((m) => parseInt(m, 10)).some((n) => n >= 30);
  if (bigDiscount || /(مجان[اًي]?|ببلاش|\bfree\b|لفترة محدودة|limited time|اسرع|hurry)/i.test(text)) {
    out.push({
      id: "salesy",
      level: "warn",
      en: "Strong sales words (free / limited time / a big discount). Say the offer plainly, once.",
      ar: "كلمات بيع قوية (مجاناً / لفترة محدودة / خصم كبير). قول العرض ببساطة ومرة واحدة.",
    });
  }

  return out;
}

export function hasBlockingIssue(checks: BroadcastCheck[]): boolean {
  return checks.some((c) => c.level === "block");
}

/* ------------------------------------------------------------------------------------------ */
/* Pace                                                                                         */
/* ------------------------------------------------------------------------------------------ */

/** Hours a broadcast may send in, Cairo time. Ends an hour before the gateway's own 22:00 close. */
export const BROADCAST_WINDOW = { startHour: 10, endHour: 21 } as const;

/** The highest daily ceiling the screen offers. The gateway's own ceiling is 200. */
export const BROADCAST_MAX_DAILY = 150;
export const BROADCAST_MIN_DAILY = 10;

/**
 * Room left for the clinic's ordinary messages. Reminders and confirmations share the number's
 * daily allowance on the gateway; a broadcast that used all of it would hold tomorrow's
 * reminders until the day after.
 */
export const BROADCAST_RESERVE_SHARE = 0.25;

/**
 * The gateway's warm-up curve (whatsapp-gateway/src/policy.js): 20 on the day a number is
 * linked, ×1.5 each day, capped at 200. Mirrored here so the screen can say what to expect
 * without a call; the cron reads the gateway's live figure before every batch.
 */
export function gatewayDailyAllowance(daysLinked: number): number {
  const d = Math.max(0, Math.floor(daysLinked));
  return Math.min(200, Math.floor(20 * Math.pow(1.5, d)));
}

/** What a broadcast may take of that allowance, after the reserve. */
export function broadcastShareOfAllowance(allowance: number): number {
  return Math.max(0, Math.floor(allowance * (1 - BROADCAST_RESERVE_SHARE)));
}

/**
 * The daily ceiling the screen suggests. The warm-up already holds a new number back for its
 * first week; this is the steady pace afterwards, kept well under the gateway's 200 because a
 * promotion to people who did not write first is the riskiest thing a number sends.
 */
export const RECOMMENDED_DAILY_LIMIT = 100;

/**
 * Day-by-day plan for `total` messages: each day sends the smaller of the clinic's ceiling and
 * what the warm-up leaves for broadcasts. Returns the per-day counts (length = days needed).
 */
export function planBroadcastDays(total: number, dailyLimit: number, daysLinked: number | null): number[] {
  const days: number[] = [];
  let left = Math.max(0, Math.floor(total));
  const limit = Math.max(1, Math.floor(dailyLimit));
  // Not linked yet: it will be on day 0 when it is, which is the slowest case — plan for it.
  let day = Math.max(0, daysLinked ?? 0);
  while (left > 0 && days.length < 365) {
    const today = Math.max(1, Math.min(limit, broadcastShareOfAllowance(gatewayDailyAllowance(day))));
    const n = Math.min(left, today);
    days.push(n);
    left -= n;
    day += 1;
  }
  return days;
}

/**
 * How many to release in one cron tick. Spreads the day's ceiling over the hours left so a
 * broadcast does not spend its whole day in the first ten minutes after opening.
 */
export function perTickRelease(args: { leftToday: number; minutesLeftInWindow: number; tickMinutes: number }): number {
  const { leftToday, minutesLeftInWindow, tickMinutes } = args;
  if (leftToday <= 0 || minutesLeftInWindow <= 0) return 0;
  const ticksLeft = Math.max(1, Math.floor(minutesLeftInWindow / tickMinutes));
  return Math.max(1, Math.min(leftToday, Math.ceil(leftToday / ticksLeft)));
}

/** First word of a name, for the greeting. "د. محمد علي" → "محمد". */
export function firstNameOf(full: string): string {
  const words = String(full || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^(د\.?|دكتور|دكتورة|م\.?|أ\.?|ا\.?|أ\/|mr\.?|mrs\.?|ms\.?|dr\.?)$/i.test(w));
  // "عبد الله", "أبو بكر", "أم كلثوم": the first word alone is not a name.
  if (words.length > 1 && /^(عبد|عبد ال|ابو|أبو|ام|أم|abdel|abd|abu)$/i.test(words[0])) return `${words[0]} ${words[1]}`;
  return words[0] || String(full || "").trim();
}

/** Which version a recipient gets. Stable per position, so a re-run gives the same answer. */
export function versionFor(index: number, versions: number): number {
  return versions <= 1 ? 0 : index % versions;
}

/**
 * The message one patient receives, exactly — shared by the screen's preview and the server's send
 * so the two can never disagree.
 *
 * The stop line is appended here, unconditionally, rather than left to the delivery chokepoint:
 * a clinic may switch the general opt-out footer off for its reminders, but a promotion to the
 * whole list without a way to stop is the message that gets a number reported. `footer` is the
 * clinic's footer wording (Arabic-only or bilingual); a message that already asks for STOP in its
 * own words gets nothing added (appendOptOutFooter is idempotent on the keyword).
 */
export function mergeBroadcast(template: string, vars: { name: string; clinicName: string; footer: string }): string {
  const merged = mergeWhatsAppTemplate(template, {
    first_name: firstNameOf(vars.name),
    patient_name: vars.name,
    clinic_name: vars.clinicName,
  })
    // A patient with no name on file is greeted without one, rather than as "أهلاً أ/ 🌷".
    .replace(/أ\/[ \t]*(?![ \t]*\p{L})/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return appendOptOutFooter(merged, vars.footer);
}

/** A version that uses {{clinic_name}} while the clinic profile has no name would send "من ." */
export function missingClinicName(versions: string[], clinicName: string): boolean {
  return !clinicName.trim() && versions.some((v) => v.includes("{{clinic_name}}"));
}

/** What the AI check returns (api/broadcasts/review). */
export type BroadcastReview = {
  verdict: "safe" | "caution" | "risky";
  score: number;
  summary: string;
  issues: { severity: "high" | "medium" | "low"; problem: string; fix: string }[];
  improved: string;
  tips: string[];
};
