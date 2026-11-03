/**
 * The tools the Pro WhatsApp brain can call: calendar search, the patient file, the price list,
 * and the finishing `reply`.
 *
 * runTool is pure over an injected ToolEnv, so tests never touch Firestore. Production wires the
 * env (real calendar, real patient file) in the brain; nothing here reads a database.
 *
 * Three rules are enforced here and not left to the model:
 *   - the calendar window is today..today+14, whatever dates the model asks for;
 *   - a patient file opens only for someone on this phone number;
 *   - a price comes only from the clinic's price list, never from a guess.
 *
 * Run: npm run test:pro-tools
 */
import { SchemaType, type FunctionDeclaration } from "@google/generative-ai";
import { minutesToTimeKey, parseApptTimeToMinutes } from "@/lib/appointmentTime";
import type { ProPerson } from "./person";

/** Same 11 actions as the responseSchema enum of the standard brain (copied, not imported). */
export const PRO_REPLY_ACTIONS = [
  "answer",
  "open_booking",
  "book_slot",
  "reschedule",
  "cancel",
  "late",
  "suggest_medicine",
  "handoff_medical",
  "handoff_complaint",
  "handoff_staff",
  "handoff_other",
] as const;

export const PRO_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "find_slots",
    description:
      "Search the clinic calendar for free appointment times. Only times returned here may be offered to the patient. The window is limited to the next 14 days.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        from: { type: SchemaType.STRING, description: "First day to search, YYYY-MM-DD." },
        to: { type: SchemaType.STRING, description: "Last day to search, YYYY-MM-DD. Defaults to 6 days after from." },
        partOfDay: {
          type: SchemaType.STRING,
          format: "enum",
          enum: ["morning", "afternoon", "evening"],
          description: "Only times in this part of the day.",
        },
        doctor: { type: SchemaType.STRING, description: "Only this doctor. Leave out for any doctor." },
      },
      required: ["from"],
    },
  },
  {
    name: "get_patient_file",
    description: "Read the file of a patient who is on this phone number (the patient or a family member).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: { patientId: { type: SchemaType.STRING, description: "A patient id from the people on this number." } },
      required: ["patientId"],
    },
  },
  {
    name: "get_price",
    description: "Look up a service in the clinic price list. The only source of prices; never quote a price from anywhere else.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: { service: { type: SchemaType.STRING, description: "The service the patient asks about, in any language." } },
      required: ["service"],
    },
  },
  {
    name: "reply",
    description: "Send the final answer to the patient and end the turn. Call this exactly once, last.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        action: { type: SchemaType.STRING, format: "enum", enum: [...PRO_REPLY_ACTIONS] },
        reply: { type: SchemaType.STRING, description: "The message to the patient." },
        interest: { type: SchemaType.STRING, description: "The service the patient is interested in, if any." },
        slotId: { type: SchemaType.STRING, description: "A slot id returned by find_slots, for book_slot." },
        medicineId: { type: SchemaType.STRING, description: "For suggest_medicine." },
        sendMedia: { type: SchemaType.STRING, description: "A media id to send with the reply." },
        extraAppointment: { type: SchemaType.BOOLEAN, description: "True when the patient wants an additional appointment, not a move." },
      },
      required: ["action", "reply"],
    },
  },
];

export interface ToolEnv {
  /** Today as YYYY-MM-DD in the clinic's timezone. */
  todayKey: string;
  /** Open days (the clinic's working days, no holidays) between two dates, inclusive. */
  openDays(from: string, to: string): string[];
  /** Free times that day for this doctor ("" = any), in the stored "05:00 PM" format. */
  freeTimes(dateKey: string, doctor: string): Promise<string[]>;
  /** The words shown to the patient for one slot. */
  dayLabel(dateKey: string, time: string, doctor: string): string;
  person: ProPerson;
  patientFile(id: string): Promise<string>;
  prices: Array<{ name: string; price: number }>;
  /** Every slot offered so far this turn: id -> `date|time|doctor` key and label. */
  shown: Map<string, { key: string; label: string }>;
}

const MAX_DAYS_AHEAD = 14;
const DEFAULT_SPAN_DAYS = 6;
const PER_DAY = 3;
const MAX_SLOTS = 8;
const MAX_PRICE_MATCHES = 5;

const DAY_MS = 86_400_000;

function parseDateKey(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return ms;
}

function dateKeyOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

type PartOfDay = "morning" | "afternoon" | "evening";

function inPart(minutes: number, part: PartOfDay | null): boolean {
  if (!part) return true;
  if (part === "morning") return minutes < 12 * 60;
  if (part === "afternoon") return minutes >= 12 * 60 && minutes < 17 * 60;
  return minutes >= 17 * 60;
}

/** Up to PER_DAY times spread across the day: earliest, middle, latest. */
function spread(times: string[]): string[] {
  if (times.length <= PER_DAY) return times;
  return [times[0], times[Math.floor((times.length - 1) / 2)], times[times.length - 1]];
}

async function findSlots(args: Record<string, unknown>, env: ToolEnv): Promise<Record<string, unknown>> {
  const today = parseDateKey(env.todayKey);
  const fromRaw = parseDateKey(args.from);
  const hasTo = args.to !== undefined && args.to !== null && args.to !== "";
  const toRaw = hasTo ? parseDateKey(args.to) : null;
  if (today === null || fromRaw === null || (hasTo && toRaw === null)) return { slots: [], note: "bad date" };

  const maxDay = today + MAX_DAYS_AHEAD * DAY_MS;
  const from = Math.max(fromRaw, today);
  let to = toRaw === null ? fromRaw + DEFAULT_SPAN_DAYS * DAY_MS : toRaw;
  to = Math.min(Math.max(to, from), maxDay);
  if (from > maxDay) return { slots: [], note: "no free time in that window" };

  const part: PartOfDay | null =
    args.partOfDay === "morning" || args.partOfDay === "afternoon" || args.partOfDay === "evening" ? args.partOfDay : null;
  const doctor = typeof args.doctor === "string" ? args.doctor.trim() : "";
  const fromKey = dateKeyOf(from);
  const toKey = dateKeyOf(to);

  const days = env
    .openDays(fromKey, toKey)
    .filter((d) => d >= fromKey && d <= toKey)
    .sort();

  const slots: Array<{ id: string; label: string }> = [];
  for (const day of days) {
    if (slots.length >= MAX_SLOTS) break;
    const free = (await env.freeTimes(day, doctor))
      .map((t) => ({ t, m: parseApptTimeToMinutes(t) }))
      .filter((x) => inPart(x.m, part))
      .sort((a, b) => a.m - b.m)
      // Normalise to the stored form so the key splits and matches the calendar exactly.
      .map((x) => minutesToTimeKey(x.m));
    for (const time of spread(free)) {
      if (slots.length >= MAX_SLOTS) break;
      const id = `s${env.shown.size + 1}`;
      const label = env.dayLabel(day, time, doctor);
      env.shown.set(id, { key: `${day}|${time}|${doctor}`, label });
      slots.push({ id, label });
    }
  }
  if (!slots.length) return { slots: [], note: "no free time in that window" };
  return { slots };
}

/** Lowercase Latin; fold Arabic letter variants; drop tashkeel, tatweel and a leading "ال". */
export function normalizeForMatch(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/(^|\s)ال(?=\S)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function getPrice(args: Record<string, unknown>, env: ToolEnv): Record<string, unknown> {
  const q = normalizeForMatch(typeof args.service === "string" ? args.service : "");
  if (!q) return { matches: [] };
  const matches = env.prices
    .filter((p) => normalizeForMatch(p.name).includes(q))
    .slice(0, MAX_PRICE_MATCHES)
    .map((p) => ({ name: p.name, price: p.price }));
  return { matches };
}

async function getPatientFile(args: Record<string, unknown>, env: ToolEnv): Promise<Record<string, unknown>> {
  const id = typeof args.patientId === "string" ? args.patientId.trim() : "";
  const allowed = new Set<string>(env.person.family.map((f) => f.id));
  if (env.person.patientId) allowed.add(env.person.patientId);
  if (!id || !allowed.has(id)) return { error: "not_on_this_number" };
  return { file: await env.patientFile(id) };
}

export async function runTool(name: string, args: Record<string, unknown>, env: ToolEnv): Promise<Record<string, unknown>> {
  switch (name) {
    case "find_slots":
      return findSlots(args || {}, env);
    case "get_patient_file":
      return getPatientFile(args || {}, env);
    case "get_price":
      return getPrice(args || {}, env);
    case "reply":
      return { error: "reply_is_final" };
    default:
      return { error: "unknown_tool" };
  }
}
