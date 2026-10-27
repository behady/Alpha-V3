"use client";

import React, { useState } from "react";
import { balanceOwed, isTrial, type ConsoleClinic } from "./clinicMath";
import { useSuperAdminText } from "./i18n";

type Tone = "danger" | "warn" | "quiet";

interface Item {
  key: string;
  clinic: ConsoleClinic;
  tone: Tone;
  tag: string;
  body: string;
  /** The one fix that solves it, when there is a single obvious one. Open is always offered. */
  fix?: { label: string; run: () => void };
}

interface Props {
  clinics: ConsoleClinic[];
  onExtend: (c: ConsoleClinic, days: number) => void;
  onAddCredits: (c: ConsoleClinic, n: number) => void;
  onOpen: (id: string) => void;
}

const TAG: Record<Tone, string> = {
  danger: "bg-danger-tint text-danger",
  warn: "bg-warn-tint text-warn",
  quiet: "bg-surface-muted text-ink-body",
};

/**
 * What the platform owner should act on today, worked out from the clinic docs alone — no stored
 * alerts to fall out of date. Each card carries the fix, so the usual case is one click.
 */
export function AttentionList({ clinics, onExtend, onAddCredits, onOpen }: Props) {
  const { t, num, days, money } = useSuperAdminText();
  const [expanded, setExpanded] = useState(false);

  const items: Item[] = [];
  for (const c of clinics) {
    if (c.status === "Suspended") continue;
    const d = c.daysRemaining;
    if (d !== undefined && d < 0 && c.status === "Active") {
      items.push({
        key: `${c.id}-expired`, clinic: c, tone: "danger", tag: t("attnExpired"),
        body: t("attnExpiredBody", { days: days(-d) }),
        fix: { label: t("plus14"), run: () => onExtend(c, 14) },
      });
    } else if (isTrial(c) && d !== undefined && d >= 0 && d <= 7) {
      items.push({
        key: `${c.id}-trial`, clinic: c, tone: "warn", tag: t("attnTrialEnding"),
        body: d === 0 ? t("attnTrialEndsToday") : t("attnTrialEndingBody", { days: days(d) }),
        fix: { label: t("plus14"), run: () => onExtend(c, 14) },
      });
    }
    if (c.aiLimit > 0 && c.aiUsed / c.aiLimit >= 0.9) {
      items.push({
        key: `${c.id}-ai`, clinic: c, tone: "danger",
        tag: t("attnCredits", { n: num(Math.min(999, (c.aiUsed / c.aiLimit) * 100)) }),
        body: t("attnCreditsBody", { used: num(c.aiUsed), limit: num(c.aiLimit) }),
        fix: { label: t("plus1000"), run: () => onAddCredits(c, 1000) },
      });
    }
    const owed = balanceOwed(c);
    if (owed > 0 && c.status === "Active") {
      items.push({
        key: `${c.id}-owed`, clinic: c, tone: "warn", tag: t("attnUnpaid"),
        body: t("attnUnpaidBody", { owed: money(owed), price: money(Number(c.customPrice) || 0) }),
      });
    }
    if (!isTrial(c) && d === undefined) {
      items.push({ key: `${c.id}-nodate`, clinic: c, tone: "quiet", tag: t("attnNoDate"), body: t("attnNoDateBody") });
    }
    if (!c.ownerEmail) {
      items.push({ key: `${c.id}-email`, clinic: c, tone: "quiet", tag: t("attnNoEmail"), body: t("attnNoEmailBody") });
    }
  }
  const rank: Record<Tone, number> = { danger: 0, warn: 1, quiet: 2 };
  items.sort((a, b) => rank[a.tone] - rank[b.tone]);

  const shown = expanded ? items : items.slice(0, 4);

  return (
    <section aria-labelledby="attn-h" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="attn-h" className="font-display text-base font-bold text-ink">{t("attnTitle")}</h2>
        <span className="text-[13px] text-ink-muted">
          {items.length ? t("attnSub", { n: num(items.length) }) : t("attnNone")}
        </span>
      </div>
      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {shown.map((it) => (
            <article key={it.key} className="bg-surface border border-line rounded-2xl p-4 flex flex-col gap-2.5">
              <span className={`self-start text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${TAG[it.tone]}`}>{it.tag}</span>
              <span className="font-semibold text-ink truncate" dir="auto">{it.clinic.name}</span>
              <span className="text-[13px] text-ink-muted leading-snug">{it.body}</span>
              <div className="flex gap-2 mt-auto pt-1">
                {it.fix && (
                  <button
                    type="button"
                    onClick={it.fix.run}
                    className="flex-1 min-h-[40px] px-3 rounded-xl bg-ink-slab text-white text-[13px] font-semibold hover:bg-ink"
                  >
                    {it.fix.label}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpen(it.clinic.id)}
                  className={`${it.fix ? "" : "flex-1 "}min-h-[40px] px-3 rounded-xl border border-line-strong bg-surface text-ink text-[13px] font-semibold hover:bg-surface-subtle`}
                >
                  {t("open")}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {items.length > 4 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="self-start text-[13px] font-semibold text-ink underline underline-offset-4">
          {expanded ? t("showLess") : t("showMore", { n: num(items.length - 4) })}
        </button>
      )}
    </section>
  );
}
