"use client";

import type { StockShape } from "@/lib/stock/types";

/**
 * A drawn stand-in for a product photo.
 *
 * A new assistant matches a picture, not a word, so every card has one from the first minute —
 * even before anyone has photographed a box. Brand colour and text come from the variant when
 * there is one, so two brands of the same item look different at a glance. A real photo replaces
 * this the moment one exists.
 */
export function ProductArt({
  shape,
  color = "#64748B",
  brand = "",
  product = "",
  spec = "",
  className,
}: {
  shape: StockShape;
  color?: string;
  brand?: string;
  product?: string;
  spec?: string;
  className?: string;
}) {
  const t = { fontFamily: "Montserrat, Cairo, sans-serif", fontWeight: 700 } as const;
  const dark = "#0F172A";
  const body = (() => {
    switch (shape) {
      case "syringe":
        return (
          <>
            <rect x="28" y="48" width="92" height="22" rx="6" fill="#fff" stroke="#CBD5E1" />
            <rect x="28" y="48" width="30" height="22" rx="6" fill={color} />
            <rect x="118" y="55" width="16" height="8" fill="#94A3B8" />
            <rect x="134" y="57" width="12" height="4" fill="#64748B" />
            <rect x="12" y="52" width="18" height="14" rx="2" fill="#CBD5E1" />
            <text x="88" y="63" textAnchor="middle" style={{ ...t, fontSize: 10 }} fill={dark}>{spec}</text>
            <text x="80" y="38" textAnchor="middle" style={{ ...t, fontSize: 9.5 }} fill={dark}>{product}</text>
          </>
        );
      case "bottle":
        return (
          <>
            <rect x="66" y="18" width="28" height="12" rx="2" fill="#334155" />
            <path d="M68 30 v8 c-10 5 -14 12 -14 22 v30 a5 5 0 0 0 5 5 h42 a5 5 0 0 0 5 -5 V60 c0-10-4-17-14-22 v-8 Z" fill="#fff" stroke="#CBD5E1" />
            <rect x="58" y="58" width="44" height="26" fill={color} />
            <text x="80" y="75" textAnchor="middle" style={{ ...t, fontSize: 8 }} fill="#fff">{product.split(" ")[0]}</text>
            <text x="80" y="104" textAnchor="middle" style={{ ...t, fontSize: 8.5 }} fill={dark}>{spec}</text>
          </>
        );
      case "jar":
        return (
          <>
            <rect x="52" y="26" width="56" height="16" rx="3" fill="#334155" />
            <rect x="48" y="42" width="64" height="52" rx="8" fill="#fff" stroke="#CBD5E1" />
            <rect x="48" y="56" width="64" height="24" fill={color} />
            <text x="80" y="71" textAnchor="middle" style={{ ...t, fontSize: 8.5 }} fill="#fff">{product}</text>
            <text x="80" y="106" textAnchor="middle" style={{ ...t, fontSize: 8 }} fill={dark}>{spec}</text>
          </>
        );
      case "pack":
        return (
          <>
            <rect x="26" y="34" width="108" height="64" rx="5" fill="#fff" stroke="#CBD5E1" />
            <rect x="26" y="34" width="108" height="16" rx="5" fill={color} />
            <rect x="26" y="44" width="108" height="6" fill={color} />
            <text x="80" y="45" textAnchor="middle" style={{ ...t, fontSize: 7.5, letterSpacing: ".1em" }} fill="#fff">{brand.toUpperCase()}</text>
            <text x="80" y="70" textAnchor="middle" style={{ ...t, fontSize: 9.5 }} fill={dark}>{product}</text>
            <text x="80" y="86" textAnchor="middle" style={{ fontFamily: "Open Sans, sans-serif", fontSize: 8 }} fill="#475569">{spec}</text>
          </>
        );
      case "bag":
        return (
          <>
            <path d="M40 30 h80 l8 70 a6 6 0 0 1 -6 6 H38 a6 6 0 0 1 -6 -6 Z" fill="#fff" stroke="#CBD5E1" />
            <path d="M40 30 h80 v10 H40 Z" fill="#CBD5E1" />
            <rect x="44" y="52" width="72" height="30" rx="3" fill={color} />
            <text x="80" y="70" textAnchor="middle" style={{ ...t, fontSize: 9 }} fill="#fff">{product}</text>
            <text x="80" y="96" textAnchor="middle" style={{ ...t, fontSize: 8 }} fill={dark}>{spec}</text>
          </>
        );
      case "cartridge":
        return (
          <>
            <rect x="30" y="44" width="80" height="14" rx="7" fill="#fff" stroke="#CBD5E1" />
            <rect x="30" y="62" width="80" height="14" rx="7" fill="#fff" stroke="#CBD5E1" />
            <rect x="30" y="44" width="26" height="32" rx="6" fill={color} />
            <path d="M110 50 h14 l8 8 l-8 8 h-14 Z" fill="#94A3B8" />
            <text x="84" y="55" textAnchor="middle" style={{ ...t, fontSize: 7 }} fill={dark}>{product}</text>
            <text x="84" y="73" textAnchor="middle" style={{ ...t, fontSize: 7 }} fill={dark}>{spec}</text>
          </>
        );
      case "vial":
        return (
          <>
            <rect x="46" y="30" width="68" height="70" rx="6" fill="#fff" stroke="#CBD5E1" />
            <rect x="46" y="30" width="68" height="12" rx="6" fill={color} />
            <rect x="70" y="50" width="20" height="40" rx="3" fill="#E2E8F0" stroke="#CBD5E1" />
            <path d="M80 56 v28 M74 62 h12 M74 70 h12 M74 78 h12" stroke="#64748B" strokeWidth="1.5" />
            <text x="80" y="108" textAnchor="middle" style={{ ...t, fontSize: 8 }} fill={dark}>{`${product} ${spec}`.trim()}</text>
          </>
        );
      case "box":
      default:
        return (
          <>
            <path d="M30 40 l20 -14 h78 l-20 14 Z" fill={shade(color, 0.75)} />
            <path d="M108 40 l20 -14 v52 l-20 14 Z" fill={shade(color, 0.55)} />
            <rect x="30" y="40" width="78" height="52" fill="#fff" stroke="#CBD5E1" />
            <rect x="30" y="40" width="78" height="14" fill={color} />
            <text x="69" y="50" textAnchor="middle" style={{ ...t, fontSize: 7.5, letterSpacing: ".08em" }} fill="#fff">{brand.toUpperCase()}</text>
            <text x="69" y="70" textAnchor="middle" style={{ ...t, fontSize: 9 }} fill={dark}>{product}</text>
            <text x="69" y="84" textAnchor="middle" style={{ fontFamily: "Open Sans, sans-serif", fontSize: 8 }} fill="#475569">{spec}</text>
          </>
        );
    }
  })();
  return (
    <svg viewBox="0 0 160 120" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="160" height="120" fill="#F1F3F6" />
      {body}
      {brand && shape !== "pack" && shape !== "box" ? (
        <text x="80" y="112" textAnchor="middle" style={{ ...t, fontSize: 8, letterSpacing: ".12em" }} fill="#475569">{brand.toUpperCase()}</text>
      ) : null}
    </svg>
  );
}

function shade(hex: string, k: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

/** A stable colour for a brand name, so the same brand always draws the same. */
export function brandColor(brand: string): string {
  const palette = ["#D71920", "#1F3A93", "#2E7D32", "#E65100", "#0277BD", "#6A1B9A", "#00838F", "#C62828", "#283593", "#00695C", "#AD1457", "#37474F"];
  if (!brand) return "#64748B";
  let h = 0;
  for (let i = 0; i < brand.length; i++) h = (h * 31 + brand.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/** Photo if there is one, drawn stand-in otherwise. */
export function StockPicture({
  photoUrl,
  shape,
  brand,
  product,
  spec,
  className = "",
  alt = "",
}: {
  photoUrl: string | null | undefined;
  shape: StockShape;
  brand?: string;
  product?: string;
  spec?: string;
  className?: string;
  alt?: string;
}) {
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl} alt={alt} className={`h-full w-full object-cover ${className}`} loading="lazy" />;
  }
  return <ProductArt shape={shape} color={brandColor(brand || "")} brand={brand} product={product} spec={spec} className={`h-full w-full ${className}`} />;
}
