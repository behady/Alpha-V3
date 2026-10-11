/**
 * Branches and rooms — the clinic's physical layout.
 *
 * Stored in one settings document (`settings/locations`) as a list of branches, each holding its
 * own rooms/chairs. A clinic that never opens this settings screen has no branches configured and
 * every screen behaves exactly as before: no branch pickers, no room pickers, nothing new asked.
 *
 * Appointments store denormalized copies (`branchId` + `branchName`, `roomId` + `roomName`) so a
 * renamed branch does not orphan history — the id stays the grouping key, the name is display.
 */

export type ClinicRoom = {
  id: string;
  name: string;
};

export type ClinicBranch = {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  /**
   * The short prefix stamped on this branch's lab case codes — `MAD` in `MAD-0142`.
   *
   * Optional, and blank for every branch created before lab tracking existed. `branchCodeFor()`
   * in labCases.ts derives one from the name when it is empty, so nothing has to be filled in
   * before the feature works; setting it just replaces a guess with the clinic's own choice.
   */
  code?: string;
  /** Prefix on this branch's receipt numbers — `HEL` in `HEL-0007`. A–Z and 0–9, upper case, 4 at most. */
  receiptPrefix?: string;
  /** The branch code this branch is registered under with the e-receipt authority (ETA). 50 characters at most. */
  etaBranchCode?: string;
  /** This branch's tax registration number, printed on its receipts. 30 characters at most. */
  taxRegistration?: string;
  rooms: ClinicRoom[];
};

export const LOCATIONS_DOC = "locations";

function sanitizeRoom(raw: unknown): ClinicRoom | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id || "").trim();
  const name = String(r.name || "").trim();
  if (!id || !name) return null;
  return { id, name };
}

function sanitizeBranch(raw: unknown): ClinicBranch | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const id = String(b.id || "").trim();
  const name = String(b.name || "").trim();
  if (!id || !name) return null;
  const rooms = Array.isArray(b.rooms)
    ? (b.rooms.map(sanitizeRoom).filter(Boolean) as ClinicRoom[])
    : [];
  return {
    id,
    name,
    address: String(b.address || "").trim(),
    phone: String(b.phone || "").trim(),
    // Normalised on the way in, because this is printed on paper and scanned back: letters and
    // digits only, upper case, four characters at most. A field missing from here is not merely
    // unread — LocationsSettings round-trips this output straight back into setDoc, so anything
    // this function drops is erased the next time somebody saves an unrelated branch edit.
    code: String(b.code || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4),
    // Same round-trip rule as `code`: absent becomes "", never undefined, and the prefix is
    // normalised the same way because it too ends up printed on paper.
    receiptPrefix: String(b.receiptPrefix || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4),
    etaBranchCode: String(b.etaBranchCode || "").trim().slice(0, 50),
    taxRegistration: String(b.taxRegistration || "").trim().slice(0, 30),
    rooms,
  };
}

type PrefixSource = Pick<ClinicBranch, "id" | "name" | "receiptPrefix">;

const explicitPrefix = (b: Pick<ClinicBranch, "receiptPrefix">): string =>
  String(b.receiptPrefix || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4);

/**
 * The receipt prefix of every branch, by id. Each branch counts its receipts on its own, so two
 * branches with the same prefix would print the same numbers twice; this never lets that happen
 * for derived prefixes.
 *
 * A branch's own `receiptPrefix` is kept as is. Otherwise the prefix is the first three
 * letters/digits of its name upper-cased, else `BR` (an all-Arabic name has none to borrow). When
 * that equals a prefix already taken, by any branch's explicit prefix or by a derived one earlier
 * in the list, the next free number is appended: BR, BR2, BR3; HEL, HEL2. Always at most 4 chars.
 */
export function resolveReceiptPrefixes(branches: readonly PrefixSource[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const b of branches) {
    const set = explicitPrefix(b);
    if (set) {
      out.set(b.id, set);
      taken.add(set);
    }
  }
  for (const b of branches) {
    if (out.has(b.id)) continue;
    const base = String(b.name || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 3) || "BR";
    let candidate = base;
    for (let n = 2; taken.has(candidate); n += 1) candidate = `${base.slice(0, 4 - String(n).length)}${n}`;
    out.set(b.id, candidate);
    taken.add(candidate);
  }
  return out;
}

/** The prefix for this branch's receipt numbers; see `resolveReceiptPrefixes`. A branch missing from `allBranches` is resolved as if it were last. */
export function receiptPrefixFor(branch: PrefixSource, allBranches: readonly PrefixSource[]): string {
  const list = allBranches.some((b) => b.id === branch.id) ? allBranches : [...allBranches, branch];
  return resolveReceiptPrefixes(list).get(branch.id) as string;
}

/** Accepts the raw `settings/locations` data (or null) and returns a clean branch list. */
export function parseClinicBranches(data: unknown): ClinicBranch[] {
  if (!data || typeof data !== "object") return [];
  const branches = (data as Record<string, unknown>).branches;
  if (!Array.isArray(branches)) return [];
  return branches.map(sanitizeBranch).filter(Boolean) as ClinicBranch[];
}

/** Every room across all branches, with its branch attached — for flat filter lists. */
export function flattenRooms(
  branches: ClinicBranch[]
): Array<ClinicRoom & { branchId: string; branchName: string }> {
  return branches.flatMap((b) =>
    b.rooms.map((r) => ({ ...r, branchId: b.id, branchName: b.name }))
  );
}

export function makeLocationId(): string {
  return `loc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
