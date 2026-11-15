/**
 * The places where a clinic's staff may clock in.
 *
 * A clinic used to have exactly one: the location saved in Settings → Attendance. A clinic with
 * two branches has two buildings, and everyone at the second one was told they were kilometres
 * from "the clinic" and could not start their shift.
 *
 * So a clinic with two or more branches saves one location per branch, and a punch is accepted
 * inside ANY of them — staff cover for each other, and the punch records which branch it was.
 *
 * Where the branch locations live: in `settings/clinic_info` under `attendanceBranchSites`, keyed
 * by branch id — NOT on the branch itself in `settings/locations`. That document is written whole
 * by the Branches screen; a second screen writing the same list would let a stale copy undo a
 * rename. Here the Attendance screen stays the only writer of everything it shows.
 *
 * Nothing changes for a clinic that never fills this in:
 *  - fewer than two branches → the one clinic location, exactly as before;
 *  - two or more branches → every branch that has its own location, PLUS the old clinic location
 *    for as long as any branch is still missing one. Once every branch has its own, the old one
 *    retires, so a stale third spot does not stay open forever.
 */
import {
  isUsableGeofence,
  judgeGeofence,
  type Geofence,
  type GeofenceVerdict,
  type LocationReading,
} from "./attendanceLocation";
import type { ClinicBranch } from "./clinicLocations";

/** The field on `settings/clinic_info` holding one location per branch id. */
export const BRANCH_SITES_FIELD = "attendanceBranchSites";

/** How a location is kept in settings: strings, like the three clinic-wide fields always were. */
export type BranchSiteDraft = { lat: string; lng: string; radius: string };

/** A place staff may clock in. `branchId` is "" for the old clinic-wide location. */
export type AttendanceSite = Geofence & { branchId: string; branchName: string };

const DEFAULT_RADIUS_M = 50;

const text = (value: unknown) => (value == null ? "" : String(value).trim());

/** Null unless the numbers describe a real spot on the map. An empty box is not latitude 0. */
function geofenceFrom(lat: unknown, lng: unknown, radius: unknown): Geofence | null {
  if (!text(lat) || !text(lng)) return null;
  const fence: Geofence = {
    lat: parseFloat(text(lat)),
    lng: parseFloat(text(lng)),
    radius: parseInt(text(radius), 10) || DEFAULT_RADIUS_M,
  };
  return isUsableGeofence(fence) ? fence : null;
}

/** The saved branch locations as the settings form edits them. Missing ones come back blank. */
export function readBranchSiteDrafts(info: Record<string, unknown> | null | undefined): Record<string, BranchSiteDraft> {
  const raw = info?.[BRANCH_SITES_FIELD];
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, BranchSiteDraft> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    out[id] = { lat: text(v.lat), lng: text(v.lng), radius: text(v.radius) };
  }
  return out;
}

/** Whether what is typed for a branch is a usable location yet. */
export function isBranchSiteSet(draft: BranchSiteDraft | undefined): boolean {
  return Boolean(draft && geofenceFrom(draft.lat, draft.lng, draft.radius));
}

/** The old single clinic location, or null when it was never set. */
export function readClinicWideSite(info: Record<string, unknown> | null | undefined): AttendanceSite | null {
  const fence = geofenceFrom(info?.attendanceLat, info?.attendanceLng, info?.attendanceRadius);
  return fence ? { ...fence, branchId: "", branchName: "" } : null;
}

/** Whether the screens treat this clinic as having a location per branch. */
export const usesBranchSites = (branches: readonly Pick<ClinicBranch, "id">[]) => branches.length >= 2;

/** Every place a punch is accepted right now. Empty means nobody has set a location at all. */
export function readAttendanceSites(
  info: Record<string, unknown> | null | undefined,
  branches: readonly Pick<ClinicBranch, "id" | "name">[]
): AttendanceSite[] {
  const clinicWide = readClinicWideSite(info);
  if (!usesBranchSites(branches)) return clinicWide ? [clinicWide] : [];

  const drafts = readBranchSiteDrafts(info);
  const own: AttendanceSite[] = [];
  for (const branch of branches) {
    const draft = drafts[branch.id];
    const fence = draft ? geofenceFrom(draft.lat, draft.lng, draft.radius) : null;
    if (fence) own.push({ ...fence, branchId: branch.id, branchName: branch.name });
  }
  const everyBranchSet = own.length === branches.length;
  return clinicWide && !everyBranchSet ? [...own, clinicWide] : own;
}

export type SiteVerdict = GeofenceVerdict & { site: AttendanceSite };

/** How far past the allowed distance a refused reading is. */
const overshoot = (v: SiteVerdict) => v.effectiveDistance - v.site.radius;

/**
 * Judges one reading against every site and returns the one that matters: the site the person is
 * inside (the closest, if two overlap), or — when they are inside none — the one they came
 * nearest to being let into, so the refusal can name a branch rather than a number alone.
 */
export function judgeSites(reading: LocationReading, sites: readonly AttendanceSite[]): SiteVerdict | null {
  let best: SiteVerdict | null = null;
  for (const site of sites) {
    const verdict: SiteVerdict = { ...judgeGeofence({ reading, clinic: site }), site };
    if (
      !best ||
      (verdict.inside && !best.inside) ||
      (verdict.inside === best.inside &&
        (verdict.inside ? verdict.distance < best.distance : overshoot(verdict) < overshoot(best)))
    ) {
      best = verdict;
    }
  }
  return best;
}

/**
 * What a punch row stores about the branch it was made at.
 *
 * Named checkIn…/checkOut… rather than plain `branchId`: that name scopes money and bookings
 * elsewhere in the app, and a clock-in is not either. Nothing is added for the clinic-wide
 * location — and never an undefined, which Firestore refuses the whole write over.
 */
export function punchBranchFields(site: AttendanceSite, type: "in" | "out"): Record<string, string> {
  if (!site.branchId) return {};
  return type === "in"
    ? { checkInBranchId: site.branchId, checkInBranchName: site.branchName }
    : { checkOutBranchId: site.branchId, checkOutBranchName: site.branchName };
}
