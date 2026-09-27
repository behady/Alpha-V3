"use client";

import { useMemo } from "react";
import { Bars, ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";
import { DataTable, Note, Num, SectionTitle, fmt } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { inventoryStats, type InventoryLine } from "@/lib/reports/opsStats";
import { summarizeLedger as ledgerTotals } from "@/lib/reports/ledgerStats";

/**
 * The stockroom: what it is worth, what was used, and what to order.
 *
 * Consumption is what was logged with the +/− buttons on the Inventory page in this period;
 * nothing deducts stock from treatments automatically, so the "used" figure is only as good as
 * the logging. The reorder list is items at or under their threshold, with a quantity that gets
 * them back to twice it.
 */
export default function InventoryReport({ ledger, isAr, data }: ReportProps) {
  const s = useMemo(() => inventoryStats(data.inventory || [], data.inventoryTx || []), [data.inventory, data.inventoryTx]);
  const income = useMemo(() => ledgerTotals(ledger).income, [ledger]);
  const egp = isAr ? "ج.م" : "EGP";
  const share = income > 0 ? (s.usedCost / income) * 100 : null;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(s.stockValue)} ${egp}`} label={isAr ? "قيمة المخزون" : "Stock value"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(s.usedCost)} ${egp}`} label={`${isAr ? "استهلاك الفترة" : "Used this period"}${share !== null ? ` · ${share.toFixed(1)}%` : ""}`} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.belowMin)} label={isAr ? "تحت الحد" : "Below threshold"} tone={s.belowMin > 0 ? "bad" : "muted"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.items)} label={isAr ? "صنف" : "Items"} tone="muted" /></div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartFrame title={isAr ? "أكتر الأصناف استهلاكاً" : "Most used, by cost"} note={isAr ? "في الفترة دي." : "In this period."}>
          <Bars rows={s.lines.filter((l) => l.usedCost > 0).slice(0, 8).map((l, i) => ({ label: `${l.name} · ${l.used} ${l.unit}`, value: l.usedCost, text: `${fmt(l.usedCost)} ${egp}`, color: i === 0 ? MARK : INK }))} />
        </ChartFrame>
        <ChartFrame title={isAr ? "قيمة المخزون حسب التصنيف" : "Stock value by category"}>
          <Bars rows={s.byCategory.slice(0, 8).map((c, i) => ({ label: `${c.category} · ${c.items}`, value: c.value, text: `${fmt(c.value)} ${egp}${c.below ? ` · ${c.below} ${isAr ? "تحت الحد" : "low"}` : ""}`, color: i === 0 ? MARK : INK, warn: false }))} />
        </ChartFrame>
      </div>

      <section>
        <SectionTitle>{isAr ? `قائمة الطلب (${s.reorder.length})` : `Reorder list (${s.reorder.length})`}</SectionTitle>
        <DataTable<InventoryLine>
          isAr={isAr}
          rows={s.reorder}
          rowKey={(l) => l.itemId}
          exportName="Inventory_Reorder"
          dense
          emptyText={isAr ? "كل الأصناف فوق الحد." : "Everything is above its threshold."}
          columns={[
            { key: "name", label: isAr ? "الصنف" : "Item", render: (l) => <span className="text-[13px] font-bold text-ink">{l.name}</span> },
            { key: "category", label: isAr ? "التصنيف" : "Category" },
            { key: "stock", label: isAr ? "المتاح" : "In stock", align: "end", render: (l) => <span className="font-figure text-[12.5px] font-bold text-danger">{l.stock} {l.unit}</span> },
            { key: "minStock", label: isAr ? "الحد" : "Threshold", align: "end", render: (l) => <Num v={l.minStock} muted /> },
            { key: "reorderQty", label: isAr ? "اطلب" : "Order", align: "end", render: (l) => <Num v={l.reorderQty} bold /> },
            { key: "cost", label: isAr ? "تكلفة الطلب" : "Order cost", align: "end", render: (l) => <Num v={l.reorderQty * l.costPerUnit} />, exportValue: (l) => Number((l.reorderQty * l.costPerUnit).toFixed(2)), total: <Num v={s.reorder.reduce((t, l) => t + l.reorderQty * l.costPerUnit, 0)} bold /> },
          ]}
        />
      </section>

      <section>
        <SectionTitle>{isAr ? "كل الأصناف" : "Every item"}</SectionTitle>
        <DataTable<InventoryLine>
          isAr={isAr}
          rows={s.lines}
          rowKey={(l) => l.itemId}
          exportName="Inventory"
          dense
          maxRows={100}
          columns={[
            { key: "name", label: isAr ? "الصنف" : "Item", render: (l) => <span className={`text-[13px] font-bold ${l.below ? "text-danger" : "text-ink"}`}>{l.name}</span> },
            { key: "category", label: isAr ? "التصنيف" : "Category" },
            { key: "stock", label: isAr ? "المتاح" : "In stock", align: "end", render: (l) => <span className={`font-figure text-[12.5px] ${l.below ? "font-bold text-danger" : "text-ink-body"}`}>{l.stock} {l.unit}</span> },
            { key: "costPerUnit", label: isAr ? "سعر الوحدة" : "Unit cost", align: "end", render: (l) => <Num v={l.costPerUnit} muted /> },
            { key: "value", label: isAr ? "القيمة" : "Value", align: "end", render: (l) => <Num v={l.value} />, total: <Num v={s.stockValue} bold /> },
            { key: "used", label: isAr ? "استُهلك" : "Used", align: "end", render: (l) => <Num v={l.used} muted={l.used === 0} /> },
            { key: "usedCost", label: isAr ? "تكلفة الاستهلاك" : "Used cost", align: "end", render: (l) => <Num v={l.usedCost} bold muted={l.usedCost === 0} />, total: <Num v={s.usedCost} bold /> },
            { key: "added", label: isAr ? "اتضاف" : "Added", align: "end", render: (l) => <Num v={l.added} muted /> },
          ]}
        />
        <Note>
          {isAr
            ? "الاستهلاك = اللي اتسجل بزرار الناقص في صفحة المخزون خلال الفترة. العلاجات مبتخصمش من المخزون لوحدها، فالرقم على قدر التسجيل."
            : "Used is what was logged with the minus button on the Inventory page during the period. Treatments do not deduct stock on their own, so this figure is only as good as the logging."}
        </Note>
      </section>
    </div>
  );
}
