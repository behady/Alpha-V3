"use client";

/**
 * The team, one person at a time.
 *
 * Team Overview used to be a second mode of the attendance screen: a wide table with a row per
 * person, and two modals hanging off each row — one for their shift and pay, one for their punches.
 * Three surfaces, and none of them agreed about the period. Answering "is Hana being paid right"
 * meant reading a row, opening a cog, opening a clock, and holding the arithmetic in your head.
 *
 * So the team becomes its own page, and a person becomes the unit: tap a face, get that person's
 * hours, every clock-in and clock-out with how far from the clinic it was taken, what they earned
 * payment by payment, and the roster and rate that produced all of it — in one column, with nothing
 * opening over anything else.
 *
 * Two deliberate calls worth knowing about:
 *
 *  - The pay figures come from `buildHrSection`, the same function the nightly brief and
 *    /api/payroll use, run here in the browser. It is a pure function, and running it rather than
 *    keeping a fourth copy of the same sums is how this page and the brief stop disagreeing about
 *    somebody's wages. It is run in the browser rather than fetched because the route refuses
 *    anyone without HR access, and a dentist should be able to read their own figures.
 *  - Commission is the STORED `doctorCommissionAmount` on each payment, which is what the reports
 *    add up. The old screen recalculated it, so for older rows it quietly disagreed with Reports →
 *    Dentist Performance. A person's own profile is the worst place for that.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Users } from "lucide-react";
import { Timestamp, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { logActivity } from "@/lib/logger";
import { deleteRecord, RecycleBinError } from "@/lib/recycleBinApi";
import FeatureGate from "@/components/FeatureGate";
import PageHeader from "@/components/dashboard/PageHeader";
import { buildHrSection } from "@/lib/automation/briefing/hr";
import type { HrStaffRow } from "@/lib/automation/briefing/types";
import type { PunchRecord, StaffRecord } from "@/lib/automation/briefing/data";
import { expectedScheduleFor, punchRecordFrom, staffRecordFrom, type Schedule } from "@/lib/hrClient";
import { commissionByStaff, NO_COMMISSION, type StaffCommission } from "@/lib/staffCommission";
import { presetOf, rangeFor, rangeText, getFirstDay, getToday, type DateRange, type RangePreset } from "@/lib/reportHelpers";
import { isDentistStaff } from "@/lib/staffRoles";
import TeamRail, { type RailPerson } from "./TeamRail";
import StaffProfile, { type PayDraft, type ProfileStaff } from "./StaffProfile";

type StaffDoc = { id: string } & Record<string, unknown>;

/** Local calendar day, matching how a punch is filed. A UTC slice moves an evening shift a day. */
function localYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function TeamPage() {
  const { user } = useAuth();
  const { isAdmin, clinicId, clinic } = useClinic();
  const { language } = useLanguage();
  const { showToast, confirm } = useUI();
  const router = useRouter();
  const params = useSearchParams();
  const isAr = language === "ar";

  /**
   * Who may look at the team, character for character the same test the attendance screen makes.
   * Deliberately NOT the same as who may change a rate — reading the roster is a rota question,
   * changing somebody's wage is not.
   */
  const canAdmin =
    isAdmin ||
    user?.permissions?.includes("attendance.admin") ||
    user?.permissions?.includes("access.settings");
  const canEdit = Boolean(isAdmin);

  const [range, setRange] = useState<DateRange>({ start: getFirstDay(), end: getToday() });
  const preset = presetOf(range);
  const [staffDocs, setStaffDocs] = useState<StaffDoc[]>([]);
  const [punches, setPunches] = useState<PunchRecord[]>([]);
  const [ledger, setLedger] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedId = params.get("staff");

  /**
   * The team, the punches and the money, each in one listener.
   *
   * The old screen re-created all three every time the logs modal opened or closed, because the
   * modal's state was in the effect's dependencies — so opening somebody's punch list re-read the
   * whole month's ledger. Here, selecting a person is the main interaction on the page, so it must
   * cost nothing: the selection lives in the URL and touches no listener.
   */
  useEffect(() => {
    if (!canAdmin || !clinicId) return;
    const unsubStaff = onSnapshot(getClinicCollection("staff"), (snap) => {
      setStaffDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    const unsubPunches = onSnapshot(
      query(
        getClinicCollection("attendance"),
        where("checkIn", ">=", Timestamp.fromDate(new Date(`${range.start}T00:00:00`))),
        where("checkIn", "<=", Timestamp.fromDate(new Date(`${range.end}T23:59:59.999`))),
      ),
      (snap) => {
        // The `attendance` collection also holds waiting-room check-ins for PATIENTS; only a staff
        // punch carries `userId`, so that is the filter rather than a guess at the shape.
        setPunches(
          snap.docs
            .map((d) => punchRecordFrom(d.id, d.data() as Record<string, unknown>))
            .filter((p) => p.userId)
            .sort((a, b) => (b.checkIn?.getTime() ?? 0) - (a.checkIn?.getTime() ?? 0)),
        );
      },
    );
    const unsubLedger = onSnapshot(
      query(
        getClinicCollection("ledger"),
        where("date", ">=", range.start),
        where("date", "<=", range.end),
      ),
      (snap) => setLedger(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );
    return () => {
      unsubStaff();
      unsubPunches();
      unsubLedger();
    };
  }, [canAdmin, clinicId, range.start, range.end]);

  const staffRecords: StaffRecord[] = useMemo(
    () => staffDocs.map((d) => staffRecordFrom(d.id, d as Record<string, unknown>)),
    [staffDocs],
  );

  const hrRows: Map<string, HrStaffRow> = useMemo(() => {
    if (staffRecords.length === 0) return new Map();
    const now = new Date();
    const { section } = buildHrSection({
      staff: staffRecords,
      punches: punches as PunchRecord[],
      startDate: range.start,
      endDate: range.end,
      today: localYmd(now),
      nowMinutes: now.getHours() * 60 + now.getMinutes(),
      timeZone: "Africa/Cairo",
      geofenceRadiusM: Number((clinic as { geofenceRadiusM?: number } | null)?.geofenceRadiusM) || 200,
      monthStart: getFirstDay(),
    });
    return new Map(section.staff.map((r) => [r.staffId, r]));
  }, [staffRecords, punches, range.start, range.end, clinic]);

  const commissions: Map<string, StaffCommission> = useMemo(
    () => commissionByStaff(ledger, staffDocs.map((d) => ({ id: d.id, name: String(d.name ?? "") }))),
    [ledger, staffDocs],
  );

  /**
   * The rail, from the STAFF list rather than from the payroll result.
   *
   * `buildHrSection` drops a person with no punches and no schedule, which is exactly the new hire
   * somebody is looking for. A team page that hid the people who have not clocked in yet would be
   * missing the ones worth checking.
   */
  const people: RailPerson[] = useMemo(
    () =>
      staffDocs
        .map((d) => {
          const row = hrRows.get(d.id);
          return {
            id: d.id,
            name: String(d.name ?? "") || (isAr ? "بدون اسم" : "Unnamed"),
            role: String(d.role ?? "Staff"),
            isDentist: d.isDentist === true,
            photoURL: typeof d.photoURL === "string" ? d.photoURL : null,
            onFloor: Boolean(row?.activeNow),
            needsAttention: Boolean(
              row && (row.absentDays > 0 || row.openShifts > 0 || row.overtimePendingMinutes > 0),
            ),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, isAr ? "ar" : "en")),
    [staffDocs, hrRows, isAr],
  );

  // Seed the selection once the team arrives, without adding a history entry for it.
  useEffect(() => {
    if (selectedId || people.length === 0) return;
    router.replace(`/attendance/team?staff=${people[0].id}`, { scroll: false });
  }, [selectedId, people, router]);

  const selectedDoc = staffDocs.find((d) => d.id === selectedId) || null;

  const profileStaff: ProfileStaff | null = useMemo(() => {
    if (!selectedDoc) return null;
    const d = selectedDoc as Record<string, unknown>;
    return {
      id: selectedDoc.id,
      uid: typeof d.uid === "string" ? d.uid : undefined,
      name: String(d.name ?? "") || (isAr ? "بدون اسم" : "Unnamed"),
      role: String(d.role ?? "Staff"),
      isDentist: d.isDentist === true,
      phone: typeof d.phone === "string" ? d.phone : undefined,
      email: typeof d.email === "string" ? d.email : undefined,
      speciality: typeof d.speciality === "string" ? d.speciality : undefined,
      baseSalary: Number(d.baseSalary) || 0,
      commissionPercentage: Number(d.commissionPercentage) || 0,
      overtimeMultiplier: Number(d.overtimeMultiplier) || 1.5,
      registeredDeviceId: typeof d.registeredDeviceId === "string" ? d.registeredDeviceId : null,
      permissions: Array.isArray(d.permissions) ? (d.permissions as string[]) : [],
    };
  }, [selectedDoc, isAr]);

  const selectedSchedule: { schedule: Schedule; assumed: boolean } = useMemo(
    () => expectedScheduleFor((selectedDoc as Record<string, unknown> | null)?.attendanceSchedule),
    [selectedDoc],
  );

  const selectedPunches = useMemo(
    () =>
      selectedDoc
        ? punches.filter((p) => p.userId === (selectedDoc.uid || selectedDoc.id) || p.staffId === selectedDoc.id)
        : [],
    [punches, selectedDoc],
  );

  /* --- writes ------------------------------------------------------------------------------- */

  const savePay = useCallback(
    async (draft: PayDraft) => {
      if (!selectedDoc) return;
      setSaving(true);
      try {
        await updateDoc(getClinicDoc("staff", selectedDoc.id), {
          attendanceSchedule: draft.schedule,
          overtimeMultiplier: draft.overtimeMultiplier,
          baseSalary: draft.baseSalary,
          commissionPercentage: draft.commissionPercentage,
          // Firestore refuses `undefined` outright, so an empty box is stored as an empty string.
          speciality: draft.speciality.trim(),
        });
        await logActivity(
          { uid: user?.uid, name: user?.name, role: user?.role },
          "Staff Attendance Settings Updated",
          `Updated shift, pay and speciality for ${String(selectedDoc.name ?? selectedDoc.id)}`,
        );
        showToast(isAr ? "اتحفظ" : "Saved", "success");
      } catch (err) {
        // The code names which of the three it was: a rules refusal (wrong role, or a suspended
        // clinic, whose writes the rules freeze on purpose), a missing row, or something else.
        const e = err as { code?: string; message?: string };
        showToast(`${isAr ? "مقدرناش نحفظ" : "Could not save"}: ${e?.code || e?.message || "unknown"}`, "error");
      } finally {
        setSaving(false);
      }
    },
    [selectedDoc, user, showToast, isAr],
  );

  const editLog = useCallback(
    async (logId: string, checkInStr: string, checkOutStr: string) => {
      if (!checkInStr) return;
      try {
        const inDate = new Date(checkInStr);
        const updates: Record<string, unknown> = {
          checkIn: Timestamp.fromDate(inDate),
          // Filed by LOCAL day, or correcting a late-evening shift moves it to another date.
          date: localYmd(inDate),
        };
        if (checkOutStr) {
          const outDate = new Date(checkOutStr);
          updates.checkOut = Timestamp.fromDate(outDate);
          updates.durationMinutes = Math.max(0, Math.round((outDate.getTime() - inDate.getTime()) / 60000));
          updates.status = "completed";
        } else {
          updates.checkOut = null;
          updates.durationMinutes = 0;
          updates.status = "active";
        }
        await updateDoc(getClinicDoc("attendance", logId), updates);
        await logActivity(
          { uid: user?.uid, name: user?.name, role: user?.role },
          "Attendance Log Updated",
          `Updated attendance log ${logId}`,
        );
        showToast(isAr ? "اتعدّل" : "Updated", "success");
      } catch {
        showToast(isAr ? "مقدرناش نعدّل" : "Could not update that log", "error");
      }
    },
    [user, showToast, isAr],
  );

  const removeLog = useCallback(
    async (logId: string) => {
      const ok = await confirm(
        isAr ? "تحذف الوقت ده؟ هيأثر على الحسابات." : "Delete this time log? It affects payroll.",
      );
      if (!ok) return;
      try {
        await deleteRecord(clinicId || "", "attendance", logId);
      } catch (err) {
        showToast(err instanceof RecycleBinError ? err.message : isAr ? "مقدرناش نحذف" : "Could not delete the log.", "error");
        return;
      }
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Attendance Log Deleted",
        `Deleted attendance log ${logId}`,
        "system_logs",
        { severity: "HIGH", module: "attendance" },
      );
      showToast(isAr ? "اتنقل للمحذوفات" : "Moved to Recently Deleted.", "info");
    },
    [clinicId, confirm, user, showToast, isAr],
  );

  const decideOvertime = useCallback(
    async (logId: string, decision: "approved" | "rejected") => {
      try {
        await updateDoc(getClinicDoc("attendance", logId), { overtimeStatus: decision });
        await logActivity(
          { uid: user?.uid, name: user?.name, role: user?.role },
          "Overtime Decision",
          `Overtime for log ${logId} was ${decision}`,
        );
        showToast(isAr ? (decision === "approved" ? "تمت الموافقة" : "اترفض") : `Overtime ${decision}`, "success");
      } catch {
        showToast(isAr ? "مقدرناش نحدّث" : "Failed to update overtime status", "error");
      }
    },
    [user, showToast, isAr],
  );

  const unlinkDevice = useCallback(async () => {
    if (!selectedDoc) return;
    const ok = await confirm(
      isAr
        ? `تفك ربط موبايل ${String(selectedDoc.name ?? "")}؟`
        : `Unlink ${String(selectedDoc.name ?? "")}'s phone?`,
    );
    if (!ok) return;
    try {
      await updateDoc(getClinicDoc("staff", selectedDoc.id), { registeredDeviceId: null });
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Staff Device Unlinked",
        `Unlinked attendance device for ${String(selectedDoc.name ?? selectedDoc.id)}`,
        "system_logs",
        { severity: "CRITICAL", module: "attendance" },
      );
      showToast(isAr ? "اتفك" : "Device unlinked.", "success");
    } catch {
      showToast(isAr ? "مقدرناش نفك الربط" : "Failed to unlink device.", "error");
    }
  }, [selectedDoc, confirm, user, showToast, isAr]);

  /* --- render ------------------------------------------------------------------------------- */

  const presets: { id: Exclude<RangePreset, "custom">; en: string; ar: string }[] = [
    { id: "today", en: "Today", ar: "النهارده" },
    { id: "week", en: "This week", ar: "الأسبوع ده" },
    { id: "month", en: "This month", ar: "الشهر ده" },
    { id: "lastMonth", en: "Last month", ar: "الشهر اللي فات" },
  ];

  if (!canAdmin) {
    return (
      <div className="min-h-full pb-24 lg:pb-10">
        <PageHeader
          title={isAr ? "الفريق" : "Team"}
          subtitle={isAr ? "للمالك والمديرين" : "Owner and admins"}
          backHref="/attendance"
        />
        <div className="mx-auto max-w-[1600px] px-4 pt-6 md:px-6 xl:px-10">
          <p className="rounded-3xl border border-line bg-surface px-6 py-14 text-center text-sm font-bold text-ink-muted">
            {isAr ? "الصفحة دي مش متاحة لدورك." : "This page is not available for your role."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full pb-24 lg:pb-10" dir={isAr ? "rtl" : "ltr"}>
      <PageHeader
        title={isAr ? "الفريق" : "Team"}
        subtitle={rangeText(range, isAr)}
        backHref="/attendance"
      >
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setRange(rangeFor(p.id))}
            className={`rounded-full px-3.5 py-2 text-[13px] font-bold transition-colors ${
              preset === p.id
                ? "bg-[#FACC15] text-ink"
                : "border border-white/15 bg-white/5 text-white/70 hover:bg-white/15"
            }`}
          >
            {isAr ? p.ar : p.en}
          </button>
        ))}
      </PageHeader>

      <div className="mx-auto max-w-[1600px] space-y-4 px-4 pt-5 md:px-6 xl:px-10 xl:pt-7">
        {loading ? (
          <div className="flex items-center justify-center gap-2.5 rounded-3xl border border-line bg-surface px-6 py-16 text-ink-muted">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm font-bold">{isAr ? "بنحضّر الفريق…" : "Loading the team…"}</span>
          </div>
        ) : people.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-line bg-surface-subtle px-6 py-14 text-center">
            <Users size={22} className="text-ink-muted" />
            <p className="text-sm font-bold text-ink">{isAr ? "مفيش حد في الفريق لسه." : "Nobody on the team yet."}</p>
            <Link href="/settings/users" className="text-[13px] font-bold text-ink-body underline">
              {isAr ? "ضيف الفريق" : "Add your team"}
            </Link>
          </div>
        ) : (
          <>
            <TeamRail
              people={people}
              selectedId={selectedId}
              onSelect={(id) => router.replace(`/attendance/team?staff=${id}`, { scroll: false })}
              isAr={isAr}
            />
            {profileStaff && (
              <div data-tour="team-profile">
                <StaffProfile
                  staff={profileStaff}
                  row={hrRows.get(profileStaff.id) ?? null}
                  schedule={selectedSchedule.schedule}
                  scheduleAssumed={selectedSchedule.assumed}
                  punches={selectedPunches}
                  commission={
                    isDentistStaff(profileStaff)
                      ? commissions.get(profileStaff.id) ?? NO_COMMISSION
                      : NO_COMMISSION
                  }
                  canEdit={canEdit}
                  isAr={isAr}
                  saving={saving}
                  onSavePay={savePay}
                  onEditLog={editLog}
                  onDeleteLog={removeLog}
                  onOvertime={decideOvertime}
                  onUnlinkDevice={unlinkDevice}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Sold as part of the attendance add-on: the page renders only once the subscription says so. */
export default function TeamPageGated() {
  return (
    <FeatureGate feature="attendance">
      {/*
        No PermissionGuard, deliberately, and matching /attendance: every member of staff may open
        the attendance area because that is where they clock in, and the sensitive half is gated on
        the page itself by `canAdmin`. A guard here would need a permission key that does not exist
        (`access.attendance`), which would lock the page for everyone including the owner.

        `useSearchParams` needs a Suspense boundary above it to prerender.
      */}
      <Suspense fallback={null}>
        <TeamPage />
      </Suspense>
    </FeatureGate>
  );
}
