/**
 * Client helpers that write appointment events. The screens that change an appointment write it to
 * Firestore themselves, so they log from here once the write has gone through. Never throw: a log
 * that fails must not undo or block the save it describes.
 */

import { logEvent } from "@/lib/logger";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";
import { normalizeDateKey, normalizeTimeKey } from "@/lib/appointmentTime";
import type { ActivityEvent, AuditUser } from "./types";

const textOf = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/**
 * A status button (Arrived, Seated, Done, No-show, Cancel…) pressed: one `appointment.status` with
 * the status before and after. Pressing the status it already has writes nothing.
 */
export async function logAppointmentStatus(
  user: AuditUser,
  appt: {
    id: string;
    patientId?: string;
    patientName?: string;
    branchId?: string;
    status?: string;
    date?: string;
    time?: string;
  },
  to: string,
): Promise<void> {
  try {
    const from = textOf(appt.status);
    const next = textOf(to);
    if (!next) return;
    // A legacy "Arrived" pressed to "Checked In" is the same stage under its old name.
    if (normalizeAppointmentStatus(from) === normalizeAppointmentStatus(next)) return;
    const date = textOf(appt.date);
    const time = textOf(appt.time);
    await logEvent(user, {
      event: "appointment.status",
      patientId: textOf(appt.patientId) ?? undefined,
      patientName: textOf(appt.patientName) ?? undefined,
      branchId: textOf(appt.branchId) ?? undefined,
      changes: [{ field: "status", from: from ?? "Scheduled", to: next }],
      refs: {
        appointmentId: appt.id,
        ...(date ? { date: normalizeDateKey(date) || date } : {}),
        ...(time ? { time: normalizeTimeKey(time) || time } : {}),
      },
    });
  } catch (err) {
    console.error("Failed to log appointment status", err);
  }
}

/** Writes each event in order (an edit before its discount). */
export async function logAppointmentEvents(user: AuditUser, events: ActivityEvent[]): Promise<void> {
  for (const e of events) {
    try {
      await logEvent(user, e);
    } catch (err) {
      console.error("Failed to log appointment event", err);
    }
  }
}
