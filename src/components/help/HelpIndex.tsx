"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, LifeBuoy, ArrowRight, ArrowLeft } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
// From helpSections, not help: `help.ts` reads the articles with node:fs and cannot be bundled
// for the browser.
import { HELP_SECTIONS, type HelpArticle } from "@/lib/helpSections";

export default function HelpIndex({ articles }: { articles: { en: HelpArticle[]; ar: HelpArticle[] } }) {
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";
  const [q, setQ] = useState("");

  // Arabic falls back to the English set only while a translation is missing, so a half-translated
  // Help Center still lists every article instead of looking empty.
  const list = isAr && articles.ar.length > 0 ? articles.ar : articles.en;

  const txt = {
    title: isAr ? "مركز المساعدة" : "Help Center",
    sub: isAr
      ? "شروحات خطوة بخطوة لكل حاجة في النظام."
      : "Step-by-step guides for everything in the system.",
    search: isAr ? "دوّر على أي حاجة…" : "Search for anything…",
    none: isAr ? "مفيش نتائج" : "No matching articles",
    noneSub: isAr ? "جرّب كلمة تانية." : "Try a different word.",
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((a) =>
      `${a.title} ${a.summary} ${a.slug}`.toLowerCase().includes(needle)
    );
  }, [q, list]);

  const sections = HELP_SECTIONS.map((s) => ({
    ...s,
    items: filtered.filter((a) => a.section === s.id),
  })).filter((s) => s.items.length > 0);

  const Arrow = isRTL ? ArrowLeft : ArrowRight;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-8" dir={isRTL ? "rtl" : "ltr"}>
      <header className="mb-8 flex items-center gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#E8F7F0] text-accent">
          <LifeBuoy size={28} />
        </span>
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">{txt.title}</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">{txt.sub}</p>
        </div>
      </header>

      <div className="relative mb-10">
        <Search
          size={18}
          className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? "right-4" : "left-4"}`}
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={txt.search}
          className={`w-full rounded-2xl border border-slate-200/60 bg-white py-4 text-sm font-bold text-slate-800 shadow-sm outline-none transition-all focus:border-accent-soft focus:ring-2 focus:ring-accent-soft/20 ${
            isRTL ? "pr-12 pl-4" : "pl-12 pr-4"
          }`}
        />
      </div>

      {sections.length === 0 ? (
        <div className="rounded-[2rem] border border-slate-200 bg-slate-50 p-12 text-center">
          <p className="text-lg font-bold text-slate-600">{txt.none}</p>
          <p className="mt-2 text-sm font-semibold text-slate-400">{txt.noneSub}</p>
        </div>
      ) : (
        <div className="space-y-12">
          {sections.map((section) => (
            <section key={section.id}>
              <div className="mb-4">
                <h2 className="text-lg font-black tracking-tight text-slate-900">
                  {isAr ? section.titleAr : section.titleEn}
                </h2>
                <p className="mt-0.5 text-xs font-semibold text-slate-400">
                  {isAr ? section.blurbAr : section.blurbEn}
                </p>
              </div>

              <div className="space-y-3">
                {section.items.map((a) => (
                  <Link
                    key={a.slug}
                    href={`/help/${a.slug}`}
                    className="group flex items-center gap-4 rounded-3xl border border-slate-200/60 bg-white p-5 shadow-sm transition-all hover:border-slate-300 hover:shadow-md"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-black tracking-tight text-slate-900">{a.title}</h3>
                        {a.plan ? (
                          <span className="rounded-lg border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-violet-700">
                            {a.plan}
                          </span>
                        ) : null}
                        {a.roles.map((r) => (
                          <span
                            key={r}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-500"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                      {a.summary ? (
                        <p className="mt-1.5 text-xs font-semibold leading-relaxed text-slate-500">
                          {a.summary}
                        </p>
                      ) : null}
                    </div>
                    <Arrow
                      size={18}
                      className="shrink-0 text-slate-300 transition-colors group-hover:text-accent"
                    />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
