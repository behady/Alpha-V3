/**
 * Records that ended up in the wrong clinic's books.
 *
 * Six of the seven money and clinical write paths never told the server which clinic they meant,
 * so the routes fell back to the caller's `defaultClinicId`. Working at a second clinic, the write
 * went somewhere else.
 *
 * MOST of those writes failed loudly rather than landing wrong, and that is worth being precise
 * about because it decides how much of the books need re-checking:
 *
 *   - A procedure checks that the PATIENT exists in the resolved clinic, inside the transaction,
 *     and that the DENTIST does, before that. Both are missing from the wrong clinic, so the save
 *     is refused. That refusal is what the owner actually saw.
 *   - A payment against a procedure checks the procedure row exists there. Also refused.
 *
 * Two paths have no such anchor and are the reason this exists:
 *
 *   - A payment NOT tied to a procedure — money on account — checks only that a patient id was
 *     supplied, never that the patient belongs to the clinic being written to.
 *   - A clinic income or expense line has no patient at all, so nothing about it is checkable.
 *
 * The first leaves a fingerprint: a ledger row naming a patient who does not exist in the clinic
 * holding the row, while some OTHER clinic has exactly that patient. That is close to conclusive —
 * Firestore ids are random, so a patient id landing in the wrong clinic by chance does not happen.
 *
 * The second leaves none, and this module says so rather than pretending otherwise.
 */

export type RecordVerdict =
  /** The patient lives in the clinic holding this row. Nothing to do. */
  | { kind: "ok" }
  /**
   * The patient belongs to a different clinic. The row is in the wrong books.
   * `homeClinicIds` names where the patient actually lives — usually exactly one.
   */
  | { kind: "misplaced"; homeClinicIds: string[] }
  /**
   * The patient exists in no clinic at all. Most likely deleted since — the recycle bin removes
   * the patient and leaves the ledger alone — so this is a loose end to look at, not a tenancy
   * error, and calling it one would send somebody hunting a bug that is not there.
   */
  | { kind: "orphaned" }
  /**
   * Nothing on this row ties it to a patient: a clinic income or expense line. The fallback could
   * have put it in the wrong clinic and no evidence of that survives in the row. Reported so the
   * total is honest about what it could not check, rather than counted as clean.
   */
  | { kind: "unjudgeable"; reason: string };

export type RecordUnderReview = {
  /** The clinic whose subtree holds this document. */
  clinicId: string;
  /** `ledger`, `clinical_notes`, … — carried through to the report. */
  collection: string;
  documentId: string;
  patientId?: string | null;
  /** `payment`, `procedure`, `income`, `expense`. Only ledger rows carry one. */
  type?: string | null;
};

/**
 * `patientHomes` maps a patient id to every clinic that holds a patient of that id. Built once by
 * the caller from every clinic's patient list, because the question "whose patient is this" cannot
 * be answered from inside one clinic — which is the whole difficulty.
 */
export function classifyRecord(
  record: RecordUnderReview,
  patientHomes: Map<string, string[]>
): RecordVerdict {
  const patientId = (record.patientId || "").trim();

  if (!patientId) {
    const type = (record.type || "").trim();
    return {
      kind: "unjudgeable",
      reason:
        type === "income" || type === "expense"
          ? `A clinic ${type} line names no patient, so nothing on it says which clinic it belongs to.`
          : "No patient on this row, so there is nothing to check it against.",
    };
  }

  const homes = patientHomes.get(patientId) || [];
  if (homes.length === 0) return { kind: "orphaned" };
  if (homes.includes(record.clinicId)) return { kind: "ok" };
  return { kind: "misplaced", homeClinicIds: [...homes].sort() };
}

export type ReviewSummary = {
  checked: number;
  ok: number;
  misplaced: number;
  orphaned: number;
  unjudgeable: number;
};

export function emptySummary(): ReviewSummary {
  return { checked: 0, ok: 0, misplaced: 0, orphaned: 0, unjudgeable: 0 };
}

export function countVerdict(summary: ReviewSummary, verdict: RecordVerdict): ReviewSummary {
  summary.checked += 1;
  summary[verdict.kind] += 1;
  return summary;
}

/**
 * What the operator is told at the end.
 *
 * A run that finds nothing must not read as "your books are clean", because two of the write paths
 * leave no evidence either way. Saying which is which is the difference between a report somebody
 * can act on and one that quietly overstates what it knows.
 */
export function verdictHeadline(summary: ReviewSummary): string {
  if (summary.misplaced > 0) {
    return `${summary.misplaced} record(s) are in the wrong clinic's books.`;
  }
  if (summary.unjudgeable > 0) {
    return (
      `No misplaced records found among the ${summary.checked - summary.unjudgeable} that could be ` +
      `checked. ${summary.unjudgeable} carry no patient — clinic income and expense lines — and ` +
      `nothing on them says which clinic they belong to, so they were not checked either way.`
    );
  }
  return `No misplaced records found across ${summary.checked} checked.`;
}
