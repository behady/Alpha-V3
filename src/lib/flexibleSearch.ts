/** Normalizes search input for tolerant matching across names & phones */

import { foldArabicDigits } from "./phoneNumber";

export function normalizeSearchQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Every whitespace-separated token must appear as a substring (order-independent). */
export function matchesTokenizedSubstring(haystack: string, query: string): boolean {
  const q = normalizeSearchQuery(query);
  if (!q) return true;
  const stack = haystack.toLowerCase();
  const tokens = q.split(" ").filter(Boolean);
  return tokens.every((tok) => stack.includes(tok));
}

/** Patient directory search: substring tokens on name + digit substring on phone. */
export function patientMatchesSearch(query: string, name?: string, phone?: string): boolean {
  const q = normalizeSearchQuery(query);
  if (!q) return true;
  const n = (name || "").trim();
  const phoneDigits = (phone || "").replace(/\D/g, "");
  // Stored phones carry the country code ("+2010..."); people type the national form
  // ("010..."). The trunk zero is dropped before matching so "0100" finds "+20100...", and
  // Arabic-keyboard digits are folded so they count as digits at all.
  const qDigits = foldArabicDigits(query).replace(/\D/g, "").replace(/^0+/, "");
  if (qDigits.length >= 2 && phoneDigits.includes(qDigits)) return true;
  return matchesTokenizedSubstring(n, q);
}
