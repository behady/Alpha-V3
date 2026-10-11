// Branch access: who may work in which branch, and which rows a branch view shows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withBranch } from "../src/lib/branchScope";
import {
  allowedBranches,
  rowInScope,
  branchForAutomaticRow,
  isValidBranchIds,
  resolveBranchChoice,
  ALL_BRANCHES,
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

// Task 4: the browser chokepoints attach the branch on screen.
const money = readFileSync(new URL("../src/lib/moneyApi.ts", import.meta.url), "utf8");
assert.match(money, /currentBranchId\(\)/, "moneyApi.post no longer attaches the on-screen branch");
const ins = readFileSync(new URL("../src/components/insurance/api.ts", import.meta.url), "utf8");
assert.match(ins, /currentBranchId\(\)/, "the insurance client no longer attaches the on-screen branch");
const hook = readFileSync(new URL("../src/lib/useActiveBranch.ts", import.meta.url), "utf8");
assert.match(hook, /setCurrentBranchScope\(scopeBranchId\)/, "useActiveBranch no longer publishes the scope");

// The body-merge rule: a body never carries an empty or null branchId.
assert.deepEqual(withBranch({ a: 1 }, "hel"), { a: 1, branchId: "hel" });
assert.deepEqual(withBranch({ branchId: "tag" }, "hel"), { branchId: "tag" });
assert.deepEqual(withBranch({ branchId: "" }, "hel"), { branchId: "hel" });
assert.deepEqual(withBranch({ branchId: "" }, ""), {});
assert.deepEqual(withBranch({ branchId: null }, ""), {});
assert.equal("branchId" in withBranch({ branchId: "" }, ""), false, "no empty key");

// Task 10: the Team page carries the branches tick-list.
const settingsTab = readFileSync(new URL("../src/app/(dashboard)/team/SettingsTab.tsx", import.meta.url), "utf8");
assert.match(settingsTab, /branchIds/, "the Team page lost the branches tick-list");

// Task 11: the branch on screen is always one the person may work in.
assert.equal(resolveBranchChoice([], ALL_BRANCHES, true), "");
assert.equal(resolveBranchChoice([b("hel"), b("tag")], ALL_BRANCHES, true), ALL_BRANCHES);
assert.equal(resolveBranchChoice([b("tag")], ALL_BRANCHES, false), "tag", "a remembered All from before the change resolves to the first allowed branch");
assert.equal(resolveBranchChoice([b("hel"), b("tag")], "tag", false), "tag");
assert.equal(resolveBranchChoice([b("tag")], "hel", false), "tag", "a remembered branch outside the allowed set falls back");
assert.equal(resolveBranchChoice([b("hel"), b("tag")], null, true), "hel");
const booking = readFileSync(new URL("../src/components/BookingModal.tsx", import.meta.url), "utf8");
assert.match(booking, /allowedBranches/, "booking no longer limits the branch picker to the allowed branches");
assert.doesNotMatch(booking, /LOCATIONS_DOC/, "booking loads settings/locations itself again");

// Task 12: no money is recorded under "All branches" without asking which branch first.
for (const rel of [
  "src/components/appointments/AppointmentMoneyTab.tsx",
  "src/components/QuickPaymentModal.tsx",
  "src/components/PatientFinance.tsx",
  "src/components/clinical-notes/ServiceEditorDrawer.tsx",
  "src/app/(dashboard)/finance/page.tsx",
  "src/app/(dashboard)/team/page.tsx",
  "src/components/insurance/ClaimsTable.tsx",
  "src/components/insurance/PatientInsuranceTab.tsx",
  "src/components/appointments/booking/InsuranceShareDue.tsx",
]) {
  assert.match(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"), /requireBranchForMoney\(\)/, `${rel} records money without asking which branch under All branches`);
}

console.log("branchAccess: all checks passed");
