/**
 * Client calls to /api/call-reminders. The browser reads `call_reminders` live but never writes it
 * (firestore.rules), so every change goes through here.
 *
 * The clinic and the branch on screen ride along on every request, as they do for money writes
 * (see lib/moneyApi.ts for why a write without the clinic lands in the wrong one).
 */

import { auth } from "@/lib/firebase";
import { currentClinicId } from "@/lib/db-utils";
import { currentBranchId, withBranch } from "@/lib/branchScope";
import { ALL_BRANCHES } from "@/lib/branchAccess";
import type { ReminderInput } from "@/lib/callReminders";

export class CallReminderApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "CallReminderApiError";
    this.status = status;
    this.code = code;
  }
}

async function post<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new CallReminderApiError("signed-out", 401, "signed-out");
  const token = await user.getIdToken();
  const clinicId = currentClinicId();
  const scope = currentBranchId();
  const res = await fetch("/api/call-reminders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(withBranch({ ...body, ...(clinicId ? { clinicId } : {}) }, scope === ALL_BRANCHES ? "" : scope)),
  });
  let payload: Record<string, unknown> = {};
  try {
    payload = await res.json();
  } catch {
    /* A route that died before writing JSON: the status is all there is. */
  }
  if (!res.ok || payload.ok === false) {
    const code = typeof payload.error === "string" ? payload.error : undefined;
    throw new CallReminderApiError(code || "failed", res.status, code);
  }
  return payload as T;
}

export async function createCallReminder(input: ReminderInput): Promise<string> {
  return (await post<{ id: string }>({ action: "create", ...input })).id;
}

export async function markCallDone(id: string, note?: string): Promise<void> {
  await post({ action: "done", id, ...(note ? { note } : {}) });
}

export async function rescheduleCall(id: string, date: string, time: string | null, note?: string): Promise<string> {
  return (await post<{ id: string }>({ action: "reschedule", id, date, time, ...(note ? { note } : {}) })).id;
}

export async function markCallBooked(id: string, appointmentId: string, appointmentDate: string): Promise<void> {
  await post({ action: "book", id, appointmentId, appointmentDate });
}

export async function deleteCallReminder(id: string): Promise<void> {
  await post({ action: "delete", id });
}

/** The words for a refusal, in the reader's language. */
export function callReminderErrorText(error: unknown, isAr: boolean): string {
  const code = error instanceof CallReminderApiError ? error.code : undefined;
  const words: Record<string, [string, string]> = {
    date: ["Pick today or a later day.", "اختار النهارده أو يوم بعده."],
    time: ["That time is not valid.", "الساعة دي مش مظبوطة."],
    reason: ["Write why the call is needed.", "اكتب سبب المكالمة."],
    recipient: ["Choose who should call.", "اختار مين اللي هيكلّم."],
    "already-handled": ["Someone already handled this call.", "حد تاني خلّص المكالمة دي خلاص."],
    forbidden: ["You are not allowed to do that.", "مش مسموحلك تعمل كده."],
    "not-found": ["This call no longer exists.", "المكالمة دي مبقتش موجودة."],
    "signed-out": ["You are signed out. Sign in and try again.", "انت خارج الحساب. ادخل وجرّب تاني."],
  };
  const w = code ? words[code] : undefined;
  if (w) return isAr ? w[1] : w[0];
  return isAr ? "حصلت مشكلة ومفيش حاجة اتغيرت. جرّب تاني." : "Something went wrong. Nothing was changed.";
}
