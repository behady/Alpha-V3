import { normalizeReplyText } from "@/lib/patientMessaging";
import type { BotFacts } from "@/types/whatsapp";
import type { Gender } from "@/lib/arabicNames";

/**
 * The salesman inside the receptionist.
 *
 * A dental clinic's sale is a booked consultation, and the assistant answered every question
 * politely and then stopped — hours, a price, an instalment plan, and silence. This module is
 * what turns an answer into a next step: the closing line under a sales-shaped reply, the offer
 * mentioned when the service it belongs to comes up, and the three objections that end most
 * conversations ("it's expensive", "I'll think about it", "somewhere else is cheaper") answered
 * from the clinic's own words instead of a shrug.
 *
 * Everything here is pure text over facts the clinic wrote. Nothing is invented: an empty
 * "why us" field means the objection reply says less, never that the model makes something up.
 */

/** Which turns are a sale in progress: a factual answer to somebody deciding whether to come. */
export const SALES_CLOSE_REASONS = new Set([
  "hours",
  "location",
  "open_now",
  "parking",
  "installments",
  "offers",
  "insurance",
  "duration",
  "price_list",
  "walk_in",
  "ai_answer",
  "objection_price",
  "objection_competitor",
]);

/** Which turns show buying interest worth a lead record, even if no service was named. */
export const LEAD_INTEREST_REASONS = new Set([
  "installments",
  "offers",
  "offers_expired",
  "insurance",
  "duration",
  "price_list",
  "ai_answer",
  "objection_price",
  "objection_thinking",
  "objection_competitor",
  "objection_price_unknown",
  "objection_competitor_unknown",
  "installments_unknown",
  "duration_unknown",
  "insurance_unknown",
]);

/**
 * The offers text, if it is still running.
 *
 * `offersUntil` is the expiry the clinic set. Past it the offer is gone from every reply at
 * once — nobody has to remember to delete the sentence — and the "offers" question gets an
 * honest "that one ended" instead of a promotion the desk will have to refuse at the counter.
 */
export function activeOffers(facts: BotFacts | undefined, todayKey: string): string {
  const text = facts?.offers?.trim() || "";
  if (!text) return "";
  const until = facts?.offersUntil?.trim() || "";
  if (until && /^\d{4}-\d{2}-\d{2}$/.test(until) && until < todayKey) return "";
  return text;
}

/**
 * The offer line for a named service, or nothing.
 *
 * Matches on the service name's first word (≥ 3 letters, normalised), the same rule matchService
 * uses to find the service in the first place — so "تبييض الأسنان" finds an offer written as
 * "خصم 20% على التبييض" — and stays silent when the offer is about something else. A whitening
 * promotion under a question about braces reads as spam, not salesmanship.
 */
export function offerForService(offersText: string, service: string): string {
  const offers = offersText.trim();
  const svc = normalizeReplyText(service);
  if (!offers || !svc) return "";
  const first = svc.split(" ")[0] || "";
  if (first.length < 3) return "";
  const o = ` ${normalizeReplyText(offers)} `;
  // The definite article on either side: "التبييض" in the offer, "تبييض" in the service list.
  const bare = first.replace(/^ال/, "");
  const hit = o.includes(` ${first} `) || o.includes(` ال${bare} `) || o.includes(` ${bare} `) || (bare.length >= 4 && o.includes(bare));
  return hit ? `🎁 *عرض حالياً:* ${offers}` : "";
}

/**
 * The invitation that closes a sales-shaped reply.
 *
 * One line, in the patient's gender, with the consultation terms when the clinic wrote them —
 * "الكشف مجاني" is the strongest close a clinic has, and it sat unused in nobody's field.
 */
export function closingLine(args: { gender?: Gender; facts?: BotFacts; alreadyBooked?: boolean }): string {
  if (args.alreadyBooked) return "";
  const f = args.gender === "female";
  const consult = args.facts?.consultation?.trim();
  const ask = f ? "تحبي أحجزلك" : "تحب أحجزلك";
  return consult ? `${consult} — ${ask} كشف؟ 👇` : `${ask} كشف عشان الدكتور يشوف الحالة ويقولك بالظبط؟ 👇`;
}
