"use client";

import { useEffect, useRef } from "react";
import { onSnapshot } from "firebase/firestore";
import { usePathname, useRouter } from "next/navigation";
import { getClinicCollection } from "@/lib/db-utils";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";

/**
 * A chime and a desktop notification when a patient writes on WhatsApp.
 *
 * The rail badge changes silently, which means someone has to be looking at it. This is the
 * part that taps the receptionist on the shoulder: mounted once in the dashboard layout, it
 * watches the conversation list and reacts to a patient message that arrives AFTER the page
 * loaded — never to the backlog it finds on first paint.
 *
 * Sound is synthesised, not a file: two short tones from the Web Audio API, so there is nothing
 * to host and nothing to fail to load. Browsers refuse audio until the person has interacted
 * with the page once; the context is created on the first click and stays warm after that.
 */

const SOUND_KEY = "alphaChatSound";

export function chatSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setChatSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* private mode — the session still chimes */
  }
}

let audioCtx: AudioContext | null = null;

/** Two rising notes, ~0.3s total. Quiet enough for a front desk, distinct enough to be heard. */
export function playChatChime(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    const notes: Array<[number, number]> = [
      [880, 0],
      [1174.66, 0.14],
    ];
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.18, now + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.18);
    }
  } catch {
    /* audio is a nicety; never an error */
  }
}

/** Ask once for permission to show desktop notifications. Safe to call from a click handler. */
export async function requestChatNotifications(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export function useChatAlerts(): void {
  const { user } = useAuth();
  const { clinicId } = useClinic();
  const router = useRouter();
  const pathname = usePathname();
  // The listener below outlives many navigations; it reads the current path through this ref.
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!user || !clinicId) return;

    // Unlock audio on the first interaction, so the chime can play later without one.
    const warm = () => {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx && !audioCtx) audioCtx = new Ctx();
        if (audioCtx?.state === "suspended") void audioCtx.resume();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointerdown", warm, { passive: true });

    let ref;
    try {
      ref = getClinicCollection("whatsapp_conversations");
    } catch {
      window.removeEventListener("pointerdown", warm);
      return;
    }

    // What each conversation last showed us. Seeded from the first snapshot so the backlog is
    // silent; only a later, newer inbound message rings.
    const seen = new Map<string, number>();
    let primed = false;

    const unsub = onSnapshot(
      ref,
      (snap) => {
        let ring = false;
        const fresh: Array<{ id: string; name: string; text: string }> = [];
        for (const d of snap.docs) {
          // A staff member rehearsing the bot must not ring the desk.
          if (d.id.startsWith("play_")) continue;
          const x = d.data() as Record<string, unknown>;
          const lastAt = Number(x.lastAt) || 0;
          const prev = seen.get(d.id) ?? 0;
          seen.set(d.id, Math.max(prev, lastAt));
          if (!primed) continue;
          // A muted chat still lands in the list and counts as unread; it just does not ring.
          if (lastAt > prev && x.lastDirection === "in" && x.muted !== true) {
            ring = true;
            fresh.push({
              id: d.id,
              name: String(x.patientName || x.phone || d.id),
              text: String(x.lastText || ""),
            });
          }
        }
        primed = true;
        if (!ring) return;

        if (chatSoundEnabled()) playChatChime();

        // A desktop notification only when the person is not already looking at that chat.
        const onThatChat = (id: string) =>
          !document.hidden && pathRef.current === "/chats" && new URLSearchParams(window.location.search).get("chat") === id;
        if ("Notification" in window && Notification.permission === "granted") {
          for (const f of fresh.slice(0, 3)) {
            if (onThatChat(f.id)) continue;
            try {
              const n = new Notification(f.name, {
                body: f.text.slice(0, 120),
                tag: `wa-${f.id}`,
              });
              n.onclick = () => {
                window.focus();
                router.push(`/chats?chat=${encodeURIComponent(f.id)}`);
                n.close();
              };
            } catch {
              /* some browsers throw on construct; the chime already happened */
            }
          }
        }
      },
      () => {
        /* a failed listener means no alerts, not a broken page */
      }
    );

    return () => {
      unsub();
      window.removeEventListener("pointerdown", warm);
    };
  }, [user, clinicId, router]);
}
