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
    rooms,
  };
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
