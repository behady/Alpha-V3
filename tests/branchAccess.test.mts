// Branch access: who may work in which branch, and which rows a branch view shows.
import assert from "node:assert/strict";
import {
  allowedBranches,
  rowInScope,
  branchForAutomaticRow,
  isValidBranchIds,
} from "../src/lib/branchAccess";

const b = (id: string) => ({ id, name: id, address: "", phone: "", code: "", rooms: [] });
const branches = [b("hel"), b("tag")];
assert.deepEqual(allowedBranches(branches, { branchIds: ["tag"] }, false).map((x) => x.id), ["tag"]);
assert.deepEqual(allowedBranches(branches, { branchIds: ["tag"] }, true).map((x) => x.id), ["hel", "tag"], "admins always see all");
assert.deepEqual(allowedBranches(branches, {}, false).map((x) => x.id), ["hel", "tag"], "nothing ticked = all");
assert.deepEqual(allowedBranches(branches, { branchIds: [] }, false).map((x) => x.id), ["hel", "tag"]);
assert.deepEqual(allowedBranches(branches, { branchIds: ["gone"] }, false).map((x) => x.id), ["hel", "tag"], "ticked branches all deleted = all, not nothing");
assert.deepEqual(allowedBranches(branches, { branchIds: ["gone", "hel"] }, false).map((x) => x.id), ["hel"]);
assert.deepEqual(allowedBranches([], { branchIds: ["hel"] }, false), [], "no branches: nothing to allow");
assert.equal(rowInScope({ branchId: "hel" }, ""), true);
assert.equal(rowInScope({}, ""), true, "old rows show under All");
assert.equal(rowInScope({}, "hel"), false, "old rows hide under a branch");
assert.equal(rowInScope({ branchId: "tag" }, "hel"), false);
assert.equal(branchForAutomaticRow({ appointment: { branchId: "tag" }, patient: { branchId: "hel" }, branches }), "tag");
assert.equal(branchForAutomaticRow({ appointment: { branchId: "gone" }, patient: { branchId: "hel" }, branches }), "hel");
assert.equal(branchForAutomaticRow({ patient: {}, branches }), "hel", "falls back to the first branch");
assert.equal(branchForAutomaticRow({ branches: [] }), null);
assert.equal(isValidBranchIds(["a", "b"]), true);
assert.equal(isValidBranchIds(["a", 3]), false);

console.log("branchAccess: all checks passed");
