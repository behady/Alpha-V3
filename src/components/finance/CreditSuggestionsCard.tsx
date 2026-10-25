"use client";

/**
 * "This patient paid 1,500 before the implant was added — apply it to the implant?"
 *
 * One line per general payment that a treatment could now take (lib/creditSuggestions), with the
 * treatments it fits and an Apply button. Nothing is linked until the button is pressed; the
 * parent does the linking through the ledger route, which re-checks it.
 */

import { useState } from "react";
import { Link2 } from "lucide-react";
import { sheetDay } from "@/lib/dailySheet";
import type { CreditSuggestion } from "@/lib/creditSuggestions";

export default function CreditSuggestionsCard({
  suggestions,
  isAr,
  currency,
  onApply,
}: {
  suggestions: CreditSuggestion[];
  isAr: boolean;
  currency: string;
  onApply: (paymentId: string, procedureId: string) => Promise<void>;
}) {
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (suggestions.length === 0) return null;

  const money = (n: number) => `${n.toLocaleString()} ${currency}`;
  const apply = async (s: CreditSuggestion) => {
    const procedureId = chosen[s.paymentId] || s.targets[0].procedureId;
    setBusy(s.paymentId);
    try {
      await onApply(s.paymentId, procedureId);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <h4 className="flex items-center gap-2 text-sm font-black text-amber-800">
        <Link2 size={16} className="shrink-0" />
        {isAr ? "فلوس مدفوعة مقدماً ومش مربوطة بعلاج" : "Money paid ahead, not linked to a treatment"}
      </h4>
      <p className="mt-1 max-w-prose text-xs font-medium text-amber-700">
        {isAr
          ? "المريض دفع الفلوس دي قبل ما العلاج يتسجل. لو ربطتها بالعلاج هتتحسب عليه وعلى نصيب الطبيب، وإجمالي حساب المريض مش هيتغير."
          : "The patient paid this before the treatment was recorded. Linking it counts it against the treatment and its dentist's share; the patient's account total does not change."}
      </p>
      <ul className="mt-3 space-y-2">
        {suggestions.map((s) => {
          const value = chosen[s.paymentId] || s.targets[0].procedureId;
          return (
            <li key={s.paymentId} className="flex flex-col gap-2 rounded-xl border border-amber-100 bg-surface p-3 sm:flex-row sm:items-center">
              <span className="min-w-0 text-sm font-black tabular-nums text-ink">
                {money(s.amount)}
                {s.date && <span className="ms-2 text-xs font-bold text-ink-muted">{sheetDay(s.date)}</span>}
              </span>
              <span className="text-xs font-bold text-ink-muted">{isAr ? "على" : "to"}</span>
              <select
                value={value}
                onChange={(e) => setChosen((prev) => ({ ...prev, [s.paymentId]: e.target.value }))}
                disabled={busy !== null}
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface-subtle px-2 py-2 text-sm font-bold text-ink-body outline-none focus:border-accent"
              >
                {s.targets.map((t) => (
                  <option key={t.procedureId} value={t.procedureId}>
                    {`${t.name || (isAr ? "علاج" : "Treatment")}${t.date ? ` · ${sheetDay(t.date)}` : ""} — ${isAr ? "المتبقي" : "left"} ${money(t.remaining)}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void apply(s)}
                disabled={busy !== null}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-black text-white transition hover:bg-amber-700 disabled:opacity-50"
              >
                {busy === s.paymentId ? "…" : isAr ? "اربطها" : "Apply"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
