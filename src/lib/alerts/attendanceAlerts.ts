/**
 * Who the owner hears about as late or absent, and when. Pure: no Firestore, no clock.
 *
 * Both alerts are measured from each person's OWN shift start. The absent alert used to fire at
 * one clinic-wide hour (11:00), which in clinics that open in the afternoon told the owner every
 * receptionist was "absent" three hours before her shift began — and, being past that hour, it
 * also silenced the late alert for the whole afternoon.
 *
 *   late   = shift start + grace minutes, still no clock-in
 *   absent = shift start + N hours, still no clock-in (and then late is no longer sent)
 */

export type RosterRow = { uid: string; name: string; start: string | null };

export type AttendanceAlert = {
  event: "staffLate" | "staffAbsent";
  uid: string;
  title: string;
  body: string;
};

export type AttendanceAlertInput = {
  roster: RosterRow[];
  /** uids with any punch today. */
  punched: Set<string>;
  /** Minutes past midnight on the clinic's clock. */
  minutesNow: number;
  late: { on: boolean; graceMinutes: number };
  absent: { on: boolean; hours: number };
};

function hhmmToMinutes(v: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(v || "");
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function attendanceAlertsDue(input: AttendanceAlertInput): AttendanceAlert[] {
  const { roster, punched, minutesNow, late, absent } = input;
  const out: AttendanceAlert[] = [];
  for (const s of roster) {
    if (punched.has(s.uid)) continue;
    const startMin = hhmmToMinutes(s.start);
    if (startMin === null) continue;
    const absentAt = startMin + absent.hours * 60;

    if (absent.on && minutesNow >= absentAt) {
      out.push({
        event: "staffAbsent",
        uid: s.uid,
        title: `🚫 ${s.name}: غياب النهارده`,
        body: `الشيفت بدأ ${s.start} — عدّى ${absent.hours} ساعة ومفيش تسجيل حضور`,
      });
      continue;
    }
    if (late.on && minutesNow >= startMin + late.graceMinutes) {
      out.push({
        event: "staffLate",
        uid: s.uid,
        title: `⏰ ${s.name}: لسه مفيش تسجيل حضور`,
        body: `الشيفت بدأ ${s.start} — عدّى ${minutesNow - startMin} دقيقة`,
      });
    }
  }
  return out;
}
