/**
 * The map link, printed beside an address that has already been said.
 *
 * The "map link" answer is free text, and a clinic pasted its whole street address into it above
 * the links — the same address its profile already holds. The confirmation prints the profile
 * address and then this field, so every booking carried the address twice. The fix is not to
 * police what a clinic types: it is to not say again a line the patient has just read.
 *
 * Pure. Links are never dropped; a line of words goes only when it is the address over again.
 */
import { asksForLocation, normalize } from "./quickAnswers";

/** Below this many letters a line is too short to be called a repeat because the address contains it. */
const MIN_CONTAINED = 20;

function fold(line: string): string {
  return line
    .replace(/^[\s📍*]+/u, "")
    .replace(/^العنوان\s*[:：-]?\s*/u, "")
    .replace(/[*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function repeatsAddress(line: string, address: string): boolean {
  if (!address || /https?:\/\//i.test(line)) return false;
  const a = fold(line);
  if (!a) return false;
  if (a === address) return true;
  const [short, long] = a.length <= address.length ? [a, address] : [address, a];
  return short.length >= MIN_CONTAINED && long.includes(short);
}

export function mapLinesBesideAddress(address: string | undefined | null, mapsUrl: string | undefined | null): string {
  const said = fold(String(address || ""));
  return String(mapsUrl || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !repeatsAddress(l, said))
    .join("\n");
}

/*
 * The map pin under a reply to "where are you".
 *
 * In sales mode every location question goes to the model, and the model is never given the URL:
 * a patient who asked three times for the pin got the street address three times, and a slot pick
 * in the same message swallowed the request whole. So the code adds it, whichever path wrote the
 * reply — the same way the booking note already does.
 */

/** A line that carries a link, with or without the scheme. */
const LINK = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*/i;
/** Any map link already in the reply: copied from a clinic's coaching, another saved one, or a mangled copy of ours. */
const ANY_MAP_LINK = /(maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.|google\.[a-z.]+\/maps|share\.google|g\.page\/|g\.co\/kgs|maps\.apple\.com|waze\.com)/i;

export const LOCATION_PIN_LABEL = "📍 لوكيشن العيادة على الخريطة:";

/**
 * The reply itself speaks of the pin: "وده اللوكيشن 👇", "الاستقبال هيبعتلك اللوكيشن". The prompt
 * tells the model the system adds the link, so whenever it says so the link must be there — also
 * when the patient's words ("في انهي حته", "اوصلكم ازاي") were not ones the check above knows.
 */
const SPEAKS_OF_PIN = /لوك[يا]?ش|خريط|\b(location|google maps?|maps?)\b/;
/** A branch, by the word: "فرع حدائق الأهرام", "فرعنا التاني", "our other branch". */
const NAMES_A_BRANCH = /فرع|فروع|branch/;

/**
 * The pin to add under a reply, or "" — when neither the patient nor the reply is about where the
 * clinic is, the clinic saved no link (words alone are not a pin), the reply already carries a map
 * link (the menu's address answer, the booking note, the model quoting the clinic's coaching), or a
 * branch is being talked about.
 *
 * `before` is the bot's previous turn, the one the patient is answering. The saved link is ONE
 * place: under "متاح فرع في حدائق الأهرام" → "ابعتلي اللوكيشن" it would send the patient to the
 * other branch's door. The branch list is free text in the coaching for most clinics, so the word
 * فرع is the signal; where it appears the reply goes out as it did before the pin existed.
 */
export function locationPinLine(a: { asked: string | string[]; reply: string; addressText?: string | null; mapsUrl?: string | null; before?: string | string[] }): string {
  const asked = (Array.isArray(a.asked) ? a.asked : [a.asked]).filter((q) => q && asksForLocation(q));
  const reply = normalize(a.reply);
  if (!asked.length && !SPEAKS_OF_PIN.test(reply)) return "";
  const lines = mapLinesBesideAddress(a.addressText, a.mapsUrl);
  const links = lines.split("\n").filter((l) => LINK.test(l));
  if (!links.length) return "";
  if (links.some((l) => a.reply.includes(l)) || ANY_MAP_LINK.test(a.reply)) return "";
  // One link per clinic: never the main branch's pin under a question about another branch.
  const address = String(a.addressText || "").trim();
  if (asked.length && asked.every((q) => NAMES_A_BRANCH.test(normalize(q))) && !(address && a.reply.includes(address))) return "";
  // ...nor under a reply, or right after a turn, that talks about branches: whose door is unclear.
  const before = (Array.isArray(a.before) ? a.before : [a.before ?? ""]).join("\n");
  if (NAMES_A_BRANCH.test(reply) || NAMES_A_BRANCH.test(normalize(before))) return "";
  return `${LOCATION_PIN_LABEL}\n${lines}`;
}

/** A closing question, with whatever trails it: spaces, emoji and their joiners. */
const ASKS = /[?؟][\s\p{Extended_Pictographic}\u{FE0F}\u{200D}]*$/u;

/**
 * The reply with the pin in it, placed so the reply still ends on what the patient must answer:
 * before a closing question, and before the name request (`beforeLast`). Otherwise at the end,
 * which is also right under a line the model wrote to introduce it ("وده اللوكيشن 👇").
 */
export function withPin(reply: string, pin: string, beforeLast = false): string {
  if (!pin) return reply;
  const text = reply.trim();
  if (!text) return pin;
  const paras = text.split(/\n{2,}/);
  const last = paras[paras.length - 1];
  // One paragraph that is a question usually holds the answer too ("عنواننا … تحب نحجز؟"): the
  // pin goes under it. Only the code's own name request is one paragraph the pin goes above.
  if (paras.length === 1) return beforeLast ? `${pin}\n\n${text}` : `${text}\n\n${pin}`;
  if (beforeLast || ASKS.test(last)) return [...paras.slice(0, -1), pin, last].join("\n\n");
  return `${text}\n\n${pin}`;
}
