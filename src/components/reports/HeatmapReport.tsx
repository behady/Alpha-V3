"use client";

import { useMemo } from "react";
import { Bars, ChartFrame, INK, MARK } from "@/components/reports/chartKit";
import { HeatGrid, Note, fmt } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { ledgerCashValue } from "@/lib/reportHelpers";
import { heatmap, hourOfTimestamp } from "@/lib/reports/ledgerStats";
import { WEEKDAYS_AR, WEEKDAYS_EN } from "@/lib/reports/periods";
import { rowDate } from "@/lib/reportPatients";
import { outcomeOf } from "@/lib/reports/opsStats";
import { toYmd } from "@/lib/reports/patientStats";
import { parseApptTimeToMinutes } from "@/lib/appointmentTime";

const EMPTY: never[] = [];

/**
 * When the clinic actually happens.
 *
 * Two grids: when patients are in the chair (appointments, by their booked hour) and when money
 * arrives (payments, by the hour they were recorded). A dead Tuesday afternoon and a Saturday
 * that carries the week are both invisible in a total and obvious here. Saturday is the first
 * column, because that is the first day of the clinic's week.
 */
export default function HeatmapReport({ payments, isAr, data, today }: ReportProps) {
  const appointments = data.appointments || EMPTY;
  const days = isAr ? WEEKDAYS_AR : WEEKDAYS_EN;

  const visits = useMemo(
    () =>
      heatmap(
        appointments.filter((a) => outcomeOf(a, today) !== "cancelled"),
        (a) => toYmd(a.date),
        (a) => (a.time ? parseApptTimeToMinutes(String(a.time)) / 60 : null),
        () => 1,
      ),
    [appointments, today],
  );
  const cash = useMemo(
    () =>
      heatmap(
        payments.filter((p) => p.type === "payment" || p.type === "income"),
        (p) => rowDate(p),
        (p) => hourOfTimestamp(p.createdAt),
        (p) => ledgerCashValue(p),
      ),
    [payments],
  );

  const byDay = useMemo(() => {
    const v = Array(7).fill(0) as number[];
    const c = Array(7).fill(0) as number[];
    for (const cell of visits) v[cell.weekday] += cell.value;
    for (const cell of cash) c[cell.weekday] += cell.value;
    return { v, c };
  }, [visits, cash]);

  const untimedCash = cash.filter((c) => c.hour < 0).reduce((s, c) => s + c.value, 0);
  const bestVisitDay = byDay.v.indexOf(Math.max(...byDay.v));
  const bestCashDay = byDay.c.indexOf(Math.max(...byDay.c));
  const egp = isAr ? "ج.م" : "EGP";

  // The busiest hour across the week, in words.
  const peakHour = useMemo(() => {
    const perHour = new Map<number, number>();
    for (const c of visits) if (c.hour >= 0) perHour.set(c.hour, (perHour.get(c.hour) || 0) + c.value);
    let best = -1;
    let n = 0;
    for (const [h, v] of perHour) if (v > n) [best, n] = [h, v];
    return best;
  }, [visits]);
  const hourText = (h: number) => (h < 0 ? "—" : `${h > 12 ? h - 12 : h}${h >= 12 ? " pm" : " am"}`);

  return (
    <div className="space-y-8">
      <ChartFrame
        title={isAr ? "المرضى: أنهي يوم وأنهي ساعة" : "Patients: which day, which hour"}
        note={
          visits.length
            ? isAr
              ? `أكتر يوم ${days[bestVisitDay]}، وأكتر ساعة ${hourText(peakHour)}.`
              : `Busiest day ${days[bestVisitDay]}; busiest hour ${hourText(peakHour)}.`
            : isAr
              ? "مفيش مواعيد في الفترة دي."
              : "No appointments in this period."
        }
      >
        <HeatGrid cells={visits} isAr={isAr} unit={isAr ? "موعد" : "visits"} />
      </ChartFrame>

      <ChartFrame
        title={isAr ? "الفلوس: أنهي يوم وأنهي ساعة" : "Money: which day, which hour"}
        note={
          cash.length
            ? isAr
              ? `أكتر يوم ${days[bestCashDay]} بـ ${fmt(byDay.c[bestCashDay])} ج.م.${untimedCash ? ` ${fmt(untimedCash)} ج.م مسجّلة من غير ساعة ومحسوبة في اليوم بس.` : ""}`
              : `Best day ${days[bestCashDay]} at ${fmt(byDay.c[bestCashDay])} EGP.${untimedCash ? ` ${fmt(untimedCash)} EGP carry no time of day and count in the day column only.` : ""}`
            : undefined
        }
      >
        <HeatGrid cells={cash} isAr={isAr} fmtValue={fmt} unit={egp} />
      </ChartFrame>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartFrame title={isAr ? "المواعيد حسب اليوم" : "Visits by weekday"}>
          <Bars rows={days.map((d, i) => ({ label: d, value: byDay.v[i], text: String(byDay.v[i]), color: i === bestVisitDay && byDay.v[i] > 0 ? MARK : INK }))} />
        </ChartFrame>
        <ChartFrame title={isAr ? "الفلوس حسب اليوم" : "Money by weekday"}>
          <Bars rows={days.map((d, i) => ({ label: d, value: byDay.c[i], text: `${fmt(byDay.c[i])} ${egp}`, color: i === bestCashDay && byDay.c[i] > 0 ? MARK : INK }))} />
        </ChartFrame>
      </div>
      <Note>
        {isAr
          ? "المواعيد بساعة الحجز؛ الفلوس بالساعة اللي اتسجلت فيها الدفعة. لو الأسبوع بيتفرّغ يوم معيّن، ده اليوم اللي الإعلانات والروستر لازم يبصوا عليه."
          : "Visits are placed by their booked hour; money by the hour the payment was recorded. If the week empties on one day, that is the day the roster and the ads should look at."}
      </Note>
    </div>
  );
}
