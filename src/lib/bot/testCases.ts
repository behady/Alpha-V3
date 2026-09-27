/**
 * Real conversations, turned into regression cases for the model battery.
 *
 * The battery (scripts/probe-model-battery.mts) replays hand-written conversations and checks
 * each reply mechanically. Hand-written is the weakness: the questions a patient actually asks
 * are the ones nobody thought to write. "Save as test case" on a chat takes the thread as it
 * happened, strips the person out of it, and stores it under `bot_test_cases` where the battery
 * picks it up. The eval set then grows from reality instead of imagination.
 *
 * Pure functions here, so the chat screen and the battery script share one definition of what a
 * saved case is, and a test can pin the anonymiser without a browser.
 */

export interface SavedTurn {
  /** What the patient wrote. */
  q: string;
  /** What the bot answered, as sent. Empty when the bot stayed silent (handoff, human-owned). */
  a: string;
  /** The engine's reason for that reply — `hours`, `ai_answer`, `ai_handoff_medical`… */
  kind: string;
}

export interface SavedTestCase {
  turns: SavedTurn[];
  /** Whether dentist mode was on; the battery builds the clinical prompt for these. */
  clinical: boolean;
  /** Optional: what the reviewer says the right action was, overriding the kind-derived guess. */
  expect?: string[];
  note?: string;
  savedBy?: string;
  savedName?: string;
  atMs: number;
  /** Where it came from; kept so the same chat is not saved twice by accident. */
  sourceChat?: string;
}

interface LineLike {
  direction: "in" | "out";
  author: "patient" | "bot" | "staff" | "system";
  text: string;
  kind?: string;
  media?: string;
}

/**
 * Strip the person out of a line of text.
 *
 * Phone numbers (nine or more digits, with or without separators) become `[phone]`; every
 * spelling of the patient's name becomes `[name]`. The name is matched word by word — a thread
 * rarely uses the full stored name, and "أهلاً يا سحر" has to come out as "أهلاً يا [name]".
 * Single-word names shorter than three letters are left alone: masking "من" everywhere would
 * destroy the Arabic.
 */
export function anonymise(text: string, patientName?: string): string {
  let out = String(text || "");
  out = out.replace(/(?:\+|00)?\d[\d\s\-().]{7,}\d/g, (m) => (m.replace(/\D/g, "").length >= 9 ? "[phone]" : m));
  const words = String(patientName || "")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
  for (const w of words) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "g"), "[name]");
  }
  return out;
}

/**
 * The thread as turns: each patient message paired with the bot's reply to it.
 *
 * Consecutive patient messages before a bot answer fold into one question, the way the model saw
 * them. Staff and system lines are dropped — a receptionist's reply is not the bot's behaviour,
 * and a receipt is not a conversation. A patient message the bot never answered still becomes a
 * turn with an empty answer, because silence is behaviour too (the engine handed off).
 */
export function turnsFromLines(lines: LineLike[], patientName?: string): SavedTurn[] {
  const turns: SavedTurn[] = [];
  let pendingQ: string[] = [];
  for (const l of lines) {
    if (l.author === "staff" || l.author === "system") continue;
    const text = l.media && /^\[\w+\]$/.test(l.text.trim()) ? "" : l.text.trim();
    if (l.direction === "in") {
      if (text) pendingQ.push(anonymise(text, patientName));
      continue;
    }
    if (l.author !== "bot") continue;
    if (pendingQ.length === 0) {
      // A bot line with no question in front of it continues the previous answer.
      const last = turns[turns.length - 1];
      if (last && text) last.a = `${last.a}\n${anonymise(text, patientName)}`.trim();
      continue;
    }
    turns.push({ q: pendingQ.join("\n"), a: anonymise(text, patientName), kind: String(l.kind || "") });
    pendingQ = [];
  }
  if (pendingQ.length) turns.push({ q: pendingQ.join("\n"), a: "", kind: "" });
  return turns.slice(0, 20);
}

/**
 * The action a correct receptionist takes, guessed from what the engine did at the time.
 *
 * The battery's vocabulary is the model's action enum; the thread's `kind` is the engine's
 * reason. A saved case starts with this guess and a reviewer can overwrite `expect` on the doc.
 * An unknown kind accepts "answer" so a saved case never fails merely for being unmapped.
 */
export function expectFromKind(kind: string): string[] {
  const k = String(kind || "");
  if (k === "ai_handoff_medical" || k === "clinical" || k === "opted_out_urgent") return ["handoff_medical"];
  if (k === "ai_handoff_complaint" || k === "complaint") return ["handoff_complaint"];
  if (k === "ai_handoff_staff") return ["handoff_staff", "answer"];
  if (k === "ai_handoff_other" || k === "asked_for_human" || k === "human") return ["handoff_other", "answer"];
  if (/reschedule/.test(k)) return ["reschedule", "book_slot", "answer"];
  if (/cancel/.test(k)) return ["cancel", "answer"];
  if (/^late/.test(k)) return ["late", "answer"];
  if (/book|slot/.test(k)) return ["open_booking", "book_slot", "answer"];
  return ["answer"];
}

/** Two saves of the same thread are the same case. */
export function testCaseId(chatKey: string, lastLineId: string): string {
  return `${chatKey}_${lastLineId}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120);
}
