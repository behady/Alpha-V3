"use client";

import { useId } from "react";

/**
 * The receptionist's presence.
 *
 * Deliberately an orb rather than a face. The previous drawing packed fourteen pieces — neck,
 * collar, fringe, brows, blush, headset, mic boom — into a 112px circle, and at that size each
 * piece got a handful of pixels: it read as assembled rather than drawn. A face also has a failure
 * mode an abstract shape does not, in that "slightly wrong" on human features reads as unpleasant
 * rather than merely plain.
 *
 * Still hand-written SVG animated with plain CSS rather than a Lottie/animation dependency: this
 * renders on every appointment click, so it has to cost nothing to load and nothing to run.
 *
 * The four states are the only signal the user has that a turn is in flight, so each gets its own
 * unmistakable motion rather than a shade change:
 *
 *   idle       slow breathing, the highlight drifting across the surface
 *   thinking   a dot orbits the rim, and the breathing quickens
 *   speaking   rings ripple outward, staggered so they read as speech rather than a pulse
 *   listening  the whole orb turns rose and pulses fast — a recording indicator must read as
 *              "recording", never as another expression to learn
 */

export type AvatarState = "idle" | "thinking" | "speaking" | "listening";

export default function AvatarFace({
  state = "idle",
  size = 128,
}: {
  state?: AvatarState;
  size?: number;
}) {
  /**
   * Gradients are referenced by id, and ids are global to the document — two avatars mounted at
   * once would otherwise collide and both paint from whichever defs rendered first. useId keeps
   * every instance's paint servers its own. The colons React puts in the value are legal in an id
   * but awkward in a url() reference, so they come out.
   */
  const uid = useId().replace(/:/g, "");
  const core = `afxCore-${uid}`;
  const spec = `afxSpec-${uid}`;

  const isListening = state === "listening";

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <style>{AVATAR_CSS}</style>

      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        className={`afx-root afx-${state}`}
        role="img"
        aria-label="AI receptionist"
      >
        <defs>
          {/* Off-centre light source: the highlight sits up and to the left, which is what reads
              as a rounded object rather than a flat disc. */}
          <radialGradient id={core} cx="36%" cy="30%" r="76%">
            {isListening ? (
              <>
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="24%" stopColor="#ffd4de" />
                <stop offset="66%" stopColor="#f43f5e" />
                <stop offset="100%" stopColor="#9f1239" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="24%" stopColor="#bff5ea" />
                <stop offset="66%" stopColor="#19b8a6" />
                <stop offset="100%" stopColor="#0b5f59" />
              </>
            )}
          </radialGradient>

          <radialGradient id={spec} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ripples sit behind the orb so they emerge from under its edge. Only the active state's
            rings are rendered — an invisible element still burns a compositor frame. */}
        {state === "speaking" && (
          <>
            <circle className="afx-ring" cx="60" cy="60" r="47" fill="none" stroke="#0f766e" strokeWidth="2" />
            <circle className="afx-ring afx-ring-2" cx="60" cy="60" r="47" fill="none" stroke="#0f766e" strokeWidth="2" />
            <circle className="afx-ring afx-ring-3" cx="60" cy="60" r="47" fill="none" stroke="#0f766e" strokeWidth="2" />
          </>
        )}

        {isListening && (
          <circle className="afx-listen-ring" cx="60" cy="60" r="47" fill="none" stroke="#e11d48" strokeWidth="2.4" />
        )}

        <g className="afx-core">
          <circle cx="60" cy="60" r="46" fill={`url(#${core})`} />
          <ellipse className="afx-spec" cx="46" cy="42" rx="15" ry="11" fill={`url(#${spec})`} />
          {/* A hairline rim catches the light and stops the orb dissolving into a pale panel. */}
          <circle cx="60" cy="60" r="46" fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.2" />
        </g>

        {state === "thinking" && (
          <g className="afx-orbit">
            <circle cx="60" cy="8" r="5" fill="#0f766e" />
          </g>
        )}
      </svg>
    </div>
  );
}

const AVATAR_CSS = `
.afx-root { display:block; overflow:visible; }

/* Every animated part turns about the centre of the view box, not about its own bounding box —
   an orbiting dot rotating around itself would simply sit still. */
.afx-core, .afx-ring, .afx-orbit, .afx-listen-ring {
  transform-box: view-box;
  transform-origin: 60px 60px;
}

/* Idle breathing. Slow and shallow: at 112px anything larger reads as a throb. */
@keyframes afxBreathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.035); } }
.afx-core { animation: afxBreathe 5s ease-in-out infinite; }
.afx-thinking  .afx-core { animation-duration: 2.4s; }
.afx-listening .afx-core { animation-duration: 1.1s; }

/* The highlight wanders on its own, slower than the breath, so the two never sync into a pulse. */
@keyframes afxDrift { 0%,100% { transform: translate(0,0); } 50% { transform: translate(3px,-2.5px); } }
.afx-spec { animation: afxDrift 7s ease-in-out infinite; }

/* Speaking: three rings on a stagger, so the surface reads as uneven speech, not a heartbeat. */
@keyframes afxRipple { 0% { opacity:.5; transform: scale(.82); } 100% { opacity:0; transform: scale(1.28); } }
.afx-ring { opacity:0; }
.afx-speaking .afx-ring { animation: afxRipple 1.8s ease-out infinite; }
.afx-speaking .afx-ring-2 { animation-delay: .6s; }
.afx-speaking .afx-ring-3 { animation-delay: 1.2s; }

/* Thinking: one dot around the rim. */
@keyframes afxSpin { to { transform: rotate(360deg); } }
.afx-orbit { animation: afxSpin 2.2s linear infinite; }

/* Listening: faster and rose, and never confusable with speaking. */
@keyframes afxListen { 0% { opacity:.65; transform: scale(.9); } 100% { opacity:0; transform: scale(1.3); } }
.afx-listen-ring { opacity:0; animation: afxListen 1.1s ease-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .afx-core, .afx-spec, .afx-ring, .afx-orbit, .afx-listen-ring { animation: none; }
}
`;
