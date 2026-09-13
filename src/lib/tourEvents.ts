// src/lib/tourEvents.ts
/**
 * What happened on the tour, recorded so we can see where people stop.
 *
 * Until now the only trace a tour left was `localStorage` on the person's own machine: we could
 * not tell whether anyone finished it, which stop lost them, or whether the hands-on moments were
 * ever taken. This writes one small row per event through the server, so the superadmin's table
 * can answer that.
 *
 * Deliberately fire-and-forget and deliberately silent. A tour that stalls because a logging call
 * failed would be a far worse bug than a missing row, so every failure here is swallowed and the
 * caller never waits for it. Events are also coalesced by the browser: the queue below batches
 * what happens inside a second into one request, because the hand fires several in a row.
 */

import { auth } from "@/lib/firebase";

export type TourEventName =
  /** A run was opened: the core tour, or a chapter. */
  | "started"
  /** A stop came on screen. One row per stop is what the drop-off curve is made of. */
  | "stop"
  /** They pressed Skip while the hand was moving. */
  | "skipped_hand"
  /** They clicked the page themselves, and she stepped aside. */
  | "took_over"
  /** Her turn ended; theirs began. */
  | "hands_on_offered"
  | "hands_on_started"
  | "hands_on_done"
  | "hands_on_gave_up"
  /** A question was asked from her panel. */
  | "question"
  /** The last stop of a run. */
  | "finished"
  /** They closed the tour before the end. */
  | "left";

export interface TourEvent {
  clinicId: string;
  event: TourEventName;
  run?: string | null;
  stopId?: string | null;
  role?: string | null;
  detail?: Record<string, unknown>;
}

let queue: TourEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  const batch = queue;
  queue = [];
  timer = null;
  if (batch.length === 0) return;
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    await fetch("/api/tour/event", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clinicId: batch[0].clinicId, events: batch.map(({ clinicId: _c, ...rest }) => rest) }),
      keepalive: true,
    });
  } catch {
    /* A lost row is not worth a broken tour. */
  }
}

/** Record one event. Never throws, never blocks the caller. */
export async function logTourEvent(event: TourEvent): Promise<void> {
  if (typeof window === "undefined" || !event.clinicId) return;
  queue.push(event);
  if (timer) return;
  timer = setTimeout(() => void flush(), 1000);
}
