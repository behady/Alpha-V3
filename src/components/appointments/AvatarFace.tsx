"use client";

/**
 * The receptionist's face.
 *
 * Deliberately hand-drawn SVG animated with plain CSS rather than a Lottie/animation dependency:
 * this renders on every appointment click, so it has to cost nothing to load and nothing to run.
 * Keyframes are scoped by the `afx-` class prefix so they cannot collide with anything global.
 *
 * The states are the only signal the user has that a turn is in flight, so they must be visually
 * unmistakable at a glance — not a subtle shade change. "listening" is a distinct rose halo rather
 * than a fourth face pose — a recording indicator needs to read as "recording", not as an
 * additional expression to learn.
 */

export type AvatarState = "idle" | "thinking" | "speaking" | "listening";

export default function AvatarFace({
  state = "idle",
  size = 128,
}: {
  state?: AvatarState;
  size?: number;
}) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <style>{AVATAR_CSS}</style>

      {/* Halo — teal while she talks, rose while she's recording you, so the two are never confused. */}
      <div className={`afx-halo ${state === "speaking" ? "afx-halo-on" : ""} ${state === "listening" ? "afx-halo-listen" : ""}`} />

      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        className={`afx-root afx-${state}`}
        role="img"
        aria-label="AI receptionist"
      >
        <defs>
          <linearGradient id="afxBg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ccfbf1" />
            <stop offset="100%" stopColor="#99f6e4" />
          </linearGradient>
          <linearGradient id="afxHair" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#334155" />
            <stop offset="100%" stopColor="#1e293b" />
          </linearGradient>
          <clipPath id="afxCircle">
            <circle cx="60" cy="60" r="56" />
          </clipPath>
        </defs>

        <circle cx="60" cy="60" r="56" fill="url(#afxBg)" />

        <g clipPath="url(#afxCircle)" className="afx-bob">
          {/* Neck — without it the head reads as floating above the uniform */}
          <rect x="53" y="76" width="14" height="18" rx="6.5" fill="#f2cdb4" />
          {/* Shoulders / uniform */}
          <path d="M14 124 C14 103 33 93 60 93 C87 93 106 103 106 124 Z" fill="#0f766e" />
          {/* Collar — a V line, not a filled diamond, which at panel size looked like a bow tie */}
          <path d="M52 93 L60 105 L68 93" stroke="#f8fafc" strokeWidth="3.4" strokeLinejoin="round" strokeLinecap="round" fill="none" />

          {/* Hair behind */}
          <path d="M28 58 C28 30 40 18 60 18 C80 18 92 30 92 58 L92 76 C92 78 88 78 88 74 L88 60 L32 60 L32 74 C32 78 28 78 28 76 Z" fill="url(#afxHair)" />

          {/* Face */}
          <ellipse cx="60" cy="58" rx="27" ry="30" fill="#fde8d7" />
          <ellipse cx="35" cy="60" rx="4" ry="6" fill="#fde8d7" />
          <ellipse cx="85" cy="60" rx="4" ry="6" fill="#fde8d7" />

          {/* Fringe */}
          <path d="M33 50 C34 30 45 22 60 22 C75 22 86 30 87 50 C80 40 72 36 60 36 C48 36 40 40 33 50 Z" fill="url(#afxHair)" />

          {/* Brows — lift while thinking */}
          <g className="afx-brows">
            <rect x="43" y="50" width="13" height="2.6" rx="1.3" fill="#5b4636" />
            <rect x="64" y="50" width="13" height="2.6" rx="1.3" fill="#5b4636" />
          </g>

          {/* Eyes */}
          <g className="afx-eyes">
            <ellipse cx="49.5" cy="59" rx="5" ry="5.4" fill="#ffffff" />
            <ellipse cx="70.5" cy="59" rx="5" ry="5.4" fill="#ffffff" />
            <g className="afx-pupils">
              <circle cx="49.5" cy="59.5" r="2.7" fill="#1e293b" />
              <circle cx="70.5" cy="59.5" r="2.7" fill="#1e293b" />
              <circle cx="50.6" cy="58.3" r="0.9" fill="#ffffff" />
              <circle cx="71.6" cy="58.3" r="0.9" fill="#ffffff" />
            </g>
          </g>

          {/* Cheeks */}
          <ellipse cx="42" cy="68" rx="4.5" ry="2.8" fill="#fbb6a4" opacity="0.55" />
          <ellipse cx="78" cy="68" rx="4.5" ry="2.8" fill="#fbb6a4" opacity="0.55" />

          {/* Mouth — one element per state, only the active one is drawn */}
          {state === "speaking" ? (
            <ellipse className="afx-mouth-talk" cx="60" cy="74" rx="5.5" ry="4" fill="#9f3f4a" />
          ) : state === "thinking" ? (
            <circle cx="60" cy="74" r="2.6" fill="#9f3f4a" />
          ) : (
            <path d="M53 73 Q60 79.5 67 73" stroke="#9f3f4a" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          )}

          {/* Headset — the one prop that says "reception" rather than "generic assistant" */}
          <path d="M31 58 C31 36 43 25 60 25 C77 25 89 36 89 58" stroke="#1e293b" strokeWidth="3.6" fill="none" strokeLinecap="round" />
          <rect x="26" y="55" width="9" height="15" rx="4.5" fill="#1e293b" />
          <rect x="85" y="55" width="9" height="15" rx="4.5" fill="#1e293b" />
          <path d="M30 70 C30 82 40 84 46 80" stroke="#1e293b" strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="47" cy="80" r="3" className={state === "listening" ? "afx-mic-live" : ""} fill={state === "listening" ? "#e11d48" : "#0f766e"} />
        </g>

        {/* Thinking dots, drawn outside the clip so they can sit over the shoulder */}
        {state === "thinking" && (
          <g className="afx-dots">
            <circle cx="92" cy="30" r="4" fill="#0f766e" />
            <circle cx="103" cy="24" r="3" fill="#0f766e" />
            <circle cx="110" cy="17" r="2" fill="#0f766e" />
          </g>
        )}
      </svg>
    </div>
  );
}

const AVATAR_CSS = `
.afx-root { display:block; overflow:visible; }
.afx-root * { transform-box: fill-box; }

/* Idle breathing */
@keyframes afxBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(1.6px); } }
.afx-bob { animation: afxBob 4s ease-in-out infinite; transform-origin: center; }

/* Blink. Two closes in quick succession, then a long pause — a metronome blink reads as a machine. */
@keyframes afxBlink {
  0%, 41%, 45%, 49%, 100% { transform: scaleY(1); }
  43%, 47% { transform: scaleY(0.1); }
}
.afx-eyes { animation: afxBlink 5.5s ease-in-out infinite; transform-origin: center; }

/* Thinking: eyes drift up-left, brows lift, dots rise */
@keyframes afxDrift { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-1.6px,-1.6px); } }
.afx-thinking .afx-pupils { animation: afxDrift 1.6s ease-in-out infinite; }
.afx-thinking .afx-brows { transform: translateY(-2px); }
.afx-brows { transition: transform .25s ease; transform-origin: center; }

@keyframes afxDot { 0%,100% { opacity:.25; transform: translateY(2px); } 50% { opacity:1; transform: translateY(-2px); } }
.afx-dots circle { animation: afxDot 1.2s ease-in-out infinite; transform-origin: center; }
.afx-dots circle:nth-child(2) { animation-delay: .15s; }
.afx-dots circle:nth-child(3) { animation-delay: .3s; }

/* Speaking: the mouth opens and closes at an uneven rate so it reads as speech, not a pulse */
@keyframes afxTalk {
  0%,100% { transform: scaleY(0.35); }
  20% { transform: scaleY(1); }
  35% { transform: scaleY(0.5); }
  55% { transform: scaleY(1.15); }
  70% { transform: scaleY(0.4); }
  85% { transform: scaleY(0.9); }
}
.afx-mouth-talk { animation: afxTalk .5s ease-in-out infinite; transform-origin: center; }

/* Halo */
.afx-halo { position:absolute; inset:-6px; border-radius:9999px; border:2px solid rgba(15,118,110,0); transition: border-color .3s ease; }
@keyframes afxHalo { 0%,100% { transform: scale(1); opacity:.55; } 50% { transform: scale(1.06); opacity:.15; } }
.afx-halo-on { border-color: rgba(15,118,110,.45); animation: afxHalo 1.4s ease-in-out infinite; }

/* Listening: a faster, rose pulse — reads as "recording", never confusable with "speaking". */
@keyframes afxHaloListen { 0%,100% { transform: scale(1); opacity:.7; } 50% { transform: scale(1.1); opacity:.25; } }
.afx-halo-listen { border-color: rgba(225,29,72,.5); animation: afxHaloListen .9s ease-in-out infinite; }

@keyframes afxMicLive { 0%,100% { opacity:1; } 50% { opacity:.4; } }
.afx-mic-live { animation: afxMicLive .9s ease-in-out infinite; transform-origin: center; }

@media (prefers-reduced-motion: reduce) {
  .afx-bob, .afx-eyes, .afx-pupils, .afx-dots circle, .afx-mouth-talk, .afx-halo-on, .afx-halo-listen, .afx-mic-live { animation: none; }
}
`;
