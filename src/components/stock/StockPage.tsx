"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { stockApi } from "@/lib/stock/api";
import { paceByItem, todayKey } from "@/lib/stock/math";
import type { StockSnapshot } from "@/lib/stock/types";
import type { StockCtx } from "./shared";
import { CupboardView } from "./CupboardView";
import { CountView } from "./CountView";
import { DeliveryView } from "./DeliveryView";
import { ReportsView } from "./ReportsView";
import { SetupView } from "./SetupView";

type Tab = "cupboard" | "count" | "delivery" | "reports" | "setup";
const TABS: Tab[] = ["cupboard", "count", "delivery", "reports", "setup"];

/**
 * The stock module. One snapshot of the clinic's cupboard is loaded through the API and every
 * screen reads from it; writes return the fresh snapshot, so nothing here subscribes to Firestore.
 */
export default function StockPage() {
  const { language } = useLanguage();
  const ar = language === "ar";
  const { showToast } = useUI();
  const { clinicId, isAdmin } = useClinic();
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  const [snap, setSnap] = useState<StockSnapshot | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const fresh = await stockApi.snapshot();
      setSnap(fresh);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the cupboard.");
    }
  }, []);

  // A clinic switch remounts the page (the layout keys it on clinicId), so one load per mount.
  useEffect(() => {
    if (!clinicId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one fetch per mount; the result lands asynchronously
    void load();
  }, [clinicId, load]);

  const tabParam = params.get("tab") as Tab | null;
  const hasCupboard = (snap?.drawers.length ?? 0) > 0;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : hasCupboard ? "cupboard" : "setup";

  const go = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      router.push(`/inventory${next.toString() ? `?${next.toString()}` : ""}`);
    },
    [params, router]
  );

  const perms = useMemo(() => user?.permissions ?? [], [user?.permissions]);
  const ctx = useMemo<StockCtx | null>(() => {
    if (!snap) return null;
    const pace = new Map(paceByItem({ items: snap.items, lines: snap.lines, counts: snap.counts, deliveries: snap.deliveries }).map((p) => [p.itemId, p]));
    return {
      snap,
      setSnap,
      drawers: new Map(snap.drawers.map((d) => [d.id, d])),
      items: new Map(snap.items.map((i) => [i.id, i])),
      variants: new Map(snap.variants.map((v) => [v.id, v])),
      pace,
      ar,
      t: (en: string, arText: string) => (ar ? arText : en),
      toast: showToast,
      canEdit: isAdmin || perms.includes("inventory.edit"),
      canStructure: isAdmin || perms.includes("inventory.add"),
      go,
      today: todayKey(),
    };
  }, [snap, ar, showToast, isAdmin, perms, go]);

  const t = (en: string, arText: string) => (ar ? arText : en);
  const labels: Record<Tab, string> = {
    cupboard: t("Cupboard", "الدولاب"),
    count: t("Weekly count", "العدّ الأسبوعي"),
    delivery: t("Delivery", "توريد"),
    reports: t("Reports", "التقارير"),
    setup: t("Setup", "الإعداد"),
  };

  return (
    <div className="min-h-full pb-24" dir={ar ? "rtl" : "ltr"}>
      <PageHeader title={t("Stock", "المخزون")} subtitle={t("Every item has one home, and the home has a code.", "كل صنف له مكان واحد، والمكان له كود.")} compact />
      <div className="mx-auto w-full max-w-[1200px] px-4 pt-4 md:px-6">
        <nav className="mb-4 flex gap-1 overflow-x-auto rounded-2xl border border-line bg-surface p-1" aria-label={t("Stock sections", "أقسام المخزون")}>
          {TABS.map((k) => {
            if (k === "setup" && !ctx?.canStructure) return null;
            const on = tab === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => go({ tab: k, drawer: null, count: null })}
                className={`relative shrink-0 rounded-xl px-3.5 py-2 font-display text-[13px] font-bold transition-colors ${on ? "bg-ink text-white" : "text-ink-body hover:bg-surface-subtle"}`}
                aria-current={on ? "page" : undefined}
              >
                {labels[k]}
              </button>
            );
          })}
        </nav>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
        ) : !ctx ? (
          <div className="grid place-items-center py-24 text-ink-muted">
            <Loader2 className="animate-spin" />
          </div>
        ) : tab === "setup" ? (
          <SetupView ctx={ctx} />
        ) : !hasCupboard ? (
          <SetupView ctx={ctx} />
        ) : tab === "count" ? (
          <CountView ctx={ctx} startDrawerCode={params.get("drawer")} />
        ) : tab === "delivery" ? (
          <DeliveryView ctx={ctx} />
        ) : tab === "reports" ? (
          <ReportsView ctx={ctx} />
        ) : (
          <CupboardView ctx={ctx} drawerCode={params.get("drawer")} />
        )}
      </div>
    </div>
  );
}
