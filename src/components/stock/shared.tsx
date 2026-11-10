"use client";

import React, { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Minus, Plus, X } from "lucide-react";
import type { StockDrawer, StockItem, StockLine, StockSnapshot, StockVariant } from "@/lib/stock/types";
import type { PaceRow } from "@/lib/stock/math";
import { StockPicture } from "./Art";

/** Everything a view needs, resolved once by the page. */
export interface StockCtx {
  snap: StockSnapshot;
  setSnap: (s: StockSnapshot) => void;
  drawers: Map<string, StockDrawer>;
  items: Map<string, StockItem>;
  variants: Map<string, StockVariant>;
  pace: Map<string, PaceRow>;
  ar: boolean;
  /** Pick the string for the current language. */
  t: (en: string, ar: string) => string;
  toast: (message: string, type?: "success" | "error" | "info") => void;
  canEdit: boolean;
  canStructure: boolean;
  go: (params: Record<string, string | null>) => void;
  today: string;
}

export function variantLabel(v: StockVariant | undefined, item: StockItem | undefined, ar: boolean): string {
  if (!v) return "";
  if (v.isGeneric) return item ? (ar ? item.nameAr : item.nameEn) : v.product;
  return [v.brand, v.product, v.spec].filter(Boolean).join(" · ");
}

export function linesOfDrawer(snap: StockSnapshot, drawerId: string): StockLine[] {
  return snap.lines.filter((l) => l.drawerId === drawerId);
}

export function fmtMoney(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtDate(iso: string, ar: boolean): string {
  if (!iso) return "—";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

/** A row's picture: the variant's photo, else the item's, else the drawing. */
export function LinePicture({ variant, item, className = "" }: { variant?: StockVariant; item?: StockItem; className?: string }) {
  return (
    <StockPicture
      photoUrl={variant?.photoUrl || item?.photoUrl}
      shape={item?.shape || "box"}
      brand={variant?.isGeneric ? "" : variant?.brand}
      product={variant?.isGeneric ? item?.nameEn : variant?.product}
      spec={variant?.spec}
      colorSeed={variant?.isGeneric || !variant ? item?.nameEn : variant.brand}
      className={className}
      alt={variantLabel(variant, item, false)}
    />
  );
}

/**
 * A row's picture that is also its camera button: tap it, take or pick a photo, and that photo
 * replaces the drawing. The small camera badge is what tells a person the picture can be changed.
 */
export function PhotoTile({ variant, item, onFile, busy, className = "" }: { variant?: StockVariant; item?: StockItem; onFile: (f: File) => void; busy?: boolean; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <button type="button" onClick={() => ref.current?.click()} disabled={busy} className={`relative block overflow-hidden rounded-lg border border-line bg-surface-subtle ${className}`} aria-label="Change photo">
      <LinePicture variant={variant} item={item} />
      <span className="absolute bottom-0.5 end-0.5 grid h-5 w-5 place-items-center rounded-full bg-ink-slab/85 text-white">
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />}
      </span>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.currentTarget.value = "";
        }}
      />
    </button>
  );
}

/**
 * Latin data inside an Arabic line: a pack size, a barcode, a price.
 *
 * In a right-to-left paragraph "50 pcs" is drawn as "pcs 50", because the number and the word
 * are laid out as two separate runs. Isolating the piece and marking it left-to-right keeps it
 * the way it is printed on the box.
 */
export function Ltr({ children }: { children: React.ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

/** A sheet over the page: from the bottom on a phone, a centred card on a wider screen. */
export function Sheet({ title, onClose, children, dir }: { title: string; onClose: () => void; children: React.ReactNode; dir?: "rtl" | "ltr" }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/45 sm:items-center sm:p-6" dir={dir} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="grid max-h-[90vh] w-full max-w-[640px] gap-4 overflow-y-auto rounded-t-3xl bg-surface p-5 pb-8 shadow-2xl sm:rounded-3xl sm:pb-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full border border-line text-ink-muted hover:text-ink">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Scrolls its content into view once, when it appears — for a form opened by a button above it. */
export function Reveal({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);
  return <div ref={ref}>{children}</div>;
}

export function Stepper({ value, onChange, min = 0, changed = false, disabled = false }: { value: number; onChange: (n: number) => void; min?: number; changed?: boolean; disabled?: boolean }) {
  return (
    <div className={`inline-flex items-center overflow-hidden rounded-xl border ${changed ? "border-[#FACC15]" : "border-line"} bg-surface`}>
      <button type="button" disabled={disabled} onClick={() => onChange(Math.max(min, value - 1))} className="grid h-10 w-10 place-items-center text-ink-body hover:bg-surface-subtle disabled:opacity-40" aria-label="minus">
        <Minus size={16} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Math.max(min, Math.floor(Number(e.target.value) || 0)))}
        onFocus={(e) => e.currentTarget.select()}
        className={`h-10 w-14 border-x border-line text-center font-display text-base font-bold outline-none ${changed ? "bg-[#FACC15] text-[#1A1206]" : "bg-transparent text-ink"}`}
      />
      <button type="button" disabled={disabled} onClick={() => onChange(value + 1)} className="grid h-10 w-10 place-items-center text-ink-body hover:bg-surface-subtle disabled:opacity-40" aria-label="plus">
        <Plus size={16} />
      </button>
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface shadow-sm ${className}`}>{children}</div>;
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-ink-muted">{children}</div>;
}

export function Btn({ children, onClick, kind = "ghost", disabled, busy, className = "", type = "button" }: { children: React.ReactNode; onClick?: () => void; kind?: "ghost" | "dark" | "yellow"; disabled?: boolean; busy?: boolean; className?: string; type?: "button" | "submit" }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-display text-[13px] font-bold transition-colors disabled:opacity-40";
  const look = kind === "dark" ? "bg-ink text-white hover:bg-ink/90" : kind === "yellow" ? "bg-[#FACC15] text-[#1A1206] hover:brightness-105" : "border border-line bg-surface text-ink hover:bg-surface-subtle";
  return (
    <button type={type} onClick={onClick} disabled={disabled || busy} className={`${base} ${look} ${className}`}>
      {busy ? <Loader2 size={15} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

export function Pill({ children, yellow = false }: { children: React.ReactNode; yellow?: boolean }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 font-display text-[10.5px] font-bold uppercase tracking-[0.06em] ${yellow ? "bg-[#FACC15] text-[#1A1206]" : "border border-line text-ink-body"}`}>
      {children}
    </span>
  );
}

export function CodeBadge({ code, big = false }: { code: string; big?: boolean }) {
  return <span className={`inline-block rounded-lg bg-[#FACC15] px-2 font-display font-black tracking-tight text-[#1A1206] ${big ? "text-3xl leading-tight" : "text-sm"}`}>{code}</span>;
}

/** A camera / file button that hands back the chosen file. */
export function PhotoButton({ label, onFile, busy, compact = false }: { label: string; onFile: (f: File) => void; busy?: boolean; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} className={`inline-flex items-center gap-2 rounded-xl border border-line bg-surface font-display font-bold text-ink hover:bg-surface-subtle disabled:opacity-50 ${compact ? "px-2.5 py-1.5 text-[12px]" : "px-3 py-2 text-[13px]"}`}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.currentTarget.value = "";
        }}
      />
    </>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-[12px] font-semibold text-ink-body">
      {label}
      {children}
    </label>
  );
}

export const inputCls = "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[14px] text-ink outline-none focus:border-ink-muted";

export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, onError: (m: string) => void): Promise<T | undefined> => {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Something went wrong.");
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}
