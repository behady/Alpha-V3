/**
 * The shape of a briefing — daily or weekly.
 *
 * One set of types serves both periods. A weekly brief is not a different report, it is the same
 * questions asked over seven days plus a comparison against the seven before it, so the sections
 * are shared and only `trend` is week-only.
 *
 * Every money- or salary-bearing section is optional. `undefined` means the caller was not
 * permitted to see it and the server never sent it — not that the number was zero. `redacted`
 * lists what was withheld so the screen can say "hidden by your permissions" instead of quietly
 * rendering a shorter page that looks like a slow day.
 */

export type BriefingPeriod = "day" | "week" | "month";

/** Which sections a reader may see. Resolved on the server from role + clinic permissions. */
export interface BriefingAccess {
  /** Revenue, expenses, commissions, per-doctor production. Gated on `access.finance`. */
  money: boolean;
  /** Punches, lateness, hours, salaries. Gated on `attendance.admin` or `access.settings`. */
  hr: boolean;
}

export interface BriefingAppointment {
  id: string;
  date: string;
  time: string;
  patientId: string;
  patientName: string;
  doctor: string;
  treatment: string;
  status: string;
  /** Minutes. Defaults to 30 at booking, so this is always a real number. */
  duration: number;
}

/** The five numbers across the top. Money is null rather than 0 when the reader cannot see it. */
export interface HeadlineSection {
  collected: number | null;
  patientsSeen: number;
  stillToCome: number;
  missed: number;
  staffOnFloor: number | null;
}

export interface MethodSplit {
  method: string;
  amount: number;
  count: number;
}

export interface CategorySplit {
  category: string;
  amount: number;
  count: number;
}

export interface MoneySection {
  /** Cash actually taken in the period — payment and income rows, cash basis. */
  collected: number;
  byMethod: MethodSplit[];
  expenses: number;
  expensesByCategory: CategorySplit[];
  /** Collected minus expenses. Not profit — commissions and salaries are not cash rows. */
  netCash: number;
  discounts: number;
  labFees: number;
  doctorCommissions: number;
  /** What the ledger itself recorded as the clinic's share, after commission and lab. */
  clinicProfit: number;
  /** Work charged in the period that carried no payment on the row — tomorrow's receivables. */
  billedUnpaid: number;
  comparison: {
    previousLabel: string;
    previousCollected: number | null;
    sameWeekdayLabel: string | null;
    sameWeekdayCollected: number | null;
  };
}

export interface DoctorProduction {
  key: string;
  name: string;
  patientsSeen: number;
  procedures: number;
  collected: number;
  commission: number;
  labFee: number;
  clinicProfit: number;
}

export interface ProductionSection {
  doctors: DoctorProduction[];
  revenuePerPatientSeen: number | null;
  /** Chair minutes booked against minutes the clinic is open. Null when hours are not configured. */
  chairUtilisation: { bookedMinutes: number; openMinutes: number; percent: number } | null;
  busiestHour: { hour: string; count: number } | null;
  /** The longest run of open time between two booked appointments. Daily only. */
  biggestGap: { startsAt: string; minutes: number } | null;
}

export interface HrStaffRow {
  staffId: string;
  uid: string;
  name: string;
  role: string;
  /** False when this person has no work schedule configured — they cannot be judged late or absent. */
  hasSchedule: boolean;
  scheduledDays: number;
  daysWorked: number;
  minutesWorked: number;
  /** Minutes past their scheduled start, summed over the period. */
  lateMinutes: number;
  lateDays: number;
  /** Scheduled to work and never punched in. */
  absentDays: number;
  activeNow: boolean;
  /** Clocked in on a day that has ended, with no clock-out recorded. */
  openShifts: number;
  overtimeApprovedMinutes: number;
  overtimePendingMinutes: number;
  /** Regular pay + approved overtime. Commission is reported separately by the payroll screen. */
  estimatedPay: number;
  /** Punches worth a second look: unregistered device, far from the clinic, or a vague GPS fix. */
  flags: string[];
}

export interface HrSection {
  staff: HrStaffRow[];
  onFloorNow: number;
  lateDays: number;
  absentDays: number;
  openShifts: number;
  totalMinutes: number;
  overtimePendingMinutes: number;
  /** What the pending overtime would cost if every hour of it were approved. */
  overtimePendingCost: number;
  labourCost: number;
  /** People with no schedule configured — excluded from late/absent counts entirely. */
  withoutSchedule: number;
}

export interface ActionItem {
  id: string;
  patientId: string;
  patientName: string;
  detail: string;
  daysAgo?: number;
  amount?: number;
}

export interface StaleBalance {
  patientId: string;
  patientName: string;
  balance: number;
  daysSinceLastActivity: number;
}

export interface ActionsSection {
  /** Past appointments still sitting on Scheduled — nobody said whether the patient came. */
  unresolvedAppointments: ActionItem[];
  unresolvedCount: number;
  /** Seen in this period and walked out with nothing in the diary. */
  seenWithoutNextVisit: ActionItem[];
  seenWithoutNextVisitCount: number;
  /** Work billed in this period with no future appointment booked against the patient. */
  billedWithoutBooking: ActionItem[];
  billedWithoutBookingCount: number;
  /** Leads whose follow-up date has come and gone. */
  overdueFollowUps: ActionItem[];
  overdueFollowUpCount: number;
  /** Appointments in the period ahead still on Scheduled rather than Confirmed. */
  unconfirmedAhead: number;
  staleBalances: StaleBalance[];
  staleBalanceTotal: number | null;
}

export interface GrowthSection {
  newPatients: number;
  newLeads: number;
  leadsBySource: { source: string; count: number }[];
  leadsConverted: number;
  /** Leads recorded before this period that are still sitting in New. */
  leadsUntouched: number;
}

export interface StockSection {
  low: { itemId: string; name: string; stock: number; minStock: number; unit: string; outOfStock: boolean }[];
  lowCount: number;
  outOfStockCount: number;
  noThresholdCount: number;
}

export interface NextUpSection {
  /** "Tomorrow" or "Next week" — resolved server-side so both languages read it the same way. */
  key: "tomorrow" | "next_week";
  startDate: string;
  endDate: string;
  appointments: number;
  firstAppointmentTime: string | null;
  doctors: string[];
  unconfirmed: number;
  /** Who is rostered. Null when the reader cannot see HR. */
  staffRostered: string[] | null;
}

/** Week-only: this period against the one before it. */
export interface TrendPoint {
  key: string;
  current: number;
  previous: number;
  /** Percent change, or null when the previous period was zero and a percentage would be noise. */
  changePercent: number | null;
  /** True when the figure is money and must be hidden from readers without finance access. */
  isMoney: boolean;
}

export interface TrendSection {
  points: TrendPoint[];
  daily: { dateKey: string; weekday: number; collected: number | null; patientsSeen: number }[];
  /** The comparison period day by day, so a chart can draw last month under this one. */
  previousDaily: { dateKey: string; collected: number | null; patientsSeen: number }[];
  bestDay: string | null;
  quietestDay: string | null;
  topProcedures: { name: string; count: number; revenue: number | null }[];
  /** Cash collected against work billed in the same period. Cash basis — see notes. */
  collectionRate: number | null;
  /** Estimated pay run for the calendar month so far. Null when HR is hidden. */
  payrollMonthToDate: number | null;
}

export interface Briefing {
  period: BriefingPeriod;
  generatedAt: string;
  startDate: string;
  endDate: string;
  /** The single date, for a daily brief. Same as startDate; kept for the existing callers. */
  dateKey: string;
  access: BriefingAccess;
  /** Section keys the reader was not permitted to see. */
  redacted: string[];
  headline: HeadlineSection;
  appointments: BriefingAppointment[];
  counts: { total: number; attended: number; cancelled: number; stillScheduled: number };
  money?: MoneySection;
  production?: ProductionSection;
  hr?: HrSection;
  actions: ActionsSection;
  growth: GrowthSection;
  stock: StockSection;
  nextUp: NextUpSection;
  trend?: TrendSection;
  notes: string[];

  /**
   * Quiet balances, repeated at the top level where they used to live.
   *
   * The Android app reads `briefing.staleBalances` and `briefing.staleBalanceTotal` straight off
   * the response, and an installed APK cannot be asked to move. Nesting them under `actions` and
   * nothing else would have blanked the one section of the phone's brief that earns its screen —
   * silently, with no error, because a missing key reads as an empty list. So they stay here too.
   *
   * New readers should use `actions.staleBalances`. These two are a compatibility surface, and can
   * go once no shipped build reads them.
   */
  staleBalances: StaleBalance[];
  staleBalanceTotal: number | null;
}
