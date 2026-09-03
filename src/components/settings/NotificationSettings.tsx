"use client";

import { Bell, Loader2, RotateCcw, Save } from "lucide-react";
import { useSettingsText } from "@/lib/useSettingsText";
import { useLanguage } from "@/context/LanguageContext";

/**
 * One switch, on a row of its own.
 *
 * The label sits at medium weight rather than bold: a list where every row shouts is a list with
 * no hierarchy, and the switch is the thing being read here.
 */
const ToggleRow = ({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) => (
  <div
    className={`flex items-center justify-between gap-6 px-4 py-3 ${
      disabled ? "pointer-events-none opacity-50" : ""
    }`}
  >
    <span className="min-w-0 text-[15px] font-medium text-ink">{label}</span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative inline-flex h-[30px] w-[50px] shrink-0 items-center rounded-full transition-colors focus:outline-none ${
        checked ? "bg-accent" : "bg-surface-muted"
      }`}
    >
      {/* Positioned on the logical inline-start edge, not translated along a physical axis:
          `translate-x` moves the knob right in Arabic too, where "on" is the left end — far
          enough that it leaves the track altogether. */}
      <span
        className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-all ${
          checked ? "start-[23px]" : "start-[3px]"
        }`}
      />
    </button>
  </div>
);

export default function NotificationSettings({
  clinicData,
  setClinicData,
  handleSaveClinic,
  isDirty,
  discard,
  saving,
}: {
  clinicData: Record<string, unknown>;
  setClinicData: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  handleSaveClinic: (e?: { preventDefault?: () => void }) => void | Promise<void>;
  isDirty?: boolean;
  discard?: () => void;
  saving?: boolean;
}) {
  const { isRTL } = useLanguage();
  const txt = useSettingsText("alerts");

  type Prefs = { inApp?: Record<string, boolean> };
  const prefs = (clinicData.alertPreferences as Prefs) || {};

  // Arrival is on unless deliberately switched off: the push works out of the box, and this is
  // the switch that turns it off (read by onPatientCheckedIn). Lab is off until asked for.
  const arrivalOn = prefs.inApp?.patientArrival !== false;
  const labOn = !!prefs.inApp?.labReady;

  const setInApp = (event: string, next: boolean) =>
    setClinicData((prev) => {
      const current = (prev.alertPreferences as Prefs) || {};
      return {
        ...prev,
        alertPreferences: {
          ...current,
          inApp: { ...(current.inApp || {}), [event]: next },
        },
      };
    });

  const onCount = [arrivalOn, labOn].filter(Boolean).length;

  return (
    <div className="w-full space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* Who sees these, which is the question the switches cannot answer for themselves. The
          count is the one fact worth reading before the list. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="min-w-0 space-y-2">
          <p className="flex items-center gap-2 font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
            <Bell size={12} />
            {txt.title}
          </p>
          <p className="max-w-xl font-display text-[15px] font-bold leading-relaxed text-white sm:text-base">
            {txt.railNote}
          </p>
          <p className="font-figure text-[13px] tracking-tight text-white/70">
            {onCount} / 2 {txt.alertsOn}
          </p>
        </div>
      </div>

      <section>
        <h3 className="mb-3 px-1 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
          {txt.inAppTitle}
        </h3>
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          <ToggleRow
            label={txt.eventPatientArrival}
            checked={arrivalOn}
            onChange={() => setInApp("patientArrival", !arrivalOn)}
          />
          <ToggleRow
            label={txt.eventLabReady}
            checked={labOn}
            onChange={() => setInApp("labReady", !labOn)}
          />
        </div>
      </section>

      {isDirty && (
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
              type="button"
              onClick={(e) => void handleSaveClinic(e)}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-ink-on-accent transition hover:bg-accent-strong disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {txt.save}
            </button>
          </span>
        </div>
      )}

      {/*
        The "Email Reports" section that used to sit here — an admin email address plus toggles
        for a daily revenue summary and low-stock warnings — has been removed.

        Nothing in this project can send an email. There is no mail library in package.json and
        no sending code anywhere in src/. The section collected an address, saved it, and then
        silently did nothing, so a clinic would configure it and wait indefinitely for reports
        that were never coming. A setting that lies costs trust twice: once for not delivering,
        and again for having claimed it would.

        Restoring this means adding a real sender (Resend or SES), a scheduled job to build the
        summary, and a way for the clinic to see that the last send actually succeeded. Until
        all three exist, the honest interface is no interface. The saved preference keys under
        alertPreferences.email are left untouched so nothing breaks for clinics that already
        set them.
      */}
    </div>
  );
}
