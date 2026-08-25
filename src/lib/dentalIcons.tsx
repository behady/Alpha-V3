"use client";

import React from "react";
import { DentalIconArt, hasColorArt } from "./dentalIconArt";

/**
 * The dental icon library.
 *
 * Every icon is a 24×24 stroke drawing defined purely as SVG path data — no text,
 * no gradients — so the exact same paths render on the website (this file) and in
 * the Android app (DentalIcons.kt mirrors these strings). If you edit a path here,
 * copy the change there.
 *
 * Icons are grouped into the same categories the price list uses, and each icon
 * carries keywords so a service called "Zircon Crown" can be matched to its icon
 * automatically the moment it is typed.
 */

export interface DentalIconDef {
  id: string;
  en: string;
  ar: string;
  keywords: string[];
  /** SVG path data, drawn stroked (round caps/joins) unless listed in `filled`. */
  paths: string[];
  /** Indexes into `paths` that should be filled instead of stroked. */
  filled?: number[];
}

/** The classic tooth silhouette most icons build on. */
const TOOTH =
  "M12 3.2c-1.1 0-1.8.7-3 .7-1.2 0-3.5-.6-3.5 3.1 0 1.9.7 3.2 1.2 4.6.5 1.4.9 3.8 1.1 6 .1 1.3.7 2.2 1.6 2.2.9 0 1.3-.9 1.5-2 .3-1.6.5-2.8 1.1-2.8s.8 1.2 1.1 2.8c.2 1.1.6 2 1.5 2 .9 0 1.5-.9 1.6-2.2.2-2.2.6-4.6 1.1-6 .5-1.4 1.2-2.7 1.2-4.6 0-3.7-2.3-3.1-3.5-3.1-1.2 0-1.9-.7-3-.7z";

/** A smaller tooth, upper-left, used when the icon needs room for a tool beside it. */
const TOOTH_SMALL =
  "M9.5 4.2c-.8 0-1.3.5-2.1.5-.9 0-2.5-.4-2.5 2.2 0 1.4.5 2.3.9 3.3.4 1 .6 2.7.8 4.3.1.9.5 1.6 1.1 1.6.6 0 .9-.6 1.1-1.4.2-1.1.4-2 .8-2s.6.9.8 2c.2.8.5 1.4 1.1 1.4.6 0 1-.7 1.1-1.6.2-1.6.4-3.3.8-4.3.4-1 .9-1.9.9-3.3 0-2.6-1.6-2.2-2.5-2.2-.8 0-1.3-.5-2.1-.5z";

/** Four-point sparkle. */
const sparkle = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r}L${cx + r * 0.35} ${cy - r * 0.35}L${cx + r} ${cy}L${cx + r * 0.35} ${cy + r * 0.35}L${cx} ${cy + r}L${cx - r * 0.35} ${cy + r * 0.35}L${cx - r} ${cy}L${cx - r * 0.35} ${cy - r * 0.35}Z`;

export const DENTAL_ICONS: DentalIconDef[] = [
  { id: "tooth", en: "Tooth", ar: "سن", keywords: ["general", "exam", "checkup", "كشف"], paths: [TOOTH] },
  {
    id: "checkup", en: "Check-up", ar: "فحص", keywords: ["consult", "exam", "checkup", "كشف", "استشارة"],
    paths: [TOOTH, "M9.6 11.2l1.7 1.7 3.4-3.4"],
  },
  {
    id: "cleaning", en: "Cleaning", ar: "تنظيف", keywords: ["clean", "scaling", "polish", "prophylaxis", "تنظيف", "تلميع"],
    paths: [TOOTH, sparkle(19.4, 5, 1.7), sparkle(4.6, 9.5, 1.3)], filled: [1, 2],
  },
  {
    id: "whitening", en: "Whitening", ar: "تبييض", keywords: ["whitening", "bleach", "zoom", "تبييض"],
    paths: [TOOTH, sparkle(12, 9.5, 2.2), sparkle(18.9, 4.6, 1.4)], filled: [1, 2],
  },
  {
    id: "filling", en: "Filling", ar: "حشو", keywords: ["filling", "composite", "restoration", "حشو", "حشوة"],
    paths: [TOOTH, "M9.8 8.2a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 1 0-4.4 0"], filled: [1],
  },
  {
    id: "root-canal", en: "Root canal", ar: "علاج عصب", keywords: ["root", "canal", "endo", "nerve", "عصب", "جذور"],
    paths: [TOOTH, "M12 7v8", "M9.6 17.5c.2-3 .6-5.3 2.4-5.3s2.2 2.3 2.4 5.3"],
  },
  {
    id: "post-core", en: "Post & core", ar: "وتد", keywords: ["post", "core", "وتد", "دعامة"],
    paths: [TOOTH, "M12 5.5v9", "M10 7h4"],
  },
  {
    id: "extraction", en: "Extraction", ar: "خلع", keywords: ["extraction", "remove", "خلع"],
    paths: [TOOTH_SMALL, "M15.5 5l4 4", "M19.5 5l-4 4", "M16 14.5c1.8 1 3 2.6 3.4 4.7"],
  },
  {
    id: "surgery", en: "Surgery", ar: "جراحة", keywords: ["surgical", "surgery", "wisdom", "جراحة", "ضرس العقل"],
    paths: [TOOTH_SMALL, "M20.3 3.7l-6.2 6.2c-.9.9-2.1 1.3-3.3 1.3 0-1.2.4-2.4 1.3-3.3l1.6-1.6", "M14.5 16.5h5"],
  },
  {
    id: "implant", en: "Implant", ar: "زراعة", keywords: ["implant", "زرع", "زراعة"],
    paths: ["M9 4h6l-1 3h-4z", "M9.7 9.5h4.6", "M10 12h4", "M10.3 14.5h3.4", "M10.7 17h2.6l-1.3 2.8z", "M8 7h8"],
  },
  {
    id: "implant-crown", en: "Implant + crown", ar: "زراعة بالتاج", keywords: ["implant crown", "زراعة تاج"],
    paths: ["M8.5 8.5c0-2.6 1.6-4.3 3.5-4.3s3.5 1.7 3.5 4.3c0 .8-.4 1.3-1.1 1.3h-4.8c-.7 0-1.1-.5-1.1-1.3z", "M9.8 12h4.4", "M10.2 14.5h3.6", "M10.7 17h2.6l-1.3 2.9z"],
  },
  {
    id: "crown", en: "Crown", ar: "تاج", keywords: ["crown", "cap", "تاج", "تلبيسة", "طربوش"],
    paths: ["M6 9.5l2-4 2.7 2.5L12 4l1.3 4 2.7-2.5 2 4z", "M7 9.5h10v2.2c0 4-1.6 8-5 8s-5-4-5-8z"],
  },
  {
    id: "crown-zircon", en: "Zircon crown", ar: "تاج زيركون", keywords: ["zircon", "zirconia", "زيركون"],
    paths: ["M6 9.5l2-4 2.7 2.5L12 4l1.3 4 2.7-2.5 2 4z", "M7 9.5h10v2.2c0 4-1.6 8-5 8s-5-4-5-8z", sparkle(19.6, 4.4, 1.7)], filled: [2],
  },
  {
    id: "crown-emax", en: "E-max crown", ar: "تاج إيماكس", keywords: ["emax", "e-max", "e max", "إيماكس", "ايماكس"],
    paths: ["M6 9.5l2-4 2.7 2.5L12 4l1.3 4 2.7-2.5 2 4z", "M7 9.5h10v2.2c0 4-1.6 8-5 8s-5-4-5-8z", "M8 13.5h8", "M8.8 16.5h6.4"],
  },
  {
    id: "crown-metal", en: "PFM / metal crown", ar: "تاج معدني", keywords: ["pfm", "metal", "porcelain fused", "معدن", "معدني"],
    paths: ["M6 9.5l2-4 2.7 2.5L12 4l1.3 4 2.7-2.5 2 4z", "M7 9.5h10v2.2c0 4-1.6 8-5 8s-5-4-5-8z", "M7.3 12.8h9.4v1.6c-.2 1-.5 2-.9 2.9H8.2c-.4-.9-.7-1.9-.9-2.9z"], filled: [2],
  },
  {
    id: "bridge", en: "Bridge", ar: "جسر", keywords: ["bridge", "جسر", "كوبري"],
    paths: ["M3.5 8h17", "M5 8v2.5c0 2.4.9 4.5 2.4 4.5s2.4-2.1 2.4-4.5V8", "M14.2 8v2.5c0 2.4.9 4.5 2.4 4.5s2.4-2.1 2.4-4.5V8", "M9.8 8v1.8c0 1.7.9 3.2 2.2 3.2s2.2-1.5 2.2-3.2V8"],
  },
  {
    id: "veneer", en: "Veneer", ar: "فينير", keywords: ["veneer", "laminate", "فينير", "قشرة", "عدسات"],
    paths: [TOOTH, "M8.3 6.2c-1 1.5-1.2 3.6-.7 5.6.4 1.7 1.4 3.4 2.9 4.4"],
  },
  {
    id: "veneer-emax", en: "E-max veneer", ar: "فينير إيماكس", keywords: ["emax veneer", "فينير ايماكس"],
    paths: [TOOTH, "M8.3 6.2c-1 1.5-1.2 3.6-.7 5.6.4 1.7 1.4 3.4 2.9 4.4", sparkle(19.4, 4.8, 1.6)], filled: [2],
  },
  {
    id: "smile-design", en: "Smile design", ar: "تصميم ابتسامة", keywords: ["smile", "hollywood", "design", "ابتسامة", "هوليود"],
    paths: ["M4 8.5c2.2 4.2 4.9 6.3 8 6.3s5.8-2.1 8-6.3", "M8.2 11.9v2.6", "M12 12.8v3", "M15.8 11.9v2.6", sparkle(19.5, 4.8, 1.7)], filled: [4],
  },
  {
    id: "denture", en: "Denture", ar: "طقم", keywords: ["denture", "full denture", "طقم"],
    paths: ["M4 14.5C4 9 7.5 5.5 12 5.5S20 9 20 14.5v1.2c0 1.5-1.2 2.8-2.8 2.8H6.8C5.2 18.5 4 17.2 4 15.7z", "M8 12.2v3.4", "M12 11.5v4.1", "M16 12.2v3.4", "M4.6 12.2h14.8"],
  },
  {
    id: "partial-denture", en: "Partial denture", ar: "طقم جزئي", keywords: ["partial", "جزئي"],
    paths: ["M5 16.5c0-6 3-9.5 7-9.5", "M12 7c4 0 7 3.5 7 9.5", "M5 16.5c2 1.4 4.4 2 7 2s5-.6 7-2", "M9 13.5v3.9", "M15 13.5v3.9"],
  },
  {
    id: "braces", en: "Braces", ar: "تقويم", keywords: ["braces", "ortho", "orthodontic", "تقويم"],
    paths: [TOOTH, "M4.5 11.5h15", "M10.4 9.9h3.2v3.2h-3.2z"],
  },
  {
    id: "aligner", en: "Clear aligner", ar: "تقويم شفاف", keywords: ["aligner", "invisalign", "clear", "شفاف"],
    paths: ["M5.5 10c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5", "M5.5 10c0 2 1 3.7 2.6 3.7 1.3 0 1.6-1 3.9-1s2.6 1 3.9 1c1.6 0 2.6-1.7 2.6-3.7", "M4.5 17.5c2.3 1.6 4.8 2.4 7.5 2.4s5.2-.8 7.5-2.4"],
  },
  {
    id: "retainer", en: "Retainer", ar: "مثبت", keywords: ["retainer", "مثبت"],
    paths: ["M4.5 15.5C4.5 10 7.8 6 12 6s7.5 4 7.5 9.5", "M6.5 13c1.7-.9 3.6-1.4 5.5-1.4s3.8.5 5.5 1.4", "M6.5 13v3.4", "M17.5 13v3.4"],
  },
  {
    id: "night-guard", en: "Night guard", ar: "واقي ليلي", keywords: ["guard", "splint", "bruxism", "واقي", "جز"],
    paths: ["M12 3.5l7 2.6v5.4c0 4.3-2.9 7.4-7 9-4.1-1.6-7-4.7-7-9V6.1z", "M8.8 11.2l2.2 2.2 4.2-4.2"],
  },
  {
    id: "xray", en: "X-ray", ar: "أشعة", keywords: ["xray", "x-ray", "radiograph", "panorama", "أشعة", "اشعة"],
    paths: ["M4.5 4.5h15v15h-15z", TOOTH_SMALL.replace("M9.5 4.2", "M12 6.8"), "M16.5 15.5v2", "M16.5 11.5v1.5"],
  },
  {
    id: "scan", en: "Scan / diagnostics", ar: "فحص رقمي", keywords: ["scan", "3d", "cbct", "diagnostic", "مسح", "تشخيص"],
    paths: [TOOTH_SMALL, "M13.5 13.5a4.2 4.2 0 1 0 8.4 0 4.2 4.2 0 1 0-8.4 0", "M20.6 16.6l2 2"],
  },
  {
    id: "perio", en: "Gum treatment", ar: "علاج لثة", keywords: ["gum", "perio", "gingiv", "لثة"],
    paths: [TOOTH_SMALL, "M3.5 18.5c1.2-1.2 2.4-1.8 3.7-1.8 1.6 0 2.4 1 4 1s2.4-1 4-1c1.3 0 2.5.6 3.7 1.8"],
  },
  {
    id: "pediatric", en: "Pediatric", ar: "أطفال", keywords: ["pediatric", "kids", "child", "أطفال", "اطفال"],
    paths: [TOOTH, "M9.3 9.3h.01", "M14.7 9.3h.01", "M9.8 11.6c.6.7 1.3 1.1 2.2 1.1s1.6-.4 2.2-1.1"],
  },
  {
    id: "anesthesia", en: "Anesthesia", ar: "تخدير", keywords: ["anesthesia", "injection", "بنج", "تخدير", "حقن"],
    paths: ["M13.5 5.5l5 5", "M15 4l5 5", "M12 7l5 5-6.5 6.5c-.9.9-2.3.9-3.2 0l-1.8-1.8c-.9-.9-.9-2.3 0-3.2z", "M5 19l-1.5 1.5", "M9.8 11.8l1.7 1.7"],
  },
  {
    id: "medication", en: "Medication", ar: "دواء", keywords: ["medication", "drug", "antibiotic", "دواء", "مضاد"],
    paths: ["M8.2 4.5h7.6v3.2H8.2z", "M7 7.7h10v9.3c0 1.4-1.1 2.5-2.5 2.5h-5C8.1 19.5 7 18.4 7 17z", "M10 12.5h4", "M12 10.5v4"],
  },
];

/** Categories the price list is grouped into. Keys are stored on the service document. */
export interface DentalCategoryDef {
  key: string;
  en: string;
  ar: string;
  icon: string;
  keywords: string[];
}

export const DENTAL_CATEGORIES: DentalCategoryDef[] = [
  { key: "diagnostics", en: "Check-ups & X-ray", ar: "كشف وأشعة", icon: "checkup", keywords: ["consult", "checkup", "exam", "xray", "x-ray", "scan", "كشف", "استشارة", "أشعة"] },
  { key: "prevention", en: "Cleaning & Prevention", ar: "تنظيف ووقاية", icon: "cleaning", keywords: ["clean", "scaling", "polish", "fluoride", "تنظيف"] },
  { key: "whitening", en: "Whitening", ar: "تبييض", icon: "whitening", keywords: ["whiten", "bleach", "zoom", "تبييض"] },
  { key: "restorative", en: "Fillings", ar: "حشوات", icon: "filling", keywords: ["filling", "composite", "restoration", "حشو"] },
  { key: "endo", en: "Root Canal", ar: "علاج العصب", icon: "root-canal", keywords: ["root", "canal", "endo", "nerve", "pulp", "عصب"] },
  { key: "crowns", en: "Crowns & Bridges", ar: "تركيبات وجسور", icon: "crown", keywords: ["crown", "bridge", "zircon", "emax", "pfm", "cap", "تاج", "تلبيسة", "جسر", "زيركون", "ايماكس"] },
  { key: "veneers", en: "Veneers", ar: "فينير", icon: "veneer", keywords: ["veneer", "laminate", "hollywood", "smile", "فينير", "عدسات", "ابتسامة"] },
  { key: "implants", en: "Implants", ar: "زراعة", icon: "implant", keywords: ["implant", "زراعة", "زرع"] },
  { key: "surgery", en: "Extraction & Surgery", ar: "خلع وجراحة", icon: "extraction", keywords: ["extraction", "surgical", "wisdom", "خلع", "جراحة"] },
  { key: "ortho", en: "Orthodontics", ar: "تقويم", icon: "braces", keywords: ["braces", "ortho", "aligner", "retainer", "تقويم", "مثبت"] },
  { key: "prostho", en: "Dentures", ar: "أطقم", icon: "denture", keywords: ["denture", "partial", "طقم"] },
  { key: "perio", en: "Gum Treatment", ar: "علاج اللثة", icon: "perio", keywords: ["gum", "perio", "لثة"] },
  { key: "pediatric", en: "Pediatric", ar: "أسنان أطفال", icon: "pediatric", keywords: ["pediatric", "child", "kids", "أطفال"] },
  { key: "other", en: "Other", ar: "أخرى", icon: "tooth", keywords: [] },
];

export function categoryOf(key: string | undefined | null): DentalCategoryDef {
  return DENTAL_CATEGORIES.find((c) => c.key === key) || DENTAL_CATEGORIES[DENTAL_CATEGORIES.length - 1];
}

export function categoryLabel(key: string | undefined | null, language: string): string {
  const cat = categoryOf(key);
  return language === "ar" ? cat.ar : cat.en;
}

/** Best icon for a service, from its saved icon, else its name, else its category. */
export function iconForService(service: { icon?: string; name?: string; category?: string }): string {
  if (service.icon && DENTAL_ICONS.some((i) => i.id === service.icon)) return service.icon;
  const suggestion = suggestIcon(service.name || "");
  if (suggestion) return suggestion;
  return categoryOf(service.category).icon;
}

/** Keyword-matched icon for a free-typed name; null when nothing matches. */
export function suggestIcon(name: string): string | null {
  const lower = name.toLowerCase();
  if (!lower.trim()) return null;
  let best: { id: string; len: number } | null = null;
  for (const icon of DENTAL_ICONS) {
    for (const keyword of icon.keywords) {
      if (lower.includes(keyword) && (!best || keyword.length > best.len)) {
        best = { id: icon.id, len: keyword.length };
      }
    }
  }
  return best?.id ?? null;
}

/** Keyword-matched category for a free-typed name. */
export function suggestCategory(name: string): string {
  const lower = name.toLowerCase();
  let best: { key: string; len: number } | null = null;
  for (const cat of DENTAL_CATEGORIES) {
    for (const keyword of cat.keywords) {
      if (lower.includes(keyword) && (!best || keyword.length > best.len)) {
        best = { key: cat.key, len: keyword.length };
      }
    }
  }
  return best?.key ?? "other";
}

/**
 * One icon from the library.
 *
 * Colour by default — see `dentalIconArt.tsx` for why, and for the note about Android, which still
 * renders the stroke paths below and is NOT updated by editing the colour art.
 *
 * Pass `mono` where the icon sits on a dark or coloured ground and has to take the surrounding
 * text colour: a selected chip, a filter pill, a button. A full-colour drawing on a slate-900
 * chip reads as a smudge, and inheriting `currentColor` is the whole point of those places.
 */
export function DentalIcon({
  id,
  size = 22,
  className = "",
  strokeWidth = 1.7,
  mono = false,
}: {
  id?: string | null;
  size?: number;
  className?: string;
  strokeWidth?: number;
  mono?: boolean;
}) {
  if (!mono && hasColorArt(id)) {
    return <DentalIconArt id={id} size={size} className={className} />;
  }
  const def = DENTAL_ICONS.find((i) => i.id === id) || DENTAL_ICONS[0];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {def.paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill={def.filled?.includes(i) ? "currentColor" : "none"}
          stroke={def.filled?.includes(i) ? "none" : "currentColor"}
        />
      ))}
    </svg>
  );
}
