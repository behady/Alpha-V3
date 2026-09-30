import { FieldValue } from "firebase-admin/firestore";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { adminAuth } from "@/lib/firebaseAdmin";

/**
 * A staff member's free question on WhatsApp, answered by the clinic's own assistant.
 *
 * Not a second assistant. The web widget, the phone app and now the staff line all go through
 * `/api/gemini`, which resolves the caller's role and permissions from their Firebase identity and
 * offers the model only the tools that person may use. So the staff line signs in AS the staff
 * member: a custom token minted for their uid, exchanged for an ID token, and the route sees the
 * same person it would see from the app. A receptionist asking "how much did we take today" on
 * WhatsApp is refused the money exactly as she is on screen.
 *
 * The route is told `client: "whatsapp-staff"`, which narrows it to the read-only tools — nothing
 * on WhatsApp can book, edit, delete, navigate or open a screen. Answers are plain text.
 */

const ORIGIN =
  process.env.APP_ORIGIN?.trim() ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://alphadental.app");

const HISTORY_TURNS = 8;
const TOKEN_TTL_MS = 50 * 60 * 1000;
const tokenCache = new Map<string, { token: string; at: number }>();

/** A Firebase ID token for this uid, so the assistant route sees the real person. */
async function idTokenFor(uid: string): Promise<string> {
  const hit = tokenCache.get(uid);
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.token;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "";
  if (!apiKey) throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is missing");
  const custom = await adminAuth().createCustomToken(uid, { staffLine: true });
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const json = (await res.json().catch(() => ({}))) as { idToken?: string; error?: { message?: string } };
  if (!res.ok || !json.idToken) throw new Error(`Could not sign in as staff: ${json.error?.message || res.status}`);
  tokenCache.set(uid, { token: json.idToken, at: Date.now() });
  return json.idToken;
}

type Turn = { role: "user" | "assistant"; content: string };

async function loadHistory(clinicId: string, uid: string): Promise<Turn[]> {
  try {
    const snap = await adminClinicDoc(clinicId, "staff_line", uid).get();
    const raw = snap.data()?.history;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((t): t is Turn => t && typeof t === "object" && typeof (t as Turn).content === "string")
      .map((t): Turn => ({ role: t.role === "assistant" ? "assistant" : "user", content: String(t.content).slice(0, 2000) }))
      .slice(-HISTORY_TURNS);
  } catch {
    return [];
  }
}

async function saveHistory(clinicId: string, uid: string, history: Turn[]): Promise<void> {
  await adminClinicDoc(clinicId, "staff_line", uid)
    .set({ history: history.slice(-HISTORY_TURNS), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    .catch(() => {});
}

export const WHATSAPP_STAFF_INSTRUCTION =
  "You are answering on WhatsApp, to a member of the clinic's own staff, not to a patient. " +
  "Plain text only: no markdown headings, no tables, no bullet symbols other than •, bold at most a number or a name with *asterisks*. " +
  "Keep it under eight short lines. You cannot open screens or show anything; describe instead. " +
  "You CAN act here with the person's own permissions. Two rules: " +
  "(1) The acting tools (set_appointment_status, reschedule_appointment, record_payment, send_patient_whatsapp, db_delete) stage a preview and the system asks the person to reply yes or no — never say it is done until the system confirms. " +
  "(2) Before db_write or db_update, first state exactly what you will create or change (every field) and ask them to confirm in words; call the tool only after they have said yes in a later message. " +
  "For an open question — recommendations, how are we doing, what should I focus on, where are we losing money — call run_clinic_report (and generate_financial_summary if money is in scope) FIRST, then give at most three concrete recommendations, each tied to a number you actually read. Never advise from general knowledge when the clinic's own figures are one tool call away. " +
  "When they ask for detail — every day, a statement, a sheet, a list, 'بالتفصيل', a PDF — read the data with the right tool (attendance_report with 'person' for one person's days, dentist_shares for shares, db_read on ledger for payments) and send it with send_pdf_document, then reply in one or two lines. Never say the detail is not available when a tool returns it. " +
  "Answer in the language the question was written in.";

/** What the assistant staged and is waiting on. Mirrors PendingActionPreview, kept small. */
export interface StaffPending {
  id: string;
  kind: string;
  title: string;
  lines: string[];
  at: number;
}

/** Ten minutes, the same as the staged action's own life in lib/aiPendingActions. */
export const STAFF_PENDING_TTL_MS = 10 * 60 * 1000;

type PreviewLike = {
  id?: string;
  kind?: string;
  title?: string;
  summary?: Record<string, unknown>;
  changes?: { label: string; from: string; to: string }[];
  messageBody?: string;
  recipient?: string;
  amount?: number;
  note?: string;
};

/** The confirmation card, as lines of text. Pure, so the wording is testable. */
export function pendingToLines(p: PreviewLike): string[] {
  const lines: string[] = [];
  const summary = p.summary || {};
  const who = [summary.patientName, summary.name].map((v) => (typeof v === "string" ? v.trim() : "")).find(Boolean);
  const when = [summary.date, summary.time].map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean).join(" ");
  if (who || when) lines.push([who, when].filter(Boolean).join(" · "));
  for (const c of p.changes || []) lines.push(`${c.label}: ${c.from || "—"} → ${c.to || "—"}`);
  if (typeof p.amount === "number") lines.push(`${Math.round(p.amount).toLocaleString("en-US")} EGP`);
  if (p.recipient) lines.push(`→ ${p.recipient}`);
  if (p.messageBody) lines.push(`"${p.messageBody.slice(0, 300)}"`);
  if (p.note) lines.push(p.note);
  return lines;
}

export function toStaffPending(p: PreviewLike): StaffPending | null {
  if (!p?.id) return null;
  return { id: p.id, kind: String(p.kind || ""), title: String(p.title || p.kind || "Action"), lines: pendingToLines(p), at: Date.now() };
}

/** "yes" / "no" in the words staff actually type, or null when it is neither. */
export function staffDecision(text: string): "approve" | "reject" | null {
  const t = String(text || "").trim().toLowerCase().replace(/[!.،,؟?]+$/g, "");
  if (/^(نعم|ايوه|أيوه|ايوا|أيوا|اه|آه|اوك|أوك|اوكي|تمام|موافق|اكد|أكد|أكّد|نفذ|نفّذ|yes|y|yep|yeah|ok|okay|confirm|confirmed|do it|go ahead|sure)$/.test(t)) return "approve";
  if (/^(لا|لأ|الغي|إلغاء|الغاء|كنسل|بلاش|مش عايز|no|n|nope|cancel|stop|abort|don't)$/.test(t)) return "reject";
  return null;
}

/** The question under a staged action. */
export function confirmPrompt(language: "ar" | "en"): string {
  return language === "ar" ? "رد بـ *نعم* للتنفيذ أو *لا* للإلغاء." : "Reply *yes* to do it or *no* to cancel.";
}

/** A PDF the assistant laid out; staffLine renders and sends it after the reply. */
export interface StaffDocument {
  title: string;
  subtitle?: string;
  language: "ar" | "en";
  sections: unknown[];
}

export type StaffAnswer =
  | { ok: true; reply: string; pending: StaffPending | null; document: StaffDocument | null }
  | { ok: false; reason: "no_reply" | "error"; error?: string };

export async function askAssistantForStaff(args: { clinicId: string; uid: string; name: string; question: string }): Promise<StaffAnswer> {
  const { clinicId, uid, name, question } = args;
  try {
    const [token, history] = await Promise.all([idTokenFor(uid), loadHistory(clinicId, uid)]);
    const res = await fetch(`${ORIGIN}/api/gemini`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        prompt: question,
        history,
        userName: name,
        clinicId,
        client: "whatsapp-staff",
        systemInstruction: WHATSAPP_STAFF_INSTRUCTION,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { reply?: string; error?: string; pendingAction?: PreviewLike | null; document?: StaffDocument | null };
    if (!res.ok) return { ok: false, reason: "error", error: json.error || `HTTP ${res.status}` };
    const reply = String(json.reply || "").trim();
    const pending = json.pendingAction ? toStaffPending(json.pendingAction) : null;
    if (!reply && !pending && !json.document) return { ok: false, reason: "no_reply" };
    await saveHistory(clinicId, uid, [...history, { role: "user", content: question }, { role: "assistant", content: reply || pending?.title || "" }]);
    await adminClinicDoc(clinicId, "staff_line", uid).set({ pending: pending || FieldValue.delete() }, { merge: true }).catch(() => {});
    const document = json.document && Array.isArray(json.document.sections) ? json.document : null;
    return { ok: true, reply, pending, document };
  } catch (error) {
    return { ok: false, reason: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

/** The action waiting on this person, if any and still alive. */
export async function loadStaffPending(clinicId: string, uid: string): Promise<StaffPending | null> {
  try {
    const snap = await adminClinicDoc(clinicId, "staff_line", uid).get();
    const p = snap.data()?.pending as StaffPending | undefined;
    if (!p || !p.id || typeof p.at !== "number") return null;
    if (Date.now() - p.at > STAFF_PENDING_TTL_MS) return null;
    return p;
  } catch {
    return null;
  }
}

export async function clearStaffPending(clinicId: string, uid: string): Promise<void> {
  await adminClinicDoc(clinicId, "staff_line", uid).set({ pending: FieldValue.delete() }, { merge: true }).catch(() => {});
}

export type StaffDecisionResult =
  | { ok: true; status: "approved"; message: string; manual?: { phone: string; text: string } }
  | { ok: true; status: "rejected" }
  | { ok: false; error: string };

/**
 * Carry the person's yes or no to the same route the app's confirmation card uses, as the same
 * person. The route checks that the approver is the one who asked and that the action is still
 * pending, so a stale "yes" cannot repeat a payment.
 */
export async function decideStaffPending(args: { clinicId: string; uid: string; name: string; actionId: string; decision: "approve" | "reject" }): Promise<StaffDecisionResult> {
  const { clinicId, uid, name, actionId, decision } = args;
  try {
    const token = await idTokenFor(uid);
    const res = await fetch(`${ORIGIN}/api/gemini/confirm-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clinicId, actionId, decision, userName: name }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; message?: string; error?: string; manual?: { phone: string; text: string } };
    await clearStaffPending(clinicId, uid);
    if (!res.ok || json.ok === false) return { ok: false, error: json.error || `HTTP ${res.status}` };
    if (json.status === "rejected") return { ok: true, status: "rejected" };
    await saveHistory(clinicId, uid, [...(await loadHistory(clinicId, uid)), { role: "user", content: decision === "approve" ? "yes" : "no" }, { role: "assistant", content: json.message || "Done." }]);
    return { ok: true, status: "approved", message: json.message || "Done.", manual: json.manual };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
