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

/** Egyptian number as the desk types it: "+201551234567" / "00201551234567" → "01551234567". */
function localEgyptDigits(digits: string): string {
  let d = digits.startsWith("00") ? digits.slice(2) : digits;
  if (d.startsWith("20") && d.length >= 12) d = "0" + d.slice(2);
  return d;
}

/** Patient directory search: substring tokens on name + digit substring on phone.
 *  Phones are stored as "+20…" but typed as "01…", so both forms are compared. */
export function patientMatchesSearch(query: string, name?: string, phone?: string): boolean {
  const q = normalizeSearchQuery(query);
  if (!q) return true;
  const n = (name || "").trim();
  const phoneDigits = (phone || "").replace(/\D/g, "");
  const qDigits = query.replace(/\D/g, "");
  if (qDigits.length >= 2 && phoneDigits) {
    const localPhone = localEgyptDigits(phoneDigits);
    const qLocal = /^(\+|00)?20/.test(query.trim()) ? "0" + qDigits.replace(/^(00)?20/, "") : qDigits;
    if (phoneDigits.includes(qDigits) || localPhone.includes(qDigits) || localPhone.includes(qLocal)) return true;
  }
  return matchesTokenizedSubstring(n, q);
}
