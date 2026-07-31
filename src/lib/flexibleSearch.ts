/** Normalizes search input for tolerant matching across names & phones */

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
  const qDigits = query.replace(/\D/g, "");
  if (qDigits.length >= 2 && phoneDigits.includes(qDigits)) return true;
  return matchesTokenizedSubstring(n, q);
}
