/**
 * The owner's three-line day: the facts a day boils down to, and the plain words for them.
 *
 * The AI writes the morning line from these facts and nothing else — it is handed a fact sheet,
 * not the database — and when the AI is off (no plan, no credits, no key) the same facts are put
 * into words here, deterministically, so the line is never blank. Pure; pinned by
 * tests/ownerSummary.test.mts.
 */

import type { Briefing } from "@/lib/automation/briefing/types";

export type DayFacts = {
  dateKey: string;
  visits: number;
  attended: number;
  cancelled: number;
  noShows: number;
  collected: number | null;
  expenses: number | null;
  net: number | null;
  sameWeekdayCollected: number | null;
  newPatients: number;
  topDentist: { name: string; collected: number } | null;
  unconfirmedTomorrow: number;
  labLate: number;
  outOfStock: number;
  waitingLongest: number | null;
};

const NO_SHOW = new Set(["No Show", "no_show", "NoShow"]);

/** What the day amounted to, off a day brief. Money is null when the reader may not see it. */
export function summaryFacts(brief: Briefing): DayFacts {
  const noShows = brief.appointments.filter((a) => NO_SHOW.has(String(a.status || ""))).length;
  const money = brief.money;
  const top = brief.production?.doctors.slice().sort((a, b) => b.collected - a.collected)[0];
  return {
    dateKey: brief.dateKey,
    visits: brief.counts.total,
    attended: brief.counts.attended,
    cancelled: brief.counts.cancelled,
    noShows,
    collected: money ? money.collected : null,
    expenses: money ? money.expenses : null,
    net: money ? money.netCash : null,
    sameWeekdayCollected: money?.comparison.sameWeekdayCollected ?? null,
    newPatients: brief.growth.newPatients,
    topDentist: top && top.collected > 0 ? { name: top.name, collected: top.collected } : null,
    unconfirmedTomorrow: brief.actions.unconfirmedAhead,
    labLate: 0,
    outOfStock: brief.stock.outOfStockCount,
    waitingLongest: null,
  };
}

const fmt = (n: number, ar: boolean) => Math.round(n).toLocaleString(ar ? "ar-EG" : "en-US");

/**
 * Three lines without a model: what happened, the money, and what is waiting. Written so a line
 * with nothing to say is dropped rather than padded — "0 no-shows" is not news.
 */
export function plainSummary(f: DayFacts, language: "en" | "ar"): string[] {
  const ar = language === "ar";
  const lines: string[] = [];

  const missed = f.noShows + f.cancelled;
  lines.push(
    ar
      ? `${f.attended} زيارة من ${f.visits}${missed ? ` · ${f.noShows} غياب و${f.cancelled} إلغاء` : ""}${f.newPatients ? ` · ${f.newPatients} مريض جديد` : ""}.`
      : `${f.attended} of ${f.visits} visits seen${missed ? ` · ${f.noShows} no-show${f.noShows === 1 ? "" : "s"}, ${f.cancelled} cancelled` : ""}${f.newPatients ? ` · ${f.newPatients} new patient${f.newPatients === 1 ? "" : "s"}` : ""}.`,
  );

  if (f.collected !== null) {
    const vs =
      f.sameWeekdayCollected && f.sameWeekdayCollected > 0
        ? (() => {
            const pct = Math.round(((f.collected! - f.sameWeekdayCollected!) / f.sameWeekdayCollected!) * 100);
            return ar ? ` (${pct >= 0 ? "أعلى" : "أقل"} ${Math.abs(pct)}% من نفس اليوم الأسبوع اللي فات)` : ` (${pct >= 0 ? "up" : "down"} ${Math.abs(pct)}% on the same day last week)`;
          })()
        : "";
    const top = f.topDentist ? (ar ? ` · أعلى تحصيل ${f.topDentist.name} ${fmt(f.topDentist.collected, true)}` : ` · top ${f.topDentist.name} ${fmt(f.topDentist.collected, false)}`) : "";
    lines.push(
      ar
        ? `اتحصّل ${fmt(f.collected, true)} ج${vs} · مصاريف ${fmt(f.expenses || 0, true)} · صافي ${fmt(f.net || 0, true)}${top}.`
        : `Collected ${fmt(f.collected, false)} EGP${vs} · expenses ${fmt(f.expenses || 0, false)} · net ${fmt(f.net || 0, false)}${top}.`,
    );
  }

  const waiting: string[] = [];
  if (f.unconfirmedTomorrow) waiting.push(ar ? `${f.unconfirmedTomorrow} مواعيد بكرة مش مؤكدة` : `${f.unconfirmedTomorrow} unconfirmed for tomorrow`);
  if (f.labLate) waiting.push(ar ? `${f.labLate} حالات معمل متأخرة` : `${f.labLate} lab case${f.labLate === 1 ? "" : "s"} late`);
  if (f.outOfStock) waiting.push(ar ? `${f.outOfStock} صنف خلص` : `${f.outOfStock} item${f.outOfStock === 1 ? "" : "s"} out of stock`);
  if (waiting.length) lines.push((ar ? "مستني: " : "Waiting: ") + waiting.join(ar ? " · " : " · ") + ".");
  else lines.push(ar ? "مفيش حاجة مستنية." : "Nothing waiting.");

  return lines;
}

/** The evening WhatsApp: a heading and the same three lines. */
export function digestMessage(f: DayFacts, lines: string[], clinicName: string, language: "en" | "ar"): string {
  const ar = language === "ar";
  const head = ar ? `ملخص ${clinicName} · ${f.dateKey}` : `${clinicName} · ${f.dateKey}`;
  return [head, ...lines.map((l) => `• ${l}`)].join("\n");
}

/** The fact sheet the model is handed — every number it may use, and nothing it may not. */
export function factSheet(f: DayFacts): string {
  return [
    `date: ${f.dateKey}`,
    `visits booked: ${f.visits}; seen: ${f.attended}; cancelled: ${f.cancelled}; no-shows: ${f.noShows}`,
    f.collected === null ? "money: not available" : `cash collected: ${Math.round(f.collected)} EGP; expenses: ${Math.round(f.expenses || 0)}; net: ${Math.round(f.net || 0)}`,
    f.sameWeekdayCollected !== null ? `same weekday last week collected: ${Math.round(f.sameWeekdayCollected)} EGP` : "",
    `new patients: ${f.newPatients}`,
    f.topDentist ? `top dentist by cash: ${f.topDentist.name} (${Math.round(f.topDentist.collected)} EGP)` : "",
    `unconfirmed visits tomorrow: ${f.unconfirmedTomorrow}`,
    `lab cases late: ${f.labLate}`,
    `items out of stock: ${f.outOfStock}`,
  ]
    .filter(Boolean)
    .join("\n");
}
