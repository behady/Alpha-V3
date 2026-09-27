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
  "Keep it under eight short lines. You cannot open screens, book, edit or delete anything from here — if asked to, say it must be done in the app and say where. " +
  "Answer in the language the question was written in.";

export type StaffAnswer =
  | { ok: true; reply: string }
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
    const json = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
    if (!res.ok) return { ok: false, reason: "error", error: json.error || `HTTP ${res.status}` };
    const reply = String(json.reply || "").trim();
    if (!reply) return { ok: false, reason: "no_reply" };
    await saveHistory(clinicId, uid, [...history, { role: "user", content: question }, { role: "assistant", content: reply }]);
    return { ok: true, reply };
  } catch (error) {
    return { ok: false, reason: "error", error: error instanceof Error ? error.message : String(error) };
  }
}
