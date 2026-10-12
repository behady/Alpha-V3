"use client";

/**
 * How a payment was made, as an icon and a word: cash, the card machine, InstaPay, the insurer,
 * a bank transfer. Spellings are folded the way Reports folds them ("Visa" is the card machine,
 * "Instapay" and "InstaPay" one app); anything else is shown as written, with a wallet.
 */

import { Banknote, CreditCard, Landmark, ShieldCheck, Smartphone, Wallet, type LucideIcon } from "lucide-react";
import { normalizeMethod } from "@/lib/reports/ledgerStats";
import { paymentMethodLabel } from "@/lib/dailySheet";

const LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  Cash: { icon: Banknote, tone: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  Card: { icon: CreditCard, tone: "bg-sky-50 text-sky-700 border-sky-100" },
  InstaPay: { icon: Smartphone, tone: "bg-violet-50 text-violet-700 border-violet-100" },
  Insurance: { icon: ShieldCheck, tone: "bg-amber-50 text-amber-800 border-amber-100" },
  Transfer: { icon: Landmark, tone: "bg-slate-50 text-slate-700 border-slate-200" },
  Other: { icon: Wallet, tone: "bg-slate-50 text-slate-700 border-slate-200" },
};

export default function MethodChip({ method, isAr }: { method: unknown; isAr: boolean }) {
  const text = String(method ?? "").trim();
  if (!text) return <span className="text-slate-300">—</span>;
  const folded = normalizeMethod(text);
  const kind = folded === "Other" && text.toLowerCase() === "bank transfer" ? "Transfer" : folded;
  const { icon: Icon, tone } = LOOK[kind] ?? LOOK.Other;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${tone}`}>
      <Icon size={13} aria-hidden />
      {paymentMethodLabel(text, isAr)}
    </span>
  );
}
