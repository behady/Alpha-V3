"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { unitLabel } from "@/lib/stock/catalog";
import { stockApi } from "@/lib/stock/api";
import { deliveredBetween } from "@/lib/stock/math";
import { DrawerThumb } from "./CupboardView";
import { Btn, Card, CodeBadge, Eyebrow, LinePicture, Ltr, Stepper, fmtDate, linesOfDrawer, useBusy, variantLabel, type StockCtx } from "./shared";

/**
 * The weekly walk. Drawers in code order, one screen each, last count pre-filled; the assistant
 * changes only what moved. The whole walk is saved as one count, so a drawer confirmed with
 * "same as last week" is recorded at exactly that.
 */
export function CountView({ ctx, startDrawerCode }: { ctx: StockCtx; startDrawerCode: string | null }) {
  const { snap, t, ar, toast } = ctx;
  const drawers = snap.drawers;
  const startIdx = Math.max(0, drawers.findIndex((d) => d.code === startDrawerCode));
  const [i, setI] = useState(startIdx);
  const [values, setValues] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<null | { changed: number }>(null);
  const { busy, run } = useBusy();
  const lastCount = snap.counts[snap.counts.length - 1];
  const Back = ar ? ArrowRight : ArrowLeft;
  const Fwd = ar ? ArrowLeft : ArrowRight;

  const changes = useMemo(() => {
    const out: Array<{ lineId: string; before: number; after: number; delivered: number }> = [];
    for (const l of snap.lines) {
      const after = values[l.id];
      if (after == null || after === l.qty) continue;
      const delivered = lastCount ? deliveredBetween(snap.deliveries, l.variantId, l.drawerId, lastCount.date, ctx.today) : 0;
      out.push({ lineId: l.id, before: l.qty, after, delivered });
    }
    return out;
  }, [values, snap, lastCount, ctx.today]);

  if (!ctx.canEdit) return <Card className="p-6 text-sm text-ink-body">{t("Counting needs the “edit inventory” permission.", "العدّ محتاج صلاحية تعديل المخزون.")}</Card>;

  if (saved) {
    return (
      <Card className="grid gap-3 p-6">
        <Eyebrow>{t("Weekly count", "العدّ الأسبوعي")}</Eyebrow>
        <h2 className="font-display text-2xl font-bold text-ink">{t("Saved. Thank you.", "اتحفظ. شكراً.")}</h2>
        <p className="text-sm text-ink-body">
          {t(`${saved.changed} line${saved.changed === 1 ? "" : "s"} changed. Usage for the week is now computed from last count, deliveries and today's numbers.`, `${saved.changed} سطر اتغير. استهلاك الأسبوع اتحسب من آخر عدّ والتوريدات وأرقام النهارده.`)}
        </p>
        <div className="flex gap-2">
          <Btn kind="dark" onClick={() => ctx.go({ tab: "reports", drawer: null })}>{t("See usage →", "شوف الاستهلاك ←")}</Btn>
          <Btn onClick={() => ctx.go({ tab: "cupboard", drawer: null })}>{t("Back to the cupboard", "ارجع للدولاب")}</Btn>
        </div>
      </Card>
    );
  }

  if (i >= drawers.length) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>{t("Weekly count · review", "العدّ الأسبوعي · مراجعة")}</Eyebrow>
            <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">
              {changes.length} {t("lines changed", "سطر اتغير")}{lastCount ? ` ${t("since", "من")} ${fmtDate(lastCount.date, ar)}` : ""}
            </h2>
            <p className="mt-1 text-sm text-ink-body">{t("Everything else is confirmed as unchanged. “Used” is computed, not typed.", "الباقي اتأكد إنه زي ما هو. «المستخدم» محسوب مش مكتوب.")}</p>
          </div>
          <div className="flex gap-2">
            <Btn onClick={() => setI(drawers.length - 1)}><Back size={14} /> {t("Back", "رجوع")}</Btn>
            <Btn kind="yellow" busy={busy} onClick={() => run(async () => { const r = await stockApi.saveCount(ctx.today, values); ctx.setSnap(r.snapshot); setSaved({ changed: r.changed }); toast(t("Count saved.", "اتحفظ العدّ.")); }, (m) => toast(m, "error"))}>
              <Check size={15} /> {t("Save count", "احفظ العدّ")}
            </Btn>
          </div>
        </div>
        <Card className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-start font-display text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                <th className="px-3.5 py-2.5 text-start">{t("Drawer", "الدرج")}</th>
                <th className="px-3.5 py-2.5 text-start">{t("Item", "الصنف")}</th>
                <th className="px-3.5 py-2.5 text-end">{t("Last", "آخر")}</th>
                <th className="px-3.5 py-2.5 text-end">{t("Delivered", "اتورّد")}</th>
                <th className="px-3.5 py-2.5 text-end">{t("Today", "النهارده")}</th>
                <th className="px-3.5 py-2.5 text-end">{t("Used", "المستخدم")}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => {
                const l = snap.lines.find((x) => x.id === c.lineId)!;
                const d = ctx.drawers.get(l.drawerId);
                return (
                  <tr key={c.lineId} className="border-t border-line">
                    <td className="px-3.5 py-2 font-display font-bold">{d?.code}</td>
                    <td className="px-3.5 py-2">{variantLabel(ctx.variants.get(l.variantId), ctx.items.get(l.itemId), ar)}</td>
                    <td className="px-3.5 py-2 text-end font-display">{c.before}</td>
                    <td className="px-3.5 py-2 text-end font-display">{c.delivered || "—"}</td>
                    <td className="px-3.5 py-2 text-end"><span className="rounded-md bg-[#FACC15] px-1.5 font-display font-bold text-[#1A1206]">{c.after}</span></td>
                    <td className="px-3.5 py-2 text-end font-display">{Math.max(0, c.before + c.delivered - c.after)}</td>
                  </tr>
                );
              })}
              {!changes.length ? <tr><td colSpan={6} className="px-3.5 py-4 text-ink-muted">{t("No changes. Saving records that every drawer was checked today.", "مفيش تغييرات. الحفظ بيسجل إن كل الأدراج اتراجعت النهارده.")}</td></tr> : null}
            </tbody>
          </table>
        </Card>
      </div>
    );
  }

  const d = drawers[i];
  const lines = linesOfDrawer(snap, d.id);
  const sameAsLast = () => {
    const next = { ...values };
    for (const l of lines) delete next[l.id];
    setValues(next);
    setI(i + 1);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>{t("Weekly count", "العدّ الأسبوعي")} · {fmtDate(ctx.today, ar)} · {t("drawer", "درج")} {i + 1} {t("of", "من")} {drawers.length}</Eyebrow>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 font-display text-2xl font-bold tracking-tight text-ink">
            <CodeBadge code={d.code} big />
            <span>{ar ? d.nameAr : d.nameEn}</span>
          </h2>
          <p className="mt-1 text-sm text-ink-body">
            {ar ? d.roomAr : d.roomEn}{d.cabinetWhere ? ` · ${d.cabinetWhere}` : ""}. {t("Last count is filled in. Change only what moved; count boxes, not pieces.", "آخر عدّ متكتب. غيّر اللي اتحرك بس؛ عدّ العلب مش القطع.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {drawers.map((x, k) => <i key={x.id} className={`block h-1.5 w-5 rounded-full ${k < i ? "bg-ink" : k === i ? "bg-[#FACC15]" : "bg-line"}`} />)}
        </div>
      </div>

      {/* The drawer's real photo helps find the drawer; a drawn tray would only push the rows off a phone screen. */}
      <div className={`grid gap-4 ${d.photoUrl ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" : ""}`}>
        {d.photoUrl ? (
          <div className="h-36 overflow-hidden rounded-2xl border border-line bg-surface-subtle lg:h-auto lg:max-h-[320px]">
            <DrawerThumb ctx={ctx} drawer={d} large />
          </div>
        ) : null}
        <div className="grid content-start gap-2">
          {lines.map((l) => {
            const v = ctx.variants.get(l.variantId);
            const item = ctx.items.get(l.itemId);
            const cur = values[l.id] ?? l.qty;
            const chg = cur !== l.qty;
            return (
              <div key={l.id} className={`grid grid-cols-[56px_1fr_auto] items-center gap-3 rounded-xl border p-2 ${chg ? "border-[#FACC15] bg-surface-subtle" : "border-line bg-surface"}`}>
                <div className="h-11 w-14 overflow-hidden rounded-lg border border-line bg-surface-subtle"><LinePicture variant={v} item={item} /></div>
                <div className="min-w-0">
                  <b className="block text-[13.5px] font-semibold leading-snug text-ink">{v?.isGeneric ? (item ? (ar ? item.nameAr : item.nameEn) : "") : <Ltr>{variantLabel(v, item, ar)}</Ltr>}</b>
                  <span className="block text-[11.5px] text-ink-muted">
                    {v?.isGeneric ? "" : `${item ? (ar ? item.nameAr : item.nameEn) : ""} · `}
                    {t("count in", "عدّ بالـ")} {unitLabel(item?.unit || "box", 2, ar)} · {t("last", "آخر")} <b className="font-display">{l.qty}</b>
                  </span>
                </div>
                <Stepper value={cur} onChange={(n) => setValues({ ...values, [l.id]: n })} changed={chg} />
              </div>
            );
          })}
          {!lines.length ? <p className="text-sm text-ink-muted">{t("Nothing lives here yet.", "لسه مفيش حاجة هنا.")}</p> : null}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Btn onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}><Back size={14} /> {t("Previous", "السابق")}</Btn>
            <div className="flex gap-2">
              <Btn onClick={sameAsLast}>{t("Same as last week", "زي الأسبوع اللي فات")}</Btn>
              <Btn kind="dark" onClick={() => setI(i + 1)}>{i === drawers.length - 1 ? t("Review", "مراجعة") : t("Next drawer", "الدرج التالي")} <Fwd size={14} /></Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
