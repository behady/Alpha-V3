"use client";

import { Fragment, useState } from "react";
import { ChevronDown, Edit2, FileSpreadsheet, Loader2, Save, Trash2 } from "lucide-react";
import { matchesFilter, type AttendanceSheet, type SheetFilter, type ShiftRow } from "@/lib/attendanceSheet";
import { hoursText } from "@/lib/hrClient";
import { btnDark, btnGhost, distanceWords, Empty, fieldInput, fieldLabel, hoursWords, inputValue, money, Section, timeOf } from "./profileKit";

/**
 * The clock-in sheet: one line per shift (and per missed day), filters above it, totals under it,
 * and an Excel download — read like Finance → GASCO, as the owner asked (2026-11-24).
 *
 * For someone on a fixed salary every line also says what that day paid, and the strip above the
 * sheet says how: the hour price is the salary over the roster's monthly hours, time inside the
 * shift is paid at it, and extra time is paid at the extra-time rate only once approved. All of it
 * comes from `buildAttendanceSheet`, which a test holds to the payroll engine's figure at the top.
 *
 * A line opens on a tap: the details, the extra-time decision, and Edit / Delete. Every write is the
 * same as before this redesign (the page's editLog / removeLog / decideOvertime).
 */
export default function AttendanceTab({
  sheet,
  baseSalary,
  overtimeMultiplier,
  scheduleAssumed,
  canEdit,
  isAr,
  onEditLog,
  onDeleteLog,
  onOvertime,
  onExport,
}: {
  sheet: AttendanceSheet;
  baseSalary: number;
  overtimeMultiplier: number;
  scheduleAssumed: boolean;
  canEdit: boolean;
  isAr: boolean;
  onEditLog: (logId: string, checkIn: string, checkOut: string) => void;
  onDeleteLog: (logId: string) => void;
  onOvertime: (logId: string, decision: "approved" | "rejected") => void;
  /** Download the sheet as Excel: this person, or the whole team. */
  onExport: (team: boolean) => Promise<void>;
}) {
  const [filter, setFilter] = useState<SheetFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingLog, setEditingLog] = useState<string | null>(null);
  const [logIn, setLogIn] = useState("");
  const [logOut, setLogOut] = useState("");
  const [exporting, setExporting] = useState<"person" | "team" | null>(null);

  // A filter whose last line went away (a decision taken, a time fixed) falls back to everything.
  const active = filter !== "all" && sheet.counts[filter] === 0 ? "all" : filter;
  const rows = sheet.rows.filter((r) => matchesFilter(r, active));
  const pay = sheet.payShown;
  const mult = overtimeMultiplier || 1.5;

  const filters: { id: SheetFilter; label: string }[] = [
    { id: "all", label: isAr ? "الكل" : "All days" },
    { id: "late", label: isAr ? "متأخر" : "Late" },
    { id: "extra", label: isAr ? "وقت زيادة" : "Extra time" },
    { id: "open", label: isAr ? "نسي الانصراف" : "Forgot to clock out" },
    { id: "far", label: isAr ? "بعيد عن العيادة" : "Away from clinic" },
    { id: "absent", label: isAr ? "غياب" : "Missed days" },
  ];

  const exportAs = async (team: boolean) => {
    if (exporting) return;
    setExporting(team ? "team" : "person");
    try {
      await onExport(team);
    } finally {
      setExporting(null);
    }
  };

  const short = (m: number) =>
    m < 60 ? (isAr ? `${m}د` : `${m}m`) : m % 60 === 0 ? (isAr ? `${m / 60}س` : `${m / 60}h`) : hoursText(m, isAr);
  const decisionPill = (r: ShiftRow) =>
    r.extraDecision === "approved"
      ? { text: isAr ? "هيتدفع" : "Paid", tone: "bg-ok-tint text-ok" }
      : r.extraDecision === "rejected"
        ? { text: isAr ? "مش هيتدفع" : "Not paid", tone: "bg-danger-tint text-danger" }
        : { text: isAr ? "مستني قرارك" : "Waiting for you", tone: "bg-accent text-ink" };
  const whereText = (r: ShiftRow) =>
    r.distanceM == null
      ? r.branchName ?? "—"
      : r.branchName
        ? r.far
          ? `${r.branchName} · ${distanceWords(r.distanceM, isAr)}`
          : r.branchName
        : distanceWords(r.distanceM, isAr);

  const cell = "border-b border-line px-2 py-3 align-middle sm:px-3";
  // "29 Oct" on the first line, the weekday under it: narrow enough for a phone's five columns.
  const dateOf = (ymd: string) => {
    const d = new Date(`${ymd}T12:00:00`);
    const loc = isAr ? "ar-EG-u-nu-latn" : "en-GB";
    return Number.isNaN(d.getTime())
      ? { day: ymd, weekday: "" }
      : { day: d.toLocaleDateString(loc, { day: "numeric", month: "short" }), weekday: d.toLocaleDateString(loc, { weekday: "long" }) };
  };
  const dateCell = (ymd: string) => (
    <>
      <span className="block whitespace-nowrap font-bold text-ink">{dateOf(ymd).day}</span>
      <span className="block whitespace-nowrap text-[12.5px] font-semibold text-ink-muted">{dateOf(ymd).weekday}</span>
    </>
  );
  const num = `${cell} text-end font-figure`;
  // Columns: date, in, out, hours, [late sm+], [extra md+], [pay], [where xl+], chevron.
  const colCount = 9 - (pay ? 0 : 1);

  return (
    <Section
      title={isAr ? "شيت الحضور" : "Clock-in sheet"}
      note={
        isAr
          ? "كل يوم في الفترة دي: دخل إمتى وخرج إمتى. اضغط على أي سطر عشان تعدّله أو توافق على الوقت الزيادة."
          : "Every day in this period: when they came in and when they left. Tap a line to change it or answer extra time."
      }
      action={
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void exportAs(false)} disabled={!!exporting} className={`${btnGhost} disabled:opacity-50`}>
            {exporting === "person" ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            {isAr ? "تنزيل Excel" : "Download Excel"}
          </button>
          <button type="button" onClick={() => void exportAs(true)} disabled={!!exporting} className={`${btnGhost} disabled:opacity-50`}>
            {exporting === "team" ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            {isAr ? "Excel للفريق كله" : "Excel for the whole team"}
          </button>
        </div>
      }
    >
      {/* How the clock becomes a wage, said once above the sheet. */}
      {pay && (
        <div className="mb-5 rounded-2xl bg-surface-subtle px-4 py-3.5 sm:px-5">
          <p className="text-[15px] font-extrabold text-ink">
            {isAr ? "سعر الساعة " : "Hour price "}
            <span className="font-figure">{money(sheet.hourlyRate)}</span>
            {isAr ? " ج.م = المرتب " : " EGP = salary "}
            <span className="font-figure">{money(baseSalary)}</span>
            {" ÷ "}
            <span className="font-figure">{Math.round(sheet.monthlyHours)}</span>
            {isAr ? " ساعة في الشهر" : " hours a month"}
          </p>
          <p className="mt-1 text-[14px] font-semibold leading-relaxed text-ink-muted">
            {isAr
              ? `الوقت جوه الوردية بيتحسب بسعر الساعة، فالتأخير بيقلّل الأجر. الوقت الزيادة بيتحسب ×${mult} بعد موافقتك بس.`
              : `Time inside the shift is paid at the hour price, so coming in late pays less. Extra time is paid at ${mult}× only after you approve it.`}
          </p>
          {scheduleAssumed && (
            <p className="mt-1 text-[14px] font-bold text-danger">
              {isAr ? "مفيش ورديات متسجلة، فالأجر تقريبي على مواعيد العيادة العادية." : "No shifts set, so the pay is estimated on the clinic's usual hours."}
            </p>
          )}
        </div>
      )}

      {/* Filters: only the ones with something in them, each with its count. */}
      <div className="no-scrollbar -mx-1 mb-4 flex gap-2 overflow-x-auto px-1 sm:flex-wrap sm:overflow-visible">
        {filters
          .filter((f) => f.id === "all" || sheet.counts[f.id] > 0)
          .map((f) => {
            const on = active === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setFilter(f.id);
                  setOpenId(null);
                }}
                className={`inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[14px] font-bold transition-colors ${
                  on ? "bg-ink-slab text-white" : "border border-line text-ink-body hover:text-ink"
                }`}
              >
                {f.label}
                <span className={`font-figure text-[13px] ${on ? "text-white/70" : "text-ink-muted"}`}>{sheet.counts[f.id]}</span>
              </button>
            );
          })}
      </div>

      {sheet.rows.length === 0 ? (
        <Empty text={isAr ? "مفيش حضور متسجل في الفترة دي." : "No clock-ins in this period."} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line max-sm:-mx-5 max-sm:rounded-none max-sm:border-x-0">
          <table className="w-full border-collapse text-[14px] sm:text-[15px] [&_tbody_td+td]:border-s [&_tbody_td+td]:border-line [&_th+th]:border-s [&_th+th]:border-line">
            <thead>
              <tr className="bg-surface-subtle text-[13px] font-bold whitespace-nowrap text-ink-muted">
                <th className={`${cell} text-start`}>{isAr ? "اليوم" : "Day"}</th>
                <th className={`${cell} text-start`}>{isAr ? "دخول" : "In"}</th>
                <th className={`${cell} text-start`}>{isAr ? "خروج" : "Out"}</th>
                <th className={`${cell} text-end`}>{isAr ? "الساعات" : "Hours"}</th>
                <th className={`${cell} text-end max-sm:hidden`}>{isAr ? "تأخير" : "Late"}</th>
                <th className={`${cell} text-start max-md:hidden`}>{isAr ? "وقت زيادة" : "Extra time"}</th>
                {pay && <th className={`${cell} text-end`}>{isAr ? "أجر اليوم" : "Day's pay"}</th>}
                <th className={`${cell} text-start max-xl:hidden`}>{isAr ? "المكان" : "Where"}</th>
                <th className={`${cell} w-8 max-sm:hidden`} aria-hidden />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                if (r.kind === "absent") {
                  return (
                    <tr key={r.id} className="bg-danger-tint">
                      <td className={cell}>{dateCell(r.date)}</td>
                      <td colSpan={3} className={`${cell} font-bold text-danger`}>
                        {isAr ? "غاب — مسجّلش حضور" : "Missed — no clock-in"}
                      </td>
                      <td className={`${cell} max-sm:hidden`} />
                      <td className={`${cell} max-md:hidden`} />
                      {pay && <td className={`${num} font-bold text-ink-muted`}>0</td>}
                      <td className={`${cell} max-xl:hidden`} />
                      <td className={`${cell} max-sm:hidden`} />
                    </tr>
                  );
                }
                const open = openId === r.id;
                const editing = editingLog === r.id;
                const pill = r.extraDecision ? decisionPill(r) : null;
                const tags: { text: string; bad?: boolean }[] = [];
                if (r.late > 0) tags.push({ text: isAr ? `متأخر ${short(r.late)}` : `Late ${short(r.late)}`, bad: true });
                // Short on purpose: the decision itself is one tap away.
                if (pill) tags.push({ text: `${isAr ? "زيادة" : "Extra"} ${short(r.extra)}${r.extraDecision === "pending" ? " ؟" : ""}`, bad: r.extraDecision === "pending" });
                const notes: { text: string; bad?: boolean }[] = [];
                if (r.forgot) notes.push({ text: isAr ? "نسي الانصراف" : "No clock-out", bad: true });
                if (r.autoClosed) notes.push({ text: isAr ? "انصراف تلقائي" : "Auto clock-out", bad: true });
                if (r.stillIn) notes.push({ text: isAr ? "في الشغل" : "At work" });
                if (r.far) notes.push({ text: isAr ? "بعيد عن العيادة" : "Far away", bad: true });
                return (
                  <Fragment key={r.id}>
                    <tr
                      onClick={() => {
                        setOpenId(open ? null : r.id);
                        setEditingLog(null);
                      }}
                      aria-expanded={open}
                      className={`cursor-pointer transition-colors ${open ? "bg-surface-subtle" : "hover:bg-surface-subtle/70"}`}
                    >
                      <td className={cell}>
                        {dateCell(r.date)}
                        {/* What the hidden columns would say, on screens too narrow for them. */}
                        {tags.length > 0 && (
                          <span className="mt-0.5 flex flex-col text-[12.5px] font-bold md:hidden">
                            {tags.map((t) => (
                              <span key={t.text} className={t.bad ? "text-danger" : "text-ink-muted"}>
                                {t.text}
                              </span>
                            ))}
                          </span>
                        )}
                        {notes.length > 0 && (
                          <span className="mt-0.5 flex flex-col text-[12.5px] font-bold">
                            {notes.map((t) => (
                              <span key={t.text} className={t.bad ? "text-danger" : "text-ink-muted"}>
                                {t.text}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className={`${cell} whitespace-nowrap font-figure font-semibold text-ink-body`}>{timeOf(r.checkIn, isAr)}</td>
                      <td className={`${cell} whitespace-nowrap font-figure font-semibold text-ink-body`}>{timeOf(r.checkOut, isAr)}</td>
                      <td className={`${num} whitespace-nowrap font-semibold text-ink`}>{hoursText(r.worked, isAr)}</td>
                      <td className={`${num} max-sm:hidden ${r.late > 0 ? "font-bold text-danger" : "text-ink-muted"}`}>{r.late > 0 ? short(r.late) : "—"}</td>
                      <td className={`${cell} max-md:hidden`}>
                        {pill ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-figure font-semibold text-ink">{short(r.extra)}</span>
                            <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold whitespace-nowrap ${pill.tone}`}>{pill.text}</span>
                          </span>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      {pay && <td className={`${num} font-extrabold text-ink`}>{money(r.pay ?? 0)}</td>}
                      <td className={`${cell} max-xl:hidden ${r.far ? "font-bold text-danger" : "text-ink-muted"}`}>{whereText(r)}</td>
                      <td className={`${cell} text-ink-muted max-sm:hidden`}>
                        <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                      </td>
                    </tr>

                    {open && (
                      <tr className="bg-surface-subtle">
                        <td colSpan={colCount} className="border-b border-line px-4 py-4 sm:px-5">
                          {editing ? (
                            <div className="flex flex-col gap-4">
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <label className="block">
                                  <span className={fieldLabel}>{isAr ? "وقت الدخول" : "Clocked in at"}</span>
                                  <input type="datetime-local" value={logIn} onChange={(e) => setLogIn(e.target.value)} className={fieldInput} />
                                </label>
                                <label className="block">
                                  <span className={fieldLabel}>{isAr ? "وقت الخروج (سيبه فاضي لو لسه جوه)" : "Clocked out at (leave empty if still in)"}</span>
                                  <input type="datetime-local" value={logOut} onChange={(e) => setLogOut(e.target.value)} className={fieldInput} />
                                </label>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onEditLog(r.id, logIn, logOut);
                                    setEditingLog(null);
                                  }}
                                  className={btnDark}
                                >
                                  <Save size={16} /> {isAr ? "حفظ" : "Save"}
                                </button>
                                <button type="button" onClick={() => setEditingLog(null)} className={btnGhost}>
                                  {isAr ? "إلغاء" : "Cancel"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-3">
                              <ul className="flex flex-col gap-1.5 text-[15px] font-semibold text-ink">
                                {r.worked > 0 && <li>
                                  {isAr
                                    ? `اشتغل ${hoursWords(r.worked, true)}${r.extra > 0 ? `، منهم ${hoursWords(r.regular, true)} جوه الوردية` : ""}.`
                                    : `Worked ${hoursWords(r.worked, false)}${r.extra > 0 ? `, ${hoursWords(r.regular, false)} of it inside the shift` : ""}.`}
                                </li>}
                                {r.late > 0 && (
                                  <li className="text-danger">
                                    {isAr ? `اتأخر ${hoursWords(r.late, true)} عن ميعاد الوردية.` : `Came in ${hoursWords(r.late, false)} after the shift started.`}
                                  </li>
                                )}
                                {r.distanceM != null && (
                                  <li className={r.far ? "text-danger" : "text-ink-body"}>
                                    {isAr ? `سجّل الحضور ${whereText(r)}.` : `Clocked in ${r.far ? whereText(r) : `at ${whereText(r)}`}.`}
                                  </li>
                                )}
                                {r.autoClosed && (
                                  <li className="text-danger">
                                    {isAr ? "نسي يسجّل انصراف، والسيستم قفل الوردية لوحده. لو الوقت غلط، عدّله." : "They forgot to clock out and the system closed the shift. If the time is wrong, change it."}
                                  </li>
                                )}
                                {r.forgot && (
                                  <li className="text-danger">
                                    {isAr ? "الوردية دي لسه مفتوحة ومش بتتحسب. اضغط تعديل وحط وقت الخروج." : "This shift is still open and pays nothing. Press Change and enter the time they left."}
                                  </li>
                                )}
                                {pay && (
                                  <li className="text-ink-body">
                                    {isAr ? "أجر اليوم: " : "Day's pay: "}
                                    <span className="font-figure font-extrabold text-ink">{money(r.pay ?? 0)}</span>
                                    {isAr ? " ج.م" : " EGP"}
                                  </li>
                                )}
                              </ul>

                              {/* Extra time is a decision, asked only on a finished shift that has some. */}
                              {r.extraDecision && (
                                <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface px-4 py-3">
                                  <span className="text-[15px] font-semibold text-ink">
                                    {isAr ? `فضل ${hoursWords(r.extra, true)} زيادة عن ورديته.` : `Stayed ${hoursWords(r.extra, false)} past their shift.`}
                                  </span>
                                  <span className={`rounded-full px-3 py-1 text-[13px] font-bold ${decisionPill(r).tone}`}>{decisionPill(r).text}</span>
                                  {canEdit && (
                                    <span className="ms-auto flex gap-2">
                                      {r.extraDecision !== "approved" && (
                                        <button type="button" onClick={() => onOvertime(r.id, "approved")} className={btnGhost}>
                                          {isAr ? `ادفعه ×${mult}` : `Pay it ×${mult}`}
                                        </button>
                                      )}
                                      {r.extraDecision !== "rejected" && (
                                        <button type="button" onClick={() => onOvertime(r.id, "rejected")} className={`${btnGhost} hover:text-danger`}>
                                          {isAr ? "متدفعوش" : "Don't pay"}
                                        </button>
                                      )}
                                    </span>
                                  )}
                                </div>
                              )}

                              {canEdit && (
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingLog(r.id);
                                      setLogIn(inputValue(r.checkIn));
                                      setLogOut(inputValue(r.checkOut));
                                    }}
                                    className={btnGhost}
                                  >
                                    <Edit2 size={16} /> {isAr ? "تعديل" : "Change"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onDeleteLog(r.id)}
                                    className={`${btnGhost} hover:bg-danger-tint hover:text-danger`}
                                  >
                                    <Trash2 size={16} /> {isAr ? "حذف" : "Delete"}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            {/* The totals are the whole period, whatever filter is on. */}
            <tfoot>
              <tr className="bg-ink-slab text-white">
                <td className="px-2 py-3.5 font-extrabold sm:px-3" colSpan={3}>
                  {isAr ? "الإجمالي" : "Total"}
                  <span className="ms-2 text-[13px] font-semibold text-white/60">
                    {isAr ? `${sheet.totals.days} يوم شغل` : `${sheet.totals.days} day${sheet.totals.days === 1 ? "" : "s"} worked`}
                  </span>
                </td>
                <td className="px-2 py-3.5 text-end font-figure font-extrabold whitespace-nowrap sm:px-3">{hoursText(sheet.totals.worked, isAr)}</td>
                <td className="px-3 py-3.5 text-end font-figure font-bold text-white/80 max-sm:hidden">
                  {sheet.totals.lateDays > 0 ? (isAr ? `${sheet.totals.lateDays} يوم` : `${sheet.totals.lateDays}d`) : "—"}
                </td>
                <td className="px-3 py-3.5 font-figure font-bold text-white/80 max-md:hidden">{sheet.totals.extra > 0 ? short(sheet.totals.extra) : "—"}</td>
                {pay && (
                  <td className="px-2 py-3.5 text-end font-figure text-[16px] font-extrabold text-white whitespace-nowrap sm:px-3">{money(sheet.totals.pay)}</td>
                )}
                <td className="px-3 py-3.5 max-xl:hidden" />
                <td className="px-3 py-3.5 max-sm:hidden" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {active !== "all" && (
        <p className="mt-3 text-[13px] font-semibold text-ink-muted">
          {isAr ? "الإجمالي تحت للفترة كلها، مش للفلتر بس." : "The totals cover the whole period, not just this filter."}
        </p>
      )}
    </Section>
  );
}
