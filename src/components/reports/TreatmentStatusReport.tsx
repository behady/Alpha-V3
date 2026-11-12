"use client";

import { useMemo, useState } from "react";
import { PhoneCall, Search, X } from "lucide-react";
import { DataTable, Note, Num, PatientLink, Phone, fmt } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { dayText } from "@/lib/reportHelpers";
import {
  NO_TREATMENT_FILTERS,
  TREATMENT_STATES,
  buildTreatmentStatus,
  dentistOptions,
  filterTreatments,
  type TreatmentFilters,
  type TreatmentLine,
  type TreatmentState,
} from "@/lib/reports/treatmentStatus";

/**
 * What is planned, what is in progress, what got finished.
 *
 * Three people open this for three reasons, and it is one screen for all of them:
 *
 *  - the owner reads the three numbers — how much work is waiting, moving, and finished;
 *  - a dentist picks their own name and sees what they have left open;
 *  - reception presses "No booking" and gets the list to phone.
 *
 * The three numbers ARE the filter: pressing one narrows the list to it, pressing it again shows
 * everything. They always describe the period on screen and never move with the filters below,
 * so a figure read out loud means the same thing whoever is looking.
 *
 * Every rule about which month a treatment belongs to is in lib/reports/treatmentStatus.
 */
export default function TreatmentStatusReport({ data, allPatients, range, today, isAr }: ReportProps) {
  const status = useMemo(
    () => buildTreatmentStatus(data.treatmentNotes || [], allPatients, data.appointmentsAhead || [], range, today),
    [data.treatmentNotes, data.appointmentsAhead, allPatients, range, today],
  );
  const [filters, setFilters] = useState<TreatmentFilters>(NO_TREATMENT_FILTERS);
  const set = (patch: Partial<TreatmentFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const rows = useMemo(() => filterTreatments(status.lines, filters), [status.lines, filters]);
  const dentists = useMemo(() => dentistOptions(status.lines), [status.lines]);
  const dirty = Boolean(filters.doctorId || filters.search || filters.unbookedOnly);

  const word = (s: TreatmentState) =>
    isAr ? { Planned: "مخطط", Ongoing: "جاري", Completed: "اتعمل" }[s] : { Planned: "Planned", Ongoing: "In progress", Completed: "Done" }[s];
  const egp = isAr ? "ج.م" : "EGP";
  const control =
    "rounded-xl border border-line bg-surface px-2.5 py-2 text-[12.5px] font-bold text-ink-body outline-none transition focus:border-accent";

  return (
    <div className="space-y-4">
      {/* --- the three numbers, which are also the filter ------------------------------------- */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {TREATMENT_STATES.map((s) => {
          const on = filters.state === s;
          const total = status.totals[s];
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => set({ state: on ? "" : s })}
              className={`flex min-w-0 flex-col gap-1 rounded-2xl border p-3 text-start transition-colors sm:p-4 ${
                on ? "border-accent bg-accent text-ink-on-accent" : "border-line bg-surface text-ink hover:bg-surface-subtle"
              }`}
            >
              <span className={`text-[11.5px] font-black sm:text-[12.5px] ${on ? "" : "text-ink-muted"}`}>{word(s)}</span>
              <span className="font-figure text-[clamp(22px,7vw,34px)] font-extrabold leading-none">{total.count}</span>
              <span className={`font-figure text-[11px] sm:text-[12px] ${on ? "" : "text-ink-faint"}`}>
                {fmt(total.value)} {egp}
              </span>
            </button>
          );
        })}
      </div>

      {/* --- open work from before the period: one tap away, never mixed into the numbers ------ */}
      {status.older.count > 0 && (
        <button
          type="button"
          aria-pressed={filters.includeOlder}
          onClick={() => set({ includeOlder: !filters.includeOlder })}
          className="flex w-full flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface-subtle px-4 py-3 text-start transition-colors hover:bg-surface-muted"
        >
          <span className="text-[12.5px] font-bold text-ink-body">
            {isAr
              ? `${status.older.count} علاج أقدم من ${dayText(range.start, true)} ولسه مخلصش · ${fmt(status.older.value)} ${egp}`
              : `${status.older.count} older treatments from before ${dayText(range.start, false)} are still not finished · ${fmt(status.older.value)} ${egp}`}
          </span>
          <span className="text-[12px] font-black text-ink">
            {filters.includeOlder ? (isAr ? "اخفيهم" : "Hide them") : isAr ? "اعرضهم" : "Show them"}
          </span>
        </button>
      )}

      {/* --- who and whom ---------------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative">
          <Search size={13} className="pointer-events-none absolute top-1/2 start-2.5 -translate-y-1/2 text-ink-faint" />
          <input
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder={isAr ? "اسم المريض أو رقمه" : "Patient name or phone"}
            className="w-44 rounded-xl border border-line bg-surface py-2 pe-2.5 ps-8 text-[12.5px] font-bold text-ink outline-none transition focus:border-accent"
          />
        </span>

        {dentists.length > 1 && (
          <select value={filters.doctorId} onChange={(e) => set({ doctorId: e.target.value })} className={control}>
            <option value="">{isAr ? "كل الأطباء" : "All dentists"}</option>
            {dentists.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          aria-pressed={filters.unbookedOnly}
          onClick={() => set({ unbookedOnly: !filters.unbookedOnly })}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[12.5px] font-black transition-colors ${
            filters.unbookedOnly ? "border-ink bg-ink-strong text-white" : "border-line bg-surface text-ink-body hover:text-ink"
          }`}
        >
          <PhoneCall size={13} />
          {isAr ? "مفيش حجز" : "No booking"}
        </button>

        {dirty && (
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...NO_TREATMENT_FILTERS, state: f.state, includeOlder: f.includeOlder }))}
            className="inline-flex items-center gap-1 rounded-xl px-2.5 py-2 text-[12px] font-black text-ink-faint transition hover:text-ink"
          >
            <X size={13} />
            {isAr ? "امسح" : "Clear"}
          </button>
        )}
      </div>

      {/* --- the list --------------------------------------------------------------------------- */}
      <DataTable<TreatmentLine>
        isAr={isAr}
        rows={rows}
        rowKey={(l) => l.id}
        exportName={`Treatments${filters.state ? `_${filters.state}` : ""}`}
        maxRows={25}
        emptyText={
          status.lines.length === 0
            ? isAr
              ? "مفيش علاجات في الفترة دي."
              : "No treatments in this period."
            : isAr
              ? "مفيش علاجات بالاختيارات دي."
              : "No treatments match."
        }
        columns={[
          { key: "patientName", label: isAr ? "المريض" : "Patient", render: (l) => <PatientLink id={l.patientId} name={l.patientName} isAr={isAr} /> },
          { key: "phone", label: isAr ? "الهاتف" : "Phone", render: (l) => <Phone value={l.phone} /> },
          {
            key: "treatment",
            label: isAr ? "العلاج" : "Treatment",
            exportValue: (l) => (l.tooth ? `${l.treatment} (${l.tooth})` : l.treatment),
            render: (l) => (
              <span className="inline-flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-ink-body">
                <span>{l.treatment}</span>
                {l.tooth && (
                  <span dir="ltr" className="rounded-md bg-surface-muted px-1.5 py-0.5 font-figure text-[10.5px] font-bold text-ink-body">
                    {l.tooth}
                  </span>
                )}
              </span>
            ),
          },
          { key: "doctorName", label: isAr ? "الدكتور" : "Dentist", render: (l) => <span className="text-[13px] font-medium text-ink-body">{l.doctorName || "—"}</span> },
          {
            key: "state",
            label: isAr ? "الحالة" : "State",
            exportValue: (l) => word(l.state),
            render: (l) => (
              <span
                className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-black ${
                  l.state === "Ongoing" ? "bg-ink-strong text-white" : l.state === "Planned" ? "bg-surface-muted text-ink" : "border border-line text-ink-muted"
                }`}
              >
                {word(l.state)}
              </span>
            ),
          },
          {
            key: "date",
            label: isAr ? "التاريخ" : "Date",
            render: (l) => (
              <span className="whitespace-nowrap font-figure text-[12.5px] text-ink-faint">
                {dayText(l.date, isAr)}
                {l.older && (
                  <span className="ms-1.5 rounded-full bg-surface-muted px-1.5 py-0.5 text-[9.5px] font-black text-ink-body">{isAr ? "قديم" : "older"}</span>
                )}
              </span>
            ),
          },
          {
            key: "nextVisit",
            label: isAr ? "الزيارة الجاية" : "Next visit",
            exportValue: (l) => (l.state === "Completed" ? "" : l.nextVisit || (isAr ? "مفيش حجز" : "No booking")),
            render: (l) =>
              l.state === "Completed" ? (
                <span className="text-ink-faint">—</span>
              ) : l.nextVisit ? (
                <span className="whitespace-nowrap font-figure text-[12.5px] text-ink-body">{dayText(l.nextVisit, isAr)}</span>
              ) : (
                <span className="whitespace-nowrap text-[11.5px] font-black text-danger">{isAr ? "مفيش حجز" : "No booking"}</span>
              ),
          },
          { key: "price", label: isAr ? "السعر" : "Price", align: "end", render: (l) => <Num v={l.price} /> },
        ]}
      />

      <Note>
        {isAr
          ? "«اتعمل» بيتحسب في الشهر اللي العلاج خلص فيه، حتى لو بدأ في شهر قبله. «مخطط» و«جاري» هما اللي لسه مفتوحين النهارده. العلاج اللي اتكمّل في زيارة تانية بيتحسب مرة واحدة."
          : "Done counts in the month the treatment was finished, even if it began earlier. Planned and In progress are what is still open today. A treatment continued into a later visit counts once."}
      </Note>
    </div>
  );
}
