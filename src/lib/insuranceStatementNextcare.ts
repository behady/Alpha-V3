/**
 * The monthly statement to NextCare, built from the saved approvals.
 *
 * Same sheet, cell for cell, as the clinic already sends (insuranceStatementXlsx.ts writes it): one block
 * per visit — `(code)patient` merged down the block — one line per service in the clinic's Arabic
 * wording with its count and teeth (`2حشو كمبوزيت رقم 4-6`), a subtotal, a grand total. Built from
 * approvals rather than from the treatments typed in the day sheets, so every visit totals exactly what
 * NextCare approved and nobody adjusts a line by hand to make it match (the owner's rule, 2026-10-07).
 *
 * Pure: claims in, statement out. Rules:
 *   - A claim is billed when it is `treated` or `sent` and its treated date (else its approval date)
 *     falls in [from, to]. An approval not treated yet is not billed.
 *   - Each line shows what the INSURER pays (`approvedAmount`). A patient on a co-pay plan pays their
 *     part at the desk, so the sheet lists 80 where the visit cost 100, as the clinic's own sheet does.
 *   - Lines NextCare refused (nothing approved) are left out.
 *   - A line's words: the clinic's wording for the code, else NextCare's usual Arabic name for it, else
 *     the Arabic half of the paper's own description.
 *   - Cases run by treatment date, then patient name.
 */
import type { InsuranceClaim } from "@/lib/insurance/claims";
import { insurerToothLabel, type Statement, type StatementCase, type StatementLine } from "@/lib/insuranceStatement";

/** NextCare's codes, in the words the clinic's sheet uses. A clinic's own wording overrides any of them. */
export const DEFAULT_NEXTCARE_WORDING: Record<string, string> = {
  "DE-1": "كشف",
  "DEN-1": "اشعه عاديه",
  "DEN-14": "حشو كمبوزيت",
  "DEN-27": "طربوش زركونيا",
};

function money(n: number): number {
  return Number((Number(n) || 0).toFixed(2));
}

/** "Composite Filling - حشو كمبوزيت" → "حشو كمبوزيت"; a description with no Arabic stays whole. */
function arabicHalf(description: string): string {
  const parts = description.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  return parts.find((p) => /[؀-ۿ]/.test(p)) ?? description.trim();
}

export function nextcareLineText(line: InsuranceClaim["lines"][number], wording: Record<string, string>): string {
  const name = wording[line.code]?.trim() || DEFAULT_NEXTCARE_WORDING[line.code] || arabicHalf(line.description) || line.code;
  const units = Math.round(line.unitsApproved || 0);
  const count = units > 1 ? String(units) : "";
  const teeth = (line.teeth ?? []).map((t) => insurerToothLabel(Number(t))).filter(Boolean);
  return `${count}${name}${teeth.length ? ` رقم ${teeth.join("-")}` : ""}`;
}

export function buildNextcareStatement(args: {
  claims: InsuranceClaim[];
  payerId: string;
  payerName: string;
  /** ISO dates, inclusive. */
  from: string;
  to: string;
  wording: Record<string, string>;
}): Statement {
  const { claims, payerId, payerName, from, to, wording } = args;
  const billed = claims
    .map((c) => ({ c, date: c.treatedDate || c.approvalDate }))
    .filter(({ c, date }) => c.payerId === payerId && (c.status === "treated" || c.status === "sent") && date >= from && date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.c.patientName.localeCompare(b.c.patientName) || a.c.approvalNumber.localeCompare(b.c.approvalNumber));

  const cases: StatementCase[] = [];
  for (const { c, date } of billed) {
    const lines: StatementLine[] = [];
    c.lines.forEach((l, i) => {
      if (l.approvedAmount <= 0) return;
      lines.push({ text: nextcareLineText(l, wording), amount: money(l.approvedAmount), rowId: `${c.id}#${i}` });
    });
    if (lines.length === 0) continue;
    cases.push({
      serial: cases.length + 1,
      patientId: c.patientId,
      patientName: c.patientName,
      memberNumber: (c.metlife.memberCode ?? "").trim(),
      date,
      lines,
      subtotal: money(lines.reduce((t, l) => t + l.amount, 0)),
    });
  }

  const seen = new Set<string>();
  const missingMemberNumber: Statement["missingMemberNumber"] = [];
  for (const k of cases) {
    if (k.memberNumber || seen.has(k.patientId)) continue;
    seen.add(k.patientId);
    missingMemberNumber.push({ patientId: k.patientId, patientName: k.patientName });
  }

  return {
    payerId,
    payerName,
    month: from.slice(0, 7),
    cases,
    total: money(cases.reduce((t, k) => t + k.subtotal, 0)),
    missingMemberNumber,
  };
}
