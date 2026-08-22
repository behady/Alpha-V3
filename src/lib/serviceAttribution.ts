/**
 * Which catalogue service does a ledger row belong to?
 *
 * Reports answer "how much did crowns earn this month" by grouping ledger rows under a service.
 * Until now they did that by reading the row's `description` and cutting the string up: strip a
 * `"Payment for "` prefix, cut at the first `(`, hope. That made revenue-by-service depend on
 * prose — the clinical-notes editor writes
 * `"Composite Filling (T: 14) | 400*1=400"` while booking and the side panel write the bare
 * service name, and renaming a service in the price list silently split its history in two.
 *
 * Procedure rows now carry `serviceId` and `serviceName`. This module prefers those and keeps the
 * string-cutting only for rows written before that existed, so old reports do not go blank.
 *
 * Payments deliberately do NOT store a serviceId of their own. A payment settles a procedure, and
 * duplicating the attribution onto it would be a second copy to keep in step — so a payment is
 * attributed through `procedureId` to the procedure it pays for. When that procedure is outside
 * the loaded window the description fallback still applies, exactly as before.
 */

/** The subset of a ledger row this module needs. Rows carry far more; none of it matters here. */
export type AttributableRow = {
  id?: string;
  type?: string;
  description?: string;
  procedure?: string;
  procedureId?: string | null;
  procedureName?: string;
  serviceId?: string | null;
  serviceName?: string | null;
  category?: string;
};

export type ServiceAttribution = {
  /** Stable grouping key: the catalogue id when known, otherwise the normalised label. */
  key: string;
  /** What to show a human. */
  name: string;
  /** False when this fell back to reading the description, i.e. the row predates serviceId. */
  fromCatalogId: boolean;
};

const UNCLASSIFIED = "General";

/**
 * The service name buried in a description string.
 *
 * Handles both shapes the app writes — `"Crown (T: 14) | 500*1=500"` and a bare `"Crown"` — plus
 * the payment prefixes in both languages.
 */
export function labelFromDescription(raw: string | null | undefined): string {
  let text = String(raw || "").trim();
  if (!text) return UNCLASSIFIED;

  for (const prefix of ["Payment for ", "دفعة مقابل ", "تسديد دفعة لـ: ", "Payment for: "]) {
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length);
      break;
    }
  }

  // Cut at the tooth list or the pricing breakdown, whichever comes first.
  const cut = text.search(/ \(| \|/);
  if (cut !== -1) text = text.slice(0, cut);

  return text.trim() || UNCLASSIFIED;
}

/** Index procedure rows by id so payments can be attributed through `procedureId`. */
export function buildProcedureIndex(procedures: AttributableRow[]): Map<string, AttributableRow> {
  const index = new Map<string, AttributableRow>();
  for (const row of procedures) {
    if (row.id) index.set(String(row.id), row);
  }
  return index;
}

function fromRow(row: AttributableRow): ServiceAttribution | null {
  const id = typeof row.serviceId === "string" ? row.serviceId.trim() : "";
  if (!id) return null;
  const name = typeof row.serviceName === "string" ? row.serviceName.trim() : "";
  return {
    key: id,
    // A row can carry the id but no name if it was written by an older path; the description is
    // still a better label than showing a raw document id to a clinic owner.
    name: name || labelFromDescription(row.description),
    fromCatalogId: true,
  };
}

/**
 * Attribute one ledger row to a service.
 *
 * `procedureIndex` is only consulted for payments — pass the procedures loaded for the same period
 * (see buildProcedureIndex). Omit it and payments simply fall back to their description.
 */
export function attributeService(
  row: AttributableRow,
  procedureIndex?: Map<string, AttributableRow>
): ServiceAttribution {
  const direct = fromRow(row);
  if (direct) return direct;

  if (row.procedureId && procedureIndex) {
    const procedure = procedureIndex.get(String(row.procedureId));
    if (procedure) {
      const viaProcedure = fromRow(procedure);
      if (viaProcedure) return viaProcedure;
      // The procedure predates serviceId too, but its description is still the better source:
      // it names the treatment, where the payment's says "Payment for …".
      const label = labelFromDescription(procedure.description || procedure.procedure);
      return { key: label, name: label, fromCatalogId: false };
    }
  }

  const label = labelFromDescription(
    row.description || row.procedure || row.procedureName || (row.category === "Treatment" ? row.category : "")
  );
  return { key: label, name: label, fromCatalogId: false };
}
