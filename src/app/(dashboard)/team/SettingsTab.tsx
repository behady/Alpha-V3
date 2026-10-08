"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Edit2, ExternalLink, Save, ShieldCheck, Smartphone } from "lucide-react";
import { hoursText, weeklyMinutes, type Schedule } from "@/lib/hrClient";
import { formatStaffRoleLabel } from "@/lib/staffRoles";
import { btnGhost, btnDark, DAYS_AR, DAYS_EN, fieldInput, fieldLabel, money, Section, Stat, type PayDraft, type ProfileStaff } from "./profileKit";

/** The settings that produce every figure on the other tabs: shifts, pay, the linked phone, access. */
export default function SettingsTab({
  staff,
  dentist,
  schedule,
  scheduleAssumed,
  canEdit,
  isAr,
  saving,
  onSavePay,
  onUnlinkDevice,
}: {
  staff: ProfileStaff;
  dentist: boolean;
  schedule: Schedule;
  scheduleAssumed: boolean;
  canEdit: boolean;
  isAr: boolean;
  saving: boolean;
  onSavePay: (draft: PayDraft) => void;
  onUnlinkDevice: () => void;
}) {
  const [payOpen, setPayOpen] = useState(false);
  const [draft, setDraft] = useState<PayDraft | null>(null);
  const days = isAr ? DAYS_AR : DAYS_EN;

  const openPay = () => {
    setDraft({
      baseSalary: staff.baseSalary,
      commissionPercentage: staff.commissionPercentage,
      overtimeMultiplier: staff.overtimeMultiplier || 1.5,
      speciality: staff.speciality || "",
      schedule: JSON.parse(JSON.stringify(schedule)) as Schedule,
    });
    setPayOpen(true);
  };

  const setDay = (day: number, patch: Partial<{ active: boolean; start: string; end: string }>) =>
    setDraft((d) => (d ? { ...d, schedule: { ...d.schedule, [day]: { ...d.schedule[day], ...patch } } } : d));

  const rosterMins = draft ? weeklyMinutes(draft.schedule) : weeklyMinutes(schedule);

  return (
    <>
      <Section
        title={isAr ? "الورديات والمرتب" : "Shifts and pay"}
        note={
          isAr
            ? `الأرقام في باقي الصفحة محسوبة من هنا.${dentist ? " والورديات دي هي كمان اللي بوت الواتساب بيعرض منها مواعيد الدكتور." : ""}`
            : `The figures on the other tabs are worked out from these settings.${dentist ? " The WhatsApp bot also uses these shifts to offer this dentist's free times." : ""}`
        }
        action={
          canEdit && !payOpen ? (
            <button type="button" onClick={openPay} className={btnDark}>
              <Edit2 size={16} /> {isAr ? "تعديل" : "Change"}
            </button>
          ) : undefined
        }
      >
        {scheduleAssumed && (
          <p className="mb-5 flex items-start gap-2.5 rounded-2xl bg-accent-tint px-4 py-3 text-[14px] font-semibold leading-relaxed text-accent-ink">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            {isAr
              ? "مفيش ورديات متسجلة. الأرقام محسوبة على مواعيد العيادة العادية: الأحد لـ الخميس، من ١ الضهر لـ ٩ بالليل."
              : "No shifts are set. The figures assume the clinic's usual hours: Sunday to Thursday, 1pm to 9pm."}
          </p>
        )}
        {!canEdit ? (
          <p className="text-[15px] font-semibold text-ink-muted">
            {isAr ? "المالك والمديرين بس يقدروا يغيّروا دول." : "Only the owner and admins can change these."}
          </p>
        ) : !payOpen || !draft ? (
          <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
            <Stat value={money(staff.baseSalary)} label={isAr ? "المرتب الشهري" : "Monthly salary"} />
            {dentist && <Stat value={`${staff.commissionPercentage}%`} label={isAr ? "نسبة العمولة" : "Commission rate"} />}
            <Stat value={`${staff.overtimeMultiplier || 1.5}×`} label={isAr ? "الساعة الزيادة بتتحسب" : "Extra hours are paid at"} />
            <Stat value={hoursText(weeklyMinutes(schedule))} label={isAr ? "ساعات في الأسبوع" : "Hours a week"} />
            <div className="col-span-2 sm:col-span-4">
              <p className="text-[14px] font-bold text-ink-muted">{isAr ? "أيام الشغل" : "Working days"}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {days.map((label, day) => {
                  const cfg = schedule[day];
                  const on = Boolean(cfg?.active);
                  return (
                    <li
                      key={day}
                      className={`rounded-full px-3.5 py-1.5 text-[14px] font-bold ${on ? "bg-ink-slab text-white" : "border border-line text-ink-muted"}`}
                    >
                      {label}
                      {on && <span className="font-figure ms-2 text-white/60" dir="ltr">{cfg.start}–{cfg.end}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); onSavePay(draft); setPayOpen(false); }}
            className="space-y-6"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { k: "baseSalary" as const, l: isAr ? "المرتب الشهري" : "Monthly salary", step: "1" },
                { k: "commissionPercentage" as const, l: isAr ? "نسبة العمولة %" : "Commission %", step: "0.5" },
                { k: "overtimeMultiplier" as const, l: isAr ? "الساعة الزيادة × كام" : "Extra hours paid at (×)", step: "0.1" },
              ].map((f) => (
                <label key={f.k} className="block">
                  <span className={fieldLabel}>{f.l}</span>
                  <input
                    type="number"
                    min={0}
                    step={f.step}
                    value={draft[f.k]}
                    onChange={(e) => setDraft({ ...draft, [f.k]: Number(e.target.value) })}
                    className={`${fieldInput} font-figure`}
                  />
                </label>
              ))}
              <label className="block">
                <span className={fieldLabel}>{isAr ? "التخصص" : "Speciality"}</span>
                <input
                  type="text"
                  value={draft.speciality}
                  onChange={(e) => setDraft({ ...draft, speciality: e.target.value })}
                  placeholder={isAr ? "مثال: تقويم" : "e.g. Orthodontics"}
                  className={fieldInput}
                />
              </label>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[16px] font-extrabold text-ink">{isAr ? "أيام ومواعيد الشغل" : "Working days and hours"}</span>
                <span className="font-figure text-[15px] font-bold text-ink-body">
                  {hoursText(rosterMins)} {isAr ? "في الأسبوع" : "a week"}
                </span>
              </div>
              <div className="space-y-2">
                {days.map((label, day) => {
                  const cfg = draft.schedule[day] || { active: false, start: "13:00", end: "21:00" };
                  return (
                    <div
                      key={day}
                      className={`flex flex-wrap items-center gap-4 rounded-2xl border px-4 py-3 transition-colors ${
                        cfg.active ? "border-line bg-surface" : "border-line/60 bg-surface-subtle"
                      }`}
                    >
                      <label className="flex min-w-[9rem] cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={cfg.active}
                          onChange={(e) => setDay(day, { active: e.target.checked })}
                          className="size-5 cursor-pointer accent-[#111318]"
                        />
                        <span className={`text-[16px] font-bold ${cfg.active ? "text-ink" : "text-ink-muted"}`}>{label}</span>
                      </label>
                      {cfg.active ? (
                        <div className="flex items-center gap-2.5">
                          <span className="text-[14px] font-semibold text-ink-muted">{isAr ? "من" : "From"}</span>
                          <input
                            type="time"
                            value={cfg.start}
                            onChange={(e) => setDay(day, { start: e.target.value })}
                            className="rounded-xl border border-line bg-surface px-3 py-2 font-figure text-[15px] font-bold text-ink outline-none"
                          />
                          <span className="text-[14px] font-semibold text-ink-muted">{isAr ? "لـ" : "to"}</span>
                          <input
                            type="time"
                            value={cfg.end}
                            onChange={(e) => setDay(day, { end: e.target.value })}
                            className="rounded-xl border border-line bg-surface px-3 py-2 font-figure text-[15px] font-bold text-ink outline-none"
                          />
                        </div>
                      ) : (
                        <span className="text-[14px] font-semibold text-ink-muted">{isAr ? "أجازة" : "Day off"}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/*
              Said where the decision is made. The percentage is not only a future setting: the
              money routes re-read it from the staff record when a payment is edited, so changing it
              can move commission on work already recorded.
            */}
            {dentist && (
              <p className="flex items-start gap-2.5 rounded-2xl bg-surface-subtle px-4 py-3 text-[14px] font-semibold leading-relaxed text-ink-muted">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                {isAr
                  ? "النسبة الجديدة بتتطبّق على الشغل الجديد. لو دفعة قديمة اتعدّلت بعد كده، هتتحسب بالنسبة الجديدة."
                  : "A new commission rate applies to new work. If an older payment is edited later, it is recalculated at the new rate."}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="submit"
                disabled={saving || draft.commissionPercentage < 0 || draft.commissionPercentage > 100 || draft.overtimeMultiplier < 1}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-[15px] font-bold text-ink disabled:opacity-50"
              >
                <Save size={16} /> {isAr ? "حفظ" : "Save"}
              </button>
              <button type="button" onClick={() => setPayOpen(false)} className={`${btnGhost} px-5 py-3 text-[15px]`}>
                {isAr ? "إلغاء" : "Cancel"}
              </button>
            </div>
          </form>
        )}
      </Section>

      {/* --- the phone they clock in from ------------------------------------------------------ */}
      <Section
        title={isAr ? "موبايل الحضور" : "Clock-in phone"}
        note={
          isAr
            ? "الحضور بيتسجل من موبايل واحد مربوط بالشخص. لو غيّر موبايله، فك الربط وهيربط الجديد أول ما يسجّل."
            : "Clock-ins come from one phone linked to the person. If they change phones, unlink it and the new one is linked on their next clock-in."
        }
        action={
          canEdit && staff.registeredDeviceId ? (
            <button type="button" onClick={onUnlinkDevice} className={`${btnGhost} hover:text-danger`}>
              <Smartphone size={16} /> {isAr ? "فك ربط الموبايل" : "Unlink their phone"}
            </button>
          ) : undefined
        }
      >
        <p className="flex items-center gap-2.5 text-[15px] font-semibold text-ink">
          <Smartphone size={18} className="shrink-0 text-ink-muted" />
          {staff.registeredDeviceId
            ? isAr ? "فيه موبايل مربوط." : "A phone is linked."
            : isAr ? "مفيش موبايل مربوط لسه. هيتربط أول ما يسجّل حضور من التطبيق." : "No phone linked yet. It links on their first clock-in from the app."}
        </p>
      </Section>

      {/* --- access ---------------------------------------------------------------------------- */}
      {canEdit && (
        <Section
          title={isAr ? "الصلاحيات" : "What they can open"}
          note={isAr ? "الدور والصلاحيات بيتغيّروا من صفحة المستخدمين." : "Role and permissions are changed on the Users page."}
          action={
            /*
              A LINK, not a second editor. Roles and permissions are changed through a server route
              with its own guards, and a copy of that panel here would be a second door onto the one
              thing in this app that can lock somebody out of their own clinic.
            */
            <Link href="/settings/users" className={btnGhost}>
              <ShieldCheck size={16} /> {isAr ? "إدارة الصلاحيات" : "Manage access"}
              <ExternalLink size={14} />
            </Link>
          }
        >
          <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
            <Stat value={formatStaffRoleLabel(staff, isAr)} label={isAr ? "الدور" : "Role"} />
            <Stat value={String(staff.permissions?.length ?? 0)} label={isAr ? "صلاحية مفتوحة" : "Permissions given"} />
          </div>
        </Section>
      )}
    </>
  );
}
