/**
 * The monthly statement to MetLife, as data.
 *
 * Once a month the clinic sends MetLife one sheet of every approval it treated in the period: a serial,
 * the patient with policy, certificate and dependent code, the approval number and date, one line per
 * service in the clinic's own wording (what MetLife's reviewers read, not the paper's English), what was
 * requested and what MetLife approved, a subtotal per case and a grand total. This builds it from the saved
 * claims, so the sheet and the approvals on file cannot disagree. The styled workbook is built from this.
 *
 * Pure and Firebase-free: claims in, statement out. Rules:
 *   - A claim is listed when its approval date is in [from, to] (inclusive) and it is `treated` or `sent`.
 *   - `approved` (not yet treated) claims in the range are not listed but counted in `heldBack`, so the
 *     desk can see what is missing; `cancelled` and out-of-range claims are ignored.
 *   - Cases run by approval date, then approval number. Lines keep the paper's order, rejected ones included.
 *   - A line's text is the clinic's wording for its code, else the paper's own description; the codes with
 *     no wording come back in `missingWording` so the desk can fill them in.
 */

import type { InsuranceClaim } from "@/lib/insurance/claims";

export type MetlifeStatementLine = { text: string; count: number; requested: number; approved: number };

export type MetlifeStatementCase = {
  serial: number;
  patientName: string;
  policyNumber: string;
  certificateNumber: string;
  dependentCode: string;
  approvalNumber: string;
  date: string;
  lines: MetlifeStatementLine[];
  subtotal: number;
};

export type MetlifeStatement = {
  from: string;
  to: string;
  cases: MetlifeStatementCase[];
  total: number;
  /** Service codes on listed cases that have no wording, in first-seen order. */
  missingWording: string[];
  /** Approved-but-not-yet-treated claims inside the range: left off the sheet. */
  heldBack: number;
};

/** The wording the clinic uses for the services MetLife approves most; the clinic's own list overrides it. */
export const DEFAULT_METLIFE_WORDING: Record<string, string> = {
  D0120: "كشف",
  D0270: "اشعه عاديه",
  D2650: "حشو كمبوزيت",
  D3120: "بطانه كالسيوم",
  D4220: "علاج لثه صديديه",
};

function money(v: number): number {
  return Number.isFinite(v) ? Number(v.toFixed(2)) : 0;
}

function byApproval(a: InsuranceClaim, b: InsuranceClaim): number {
  if (a.approvalDate !== b.approvalDate) return a.approvalDate < b.approvalDate ? -1 : 1;
  return a.approvalNumber < b.approvalNumber ? -1 : a.approvalNumber > b.approvalNumber ? 1 : 0;
}

export function buildMetlifeStatement(args: {
  claims: InsuranceClaim[];
  from: string;
  to: string;
  wording: Record<string, string>;
}): MetlifeStatement {
  const { from, to, wording } = args;
  const inRange = args.claims.filter((c) => c.approvalDate >= from && c.approvalDate <= to);
  const heldBack = inRange.filter((c) => c.status === "approved").length;
  const listed = inRange.filter((c) => c.status === "treated" || c.status === "sent").sort(byApproval);

  const missing = new Set<string>();
  const cases = listed.map((c, i): MetlifeStatementCase => {
    const lines = c.lines.map((l): MetlifeStatementLine => {
      const worded = (wording[l.code] ?? "").trim();
      if (!worded) missing.add(l.code);
      return { text: worded || l.description.trim(), count: l.unitsApproved, requested: l.grossTotal, approved: l.approvedAmount };
    });
    return {
      serial: i + 1,
      patientName: c.patientName,
      policyNumber: c.metlife.policyNumber,
      certificateNumber: c.metlife.certificateNumber,
      dependentCode: c.metlife.dependentCode,
      approvalNumber: c.approvalNumber,
      date: c.approvalDate,
      lines,
      subtotal: money(lines.reduce((sum, l) => sum + l.approved, 0)),
    };
  });

  return {
    from,
    to,
    cases,
    total: money(cases.reduce((sum, c) => sum + c.subtotal, 0)),
    missingWording: [...missing],
    heldBack,
  };
}
