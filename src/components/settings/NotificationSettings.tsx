"use client";

import { useCallback, useMemo, useState } from "react";
import { Bell, BellOff, Check, Loader2, Moon, RotateCcw, Save, Smartphone, User } from "lucide-react";
import { doc, setDoc } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useSettingsText } from "@/lib/useSettingsText";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import {
  NOTIFY_EVENTS,
  NOTIFY_GROUPS,
  NOTIFY_ROLES,
  mutedEventsFor,
  notifyTiming,
  resolveNotify,
  withMute,
  type AlertPreferences,
  type NotifyEvent,
  type NotifyRole,
} from "@/lib/notificationCatalog";

/**
 * The notification centre.
 *
 * It replaces two switches. Those two were the whole of a clinic's control over thirty alerts —
 * and one of them did not work, because the screen saved `alertPreferences` to the settings
 * document while the server read it from the clinic document. Every alert now comes from
 * `lib/notificationCatalog`, which is the same list the Cloud Functions read, so a row cannot
 * exist here for something that never fires, and nothing can fire that has no row here.
 *
 * Three decisions visible in the layout:
 *
 *  - **Two columns, not one.** The bell and the phone are genuinely different questions. A clinic
 *    wants the evening money figure in the bell to read tomorrow, and does not want it buzzing a
 *    pocket at 21:00 in front of a patient.
 *  - **Who it goes to is on the row.** The audience was the least visible and most surprising part
 *    of the old behaviour — "why does reception see the money?" — so it is on the surface, and the
 *    alerts whose audience is part of what they *are* say so instead of offering a choice.
 *  - **Mine only, at the bottom, saving as you tap.** A personal mute is not the clinic's business
 *    and has no place behind the clinic's Save button. It writes to the person's own user
 *    document, which is also the only document they are allowed to write.
 */

type Prefs = AlertPreferences;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** One switch. Small, because a row carries two of them plus a role list. */
function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
        on ? "bg-accent" : "bg-surface-muted"
      }`}
    >
      {/* Positioned on the logical inline-start edge: `translate-x` moves the knob right in
          Arabic too, where "on" is the left end. */}
      <span
        className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-all ${
          on ? "start-[21px]" : "start-[3px]"
        }`}
      />
    </button>
  );
}

function RoleChip({
  role,
  on,
  onChange,
  disabled,
}: {
  role: NotifyRole;
  on: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  const { language } = useLanguage();
  const ar = language === "ar";
  const name: Record<NotifyRole, { en: string; ar: string }> = {
    Owner: { en: "Owner", ar: "المالك" },
    Admin: { en: "Admin", ar: "مدير" },
    Dentist: { en: "Dentist", ar: "دكتور" },
    Receptionist: { en: "Reception", ar: "استقبال" },
    Assistant: { en: "Assistant", ar: "مساعد" },
  };
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onChange}
      className={`rounded-full px-2.5 py-1 text-[11px] font-black transition-colors disabled:opacity-40 ${
        on ? "bg-ink-slab text-white" : "border border-line bg-surface text-ink-faint hover:text-ink"
      }`}
    >
      {ar ? name[role].ar : name[role].en}
    </button>
  );
}

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
  const { language, isRTL } = useLanguage();
  const txt = useSettingsText("alerts");
  const { user } = useAuth();
  const { clinicId } = useClinic();
  const isAr = language === "ar";

  // Memoised because the whole page derives from it: a fresh `{}` on every render would make
  // every row recompute and the "on" count flicker.
  const prefs = useMemo<Prefs>(() => (clinicData.alertPreferences as Prefs) || {}, [clinicData.alertPreferences]);

  const patch = useCallback(
    (next: (current: Prefs) => Prefs) =>
      setClinicData((prev) => ({
        ...prev,
        alertPreferences: next((prev.alertPreferences as Prefs) || {}),
      })),
    [setClinicData],
  );

  const setChannel = (eventId: string, key: "bell" | "push", value: boolean) =>
    patch((current) => ({
      ...current,
      events: { ...(current.events || {}), [eventId]: { ...(current.events?.[eventId] || {}), [key]: value } },
    }));

  const toggleRole = (event: NotifyEvent, role: NotifyRole) =>
    patch((current) => {
      const resolved = resolveNotify(event.id, current);
      const now = new Set(resolved?.roles || event.roles);
      if (now.has(role)) now.delete(role);
      else now.add(role);
      // Written in the catalogue's order rather than click order, so two admins setting the same
      // audience produce the same document and the Save button is honest about what changed.
      const roles = NOTIFY_ROLES.filter((r) => now.has(r));
      return {
        ...current,
        events: { ...(current.events || {}), [event.id]: { ...(current.events?.[event.id] || {}), roles: [...roles] } },
      };
    });

  const setTiming = (eventId: string, key: string, value: number) =>
    patch((current) => ({
      ...current,
      timings: { ...(current.timings || {}), [eventId]: { ...(current.timings?.[eventId] || {}), [key]: value } },
    }));

  const setQuiet = (key: "enabled" | "fromHour" | "toHour", value: boolean | number) =>
    patch((current) => ({ ...current, quietHours: { ...(current.quietHours || {}), [key]: value } as never }));

  const quiet = prefs.quietHours || {};
  const onCount = useMemo(
    () => NOTIFY_EVENTS.filter((e) => { const r = resolveNotify(e.id, prefs); return r?.bell || r?.push; }).length,
    [prefs],
  );

  /* --- the test button ------------------------------------------------------------------------ */
  const [testing, setTesting] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, "ok" | "fail">>({});
  const sendTest = async (eventId: string) => {
    if (!clinicId) return;
    setTesting(eventId);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/notifications/raise", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken || ""}` },
        body: JSON.stringify({ clinicId, event: eventId, test: true }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
      setTested((t) => ({ ...t, [eventId]: res.ok && json.ok ? "ok" : "fail" }));
    } catch {
      setTested((t) => ({ ...t, [eventId]: "fail" }));
    } finally {
      setTesting(null);
    }
  };

  /* --- mine only ----------------------------------------------------------------------------- */
  const myMutes = mutedEventsFor(
    (user as { notificationMutes?: Record<string, string[]> } | null)?.notificationMutes,
    clinicId,
  );
  const [savingMine, setSavingMine] = useState<string | null>(null);
  const toggleMine = async (eventId: string) => {
    if (!user?.uid || !clinicId) return;
    setSavingMine(eventId);
    const next = withMute(myMutes, eventId, !myMutes.includes(eventId));
    try {
      // Merged into a per-clinic map: a person who works at two clinics mutes at one of them
      // without going quiet at the other. AuthContext is subscribed, so the switch settles itself.
      await setDoc(doc(db, "users", user.uid), { notificationMutes: { [clinicId]: next } }, { merge: true });
    } catch {
      /* The switch springs back on the next snapshot, which is the honest failure. */
    } finally {
      setSavingMine(null);
    }
  };

  return (
    <div className="w-full space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
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
            {onCount} / {NOTIFY_EVENTS.length} {txt.alertsOn}
          </p>
        </div>
      </div>

      {/* Quiet hours first: it is the one setting that changes every row below it. */}
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-start justify-between gap-4 px-4 py-3.5">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[15px] font-bold text-ink">
              <Moon size={15} className="text-ink-muted" />
              {txt.quietTitle}
            </p>
            <p className="mt-1 max-w-2xl text-[12.5px] font-medium leading-relaxed text-ink-muted">{txt.quietNote}</p>
          </div>
          <Toggle on={quiet.enabled === true} onChange={() => setQuiet("enabled", !quiet.enabled)} label={txt.quietTitle} />
        </div>
        {quiet.enabled && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
            <label className="flex items-center gap-2 text-[12.5px] font-bold text-ink-body">
              {txt.quietFrom}
              <select
                value={typeof quiet.fromHour === "number" ? quiet.fromHour : 22}
                onChange={(e) => setQuiet("fromHour", Number(e.target.value))}
                className="rounded-xl border border-line bg-surface px-2.5 py-1.5 font-figure text-[13px] text-ink"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[12.5px] font-bold text-ink-body">
              {txt.quietTo}
              <select
                value={typeof quiet.toHour === "number" ? quiet.toHour : 8}
                onChange={(e) => setQuiet("toHour", Number(e.target.value))}
                className="rounded-xl border border-line bg-surface px-2.5 py-1.5 font-figure text-[13px] text-ink"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </section>

      {NOTIFY_GROUPS.map((group) => {
        const events = NOTIFY_EVENTS.filter((e) => e.group === group.id);
        if (events.length === 0) return null;
        return (
          <section key={group.id}>
            <h3 className="mb-1 px-1 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
              {isAr ? group.ar : group.en}
            </h3>
            <p className="mb-3 px-1 text-[12px] font-medium leading-relaxed text-ink-faint">
              {isAr ? group.noteAr : group.noteEn}
            </p>
            <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {events.map((event) => {
                const resolved = resolveNotify(event.id, prefs);
                const bell = resolved?.bell === true;
                const push = resolved?.push === true;
                const roles = resolved?.roles || [];
                const offered = event.rolesMax ? NOTIFY_ROLES.filter((r) => event.rolesMax!.includes(r)) : NOTIFY_ROLES;
                const state = tested[event.id];
                return (
                  <div key={event.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[14.5px] font-bold leading-snug text-ink">{isAr ? event.ar : event.en}</p>
                        <p className="mt-0.5 text-[12px] font-medium leading-relaxed text-ink-muted">
                          {isAr ? event.whenAr : event.whenEn}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        <span className="flex flex-col items-center gap-1">
                          <span className="text-[9.5px] font-black uppercase tracking-wider text-ink-faint">
                            {txt.bellCol}
                          </span>
                          <Toggle on={bell} onChange={() => setChannel(event.id, "bell", !bell)} label={txt.bellCol} />
                        </span>
                        <span className="flex flex-col items-center gap-1">
                          <span className="text-[9.5px] font-black uppercase tracking-wider text-ink-faint">
                            {txt.pushCol}
                          </span>
                          <Toggle on={push} onChange={() => setChannel(event.id, "push", !push)} label={txt.pushCol} />
                        </span>
                      </div>
                    </div>

                    {(bell || push) && (
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="me-1 text-[10.5px] font-black uppercase tracking-wider text-ink-faint">
                            {txt.goesTo}
                          </span>
                          {event.rolesFixed ? (
                            <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-black text-ink-body">
                              {txt.fixedAudience}
                            </span>
                          ) : (
                            offered.map((role) => (
                              <RoleChip
                                key={role}
                                role={role}
                                on={roles.includes(role)}
                                onChange={() => toggleRole(event, role)}
                              />
                            ))
                          )}
                        </span>

                        {event.timings?.map((timing) => (
                          <label
                            key={timing.key}
                            className="flex items-center gap-2 text-[11.5px] font-bold text-ink-body"
                          >
                            {isAr ? timing.ar : timing.en}
                            {timing.kind === "hourOfDay" ? (
                              <select
                                value={notifyTiming(event.id, timing.key, prefs)}
                                onChange={(e) => setTiming(event.id, timing.key, Number(e.target.value))}
                                className="rounded-xl border border-line bg-surface px-2 py-1 font-figure text-[12.5px] text-ink"
                              >
                                {HOURS.map((h) => (
                                  <option key={h} value={h}>
                                    {hourLabel(h)}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="inline-flex items-center gap-1">
                                <input
                                  type="number"
                                  min={timing.min}
                                  max={timing.max}
                                  value={notifyTiming(event.id, timing.key, prefs)}
                                  onChange={(e) => setTiming(event.id, timing.key, Number(e.target.value))}
                                  className="w-16 rounded-xl border border-line bg-surface px-2 py-1 font-figure text-[12.5px] text-ink"
                                />
                                <span className="text-[11px] font-bold text-ink-faint">
                                  {timing.kind === "hours" ? (isAr ? "ساعة" : "h") : isAr ? "دقيقة" : "min"}
                                </span>
                              </span>
                            )}
                          </label>
                        ))}

                        <button
                          type="button"
                          onClick={() => void sendTest(event.id)}
                          disabled={testing === event.id || !clinicId}
                          className="ms-auto inline-flex items-center gap-1.5 rounded-xl border border-line px-2.5 py-1 text-[11px] font-black text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
                        >
                          {testing === event.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : state === "ok" ? (
                            <Check size={12} className="text-ok" />
                          ) : (
                            <Smartphone size={12} />
                          )}
                          {state === "ok" ? txt.testSent : state === "fail" ? txt.testFailed : txt.test}
                        </button>
                      </div>
                    )}

                    {!bell && !push && (
                      <p className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-black text-ink-faint">
                        <BellOff size={12} />
                        {txt.offEverywhere}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* --- Mine only. Saves itself; deliberately outside the clinic's Save button. --------- */}
      <section>
        <h3 className="mb-1 flex items-center gap-2 px-1 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
          <User size={12} />
          {txt.mineTitle}
        </h3>
        <p className="mb-3 px-1 max-w-2xl text-[12px] font-medium leading-relaxed text-ink-faint">{txt.mineNote}</p>
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {NOTIFY_EVENTS.map((event) => {
            const resolved = resolveNotify(event.id, prefs);
            const clinicHasIt = resolved?.bell || resolved?.push;
            const muted = myMutes.includes(event.id);
            return (
              <div key={event.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <span className="min-w-0 text-[13.5px] font-medium text-ink">
                  {isAr ? event.ar : event.en}
                  {!clinicHasIt && (
                    <span className="ms-2 text-[11px] font-bold text-ink-faint">({txt.clinicOff})</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {savingMine === event.id && <Loader2 size={13} className="animate-spin text-ink-faint" />}
                  <Toggle
                    on={!muted}
                    disabled={!clinicHasIt}
                    onChange={() => void toggleMine(event.id)}
                    label={muted ? txt.mineMuted : txt.mineOn}
                  />
                </span>
              </div>
            );
          })}
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
        silently did nothing. A setting that lies costs trust twice: once for not delivering,
        and again for having claimed it would. The saved preference keys under
        alertPreferences.email are left untouched so nothing breaks for clinics that set them.
      */}
    </div>
  );
}
