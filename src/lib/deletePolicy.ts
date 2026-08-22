/**
 * One rule for deleting anything financial, so every screen answers the same question the same way.
 *
 * Three screens could delete the same procedure and each behaved differently: the patient ledger
 * refused when payments were attached, the finance page warned and then cascaded through them
 * anyway, and the clinical-notes timeline never checked at all. Whether a paid-for treatment
 * survived depended on which door you happened to be standing at.
 *
 * The strict rule wins everywhere: a charge with money collected against it cannot be deleted
 * until those payments are. Deleting it would leave payments pointing at nothing, and the
 * patient's balance would silently move by whatever was collected.
 *
 * Pure and Firebase-free: the caller loads the related rows however it likes (a client query, a
 * server transaction) and this decides. Nothing here reads or writes.
 */

export type DeleteTarget =
  | { kind: "ledger-procedure"; id: string }
  | { kind: "ledger-payment"; id: string; procedureId?: string | null }
  | { kind: "ledger-entry"; id: string }
  | { kind: "clinical-note"; id: string; ledgerIds?: string[] };

export type DeleteBlockReason = "HAS_PAYMENTS";

export type CascadeItem = { collection: "ledger" | "clinical_notes"; id: string };

export type DeleteVerdict = {
  allowed: boolean;
  reason?: DeleteBlockReason;
  /** Human-readable explanation of a refusal, for the toast the user actually sees. */
  message?: string;
  /** Everything that must be removed together. Empty when the delete is refused. */
  cascade: CascadeItem[];
  /**
   * Procedures whose set of payments changed, so the caller can rebalance them afterwards —
   * deleting a payment can move the lab fee onto whichever payment is now the earliest.
   */
  resyncProcedureIds: string[];
  /** Payments standing in the way, so a refusal can say how many rather than just "no". */
  blockingPaymentIds: string[];
};

export type DeleteContext = {
  /** procedure ledger row id → ids of the payments settling it. */
  paymentsByProcedureId: Map<string, string[]>;
  /** clinical note id → ids of every ledger row linked to it, in either direction. */
  ledgerRowsByClinicalNoteId: Map<string, string[]>;
  /** ledger row id → its `type`, so a note's linked rows can be told apart. */
  ledgerRowTypes?: Map<string, string>;
};

function paymentsFor(context: DeleteContext, procedureId: string): string[] {
  return context.paymentsByProcedureId.get(procedureId) || [];
}

function refuse(blockingPaymentIds: string[]): DeleteVerdict {
  const count = blockingPaymentIds.length;
  return {
    allowed: false,
    reason: "HAS_PAYMENTS",
    message:
      count === 1
        ? "A payment has been recorded against this. Delete the payment first."
        : `${count} payments have been recorded against this. Delete them first.`,
    cascade: [],
    resyncProcedureIds: [],
    blockingPaymentIds,
  };
}

function allow(cascade: CascadeItem[], resyncProcedureIds: string[] = []): DeleteVerdict {
  return { allowed: true, cascade, resyncProcedureIds, blockingPaymentIds: [] };
}

/**
 * May this be deleted, and what goes with it?
 *
 * A note and its ledger row are one thing to the person looking at the screen — a treatment that
 * was recorded and charged for — so deleting either takes both. Splitting them would leave a
 * charge nobody can explain or a treatment nobody was billed for, which are exactly the two states
 * the recovery engines exist to hunt down.
 */
export function evaluateDelete(target: DeleteTarget, context: DeleteContext): DeleteVerdict {
  switch (target.kind) {
    case "ledger-payment": {
      // A payment is always removable. Its procedure has to be rebalanced afterwards, because the
      // lab fee sits on the earliest payment and that may now be a different row.
      const resync = target.procedureId ? [String(target.procedureId)] : [];
      return allow([{ collection: "ledger", id: target.id }], resync);
    }

    case "ledger-entry": {
      // Clinic income or overhead: belongs to no patient and settles nothing.
      return allow([{ collection: "ledger", id: target.id }]);
    }

    case "ledger-procedure": {
      const blocking = paymentsFor(context, target.id);
      if (blocking.length > 0) return refuse(blocking);

      // Take the clinical note with it when one is linked, so the two never diverge.
      const cascade: CascadeItem[] = [{ collection: "ledger", id: target.id }];
      for (const [noteId, ledgerIds] of context.ledgerRowsByClinicalNoteId) {
        if (ledgerIds.includes(target.id)) {
          cascade.push({ collection: "clinical_notes", id: noteId });
        }
      }
      return allow(cascade);
    }

    case "clinical-note": {
      // Both link directions: rows carrying clinicalNoteId, and the legacy note.ledgerId pointer.
      const linked = new Set<string>([
        ...(context.ledgerRowsByClinicalNoteId.get(target.id) || []),
        ...(target.ledgerIds || []),
      ]);

      const blocking: string[] = [];
      for (const ledgerId of linked) {
        // Only a charge can have payments settling it; a payment row linked to a note is not
        // itself blocking.
        const type = context.ledgerRowTypes?.get(ledgerId);
        if (type && type !== "procedure") continue;
        blocking.push(...paymentsFor(context, ledgerId));
      }
      if (blocking.length > 0) return refuse(blocking);

      const cascade: CascadeItem[] = [{ collection: "clinical_notes", id: target.id }];
      for (const ledgerId of linked) cascade.push({ collection: "ledger", id: ledgerId });
      return allow(cascade);
    }
  }
}

/**
 * Build the context from flat rows the caller has already loaded.
 *
 * Kept next to the rule so every caller indexes the same way — the finance page, the timeline and
 * the server routes were each doing their own version of this.
 */
export function buildDeleteContext(
  ledgerRows: Array<{ id: string; type?: string | null; procedureId?: string | null; clinicalNoteId?: string | null }>
): DeleteContext {
  const paymentsByProcedureId = new Map<string, string[]>();
  const ledgerRowsByClinicalNoteId = new Map<string, string[]>();
  const ledgerRowTypes = new Map<string, string>();

  for (const row of ledgerRows) {
    const id = String(row.id);
    const type = String(row.type || "");
    ledgerRowTypes.set(id, type);

    if (type === "payment" && row.procedureId) {
      const key = String(row.procedureId);
      const list = paymentsByProcedureId.get(key) || [];
      list.push(id);
      paymentsByProcedureId.set(key, list);
    }

    if (row.clinicalNoteId) {
      const key = String(row.clinicalNoteId);
      const list = ledgerRowsByClinicalNoteId.get(key) || [];
      list.push(id);
      ledgerRowsByClinicalNoteId.set(key, list);
    }
  }

  return { paymentsByProcedureId, ledgerRowsByClinicalNoteId, ledgerRowTypes };
}
