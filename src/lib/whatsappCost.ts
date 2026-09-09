/**
 * What Meta charges for the clinic's WhatsApp messages.
 *
 * Deliberately free of any server-only import: the Settings screen is a client component and
 * needs these rates and this arithmetic, and dragging `firebase-admin` into the browser bundle
 * has broken the build here before (see `lib/sms/config.ts`, which is split for the same reason).
 *
 * THE HEADLINE, because it is the opposite of what everyone assumes: **the assistant's replies
 * are free.** Meta stopped charging for service conversations in November 2024, and every reply
 * the bot sends is a free-form answer inside the 24-hour window a patient opened by writing in.
 * Measured on the clinic's own account on 2026-09-07: one day of 39 sent messages billed $0.00.
 *
 * What is billed is the messages nobody asked for — the templates the clinic starts: reminders,
 * recalls, review requests, lead follow-ups. So a WhatsApp bill that grows is a reminders bill,
 * not an AI bill, and the two belong on separate lines in front of the owner.
 *
 * These rates are an ESTIMATE for showing a clinic what a send will cost before it happens.
 * The truth is `pricing_analytics` on the WABA, which returns Meta's own figure; the API route
 * prefers it and falls back to this only when Meta has not reported yet.
 */

/** Meta's four categories. Only the first two are ever sent by this system. */
export type MessageCategory = "utility" | "marketing" | "authentication" | "service";

/**
 * Per-message rates in USD for Egypt (+20), from Meta's rate card.
 *
 * Checked 2026-09-07. Marketing is roughly EIGHTEEN times utility, which is why the category of
 * a template matters far more than how many are sent: one recall campaign can outweigh a month
 * of reminders. Meta prices on the RECIPIENT's country code, not the clinic's, so a patient with
 * a foreign number is billed at that country's rate — the estimate below assumes Egyptian
 * numbers, which is every patient this system has.
 */
export const EGYPT_RATES_USD: Record<MessageCategory, number> = {
  utility: 0.0036,
  marketing: 0.064,
  authentication: 0.0075,
  service: 0,
};

/**
 * Which category each template kind is registered under.
 *
 * Mirrors `category` in `scripts/meta-templates.json`, which is what was actually submitted to
 * Meta — a template's price follows the category Meta approved it as, not what we call it here.
 * Keep the two in step: a template re-registered under a different category changes the bill
 * without changing a line of code.
 */
export const CATEGORY_FOR_TEMPLATE_KIND: Record<string, MessageCategory> = {
  new: "utility",
  edit: "utility",
  cancel: "utility",
  reminder24h: "utility",
  reminder24h_btn: "utility",
  invoice: "utility",
  followup: "utility",
  review: "marketing",
  checkin: "utility",
  noshow: "marketing",
  recall: "marketing",
  lead_followup: "marketing",
  lead_welcome: "marketing",
};

/**
 * What a message of this kind costs to send, in USD.
 *
 * `null` kind means free-form text — a bot reply or a staff reply inside the window — which is a
 * service message and free. An unknown template kind is priced as marketing: the expensive
 * assumption, so a new template added without updating the map above overstates the bill rather
 * than hiding it.
 */
export function estimateMessageCostUsd(templateKind: string | null | undefined): number {
  const kind = String(templateKind || "").trim();
  if (!kind) return EGYPT_RATES_USD.service;
  const category = CATEGORY_FOR_TEMPLATE_KIND[kind] ?? "marketing";
  return EGYPT_RATES_USD[category];
}

/** The category a message of this kind is billed under; free-form text is a service message. */
export function categoryForTemplateKind(templateKind: string | null | undefined): MessageCategory {
  const kind = String(templateKind || "").trim();
  if (!kind) return "service";
  return CATEGORY_FOR_TEMPLATE_KIND[kind] ?? "marketing";
}

/** One month's WhatsApp spend, as the Settings screen shows it. */
export type WhatsappMonthCost = {
  /** "YYYY-MM". */
  monthKey: string;
  /** Messages we sent, by category, counted at send time. */
  sentByCategory: Record<MessageCategory, number>;
  /** What those sends should cost at the rates above. */
  estimatedUsd: number;
  /** Meta's own figure for the month, when `pricing_analytics` has reported it. */
  billedUsd: number | null;
  /** Messages Meta counted as billable. Free service messages are not among them. */
  billedMessages: number | null;
};

export const EMPTY_CATEGORY_COUNTS: Record<MessageCategory, number> = {
  utility: 0,
  marketing: 0,
  authentication: 0,
  service: 0,
};

/** Sum the per-category counts at the Egypt rates. */
export function estimateMonthUsd(sentByCategory: Partial<Record<MessageCategory, number>>): number {
  let total = 0;
  for (const [category, count] of Object.entries(sentByCategory)) {
    const rate = EGYPT_RATES_USD[category as MessageCategory];
    if (rate === undefined) continue;
    total += rate * (Number(count) || 0);
  }
  // Meta bills to four decimals; carrying float noise into a displayed figure looks like a bug.
  return Math.round(total * 10000) / 10000;
}

/**
 * USD to EGP for display only.
 *
 * A rate baked into a stored document goes stale silently, so nothing is ever SAVED in pounds —
 * costs are kept in the currency Meta bills in and converted at read time, the same rule the AI
 * token log follows. Override from settings when the clinic wants their own rate.
 */
export const DEFAULT_USD_TO_EGP = 48;

export function usdToEgp(usd: number, rate = DEFAULT_USD_TO_EGP): number {
  return Math.round(usd * rate * 100) / 100;
}
