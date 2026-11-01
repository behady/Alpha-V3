/**
 * Old chats, turned into something a model can read without learning anyone's phone number.
 *
 * Pure: no Firestore, no model. The onboarding scan loads a RawConversation (store.ts), and these
 * helpers decide what part of it is shown to the model and whether the chat ended in a booking.
 *
 * Run: npm run test:pro-onboarding
 */

export type RawConversation = {
  key: string;
  patientId?: string;
  phone?: string;
  messages: Array<{ author: string; text: string; at: number }>;
  /** When each appointment of this patient (by id, else by phone) was created, in ms. */
  appointmentsCreatedAt: number[];
};

/** What one batch of chats taught the scan, before the batches are merged. */
export type ChunkFindings = {
  faq: string[];
  answers: string[];
  selling: string[];
  facts: string[];
  handoffs: string[];
  avoid: string[];
  chats: number;
  booked: number;
};

const DIGIT = "[0-9\\u0660-\\u0669]";
/** Seven or more digits (Latin or Arabic-Indic), a single space or dash allowed between them. */
const PHONE_RUN = new RegExp(`${DIGIT}(?:[ \\-]?${DIGIT}){6,}`, "g");

/** Every run of 7+ digits becomes <رقم>: the model learns how the clinic talks, not who called. */
export function maskPhones(text: string): string {
  return String(text ?? "").replace(PHONE_RUN, "<رقم>");
}

const LABEL: Record<string, string> = { patient: "مريض", staff: "الاستقبال", bot: "البوت" };

/**
 * "مريض: …" / "الاستقبال: …" / "البوت: …" lines, oldest first, cut from the oldest end to fit
 * maxChars. Null when what remains has no patient line or no clinic line: a one-sided chat teaches
 * nothing about how the clinic answers.
 */
export function transcriptOf(c: RawConversation, maxChars = 2500): string | null {
  const lines: Array<{ patient: boolean; text: string }> = [];
  for (const m of c.messages) {
    const label = LABEL[m.author];
    if (!label) continue;
    const body = String(m.text ?? "").replace(/\s+/g, " ").trim();
    if (!body || body.startsWith("[")) continue;
    lines.push({ patient: m.author === "patient", text: `${label}: ${maskPhones(body)}` });
  }

  // Drop the oldest lines until the rest (joined by newlines) fits.
  let size = lines.reduce((n, l) => n + l.text.length, 0) + Math.max(0, lines.length - 1);
  let from = 0;
  while (from < lines.length && size > maxChars) {
    size -= lines[from].text.length + 1;
    from += 1;
  }
  const kept = lines.slice(from);
  if (!kept.some((l) => l.patient) || !kept.some((l) => !l.patient)) return null;
  return kept.map((l) => l.text).join("\n");
}

/** Did the patient book within `days` of their first message? An appointment before it does not count. */
export function bookedAfter(c: RawConversation, days = 14): boolean {
  let first: number | null = null;
  for (const m of c.messages) {
    if (m.author === "patient" && Number.isFinite(m.at) && (first === null || m.at < first)) first = m.at;
  }
  if (first === null) return false;
  const end = first + days * 24 * 60 * 60 * 1000;
  return c.appointmentsCreatedAt.some((t) => Number.isFinite(t) && t >= first! && t <= end);
}
