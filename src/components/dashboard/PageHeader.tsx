"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { usePageHeaderSlot } from "@/context/PageHeaderContext";
import { useLanguage } from "@/context/LanguageContext";

/**
 * The page's own title row, rendered up inside the layout's black band.
 *
 * Put one of these at the top of a page and delete whatever heading the page used to draw for
 * itself — two headings stacked is the thing this component exists to prevent. Anything passed as
 * children lands on the right (the left, in Arabic) as the page's actions.
 *
 *   <PageHeader title={t("patients")} subtitle={`${count} records`}>
 *     <button onClick={() => setOpen(true)}>New patient</button>
 *   </PageHeader>
 *
 * `compact` collapses the strip to a single slim line. Use it on pages locked to the viewport
 * height — the calendar and the reception desk — where every pixel the header takes is a row of
 * appointments the receptionist cannot see.
 */
export default function PageHeader({
  title,
  subtitle,
  eyebrow,
  backHref,
  compact = false,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Small line above the title — a breadcrumb, a date, a clinic name. */
  eyebrow?: React.ReactNode;
  /** Renders a back arrow before the title. For detail pages under a list. */
  backHref?: string;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const ctx = usePageHeaderSlot();
  const { isRTL } = useLanguage();
  const register = ctx?.register;
  const unregister = ctx?.unregister;

  useEffect(() => {
    if (!register || !unregister) return;
    register(compact);
    return () => unregister(compact);
  }, [register, unregister, compact]);

  if (!ctx?.slot) return null;

  const Back = isRTL ? ArrowRight : ArrowLeft;

  return createPortal(
    <div
      className={`flex w-full items-center justify-between gap-4 ${compact ? "flex-row" : "flex-col items-start gap-3 sm:flex-row sm:items-center"}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {backHref && (
          <Link
            href={backHref}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-white/15 bg-white/5 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
          >
            <Back size={17} />
          </Link>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">{eyebrow}</p>
          )}
          <h1
            className={`truncate font-semibold tracking-tight text-white ${
              compact ? "text-lg lg:text-xl" : "text-xl lg:text-[1.7rem] lg:leading-tight"
            }`}
          >
            {title}
          </h1>
          {subtitle && !compact && (
            <p className="mt-0.5 truncate text-[13px] font-medium text-white/55">{subtitle}</p>
          )}
        </div>
      </div>

      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>,
    ctx.slot
  );
}

/**
 * The buttons inside a PageHeader sit on black, so the page's usual white-card button styles are
 * invisible there. These two give a consistent pair without every page inventing its own.
 */
export const headerButtonPrimary =
  "inline-flex items-center gap-2 rounded-full bg-[#FACC15] px-4 py-2 text-sm font-bold text-ink shadow-sm transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-50";

export const headerButtonGhost =
  "inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white/85 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-50";
