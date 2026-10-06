/**
 * The dashboard's room calendar: one column per room, so each room's day reads on its own.
 *
 * Looking at one branch, its rooms get a column each, under their own names. Looking at every
 * branch, every room does, named with its branch ("Maadi · Room 1") since two branches usually
 * both have a "Room 1". A visit with no room — or a room that is not one of the columns — goes in a
 * "No room" column at the end, which only exists when something needs it: nothing is hidden.
 */
import type { ClinicBranch } from "@/lib/clinicLocations";

export const NO_ROOM = "__no_room__";

export type RoomColumn = { id: string; label: string; roomName: string; branchId: string };

export function roomColumns(
  branches: ReadonlyArray<Pick<ClinicBranch, "id" | "name" | "rooms">>,
  scopeBranchId: string,
  appointments: ReadonlyArray<{ id: string; roomId?: string | null }>,
): { columns: RoomColumn[]; columnOf: Map<string, string> } {
  const inScope = scopeBranchId ? branches.filter((b) => b.id === scopeBranchId) : branches;
  const named = !scopeBranchId;
  const columns: RoomColumn[] = [];
  for (const b of inScope) {
    for (const r of b.rooms ?? []) {
      columns.push({ id: r.id, label: named ? `${b.name} · ${r.name}` : r.name, roomName: r.name, branchId: b.id });
    }
  }
  const known = new Set(columns.map((c) => c.id));
  const columnOf = new Map<string, string>();
  let loose = false;
  for (const a of appointments) {
    const room = String(a.roomId || "");
    if (room && known.has(room)) columnOf.set(a.id, room);
    else {
      columnOf.set(a.id, NO_ROOM);
      loose = true;
    }
  }
  if (loose && columns.length > 0) columns.push({ id: NO_ROOM, label: "", roomName: "", branchId: scopeBranchId });
  return { columns, columnOf };
}
