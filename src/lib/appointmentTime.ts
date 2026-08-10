/**
 * Date and time normalisation for appointments — pure functions, no Firebase.
 *
 * These lived in bookingService.ts, which imports the *client* Firebase SDK. Server code that
 * only needed to read a stored time (the public booking endpoint, in particular) had no way to
 * reach them without dragging the browser SDK into a Node route, so it hand-rolled its own
 * formats instead — and stored "14:00" where the rest of the system stores "02:00 PM". The two
 * never compared equal, so a slot the clinic had already filled still looked free to a patient
 * booking online.
 *
 * bookingService re-exports these, so every existing import keeps working.
 */

/** Canonical stored date: YYYY-MM-DD. */
export function normalizeDateKey(value?: string): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return local.toISOString().split("T")[0];
}

/**
 * Canonical stored time: `hh:mm AM/PM` with a leading zero.
 *
 * Accepts 24-hour input and the Arabic ص/م markers, so whatever a caller has can be turned into
 * the one format the database holds.
 */
export function normalizeTimeKey(value?: string): string {
  if (!value) return "";
  const normalized = value
    .trim()
    .replace(/\s+/g, " ")
    .replace("ص", "AM")
    .replace("م", "PM")
    .toUpperCase();

  const twelveHour = normalized.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/);
  if (twelveHour) {
    const hours = Number(twelveHour[1]);
    const mins = Number(twelveHour[2]);
    if (hours >= 1 && hours <= 12 && mins >= 0 && mins <= 59) {
      return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")} ${twelveHour[3]}`;
    }
  }

  const twentyFourHour = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHour) {
    const hours24 = Number(twentyFourHour[1]);
    const mins = Number(twentyFourHour[2]);
    if (hours24 >= 0 && hours24 <= 23 && mins >= 0 && mins <= 59) {
      const ampm = hours24 >= 12 ? "PM" : "AM";
      let hours12 = hours24 % 12;
      if (hours12 === 0) hours12 = 12;
      return `${hours12.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")} ${ampm}`;
    }
  }

  return normalized;
}

/** Minutes from midnight. Comparing these is the only safe way to test two times for overlap. */
export function parseApptTimeToMinutes(timeStr?: string): number {
  if (!timeStr) return 0;
  const normalized = normalizeTimeKey(timeStr);
  const match = normalized.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
  if (match) {
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return h * 60 + m;
  }
  return 0;
}

/** Minutes from midnight back to the canonical stored form. */
export function minutesToTimeKey(minutes: number): string {
  const wrapped = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")} ${ampm}`;
}
