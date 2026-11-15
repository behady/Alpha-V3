"use client";

/**
 * Separate crowns, or one bridge.
 *
 * Shown under the tooth picker only when the question exists: two or more picked teeth stand next
 * to each other, or the patient's chart has a missing tooth sitting between two picked ones. A
 * single crown never sees it.
 *
 * The answer usually arrives already filled in, read off the patient's chart (see labBridge.ts).
 * This is where somebody confirms it, or corrects a chart nobody updated: tapping a tooth marks it
 * as the one the bridge replaces.
 */

import { Link2, Plus } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import PalmerMark, { PalmerList } from "@/components/lab/PalmerMark";
import { bridgeRuns } from "@/lib/labBridge";

export default function LabBridgeField({
  teeth,
  bridge,
  pontics,
  gaps,
  onBridgeChange,
  onTogglePontic,
  onAddGaps,
}: {
  teeth: number[];
  bridge: boolean;
  pontics: number[];
  /** Missing teeth lying between picked ones, not yet part of the order. */
  gaps: number[];
  onBridgeChange: (next: boolean) => void;
  onTogglePontic: (tooth: number) => void;
  onAddGaps: () => void;
}) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const runs = bridgeRuns(teeth);
  if (runs.length === 0 && gaps.length === 0) return null;

  const replaced = new Set(pontics);
  const option = (on: boolean, label: string, value: boolean) => (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onBridgeChange(value)}
      className={`h-10 flex-1 rounded-lg px-3 text-[13px] font-black transition-colors ${
        on ? "bg-ink-slab text-white" : "text-ink-muted hover:bg-surface-subtle"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-3" data-tour="lab-case-bridge">
      {gaps.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-subtle px-3 py-2.5">
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] font-bold text-ink">
            <PalmerList teeth={gaps} className="font-black" />
            <span>
              {isAr
                ? gaps.length === 1 ? "مخلوع بين الأسنان المختارة. كوبري؟" : "مخلوعين بين الأسنان المختارة. كوبري؟"
                : gaps.length === 1 ? "is missing between the picked teeth. A bridge?" : "are missing between the picked teeth. A bridge?"}
            </span>
          </p>
          <button
            type="button"
            onClick={onAddGaps}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ink-slab px-3 text-[12px] font-black text-white hover:bg-ink"
          >
            <Plus size={14} />
            {isAr ? "ضيفه للكوبري" : "Add to the bridge"}
          </button>
        </div>
      )}

      {runs.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <Link2 size={15} className="shrink-0 text-ink" aria-hidden="true" />
            <p className="text-[11px] font-black uppercase tracking-wider text-ink-muted">
              {isAr ? "الأسنان اللي جنب بعض" : "The teeth next to each other"}
            </p>
          </div>
          <div className="flex gap-1 rounded-xl border border-line bg-surface p-1">
            {option(!bridge, isAr ? "تيجان منفصلة" : "Separate crowns", false)}
            {option(bridge, isAr ? "كوبري (متصلين)" : "Bridge (joined)", true)}
          </div>

          {bridge && (
            <div className="space-y-2.5">
              <p className="text-[12px] font-bold text-ink-muted">
                {isAr
                  ? "دوس على السن اللي الكوبري بيعوّضه (المخلوع)."
                  : "Tap the tooth the bridge replaces (the missing one)."}
              </p>
              {runs.map((run) => {
                const hanging = run.filter((t) => replaced.has(t));
                const supports = run.filter((t) => !replaced.has(t));
                return (
                  <div key={run.join("-")} className="space-y-2 rounded-xl bg-surface-subtle p-2.5">
                    <div className="flex flex-wrap gap-1.5" dir="ltr">
                      {run.map((tooth) => {
                        const on = replaced.has(tooth);
                        return (
                          <button
                            key={tooth}
                            type="button"
                            aria-pressed={on}
                            onClick={() => onTogglePontic(tooth)}
                            className={`inline-flex h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-lg border px-2 transition-colors ${
                              on ? "border-ink-slab bg-ink-slab text-white" : "border-line bg-surface text-ink hover:border-ink"
                            }`}
                          >
                            <PalmerMark fdi={tooth} className="text-[13px] font-black" />
                            <span className="text-[9px] font-black leading-none">
                              {on ? (isAr ? "بونتيك" : "pontic") : isAr ? "دعامة" : "support"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] font-black text-ink">
                      <span>
                        {hanging.length > 0
                          ? isAr ? `كوبري ${run.length} وحدات` : `Bridge, ${run.length} units`
                          : isAr ? `تيجان متصلة ${run.length} وحدات` : `Joined crowns, ${run.length} units`}
                      </span>
                      {hanging.length > 0 && (
                        <>
                          <span className="font-bold text-ink-muted">· {isAr ? "دعامات" : "supports"}</span>
                          <PalmerList teeth={supports} />
                          <span className="font-bold text-ink-muted">· {isAr ? "بونتيك" : "pontic"}</span>
                          <PalmerList teeth={hanging} />
                        </>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
