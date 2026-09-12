"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
// From helpSections, not help: `help.ts` reads the articles with node:fs and cannot be bundled
// for the browser.
import { HELP_SECTIONS, type HelpArticle } from "@/lib/helpSections";
import HelpMarkdown from "./HelpMarkdown";
import PageHeader from "@/components/dashboard/PageHeader";

type Props = {
  article: { en: HelpArticle | null; ar: HelpArticle | null };
  /** Previous / next within the same section, so the setup path reads front to back. */
  siblings: {
    en: { prev: Pick<HelpArticle, "slug" | "title"> | null; next: Pick<HelpArticle, "slug" | "title"> | null };
    ar: { prev: Pick<HelpArticle, "slug" | "title"> | null; next: Pick<HelpArticle, "slug" | "title"> | null };
  };
};

export default function HelpArticleView({ article, siblings }: Props) {
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";

  // An untranslated article shows its English text rather than nothing at all.
  const a = (isAr ? article.ar : article.en) ?? article.en ?? article.ar;
  const nav = isAr && article.ar ? siblings.ar : siblings.en;
  if (!a) return null;

  const showingFallback = isAr && !article.ar;
  const section = HELP_SECTIONS.find((s) => s.id === a.section);

  const txt = {
    back: isAr ? "مركز المساعدة" : "Help Center",
    prev: isAr ? "السابق" : "Previous",
    next: isAr ? "التالي" : "Next",
    fallback: isAr ? "الشرح ده لسه بالإنجليزي." : "This article is not translated yet.",
  };

  const Back = isRTL ? ArrowRight : ArrowLeft;
  const Fwd = isRTL ? ArrowLeft : ArrowRight;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-8" dir={isRTL ? "rtl" : "ltr"}>
      {/* Title, section and the way back are in the layout's black band; the plan and role tags
          stay on the page, immediately above the article they qualify. */}
      <PageHeader
        eyebrow={section ? (isAr ? section.titleAr : section.titleEn) : undefined}
        title={a.title}
        subtitle={a.summary || undefined}
        backHref="/help"
      />

      <header className="mb-10">
        <div className="flex flex-wrap items-center gap-2">
          {a.plan ? (
            <span className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-violet-700">
              {a.plan}
            </span>
          ) : null}
          {a.roles.map((r) => (
            <span
              key={r}
              className="rounded-lg border border-line bg-surface-subtle px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-ink-muted"
            >
              {r}
            </span>
          ))}
        </div>

        {showingFallback ? (
          <p className="mt-5 rounded-2xl border border-line bg-surface-subtle px-4 py-3 text-xs font-bold text-ink-muted">
            {txt.fallback}
          </p>
        ) : null}
      </header>

      <article className="rounded-[2rem] border border-slate-200/60 bg-surface p-6 shadow-sm md:p-10">
        <HelpMarkdown body={a.body} isRTL={showingFallback ? false : isRTL} />
      </article>

      {(nav.prev || nav.next) && (
        <nav className="mt-8 grid gap-3 sm:grid-cols-2">
          {nav.prev ? (
            <Link
              href={`/help/${nav.prev.slug}`}
              className="group rounded-2xl border border-slate-200/60 bg-surface p-5 shadow-sm transition-all hover:border-line-strong hover:shadow-md"
            >
              <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <Back size={12} /> {txt.prev}
              </span>
              <span className="mt-1.5 block text-sm font-black text-ink">{nav.prev.title}</span>
            </Link>
          ) : (
            <span className="hidden sm:block" />
          )}
          {nav.next ? (
            <Link
              href={`/help/${nav.next.slug}`}
              className={`group rounded-2xl border border-slate-200/60 bg-surface p-5 shadow-sm transition-all hover:border-line-strong hover:shadow-md ${
                isRTL ? "sm:text-left" : "sm:text-right"
              }`}
            >
              <span
                className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 ${
                  isRTL ? "sm:justify-start" : "sm:justify-end"
                }`}
              >
                {txt.next} <Fwd size={12} />
              </span>
              <span className="mt-1.5 block text-sm font-black text-ink">{nav.next.title}</span>
            </Link>
          ) : null}
        </nav>
      )}
    </div>
  );
}
