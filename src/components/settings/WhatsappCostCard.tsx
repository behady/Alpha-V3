"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Megaphone, Bell, Info } from "lucide-react";
import { auth } from "@/lib/firebase";
import { currentClinicId } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { usdToEgp, type MessageCategory } from "@/lib/whatsappCost";

type MonthCost = {
  monthKey: string;
  sentByCategory: Record<MessageCategory, number>;
  estimatedUsd: number;
  billedUsd: number | null;
  billedMessages: number | null;
};

/**
 * What WhatsApp costs the clinic this month — a SECOND bill, beside the AI credits.
 *
 * Kept as its own card rather than folded into the AI one because they are two suppliers with
 * two invoices, and merging them hides the thing an owner most needs to see: the assistant's
 * replies are free, and the WhatsApp bill is a REMINDERS bill. On this clinic's own account, a
 * day of 39 bot replies was billed $0.00 by Meta.
 *
 * Meta's own figure is shown when it has reported one; our running estimate sits beside it, never
 * instead of it, because the estimate covers messages Meta has not counted yet and the gap
 * between the two is worth seeing.
 */
export default function WhatsappCostCard() {
  const { language } = useLanguage();
  const ar = language === "ar";
  const [cost, setCost] = useState<MonthCost | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    // Guarded rather than fire-and-forget: the settings panels mount and unmount as the owner
    // moves between them, and a reply landing after that is a state update on a dead component.
    let cancelled = false;

    async function fetchCost() {
      const user = auth.currentUser;
      if (!user) return null;
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/admin/whatsapp-cost?clinicId=${encodeURIComponent(currentClinicId() || "")}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json().catch(() => ({}));
      return res.ok && data.ok ? (data.cost as MonthCost) : null;
    }

    fetchCost()
      .then((result) => {
        if (cancelled) return;
        setCost(result);
        setState(result ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) setState("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const txt = {
    title: ar ? "تكلفة الواتساب الشهر ده" : "WhatsApp cost this month",
    lead: ar
      ? "ميتا بتحاسب على الرسايل اللي العيادة بتبدأها بس. ردود المساعد على المرضى مجانية."
      : "Meta charges only for messages the clinic starts. The assistant's replies to patients are free.",
    billed: ar ? "اللي ميتا حاسبت عليه" : "Billed by Meta",
    estimate: ar ? "تقديرنا" : "Our estimate",
    notYet: ar ? "ميتا لسه محسبتش الشهر ده" : "Meta has not reported yet",
    free: ar ? "ردود المساعد (مجانية)" : "Assistant replies (free)",
    utility: ar ? "تذكيرات وإشعارات" : "Reminders and notices",
    marketing: ar ? "رسايل تسويقية" : "Marketing messages",
    messages: ar ? "رسالة" : "messages",
    unavailable: ar ? "الواتساب الرسمي مش متوصل، فمفيش فاتورة." : "The official WhatsApp channel is not connected, so there is no bill.",
    marketingNote: ar
      ? "الرسالة التسويقية بتكلف حوالي 18 ضعف رسالة التذكير — النوع بيفرق أكتر من العدد."
      : "A marketing message costs about 18x a reminder — the category matters more than the count.",
  };

  const money = (usd: number) => (ar ? `${usdToEgp(usd).toLocaleString("en-US")} ج.م` : `$${usd.toFixed(2)}`);

  if (state === "loading") {
    return <div className="rounded-2xl border border-line bg-surface p-5 text-sm font-semibold text-ink-muted">…</div>;
  }
  if (state === "unavailable" || !cost) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-5">
        <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-ink">
          <MessageSquare size={17} className="text-ink-muted" /> {txt.title}
        </h3>
        <p className="text-sm font-semibold text-ink-muted">{txt.unavailable}</p>
      </div>
    );
  }

  const rows: Array<{ key: MessageCategory; label: string; Icon: typeof Bell; count: number; free?: boolean }> = [
    { key: "service", label: txt.free, Icon: MessageSquare, count: cost.sentByCategory.service || 0, free: true },
    { key: "utility", label: txt.utility, Icon: Bell, count: cost.sentByCategory.utility || 0 },
    { key: "marketing", label: txt.marketing, Icon: Megaphone, count: cost.sentByCategory.marketing || 0 },
  ];

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-ink">
        <MessageSquare size={17} className="text-ink-muted" /> {txt.title}
      </h3>
      <p className="mb-4 text-sm font-semibold text-ink-muted">{txt.lead}</p>

      <div className="mb-4 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <span className="block text-[11px] font-bold uppercase tracking-wide text-ink-muted">{txt.billed}</span>
          <span className="font-figure text-2xl font-bold text-ink">
            {cost.billedUsd === null ? "—" : money(cost.billedUsd)}
          </span>
          {cost.billedUsd === null && <span className="ms-2 text-xs font-semibold text-ink-muted">{txt.notYet}</span>}
        </div>
        <div>
          <span className="block text-[11px] font-bold uppercase tracking-wide text-ink-muted">{txt.estimate}</span>
          <span className="font-figure text-lg font-bold text-ink-body">{money(cost.estimatedUsd)}</span>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map(({ key, label, Icon, count, free }) => (
          <li key={key} className="flex items-center justify-between gap-3 border-t border-line-soft pt-2 first:border-t-0 first:pt-0">
            <span className="flex items-center gap-2 text-sm font-semibold text-ink-body">
              <Icon size={14} className="shrink-0 text-ink-muted" /> {label}
            </span>
            <span className="font-figure text-sm font-bold text-ink">
              {count.toLocaleString("en-US")} {txt.messages}
              {free && <span className="ms-1 text-xs font-semibold text-ink-muted">· {ar ? "٠" : "0"}</span>}
            </span>
          </li>
        ))}
      </ul>

      {(cost.sentByCategory.marketing || 0) > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-xs font-semibold text-ink-muted">
          <Info size={13} className="mt-0.5 shrink-0" /> {txt.marketingNote}
        </p>
      )}
    </div>
  );
}
