"use client";

/**
 * One line of the activity log: **who** · what happened (the catalogue's sentence, with the
 * patient's name in bold and linked to their file) · the time on the clinic's clock. A line with
 * something behind it (a before → after, a reason, or the lines of a folded visit discount) opens
 * in place; the chevron is the keyboard way in, the whole line is the mouse way in.
 */

import { useId, useState, type MouseEvent } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Sparkles } from "lucide-react";
import { describeLog, fieldLabel, reasonText, valueText } from "@/lib/activity/catalogue";
import { logTime, personName, servicesCount, splitOnName, type FoldedEntry } from "@/lib/activity/feed";
import type { ActivityLogDoc, Change } from "@/lib/activity/types";

type Lang = "ar" | "en";

const timeFormats = new Map<string, Intl.DateTimeFormat>();
/** "14:05" on the clinic's clock, Latin digits like the rest of the line. */
export function clockTime(at: Date, tz: string): string {
  let f = timeFormats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    timeFormats.set(tz, f);
  }
  return f.format(at);
}

/** The "worth a look" mark: a small amber diamond, not a badge. */
export function FlagMark({ isAr, className = "" }: { isAr: boolean; className?: string }) {
  const label = isAr ? "يستاهل نظرة" : "Worth a look";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block h-2 w-2 shrink-0 rotate-45 rounded-[1px] bg-amber-500 ${className}`}
    />
  );
}

function AiChip() {
  return (
    // The person stays accountable; the chip says the change came through the assistant.
    <span className="ms-1.5 inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-0.5 align-middle text-[9px] font-black uppercase tracking-widest text-ink-muted">
      <Sparkles size={9} aria-hidden="true" /> AI
    </span>
  );
}

const stop = (e: MouseEvent) => e.stopPropagation();

/** The sentence with the patient's name bold, and a link to their file when we know who they are. */
function Sentence({ log, text, linkPatient }: { log: ActivityLogDoc; text: string; linkPatient: boolean }) {
  const parts = splitOnName(text, log.patientName);
  if (!parts) return <>{text}</>;
  const [before, name, after] = parts;
  const bold = <bdi className="font-bold text-ink">{name}</bdi>;
  return (
    <>
      {before}
      {linkPatient && log.patientId ? (
        <Link
          href={`/patients/${encodeURIComponent(log.patientId)}`}
          onClick={stop}
          className="underline decoration-ink-faint underline-offset-4 hover:decoration-ink"
        >
          {bold}
        </Link>
      ) : (
        bold
      )}
      {after}
    </>
  );
}

function ChangeRow({ change, lang, isRTL }: { change: Change; lang: Lang; isRTL: boolean }) {
  const isAr = lang === "ar";
  const labelOnly = (change.from === null || change.from === undefined) && (change.to === null || change.to === undefined);
  const fig = (v: Change["from"]) => (typeof v === "number" ? "font-figure" : "");
  return (
    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[minmax(7rem,11rem)_1fr] sm:gap-4">
      <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{fieldLabel(change.field, lang)}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        {labelOnly ? (
          <span className="text-ink-body">{isAr ? "اتغيّر" : "Changed"}</span>
        ) : (
          <>
            <span className="sr-only">{isAr ? "من" : "from"}</span>
            <bdi className={`break-words text-ink-muted ${fig(change.from)}`}>{valueText(change.field, change.from, lang)}</bdi>
            <ArrowRight size={12} aria-hidden="true" className={`shrink-0 text-ink-faint ${isRTL ? "rotate-180" : ""}`} />
            <span className="sr-only">{isAr ? "إلى" : "to"}</span>
            <bdi className={`break-words font-semibold text-ink ${fig(change.to)}`}>{valueText(change.field, change.to, lang)}</bdi>
          </>
        )}
      </dd>
    </div>
  );
}

export default function ActivityEntry({
  entry,
  isAr,
  isRTL,
  tz,
  linkPatient = true,
}: {
  entry: FoldedEntry;
  isAr: boolean;
  isRTL: boolean;
  tz: string;
  /** Off inside the patient's own file, where a link to the same file goes nowhere. */
  linkPatient?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const lang: Lang = isAr ? "ar" : "en";
  const { log, members } = entry;
  const grouped = members.length > 1;
  const sentence = describeLog(log, lang) || "—";
  const at = logTime(log);
  const who = personName(log) || (isAr ? "غير معروف" : "Unknown");
  // A folded line's own price arrow is gone; its lines are listed instead.
  const changes = grouped ? [] : (log.changes ?? []).filter((c) => c && c.field);
  const reason = typeof log.reason === "string" && log.reason.trim() ? log.reason.trim() : "";
  const expandable = grouped || changes.length > 0 || !!reason;
  const toggle = () => setOpen((o) => !o);

  return (
    <li>
      <div
        className={`flex items-start gap-3 px-4 py-3 sm:px-5 ${expandable ? "cursor-pointer transition-colors hover:bg-surface-subtle" : ""}`}
        onClick={expandable ? toggle : undefined}
      >
        <p className="min-w-0 flex-1 break-words text-[13.5px] leading-relaxed text-ink-body">
          <bdi className="font-bold text-ink">{who}</bdi>
          {log.actor === "ai" && <AiChip />}
          <span className="text-ink-faint" aria-hidden="true"> · </span>
          <Sentence log={log} text={sentence} linkPatient={linkPatient} />
          {grouped && <span className="text-ink-muted"> ({servicesCount(members.length, lang)})</span>}
        </p>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          {log.flag === true && <FlagMark isAr={isAr} />}
          {at && (
            <time dateTime={at.toISOString()} className="font-figure text-xs font-semibold text-ink-muted">
              {clockTime(at, tz)}
            </time>
          )}
          {expandable && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
              aria-expanded={open}
              aria-controls={panelId}
              aria-label={open ? (isAr ? "إخفاء التفاصيل" : "Hide details") : (isAr ? "عرض التفاصيل" : "Show details")}
              className="-my-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <ChevronDown size={14} aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      </div>

      {expandable && open && (
        <div id={panelId} className="px-4 pb-4 sm:px-5">
          <div className="space-y-3 rounded-xl bg-surface-subtle px-4 py-3">
            {changes.length > 0 && (
              <dl className="divide-y divide-line">
                {changes.map((c, i) => (
                  <ChangeRow key={`${c.field}-${i}`} change={c} lang={lang} isRTL={isRTL} />
                ))}
              </dl>
            )}
            {reason && (
              <p className="text-[13px] text-ink-body">
                <span className="font-bold text-ink-muted">{isAr ? "السبب: " : "Reason: "}</span>
                {reasonText(reason, lang)}
              </p>
            )}
            {grouped && (
              <ul className="space-y-1.5">
                {members.map((m) => (
                  <li key={m.id} className="text-[13px] leading-relaxed text-ink-body">
                    {describeLog(m, lang)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
