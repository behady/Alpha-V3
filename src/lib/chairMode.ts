/**
 * Chair mode: the dentist's experience with no money in it.
 *
 * One rule, asked by every screen that has to decide (the dentist home, the patient file, the
 * procedure editor), so it cannot drift: a user whose clinic role is Dentist is always in it;
 * an Owner or Admin who is also a dentist is in it only while their home screen is the chair
 * (Settings → Interface). Reception, assistants and non-dentist admins never are.
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
  if (i.role === "Dentist") return true;
  return i.isDentist === true && i.homeView === "chair";
}
