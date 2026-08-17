"use client";

import React from "react";
import { Phone, Footprints, Users, Megaphone, MessageCircle } from "lucide-react";

/**
 * Colored source logos for lead channels — Facebook blue, WhatsApp green, the Google "G",
 * Instagram's gradient, TikTok's note. Matching is fuzzy (substring, case-insensitive,
 * Arabic aliases included) because sources are free text the clinic can rename.
 *
 * lucide dropped brand icons, so the brand marks are tiny inline SVGs; non-brand sources
 * (walk-in, phone call, referral) fall back to lucide glyphs in muted colors.
 */

function FacebookLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path
        fill="#fff"
        d="M16.7 15.4l.5-3.4h-3.3V9.8c0-.9.5-1.8 2-1.8h1.5V5.1S16 4.9 14.8 4.9c-2.6 0-4.3 1.6-4.3 4.4V12H7.5v3.4h3v8.2a12 12 0 003.4 0v-8.2h2.8z"
      />
    </svg>
  );
}

function WhatsAppLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#25D366" />
      <path
        fill="#fff"
        d="M12 4.6a7.3 7.3 0 00-6.2 11.2L4.7 19.4l3.7-1a7.3 7.3 0 103.6-13.8zm4.3 10.4c-.2.5-1 .9-1.4 1-.4 0-.8.2-2.7-.6-2.3-1-3.8-3.3-3.9-3.5-.1-.2-.9-1.3-.9-2.4 0-1.1.6-1.7.8-1.9.2-.2.5-.3.6-.3h.5c.1 0 .3 0 .5.4l.7 1.7c0 .1.1.3 0 .4l-.3.5-.4.4c-.1.1-.2.3-.1.5.1.2.6 1 1.3 1.7.9.8 1.7 1.1 2 1.2.2.1.4.1.5-.1l.7-.8c.2-.2.3-.2.5-.1l1.6.8c.2.1.4.2.4.3.1 0 .1.4-.1.8z"
      />
    </svg>
  );
}

function GoogleLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 01-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z" />
      <path fill="#34A853" d="M12 21.6c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.9 5.9 0 01-5.5-4H3.2v2.6A9.9 9.9 0 0012 21.6z" />
      <path fill="#FBBC05" d="M6.5 13.6a5.9 5.9 0 010-3.7V7.3H3.2a9.9 9.9 0 000 8.9l3.3-2.6z" />
      <path fill="#EA4335" d="M12 6.4c1.5 0 2.8.5 3.8 1.5L18.7 5A9.9 9.9 0 003.2 7.3l3.3 2.6A5.9 5.9 0 0112 6.4z" />
    </svg>
  );
}

function InstagramLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <radialGradient id="src-ig-grad" cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#fdf497" />
          <stop offset="10%" stopColor="#fdf497" />
          <stop offset="45%" stopColor="#fd5949" />
          <stop offset="60%" stopColor="#d6249f" />
          <stop offset="90%" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill="url(#src-ig-grad)" />
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" strokeWidth="1.7" />
      <circle cx="17.2" cy="6.8" r="1.3" fill="#fff" />
    </svg>
  );
}

function TikTokLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect width="24" height="24" rx="6" fill="#010101" />
      <path fill="#25F4EE" d="M15.4 7.7a4.4 4.4 0 01-1-2.7h-2.6v10.2a2.2 2.2 0 11-2.2-2.3c.2 0 .5 0 .7.1V10a4.9 4.9 0 00-.7 0 4.9 4.9 0 104.9 4.9V9.7a6.9 6.9 0 003.4.9V8a4.4 4.4 0 01-2.5-.3z" />
      <path fill="#FE2C55" d="M16 8.3a4.4 4.4 0 01-1.6-3.3h-1v10.2a2.2 2.2 0 11-1.5-2.1v-2.7a4.9 4.9 0 103.4 4.7V10a6.9 6.9 0 003.4.9V8.6a4.5 4.5 0 01-2.7-.3z" />
      <path fill="#fff" d="M15.6 8.1a4.4 4.4 0 01-1.2-2.9h-1.8v10.2a2.2 2.2 0 11-2.2-2.3c.2 0 .5 0 .7.1v-1.9a4.9 4.9 0 104.2 4.8V9.9a6.9 6.9 0 003.4.9V9a4.5 4.5 0 01-3.1-.9z" />
    </svg>
  );
}

/** Fuzzy source → icon. Returns a colored brand mark, or a muted lucide glyph. */
export function SourceIcon({ source, size = 16, className = "" }: { source?: string | null; size?: number; className?: string }) {
  const s = String(source || "").toLowerCase();
  const wrap = (node: React.ReactNode) => (
    <span className={`inline-flex items-center shrink-0 ${className}`} title={source || undefined}>
      {node}
    </span>
  );

  if (/meta|facebook|فيس|ميتا/.test(s)) return wrap(<FacebookLogo size={size} />);
  if (/whatsapp|واتس/.test(s)) return wrap(<WhatsAppLogo size={size} />);
  if (/google|جوجل/.test(s)) return wrap(<GoogleLogo size={size} />);
  if (/instagram|انستا|إنستا/.test(s)) return wrap(<InstagramLogo size={size} />);
  if (/tiktok|تيك/.test(s)) return wrap(<TikTokLogo size={size} />);
  if (/phone|call|اتصال|تليفون|هاتف/.test(s)) return wrap(<Phone size={size} className="text-sky-500" />);
  if (/walk|زيارة|ممر/.test(s)) return wrap(<Footprints size={size} className="text-amber-500" />);
  if (/friend|referral|صديق|ترشيح|توصية/.test(s)) return wrap(<Users size={size} className="text-violet-500" />);
  if (/sms|message|رسالة/.test(s)) return wrap(<MessageCircle size={size} className="text-emerald-500" />);
  return wrap(<Megaphone size={size} className="text-slate-400" />);
}
