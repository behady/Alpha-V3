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

// Task 14: every money-reading screen shows only the branch on screen.
for (const rel of [
  "src/app/(dashboard)/finance/page.tsx",
  "src/components/dashboard/DesktopDashboard.tsx",
  "src/components/dashboard/MobileDashboard.tsx",
  "src/components/dashboard/OwnerHome.tsx",
  "src/components/dashboard/DentistHome.tsx",
]) {
  assert.match(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"), /rowInScope\(/, `${rel} reads money without filtering by the branch on screen`);
}

// Task 15: reports read the branch on screen, and the export names the branch.
const reportsPage = readFileSync(new URL("../src/app/(dashboard)/reports/page.tsx", import.meta.url), "utf8");
assert.match(reportsPage, /rowInScope\(/, "reports no longer filter by the branch on screen");
const reportsExport = readFileSync(new URL("../src/components/reports/reportExcelUtils.ts", import.meta.url), "utf8");
assert.match(reportsExport, /"Branch"|الفرع/, "the reports export has no Branch column");

// Task 16: payroll and settlements are per branch; the phone keeps getting the clinic total without a param.
assert.match(readFileSync(new URL("../src/app/(dashboard)/team/page.tsx", import.meta.url), "utf8"), /rowInScope\(/, "the Team page ignores the branch on screen");
assert.match(readFileSync(new URL("../src/app/(dashboard)/team/page.tsx", import.meta.url), "utf8"), /[Cc]laims\b[^\n]*rowInScope\(/, "the Team page shows insurance shares of every branch");
assert.match(readFileSync(new URL("../src/app/api/insurance/claims/route.ts", import.meta.url), "utf8"), /branchId: branch\.branchId/, "a saved claim does not carry its branch");
// Payroll reads no money rows; the branch narrows the roster by the ticks on each staff row.
const payroll = readFileSync(new URL("../src/app/api/payroll/route.ts", import.meta.url), "utf8");
assert.match(payroll, /searchParams\.get\("branchId"\)/, "payroll does not accept a branch");
assert.match(payroll, /allowedBranches\(/, "payroll does not narrow the roster to the branch");

// Mixed-scope fixes: the pending commission, and the owner's briefing, follow the branch on screen.
assert.match(readFileSync(new URL("../src/app/(dashboard)/finance/page.tsx", import.meta.url), "utf8"), /rowInScope\(claim/, "Finance pending insurance commission ignores the branch on screen");
assert.match(readFileSync(new URL("../src/lib/automation/briefing/data.ts", import.meta.url), "utf8"), /rowInScope\(/, "the briefing loader ignores the branch");
assert.match(readFileSync(new URL("../src/app/api/ai/daily-briefing/route.ts", import.meta.url), "utf8"), /searchParams\.get\("branchId"\)/, "the briefing route ignores the branch");
assert.match(readFileSync(new URL("../src/components/dashboard/OwnerHome.tsx", import.meta.url), "utf8"), /&branchId=/, "the owner view does not ask for its branch's briefing");

// Task 17: the patient file shows the whole account, each row saying which branch took it.
const patientFinance = readFileSync(new URL("../src/components/PatientFinance.tsx", import.meta.url), "utf8");
const moneyTab = readFileSync(new URL("../src/components/appointments/AppointmentMoneyTab.tsx", import.meta.url), "utf8");
assert.match(patientFinance, /useActiveBranch\(\)/, "the patient file does not look up branch names");
assert.match(patientFinance, /\.branchId/, "the patient file rows do not say which branch they belong to");
assert.match(moneyTab, /useActiveBranch\(\)/, "the appointment money tab does not look up branch names");
assert.match(moneyTab, /r\.branchId/, "the appointment money tab rows do not say which branch they belong to");
assert.doesNotMatch(patientFinance, /rowInScope\(/, "the patient file must show the whole account, not one branch of it");

// Every money route asks which branch before it writes; edits and deletes ask whose row it is.
for (const rel of [
  "src/app/api/finance/ledger/route.ts",
  "src/app/api/clinical/procedures/route.ts",
  "src/app/api/insurance/claims/route.ts",
  "src/app/api/staff/settlements/route.ts",
  "src/app/api/gemini/route.ts",
]) {
  assert.match(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"), /assertBranchAllowed\(/, `${rel} writes money without checking the branch`);
}
for (const rel of ["src/app/api/finance/ledger/route.ts", "src/app/api/clinical/procedures/route.ts"]) {
  assert.match(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"), /assertRowBranchAllowed\(/, `${rel} edits or deletes another branch's money unchecked`);
}

// Finance tabs: a tab per branch for the owner, a tab per insurance company, one filter, one collect.
{
  const financePage = readFileSync(new URL("../src/app/(dashboard)/finance/page.tsx", import.meta.url), "utf8");
  assert.match(financePage, /BranchTabs/, "the Finance page has no branch tabs");
  assert.match(financePage, /InsurerTab/, "the Finance page has no insurance-company tab");
  assert.match(financePage, /applyFinanceFilters\(/, "the Finance page filters rows by hand instead of applyFinanceFilters");
  assert.match(financePage, /collectFromInsurer\(/, "the Finance page cannot collect from an insurance company");
  assert.match(financePage, /rowsBeforeBranches/, "the Clinic tab lost the rows-from-before-branches line");
  assert.match(financePage, /InsurerBadge/, "payment rows no longer say which company paid");
  const insurerTab = readFileSync(new URL("../src/components/finance/InsurerTab.tsx", import.meta.url), "utf8");
  // Insurer money follows the charge's branch; collecting never asks which branch.
  assert.doesNotMatch(insurerTab, /useBranchForMoney/, "collecting from an insurer must not ask which branch");
}

console.log("branchAccess: all checks passed");
