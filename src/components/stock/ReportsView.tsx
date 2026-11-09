"use client";

import { useMemo, useState } from "react";
import { MessageCircle } from "lucide-react";
import { unitLabel } from "@/lib/stock/catalog";
import { addDays, daysLabel, lastPrice, paceByItem, shoppingList, sortCounts, usageByItem, variance } from "@/lib/stock/math";
import { Btn, Card, Eyebrow, LinePicture, Pill, fmtDate, fmtMoney, inputCls, variantLabel, type StockCtx } from "./shared";

type Tab = "usage" | "days" | "shop" | "buy" | "var" | "trace";

/** Everything here is arithmetic on three logs: deliveries, counts, items used on patients. */
export function ReportsView({ ctx }: { ctx: StockCtx }) {
  const { snap, t, ar } = ctx;
  const [tab, setTab] = useState<Tab>("usage");
  const [weeks, setWeeks] = useState(4);
  const [by, setBy] = useState<"item" | "room">("item");
  const [q, setQ] = useState("");
  const counts = useMemo(() => sortCounts(snap.counts), [snap.counts]);
  const usage = useMemo(() => usageByItem({ items: snap.items, variants: snap.variants, lines: snap.lines, counts: snap.counts, deliveries: snap.deliveries, weeks }), [snap, weeks]);
  const pace = useMemo(() => paceByItem({ items: snap.items, lines: snap.lines, counts: snap.counts, deliveries: snap.deliveries }), [snap]);
  const shop = useMemo(() => shoppingList({ pace, variants: snap.variants, lines: snap.lines, deliveries: snap.deliveries }), [pace, snap]);
  const tabs: Array<[Tab, string]> = [
    ["usage", t("Usage", "الاستهلاك")],
    ["days", t("Days left", "الأيام الباقية")],
    ["shop", t("Shopping list", "قائمة الشراء")],
    ["buy", t("Purchases", "المشتريات")],
    ["var", t("Variance", "الفروق")],
    ["trace", t("Traceability", "التتبع")],
  ];
  const totalCost = usage.reduce((a, r) => a + r.cost, 0);
  const windowCounts = counts.slice(-(weeks + 1));

  return (
    <div className="grid gap-4">
      <div>
        <Eyebrow>{t("Reports", "التقارير")}</Eyebrow>
        <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">{t("Everything here is arithmetic on three logs.", "كل اللي هنا حساب على تلات سجلات.")}</h2>
        <p className="mt-1 text-sm text-ink-body">{t("Deliveries, weekly counts, and items used on patients. Nobody typed a usage number.", "التوريدات، العدّ الأسبوعي، والأصناف اللي اتستخدمت لمرضى. محدش كتب رقم استهلاك.")}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k} className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${tab === k ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-body"}`}>{l}</button>
        ))}
      </div>

      {counts.length < 2 && tab !== "buy" && tab !== "trace" ? (
        <Card className="p-4 text-sm text-ink-body">
          {t("Usage needs two counts. The first count sets the starting point; from the second Thursday on, every report here fills in by itself.", "الاستهلاك محتاج عدّتين. أول عدّ بيحدد نقطة البداية؛ من الخميس التاني وكل التقارير هنا هتتملي لوحدها.")}
        </Card>
      ) : null}

      {tab === "usage" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex overflow-hidden rounded-xl border border-line text-[12px] font-semibold">
              {[4, 8, 12].map((n) => <button key={n} type="button" onClick={() => setWeeks(n)} className={`px-3 py-1.5 ${weeks === n ? "bg-ink text-white" : "text-ink-body"}`}>{t(`Last ${n} weeks`, `آخر ${n} أسابيع`)}</button>)}
            </div>
            <div className="inline-flex overflow-hidden rounded-xl border border-line text-[12px] font-semibold">
              <button type="button" onClick={() => setBy("item")} className={`px-3 py-1.5 ${by === "item" ? "bg-ink text-white" : "text-ink-body"}`}>{t("By item", "بالصنف")}</button>
              <button type="button" onClick={() => setBy("room")} className={`px-3 py-1.5 ${by === "room" ? "bg-ink text-white" : "text-ink-body"}`}>{t("By room", "بالغرفة")}</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card className="p-3.5"><Eyebrow>{t("Materials used", "مواد اتستخدمت")}</Eyebrow><div className="mt-1 font-display text-2xl font-bold text-ink">{fmtMoney(totalCost)} <small className="text-xs font-semibold text-ink-muted">EGP</small></div><div className="text-[11.5px] text-ink-muted">{windowCounts.length ? `${fmtDate(windowCounts[0].date, ar)} – ${fmtDate(windowCounts[windowCounts.length - 1].date, ar)}` : "—"}</div></Card>
            <Card className="p-3.5"><Eyebrow>{t("Per week", "في الأسبوع")}</Eyebrow><div className="mt-1 font-display text-2xl font-bold text-ink">{fmtMoney(windowCounts.length > 1 ? totalCost / (windowCounts.length - 1) : 0)} <small className="text-xs font-semibold text-ink-muted">EGP</small></div><div className="text-[11.5px] text-ink-muted">{t("at last purchase prices", "بآخر أسعار الشراء")}</div></Card>
            <Card className="col-span-2 p-3.5">
              <Eyebrow>{t("Week by week · EGP", "أسبوع بأسبوع · جنيه")}</Eyebrow>
              <WeekBars ctx={ctx} usage={usage} counts={windowCounts} />
            </Card>
          </div>
          {by === "item" ? (
            <Card className="overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead><tr className="font-display text-[11px] uppercase tracking-[0.08em] text-ink-muted"><th className="px-3.5 py-2.5 text-start">{t("Item", "الصنف")}</th><th className="px-3.5 py-2.5 text-end">{t("Used", "المستخدم")}</th><th className="px-3.5 py-2.5 text-end">EGP</th><th className="px-3.5 py-2.5 text-start">{t("Share", "النسبة")}</th><th className="px-3.5 py-2.5 text-end">{t("Per week", "في الأسبوع")}</th></tr></thead>
                <tbody>
                  {usage.map((r) => {
                    const item = ctx.items.get(r.itemId);
                    const brands = [...new Set(snap.variants.filter((v) => v.itemId === r.itemId && !v.isGeneric).map((v) => v.brand))];
                    return (
                      <tr key={r.itemId} className="border-t border-line">
                        <td className="px-3.5 py-2"><b>{item ? (ar ? item.nameAr : item.nameEn) : ""}</b> <span className="text-ink-muted">{item ? (ar ? item.nameEn : item.nameAr) : ""}</span>{brands.length ? <><br /><span className="text-[11.5px] text-ink-muted">{brands.join(", ")}</span></> : null}</td>
                        <td className="px-3.5 py-2 text-end font-display font-semibold">{r.used} {unitLabel(item?.unit || "box", r.used, ar)}</td>
                        <td className="px-3.5 py-2 text-end font-display font-semibold">{fmtMoney(r.cost)}</td>
                        <td className="px-3.5 py-2"><Bar frac={totalCost ? r.cost / totalCost : 0} label={`${Math.round(totalCost ? (r.cost / totalCost) * 100 : 0)}%`} /></td>
                        <td className="px-3.5 py-2 text-end font-display text-ink-muted">{r.perWeek.length ? (r.used / r.perWeek.length).toFixed(1) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          ) : (
            <RoomUsage ctx={ctx} weeks={weeks} />
          )}
        </>
      ) : null}

      {tab === "days" ? (
        <Card className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead><tr className="font-display text-[11px] uppercase tracking-[0.08em] text-ink-muted"><th className="px-3.5 py-2.5 text-start">{t("Item", "الصنف")}</th><th className="px-3.5 py-2.5 text-end">{t("On hand", "موجود")}</th><th className="px-3.5 py-2.5 text-end">{t("Pace / week", "المعدل / أسبوع")}</th><th className="px-3.5 py-2.5 text-start">{t("Days left", "الأيام الباقية")}</th><th className="px-3.5 py-2.5 text-start">{t("Runs out", "هيخلص")}</th></tr></thead>
            <tbody>
              {pace.map((p) => {
                const item = ctx.items.get(p.itemId);
                const low = p.daysLeft != null && p.daysLeft < 14;
                return (
                  <tr key={p.itemId} className="border-t border-line">
                    <td className="px-3.5 py-2"><b>{item ? (ar ? item.nameAr : item.nameEn) : ""}</b> <span className="text-ink-muted">{item ? (ar ? item.nameEn : item.nameAr) : ""}</span></td>
                    <td className="px-3.5 py-2 text-end font-display font-semibold">{p.onHand} {unitLabel(item?.unit || "box", p.onHand, ar)}</td>
                    <td className="px-3.5 py-2 text-end font-display">{p.pace.toFixed(1)}</td>
                    <td className="px-3.5 py-2"><Bar frac={Math.min(1, (p.daysLeft ?? 60) / 60)} label={daysLabel(p.daysLeft, ar)} yellow={low} /></td>
                    <td className="px-3.5 py-2 text-ink-muted">{p.daysLeft == null ? "—" : fmtDate(addDays(ctx.today, Math.round(p.daysLeft)), ar)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="p-3 text-xs text-ink-muted">{t("Pace is the average of the last three weekly counts. Yellow is under 14 days.", "المعدل هو متوسط آخر تلات عدّات أسبوعية. الأصفر تحت 14 يوم.")}</p>
        </Card>
      ) : null}

      {tab === "shop" ? <Shopping ctx={ctx} shop={shop} /> : null}

      {tab === "buy" ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Object.entries(snap.deliveries.reduce<Record<string, number>>((acc, d) => { acc[d.supplier] = (acc[d.supplier] || 0) + d.total; return acc; }, {})).sort((a, b) => b[1] - a[1]).map(([s, tot]) => (
              <Card key={s} className="p-3.5"><Eyebrow>{s}</Eyebrow><div className="mt-1 font-display text-xl font-bold text-ink">{fmtMoney(tot)} <small className="text-xs font-semibold text-ink-muted">EGP</small></div></Card>
            ))}
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead><tr className="font-display text-[11px] uppercase tracking-[0.08em] text-ink-muted"><th className="px-3.5 py-2.5 text-start">{t("Date", "التاريخ")}</th><th className="px-3.5 py-2.5 text-start">{t("Supplier", "المورّد")}</th><th className="px-3.5 py-2.5 text-start">{t("Lines", "السطور")}</th><th className="px-3.5 py-2.5 text-end">EGP</th></tr></thead>
              <tbody>
                {[...snap.deliveries].reverse().map((d) => (
                  <tr key={d.id} className="border-t border-line align-top">
                    <td className="px-3.5 py-2 font-display">{fmtDate(d.date, ar)}</td>
                    <td className="px-3.5 py-2"><b>{d.supplier}</b>{d.invoiceUrl ? <> · <a className="underline" href={d.invoiceUrl} target="_blank" rel="noreferrer">{t("invoice", "الفاتورة")}</a></> : null}<br /><span className="text-[11.5px] text-ink-muted">{d.byName}</span></td>
                    <td className="px-3.5 py-2 text-[12.5px]">{d.lines.map((l, k) => <div key={k}>{l.qty}× {variantLabel(ctx.variants.get(l.variantId), ctx.items.get(ctx.variants.get(l.variantId)?.itemId || ""), ar)} → {ctx.drawers.get(l.drawerId)?.code}</div>)}</td>
                    <td className="px-3.5 py-2 text-end font-display font-semibold">{fmtMoney(d.total)}</td>
                  </tr>
                ))}
                {!snap.deliveries.length ? <tr><td colSpan={4} className="px-3.5 py-4 text-ink-muted">{t("No deliveries yet.", "لسه مفيش توريدات.")}</td></tr> : null}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}

      {tab === "var" ? (
        <Card className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead><tr className="font-display text-[11px] uppercase tracking-[0.08em] text-ink-muted"><th className="px-3.5 py-2.5 text-start">{t("Tracked item", "صنف متتبع")}</th><th className="px-3.5 py-2.5 text-start">{t("Drawer", "الدرج")}</th><th className="px-3.5 py-2.5 text-end">{t("Start", "البداية")}</th><th className="px-3.5 py-2.5 text-end">{t("Delivered", "اتورّد")}</th><th className="px-3.5 py-2.5 text-end">{t("Gone", "خرج")}</th><th className="px-3.5 py-2.5 text-end">{t("On patients", "لمرضى")}</th><th className="px-3.5 py-2.5 text-end">{t("Gap", "الفرق")}</th><th className="px-3.5 py-2.5 text-end">EGP</th></tr></thead>
            <tbody>
              {variance({ lines: snap.lines, counts: snap.counts, deliveries: snap.deliveries, uses: snap.uses, trackedItemIds: new Set(snap.items.filter((i) => i.tracked).map((i) => i.id)) }).map((r) => {
                const v = ctx.variants.get(r.variantId);
                const price = lastPrice(v, snap.deliveries);
                return (
                  <tr key={r.variantId + r.drawerId} className="border-t border-line">
                    <td className="px-3.5 py-2"><b>{variantLabel(v, ctx.items.get(v?.itemId || ""), ar)}</b></td>
                    <td className="px-3.5 py-2 font-display">{ctx.drawers.get(r.drawerId)?.code}</td>
                    <td className="px-3.5 py-2 text-end font-display">{r.start}</td>
                    <td className="px-3.5 py-2 text-end font-display">{r.delivered || "—"}</td>
                    <td className="px-3.5 py-2 text-end font-display">{r.gone}</td>
                    <td className="px-3.5 py-2 text-end font-display">{r.usedOnPatients}</td>
                    <td className={`px-3.5 py-2 text-end font-display font-bold ${r.gap > 0 ? "text-red-700" : "text-emerald-700"}`}>{r.gap > 0 ? `−${r.gap}` : r.gap < 0 ? `+${-r.gap}` : "0"}</td>
                    <td className={`px-3.5 py-2 text-end font-display ${r.gap > 0 ? "font-bold text-red-700" : ""}`}>{r.gap > 0 && price ? fmtMoney(r.gap * price) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="p-3 text-xs text-ink-muted">{t("Gone = start + delivered − on the shelf now. The report says which drawer and since when; it never says who.", "خرج = البداية + اتورّد − الموجود دلوقتي. التقرير بيقول أي درج ومن إمتى؛ عمره ما بيقول مين.")}</p>
        </Card>
      ) : null}

      {tab === "trace" ? (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Patient name or lot number", "اسم المريض أو رقم التشغيلة")} className={`${inputCls} max-w-sm`} />
          <Card className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead><tr className="font-display text-[11px] uppercase tracking-[0.08em] text-ink-muted"><th className="px-3.5 py-2.5 text-start">{t("Date", "التاريخ")}</th><th className="px-3.5 py-2.5 text-start">{t("Patient", "المريض")}</th><th className="px-3.5 py-2.5 text-start">{t("Item", "الصنف")}</th><th className="px-3.5 py-2.5 text-start">{t("Lot", "التشغيلة")}</th><th className="px-3.5 py-2.5 text-start">{t("Drawer", "الدرج")}</th><th className="px-3.5 py-2.5 text-start">{t("By", "بواسطة")}</th></tr></thead>
              <tbody>
                {snap.uses.filter((u) => !q.trim() || `${u.patientName} ${u.lot} ${variantLabel(ctx.variants.get(u.variantId), undefined, false)}`.toLowerCase().includes(q.toLowerCase())).map((u) => (
                  <tr key={u.id} className="border-t border-line">
                    <td className="px-3.5 py-2 font-display">{fmtDate(u.date, ar)}</td>
                    <td className="px-3.5 py-2"><b>{u.patientName}</b></td>
                    <td className="px-3.5 py-2">{variantLabel(ctx.variants.get(u.variantId), ctx.items.get(ctx.variants.get(u.variantId)?.itemId || ""), ar)}</td>
                    <td className="px-3.5 py-2 font-display">{u.lot || "—"}</td>
                    <td className="px-3.5 py-2 font-display">{ctx.drawers.get(u.drawerId)?.code}</td>
                    <td className="px-3.5 py-2 text-ink-muted">{u.byName}</td>
                  </tr>
                ))}
                {!snap.uses.length ? <tr><td colSpan={6} className="px-3.5 py-4 text-ink-muted">{t("Nothing recorded on a patient yet.", "لسه مفيش حاجة اتسجلت لمريض.")}</td></tr> : null}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Bar({ frac, label, yellow = false }: { frac: number; label: string; yellow?: boolean }) {
  return (
    <div className="flex min-w-[120px] items-center gap-2">
      <i className={`block h-2 rounded-full ${yellow ? "bg-[#FACC15]" : "bg-ink-body"}`} style={{ width: `${Math.max(2, Math.min(100, frac * 100)) * 1.4}px` }} />
      <span className="whitespace-nowrap text-[12px] text-ink-muted">{label}</span>
    </div>
  );
}

function WeekBars({ ctx, usage, counts }: { ctx: StockCtx; usage: ReturnType<typeof usageByItem>; counts: ReturnType<typeof sortCounts> }) {
  const { ar } = ctx;
  const n = Math.max(0, counts.length - 1);
  const totals: number[] = [];
  for (let k = 0; k < n; k++) {
    let c = 0;
    for (const r of usage) {
      const perUnit = r.used ? r.cost / r.used : 0;
      c += (r.perWeek[k] || 0) * perUnit;
    }
    totals.push(c);
  }
  const max = Math.max(1, ...totals);
  if (!n) return <p className="mt-2 text-xs text-ink-muted">—</p>;
  return (
    <div className="mt-2 flex h-[84px] items-end gap-1.5">
      {totals.map((c, k) => (
        <div key={k} className="grid flex-1 content-end gap-1 text-center" title={`${fmtDate(counts[k + 1].date, ar)}: ${fmtMoney(c)} EGP`}>
          <b className="font-display text-[11px] font-bold text-ink">{c >= 1000 ? `${(c / 1000).toFixed(1)}k` : fmtMoney(c)}</b>
          <i className={`block rounded-t ${k === totals.length - 1 ? "bg-[#FACC15]" : "bg-ink-body"}`} style={{ height: `${Math.max(2, (c / max) * 48)}px` }} />
          <span className="whitespace-nowrap text-[10px] text-ink-muted">{fmtDate(counts[k + 1].date, ar)}</span>
        </div>
      ))}
    </div>
  );
}

function RoomUsage({ ctx, weeks }: { ctx: StockCtx; weeks: number }) {
  const { snap, t, ar } = ctx;
  const counts = sortCounts(snap.counts).slice(-(weeks + 1));
  const byRoom = new Map<string, { en: string; ar: string; cost: number }>();
  const deliveries = [...snap.deliveries].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const l of snap.lines) {
    const d = ctx.drawers.get(l.drawerId);
    if (!d) continue;
    const item = ctx.items.get(l.itemId);
    if (item?.tracked) continue;
    const r = byRoom.get(d.roomCode) || { en: d.roomEn, ar: d.roomAr, cost: 0 };
    for (let k = 1; k < counts.length; k++) {
      const before = counts[k - 1].snapshot[l.id] ?? 0;
      const after = counts[k].snapshot[l.id] ?? 0;
      let delivered = 0;
      for (const dv of deliveries) if (dv.date > counts[k - 1].date && dv.date <= counts[k].date) for (const x of dv.lines) if (x.variantId === l.variantId && x.drawerId === l.drawerId) delivered += x.qty;
      r.cost += Math.max(0, before + delivered - after) * lastPrice(ctx.variants.get(l.variantId), deliveries);
    }
    byRoom.set(d.roomCode, r);
  }
  const rows = [...byRoom.entries()].sort((a, b) => b[1].cost - a[1].cost);
  const total = rows.reduce((a, r) => a + r[1].cost, 0);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-[13.5px]">
        <thead><tr className="font-display text-[11px] uppercase tracking-[0.08em] text-ink-muted"><th className="px-3.5 py-2.5 text-start">{t("Room", "الغرفة")}</th><th className="px-3.5 py-2.5 text-end">EGP</th><th className="px-3.5 py-2.5 text-start">{t("Share", "النسبة")}</th></tr></thead>
        <tbody>
          {rows.map(([code, r]) => (
            <tr key={code} className="border-t border-line"><td className="px-3.5 py-2"><b>{code}</b> · {ar ? r.ar : r.en}</td><td className="px-3.5 py-2 text-end font-display font-semibold">{fmtMoney(r.cost)}</td><td className="px-3.5 py-2"><Bar frac={total ? r.cost / total : 0} label={`${Math.round(total ? (r.cost / total) * 100 : 0)}%`} /></td></tr>
          ))}
        </tbody>
      </table>
      <p className="p-3 text-xs text-ink-muted">{t("The Store counts as a room. Material moved from the Store to a chair nets out, so the total is true even when boxes are transferred mid-week.", "المخزن بيتحسب غرفة. اللي اتنقل من المخزن للكرسي بيتصفّى، فالإجمالي صح حتى لو العلب اتنقلت وسط الأسبوع.")}</p>
    </Card>
  );
}

function Shopping({ ctx, shop }: { ctx: StockCtx; shop: ReturnType<typeof shoppingList> }) {
  const { snap, t, ar } = ctx;
  const bySup = new Map<string, typeof shop>();
  for (const s of shop) bySup.set(s.supplier, [...(bySup.get(s.supplier) || []), s]);
  if (!shop.length) return <Card className="p-4 text-sm text-ink-muted">{t("Nothing under 14 days. Nothing to order.", "مفيش حاجة تحت 14 يوم. مفيش حاجة تتطلب.")}</Card>;
  return (
    <div className="grid gap-3">
      {[...bySup.entries()].map(([sup, rows]) => {
        const text = [`${t("Order for", "طلبية لـ")} ${snap.drawers[0]?.roomEn ? "" : ""}${sup}:`, ...rows.map((r) => { const item = ctx.items.get(r.itemId); return `• ${r.need} ${unitLabel(item?.unit || "box", r.need, ar)} ${variantLabel(r.variant || undefined, item, ar)}`; })].join("\n");
        const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
        const tot = rows.reduce((a, r) => a + r.need * lastPrice(r.variant || undefined, snap.deliveries), 0);
        return (
          <Card key={sup} className="grid gap-3 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-[15px] font-bold text-ink">{sup}</h3>
              <span className="text-[12px] text-ink-muted">{rows.length} {t("lines", "سطر")} · ~{fmtMoney(tot)} EGP</span>
            </div>
            <div className="grid gap-1.5">
              {rows.map((r) => {
                const item = ctx.items.get(r.itemId);
                return (
                  <div key={r.itemId} className="grid grid-cols-[56px_1fr_auto] items-center gap-3 rounded-xl border border-line p-2">
                    <div className="h-11 w-14 overflow-hidden rounded-lg border border-line bg-surface-subtle"><LinePicture variant={r.variant || undefined} item={item} /></div>
                    <div className="min-w-0">
                      <b className="block truncate text-[13.5px] font-semibold text-ink">{item ? (ar ? item.nameAr : item.nameEn) : ""}{r.variant && !r.variant.isGeneric ? ` · ${variantLabel(r.variant, item, ar)}` : ""}</b>
                      <span className="block text-[11.5px] text-ink-muted">{r.onHand} {t("left", "باقي")} · {daysLabel(r.daysLeft, ar)}{r.variant?.supplier ? ` · ${t("last bought from", "آخر مرة من")} ${r.variant.supplier}` : ""} {r.daysLeft != null && r.daysLeft < 7 ? <Pill yellow>{t("urgent", "عاجل")}</Pill> : null}</span>
                    </div>
                    <div className="text-end"><b className="font-display text-xl font-black text-ink">{r.need}</b> <span className="text-[11px] text-ink-muted">{unitLabel(item?.unit || "box", r.need, ar)}</span></div>
                  </div>
                );
              })}
            </div>
            <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 justify-self-start rounded-xl bg-ink px-4 py-2.5 font-display text-[13px] font-bold text-white"><MessageCircle size={15} /> {t("Send on WhatsApp", "ابعت على واتساب")}</a>
          </Card>
        );
      })}
      <p className="text-xs text-ink-muted">{t("Quantity is four weeks of pace minus what is on hand. The brand is whichever you bought last.", "الكمية = أربع أسابيع بالمعدل ناقص الموجود. الماركة هي آخر اللي اشتريته.")}</p>
      <Btn className="hidden">{""}</Btn>
    </div>
  );
}
