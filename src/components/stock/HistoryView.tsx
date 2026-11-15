"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { stockApi } from "@/lib/stock/api";
import { EVENT_GROUP, GROUP_LABEL, describeEvent, eventSubject, type EventGroup } from "@/lib/stock/history";
import type { StockEvent } from "@/lib/stock/types";
import { Btn, Card, Ltr, inputCls, type StockCtx } from "./shared";

/**
 * Who did what, and when. Every count, delivery, patient use, write-off, edit, move and layout
 * change, newest first, with the person's name and the time to the minute. Filters narrow it by
 * kind of action, by person, by date and by a word; Excel takes exactly what is on screen.
 */
export function HistoryView({ ctx }: { ctx: StockCtx }) {
  const { t, ar, toast } = ctx;
  const [events, setEvents] = useState<StockEvent[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<EventGroup | "all">("all");
  const [person, setPerson] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(
    async (beforeMs?: number) => {
      setLoading(true);
      try {
        const r = await stockApi.history(beforeMs);
        setEvents((prev) => {
          const seen = new Set(beforeMs ? prev.map((e) => e.id) : []);
          return [...(beforeMs ? prev : []), ...r.events.filter((e) => !seen.has(e.id))];
        });
        setMore(r.more);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not load the history.", "error");
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const people = useMemo(() => [...new Set(events.map((e) => e.byName).filter(Boolean))].sort(), [events]);
  const day = (e: StockEvent) => localDay(e.atMs);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (group !== "all" && EVENT_GROUP[e.type] !== group) return false;
      if (person !== "all" && e.byName !== person) return false;
      if (from && day(e) < from) return false;
      if (to && day(e) > to) return false;
      if (needle && !`${describeEvent(e, true)} ${describeEvent(e, false)} ${e.byName}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [events, group, person, from, to, q]);

  const when = (ms: number) => new Date(ms).toLocaleString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const exportExcel = async () => {
    setExporting(true);
    try {
      const { default: XLSX } = await import("xlsx-js-style");
      const rows = shown.map((e) => {
        const d = new Date(e.atMs);
        return {
          [t("Date", "التاريخ")]: localDay(e.atMs),
          [t("Time", "الوقت")]: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
          [t("User", "المستخدم")]: e.byName,
          [t("Role", "الدور")]: e.byRole,
          [t("Kind", "النوع")]: ar ? GROUP_LABEL[EVENT_GROUP[e.type]].ar : GROUP_LABEL[EVENT_GROUP[e.type]].en,
          [t("Item", "الصنف")]: eventSubject(e, ar),
          [t("Drawer", "الدرج")]: e.drawerCode || "",
          [t("Before", "قبل")]: e.qtyBefore ?? "",
          [t("After", "بعد")]: e.qtyAfter ?? "",
          [t("Quantity", "الكمية")]: e.qty ?? "",
          [t("Price", "السعر")]: e.price ?? "",
          [t("Supplier", "المورّد")]: e.supplier || "",
          [t("Patient", "المريض")]: e.patientName || "",
          [t("Lot", "التشغيلة")]: e.lot || "",
          [t("What happened", "اللي حصل")]: describeEvent(e, ar),
        };
      });
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = [{ wch: 11 }, { wch: 7 }, { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 30 }, { wch: 9 }, { wch: 7 }, { wch: 7 }, { wch: 9 }, { wch: 9 }, { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 70 }];
      if (ar) sheet["!views"] = [{ rightToLeft: true }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheet, t("Stock history", "سجل المخزون"));
      XLSX.writeFile(wb, `stock-history-${localDay(Date.now())}.xlsx`, { compression: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not make the Excel file.", "error");
    } finally {
      setExporting(false);
    }
  };

  const groups = Object.keys(GROUP_LABEL) as EventGroup[];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-[12px] font-semibold text-ink-body">
          {t("Kind", "النوع")}
          <select id="stock-history-kind" value={group} onChange={(e) => setGroup(e.target.value as EventGroup | "all")} className={`${inputCls} !py-2`}>
            <option value="all">{t("Everything", "الكل")}</option>
            {groups.map((g) => <option key={g} value={g}>{ar ? GROUP_LABEL[g].ar : GROUP_LABEL[g].en}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] font-semibold text-ink-body">
          {t("Person", "الشخص")}
          <select id="stock-history-person" value={person} onChange={(e) => setPerson(e.target.value)} className={`${inputCls} !py-2`}>
            <option value="all">{t("Everyone", "الكل")}</option>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] font-semibold text-ink-body">
          {t("From", "من")}
          <input id="stock-history-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputCls} !py-2`} />
        </label>
        <label className="grid gap-1 text-[12px] font-semibold text-ink-body">
          {t("To", "إلى")}
          <input id="stock-history-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputCls} !py-2`} />
        </label>
        <label className="grid min-w-[160px] flex-1 gap-1 text-[12px] font-semibold text-ink-body">
          {t("Search", "بحث")}
          <input id="stock-history-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("item, drawer, patient, lot…", "صنف، درج، مريض، تشغيلة…")} className={`${inputCls} !py-2`} />
        </label>
        <Btn onClick={exportExcel} busy={exporting} disabled={!shown.length}>
          <Download size={15} /> {t("Excel", "إكسل")}
        </Btn>
      </div>

      <Card className="overflow-hidden">
        {shown.map((e) => (
          <div key={e.id} className="grid gap-x-4 gap-y-0.5 border-t border-line px-3.5 py-2.5 first:border-t-0 sm:grid-cols-[170px_1fr]">
            <div className="text-[12px] text-ink-muted">
              <b className="block font-display text-[12.5px] font-bold text-ink"><Ltr>{when(e.atMs)}</Ltr></b>
              <span>{e.byName}{e.byRole ? ` · ${e.byRole}` : ""}</span>
            </div>
            <div className="min-w-0">
              <p className="text-[13.5px] leading-snug text-ink">{describeEvent(e, ar)}</p>
              <span className="text-[12px] text-ink-muted">{ar ? GROUP_LABEL[EVENT_GROUP[e.type]].ar : GROUP_LABEL[EVENT_GROUP[e.type]].en}</span>
            </div>
          </div>
        ))}
        {!shown.length && !loading ? (
          <p className="p-4 text-sm text-ink-muted">
            {events.length
              ? t("Nothing matches these filters.", "مفيش حاجة مطابقة للفلاتر دي.")
              : t("Nothing recorded yet. The history starts from the day this was switched on: every count, delivery, edit and delete from now on appears here with the person and the time.", "لسه مفيش حاجة مسجلة. السجل بيبدأ من يوم تفعيله: كل عدّ وتوريد وتعديل ومسح من دلوقتي هيظهر هنا بالشخص والوقت.")}
          </p>
        ) : null}
        {loading ? <div className="grid place-items-center p-6 text-ink-muted"><Loader2 className="animate-spin" /></div> : null}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-muted">
        <span>{shown.length} {t("of", "من")} {events.length} {t("lines loaded", "سطر محمّل")}</span>
        {more ? <Btn onClick={() => void load(events[events.length - 1]?.atMs)} busy={loading}>{t("Load older", "حمّل الأقدم")}</Btn> : null}
      </div>
    </div>
  );
}

/** The calendar day of a moment, as the person's own clock sees it. */
function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
