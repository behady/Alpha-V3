import { holdsPermission } from "@/lib/permissions";

/**
 * What the assistant may READ for the person asking.
 *
 * Writes were already checked against the same table the Firestore rules use. Reads were not:
 * the route only established "this is a staff member", so anyone with the chat could ask for
 * net profit or read the `staff` collection (which carries salaries) whatever their own screens
 * showed. The rule here is the owner's, in one line: the assistant tells a person only what
 * their screens already show them.
 *
 * Pure on purpose, so `tests/saraReadPolicy.test.mts` can pin every row of the table.
 */

export type ReadFilter = { whereField?: unknown; whereOperator?: unknown; whereValue?: unknown };

/** null = any staff member. */
const COLLECTION_READ_PERMISSION: Record<string, string | null> = {
  patients: "access.patients",
  appointments: "access.appointments",
  clinical_notes: "access.clinical",
  inventory: "access.inventory",
  inventory_transactions: "access.inventory",
  ledger: "access.finance",
  expenses: "access.finance",
  staff: null,
  services: null,
  tickets: null,
};

/** A ledger read narrowed to one patient is that patient's account, which the patient file shows. */
function isOnePatientRead(filter: ReadFilter | undefined): boolean {
  return (
    !!filter &&
    filter.whereField === "patientId" &&
    filter.whereOperator === "==" &&
    typeof filter.whereValue === "string" &&
    filter.whereValue.trim() !== ""
  );
}

/**
 * Why this read is refused, or null when it is allowed.
 *
 * `reception` is the appointment-panel assistant: its allowlist was already narrowed by hand to
 * what a front desk needs, so only the money rule is added there.
 */
export function readDenial(
  collection: string,
  filter: ReadFilter | undefined,
  role: string | null | undefined,
  permissions: string[] | null | undefined,
  mode: "general" | "reception" = "general",
): string | null {
  const name = String(collection || "").trim();
  let needed: string | null = Object.prototype.hasOwnProperty.call(COLLECTION_READ_PERMISSION, name)
    ? COLLECTION_READ_PERMISSION[name]
    : null;

  if (name === "ledger" && isOnePatientRead(filter)) needed = "access.patients";
  if (mode === "reception" && name !== "ledger" && name !== "expenses") needed = null;
  // The front desk takes payments and sees one patient's account without holding `access.patients`
  // as a separate tick; the panel is already scoped to the appointment on screen.
  if (mode === "reception" && name === "ledger" && isOnePatientRead(filter)) needed = null;

  if (holdsPermission(role, permissions, needed)) return null;

  if (name === "ledger" || name === "expenses") {
    return "This person does not have access to the clinic's money. Tell them so plainly and do not give any figure.";
  }
  return `This person does not have access to ${name.replace(/_/g, " ")}. Tell them so plainly and do not answer from another source.`;
}

/** Does this person see the clinic's money (the Finance page's own permission)? */
export function seesMoney(role: string | null | undefined, permissions: string[] | null | undefined): boolean {
  return holdsPermission(role, permissions, "access.finance");
}

const PAY_FIELD = /salary|commission|wage|payrate|hourly|overtime|bonus|deduction|dailypay|paiddaily|bank|iban/i;

/** A staff row without what the person is paid, for anyone who does not administer attendance. */
export function withoutPayFields<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (PAY_FIELD.test(key)) continue;
    out[key] = value;
  }
  return out;
}
