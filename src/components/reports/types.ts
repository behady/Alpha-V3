import type { DateRange } from "@/lib/reportHelpers";
import type { Clinic } from "@/types/saas";
import type { ReportData, Row } from "@/components/reports/useReportData";

/** What every report tab receives. The base sets are loaded once; `data` holds what the tab asked for. */
export type ReportProps = {
  /** Procedure rows in the period on screen. */
  procedures: Row[];
  /** Payment, income and expense rows in the period on screen. */
  payments: Row[];
  /** The two above, together. */
  ledger: Row[];
  allPatients: Row[];
  leads: Row[];
  range: DateRange;
  rangeLabel: string;
  today: string;
  isAr: boolean;
  clinic: Clinic | null;
  data: ReportData;
  /** Lets a report move the page's own range — the statement tab picks a month. Absent on the phone. */
  setRange?: (range: DateRange) => void;
};
