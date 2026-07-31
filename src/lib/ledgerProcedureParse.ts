/** Matches ClinicalNotes ledger lines: procedure (T: teeth) | unit×qty=total */
export function parseLedgerProcedureDescription(raw: string): {
  procedureLine: string;
  teeth?: string;
  pricingBreakdown?: string;
} {
  let rest = raw.trim();
  if (!rest) return { procedureLine: "—" };

  let teeth: string | undefined;
  const teethMatch = rest.match(/\(\s*T:\s*([^)]+)\)/i);
  if (teethMatch) {
    teeth = teethMatch[1].trim();
    rest = rest.replace(teethMatch[0], "").replace(/\s+/g, " ").trim();
  }

  let pricingBreakdown: string | undefined;
  const pipeIdx = rest.lastIndexOf("|");
  if (pipeIdx !== -1) {
    const left = rest.slice(0, pipeIdx).trim();
    const right = rest.slice(pipeIdx + 1).trim();
    const looksLikeFormula =
      /^[\d\s.,]+\s*[*×x]\s*[\d\s.,]+\s*=/.test(right.replace(/\s/g, "")) || /\d\s*=/.test(right);
    if (looksLikeFormula && right) {
      rest = left;
      pricingBreakdown = right.replace(/\*/g, "×");
    }
  }

  return {
    procedureLine: rest || "—",
    teeth,
    pricingBreakdown,
  };
}
