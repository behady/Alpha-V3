"use client";

import type { CursorState } from "@/lib/useTourRunner";

/**
 * The hand on screen.
 *
 * A plain arrow, black with a white edge so it reads on the dim sheet and on a white modal alike,
 * gliding to wherever Sara is about to click. The ripple is the click; the small tag says whose
 * hand it is, because a cursor that is not yours moving on your screen is alarming for exactly
 * as long as it is unexplained.
 *
 * Above everything, including the confirm dialog (z-9999): when Sara presses Delete, the hand
 * must be seen pressing it.
 */
export default function TourCursor({ cursor, label }: { cursor: CursorState; label: string }) {
  if (!cursor.visible) return null;
  return (
    <div
      className="pointer-events-none fixed left-0 top-0 z-[10002] transition-transform duration-[650ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
      aria-hidden
    >
      {/* Ripple on click */}
      {cursor.clicking && (
        <span className="absolute -left-4 -top-4 block size-8 animate-ping rounded-full bg-[#FACC15]/60" />
      )}
      {/* Caret while typing: the hand rests on the field, a bar blinks. */}
      {cursor.typing ? (
        <span className="absolute -left-[1px] -top-3 block h-6 w-[2px] animate-pulse bg-[#FACC15]" />
      ) : (
        <svg width="26" height="30" viewBox="0 0 26 30" className="absolute -left-[3px] -top-[2px] drop-shadow-[0_2px_4px_rgba(0,0,0,0.45)]">
          <path d="M4 2 L4 24 L9.5 18.5 L13.5 27 L17.5 25.2 L13.6 16.8 L21 16.5 Z" fill="#0b0c10" stroke="#ffffff" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      )}
      <span className="absolute left-5 top-6 whitespace-nowrap rounded-full bg-[#FACC15] px-2 py-0.5 text-[10px] font-black text-ink shadow-md">
        {label}
      </span>
    </div>
  );
}
