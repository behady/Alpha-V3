/**
 * The line the owner reads when somebody clocks in or out. Pure: no Firestore, no clock.
 *
 *   🟢 sohila ahmed: حضور 14:21     تأخير 21 دقيقة (الشيفت 14:00) · فرع التجمع الخامس
 *   🔴 faten: انصراف 22:05           مدة الشغل 7 ساعات و44 دقيقة · فرع مصر الجديدة
 *
 * Worded without "he" or "she" on purpose: most of the people clocking in are women, and a
 * masculine default ("متأخر") read about them is the kind of small wrongness owners notice.
 */

export type PunchAlertInput = {
  direction: "in" | "out";
  name: string;
  /** The punch time on the clinic's clock, "HH:MM". */
  at: string;
  /** That day's rostered start, when the person is rostered that day. */
  shiftStart: string | null;
  branch: string | null;
  /** Clock-out only: the minutes between clock-in and clock-out. */
  durationMinutes?: number;
};

function toMinutes(v: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(v || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function hoursWord(h: number): string {
  if (h === 1) return "ساعة";
  if (h === 2) return "ساعتين";
  if (h >= 3 && h <= 10) return `${h} ساعات`;
  return `${h} ساعة`;
}

function workedWords(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0 && m === 0) return "أقل من دقيقة";
  if (h === 0) return `${m} دقيقة`;
  return m ? `${hoursWord(h)} و${m} دقيقة` : hoursWord(h);
}

export function punchAlertText(input: PunchAlertInput): { title: string; body: string } {
  const parts: string[] = [];
  if (input.direction === "in") {
    const start = toMinutes(input.shiftStart);
    const at = toMinutes(input.at);
    if (start !== null && at !== null) {
      parts.push(at > start ? `تأخير ${at - start} دقيقة (الشيفت ${input.shiftStart})` : `في الميعاد (الشيفت ${input.shiftStart})`);
    }
  } else {
    parts.push(`مدة الشغل ${workedWords(input.durationMinutes ?? 0)}`);
  }
  if (input.branch) parts.push(`فرع ${input.branch}`);
  return {
    title: `${input.direction === "in" ? "🟢" : "🔴"} ${input.name}: ${input.direction === "in" ? "حضور" : "انصراف"} ${input.at}`,
    body: parts.join(" · "),
  };
}

/** The rostered start on a given date ("YYYY-MM-DD"), from a staff `attendanceSchedule`. */
export function shiftStartFor(schedule: unknown, ymd: string): string | null {
  if (!schedule || typeof schedule !== "object") return null;
  const weekday = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  const cfg = (schedule as Record<string, { active?: boolean; start?: string } | undefined>)[String(weekday)];
  if (!cfg || !cfg.active) return null;
  const start = typeof cfg.start === "string" ? cfg.start.trim() : "";
  return toMinutes(start) === null ? null : start;
}
