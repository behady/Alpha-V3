// One visit, several approved services.
//
// An appointment used to carry one link (claimId + claimLine). It can now carry a list
// (claimLinks), while still writing the first link into the old pair so every screen that reads
// only the pair keeps working. These checks pin the reading side: a list, the old pair, or both.
import assert from "node:assert/strict";
import { appointmentLinkFields, lineBooking, lineSyncPatch, parseClaimLinks } from "../src/lib/insurance/appointments";

// --- reading the links -------------------------------------------------------------------------
assert.deepEqual(parseClaimLinks(null), []);
assert.deepEqual(parseClaimLinks({ status: "Scheduled" }), [], "a private booking has no links");
assert.deepEqual(parseClaimLinks({ claimId: "c1", claimLine: 2 }), [{ claimId: "c1", claimLine: 2 }], "an old single link still reads");
assert.deepEqual(
  parseClaimLinks({ claimId: "c1", claimLine: 0, claimLinks: [{ claimId: "c1", claimLine: 0 }, { claimId: "c1", claimLine: 1 }, { claimId: "c2", claimLine: 0 }] }),
  [
    { claimId: "c1", claimLine: 0 },
    { claimId: "c1", claimLine: 1 },
    { claimId: "c2", claimLine: 0 },
  ],
  "the list wins, and the mirrored first link is not counted twice",
);
assert.deepEqual(
  parseClaimLinks({ claimLinks: [{ claimId: "c1", claimLine: -1 }, { claimId: "", claimLine: 0 }, "junk", { claimId: "c1", claimLine: 1 }] }),
  [{ claimId: "c1", claimLine: 1 }],
  "broken entries are dropped, good ones kept",
);
assert.deepEqual(
  parseClaimLinks({ claimId: "c9", claimLine: 0, claimLinks: [] }),
  [],
  "an empty list is the truth once a list exists: the old pair is only a mirror",
);

// --- what gets stored ---------------------------------------------------------------------------
assert.deepEqual(appointmentLinkFields([]), { claimLinks: [], claimId: null, claimLine: null });
assert.deepEqual(
  appointmentLinkFields([{ claimId: "c1", claimLine: 1 }, { claimId: "c2", claimLine: 0 }]),
  { claimLinks: [{ claimId: "c1", claimLine: 1 }, { claimId: "c2", claimLine: 0 }], claimId: "c1", claimLine: 1 },
  "the first link is mirrored into the old pair",
);

// --- where a line stands ------------------------------------------------------------------------
const visits = [
  { id: "a1", claimLinks: [{ claimId: "c1", claimLine: 0 }, { claimId: "c1", claimLine: 1 }], claimId: "c1", claimLine: 0, status: "Scheduled", date: "2026-10-08", time: "10:00 AM", doctor: "Dr A" },
  { id: "a2", claimId: "c1", claimLine: 2, status: "Completed", date: "2026-10-01", time: "11:00 AM", doctor: "Dr B" },
];
assert.equal(lineBooking(visits, "c1", 0).kind, "booked");
assert.equal(lineBooking(visits, "c1", 1).kind, "booked", "the second service on a visit is booked too");
assert.equal(lineBooking(visits, "c1", 2).kind, "done", "an old single-link visit still counts");
assert.equal(lineBooking(visits, "c2", 0).kind, "none");

// --- a finished visit completes every service it was booked for --------------------------------
const claim = {
  id: "c1",
  status: "approved" as const,
  lines: [{}, {}, {}] as never[],
  lineStatus: { 0: "Planned", 1: "Planned", 2: "Ongoing" } as Record<number, "Planned" | "Ongoing" | "Completed">,
  dentists: {},
};
assert.deepEqual(
  lineSyncPatch(claim, { claimLinks: [{ claimId: "c1", claimLine: 0 }, { claimId: "c1", claimLine: 2 }, { claimId: "c2", claimLine: 1 }], status: "Completed", doctorId: "s1" }),
  { lineStatus: { 0: "Completed" }, dentists: { 0: "s1", 2: "s1" } },
  "both of this approval's services follow; the Ongoing one keeps its state; the other approval's link is not applied here",
);
assert.equal(
  lineSyncPatch(claim, { claimLinks: [{ claimId: "c2", claimLine: 0 }], status: "Completed", doctorId: "s1" }),
  null,
  "a visit linked only to another approval changes nothing on this one",
);

console.log("claim links: all checks passed");
