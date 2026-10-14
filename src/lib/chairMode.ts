/**
 * Chair mode: the dentist's experience with no money in it.
 *
 * One rule, asked by every screen that has to decide (the patient file, the procedure editor),
 * so it cannot drift: only a user whose clinic role is Dentist is in it. An Owner or Admin who
 * also treats patients may pick the chair as their home screen, but keeps prices and discounts
 * in the patient file — the owner asked for that 2026-10-14 after the chair home hid them.
 * Reception and assistants never are.
 *
 * It hides prices, price lists, discounts and the dentist picker; it locks nothing — the role's
 * permissions are unchanged and the owner chose hiding over a rules lock (spec 2026-10-08).
 */
export type ChairModeInput = {
  role?: string | null;
  /** The staff row's flag: an admin who treats patients. */
  isDentist?: boolean;
  homeView?: "desk" | "chair" | "owner";
};

export function isChairMode(i: ChairModeInput): boolean {
  return i.role === "Dentist";
}
