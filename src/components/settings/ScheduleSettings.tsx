"use client";

import { Clock, Loader2, RotateCcw, Save } from "lucide-react";
import { useSettingsText } from "@/lib/useSettingsText";
import { useLanguage } from "@/context/LanguageContext";
import { countedNoun } from "@/lib/arabicCount";

/** Stored against these English names; only the label on screen is translated. */
const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_KEYS: Record<string, string> = {
  Sunday: "daySunday", Monday: "dayMonday", Tuesday: "dayTuesday", Wednesday: "dayWednesday",
  Thursday: "dayThursday", Friday: "dayFriday", Saturday: "daySaturday",
};

const FIELD =
  "w-full rounded-xl border border-line bg-surface-subtle px-4 py-3 text-base font-bold text-ink " +
  "outline-none transition-all focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10";

/** "15:00" → minutes since midnight. */
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h < 24 && min >= 0 && min < 60 ? h * 60 + min : null;
}

export default function ScheduleSettings({
  schedule,
  setSchedule,
  handleSaveClinic,
  isDirty,
  discard,
  saving,
}: {
  schedule: { start: string; end: string; slotDuration: string; offDays: string[] };
  setSchedule: (next: unknown) => void;
  handleSaveClinic: (e?: { preventDefault?: () => void }) => void | Promise<void>;
  isDirty?: boolean;
  discard?: () => void;
  saving?: boolean;
}) {
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";
  const txt = useSettingsText("schedule");

  const toggleOffDay = (day: string) => {
    setSchedule((prev: { offDays: string[] }) => {
      const isOff = prev.offDays.includes(day);
      return {
        ...prev,
        offDays: isOff ? prev.offDays.filter((d: string) => d !== day) : [...prev.offDays, day],
      };
    });
  };

  const dayLabel = (day: string) => txt[DAY_KEYS[day] as keyof typeof txt] ?? day;
  const clock = (hhmm: string) => {
    const mins = toMinutes(hhmm);
    if (mins === null) return hhmm;
    const d = new Date(2000, 0, 1, Math.floor(mins / 60), mins % 60);
    return d.toLocaleTimeString(isAr ? "ar-EG" : "en-GB", { hour: "numeric", minute: "2-digit" });
  };

  /**
   * What the three boxes and seven buttons add up to.
   *
   * The page's whole content is one sentence — when the clinic opens, when it shuts, which days it
   * does not, and therefore how many appointments a day holds. Every part of that was on screen
   * and the sentence was not, so working out "do we have room on Tuesday" meant doing the
   * arithmetic yourself.
   */
  const startMin = toMinutes(schedule.start);
  const endMin = toMinutes(schedule.end);
  // A clinic that closes after midnight is normal here; the day simply runs past 24:00.
  const openMinutes =
    startMin === null || endMin === null ? null : endMin > startMin ? endMin - startMin : 1440 - startMin + endMin;
  const slotLength = Number(schedule.slotDuration) || 0;
  const slots = openMinutes !== null && slotLength > 0 ? Math.floor(openMinutes / slotLength) : null;
  const openHours = openMinutes !== null ? Math.round((openMinutes / 60) * 10) / 10 : null;

  const closedDays = DAYS_OF_WEEK.filter((d) => schedule.offDays.includes(d));
  const closedPhrase =
    closedDays.length === 0
      ? txt.openEveryDay
      : `${txt.closedOnPrefix} ${closedDays.map(dayLabel).join(isAr ? " و" : ", ")}`;

  const headline =
    openMinutes === null
      ? txt.notSetYet
      : isAr
        ? `مفتوحة من ${clock(schedule.start)} لـ ${clock(schedule.end)}، ${closedPhrase}.`
        : `Open ${clock(schedule.start)} to ${clock(schedule.end)}, ${closedPhrase}.`;

  const facts = [
    openHours !== null
      ? countedNoun(openHours, isAr, { one: txt.hourOne, two: txt.hourTwo, few: txt.hourFew, many: txt.hourMany })
      : null,
    slots !== null
      ? countedNoun(slots, isAr, { one: txt.slotOne, two: txt.slotTwo, few: txt.slotFew, many: txt.slotMany })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* The sentence the three boxes below add up to. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="min-w-0 space-y-2">
          <p className="flex items-center gap-2 font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
            <Clock size={12} />
            {txt.scheduleTitle}
          </p>
          <p className="max-w-xl font-display text-[15px] font-bold leading-relaxed text-white sm:text-base">
            {headline}
          </p>
          {facts && <p className="font-figure text-[13px] tracking-tight text-white/70">{facts}</p>}
        </div>
      </div>

      <section>
        <h3 className="mb-3 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
          {txt.hoursGroup}
        </h3>
        <div className="grid grid-cols-1 gap-5 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-3 sm:p-6">
          <label className="block space-y-2">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              {txt.openTime}
            </span>
            <input
              data-tour="schedule-open-time"
              type="time"
              value={schedule.start}
              onChange={(e) => setSchedule({ ...schedule, start: e.target.value })}
              className={FIELD}
            />
          </label>
          <label className="block space-y-2">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              {txt.closeTime}
            </span>
            <input
              type="time"
              value={schedule.end}
              onChange={(e) => setSchedule({ ...schedule, end: e.target.value })}
              className={FIELD}
            />
          </label>
          <label className="block space-y-2">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              {txt.slotDuration}
            </span>
            <select
              data-tour="schedule-slot-duration"
              value={schedule.slotDuration}
              onChange={(e) => setSchedule({ ...schedule, slotDuration: e.target.value })}
              className={`${FIELD} cursor-pointer`}
            >
              <option value="15">15 {txt.minutes}</option>
              <option value="30">30 {txt.minutes}</option>
              <option value="45">45 {txt.minutes}</option>
              <option value="60">{txt.oneHour}</option>
            </select>
          </label>
        </div>
      </section>

      {/* A week is seven things, so it is one row of seven — the shape of the working week is the
          point, and it was wrapping six-and-one with the seventh alone on its own line. */}
      <section>
        <h3 className="mb-1 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
          {txt.closedGroup}
        </h3>
        <p className="mb-3 text-xs font-medium text-ink-muted">{txt.closedHint}</p>
        <div
          data-tour="schedule-days-off"
          className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-4 lg:grid-cols-7"
        >
          {DAYS_OF_WEEK.map((day) => {
            const isOff = schedule.offDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={isOff}
                onClick={(e) => {
                  e.preventDefault();
                  toggleOffDay(day);
                }}
                // No scale on the active state: it nudged the row and moved the wrap point as you
                // clicked. And closed is not an error — red on this page read as "something went
                // wrong on Friday" rather than "we are shut".
                className={`rounded-xl border px-2 py-3 text-center text-[13px] font-bold transition-colors ${
                  isOff
                    ? "border-accent bg-accent-tint text-accent"
                    : "border-line bg-surface-subtle text-ink-muted hover:border-line-strong hover:text-ink-body"
                }`}
              >
                {dayLabel(day)}
              </button>
            );
          })}
        </div>
      </section>

      {isDirty ? (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-ink-slab px-4 py-3 shadow-2xl">
          <span className="text-xs font-bold text-white/70">{txt.unsaved}</span>
          <span className="flex items-center gap-2">
            {discard && (
              <button
                type="button"
                onClick={discard}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white/60 transition hover:text-white disabled:opacity-50"
              >
                <RotateCcw size={14} /> {txt.discard}
              </button>
            )}
            <button
              data-tour="schedule-save"
              type="button"
              onClick={(e) => {
                e.preventDefault();
                void handleSaveClinic(e);
              }}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-ink-on-accent transition hover:bg-accent-strong disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {txt.saveSchedule}
            </button>
          </span>
        </div>
      ) : (
        // The tutorial rings this button, so it has to exist even with nothing to save.
        <div className="sr-only">
          <button data-tour="schedule-save" type="button" onClick={(e) => void handleSaveClinic(e)}>
            {txt.saveSchedule}
          </button>
        </div>
      )}
    </div>
  );
}
