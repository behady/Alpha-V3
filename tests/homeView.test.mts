// The three home screens: which one opens, and who may open it. Every user has all three tabs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { effectiveHomeView, homeViewAccess } from "../src/lib/homeView";

let checks = 0;
const eq = (a: unknown, b: unknown, msg: string) => {
  assert.deepEqual(a, b, msg);
  checks++;
};

// Which screen opens: a choice wins; without one, a Dentist is on the chair and others on the calendar.
eq(effectiveHomeView("desk", false, "Dentist"), "chair", "a dentist who never picked on the tabs lands on the chair, as before");
eq(effectiveHomeView("owner", false, "Dentist"), "chair", "an old stored value means nothing for a dentist: the old screens ignored it");
eq(effectiveHomeView("desk", false, "Receptionist"), "desk", "everyone else lands on the calendar");
eq(effectiveHomeView("owner", false, "Owner"), "owner", "an owner's stored choice from before the tabs still counts");
eq(effectiveHomeView("desk", true, "Dentist"), "desk", "a dentist who picked the calendar gets it");
eq(effectiveHomeView("owner", true, "Receptionist"), "owner", "a stored choice is kept even when locked: the page says why");

// Who may open what.
const owner = homeViewAccess({ isAdmin: true, role: "Owner", permissions: [], alsoDentist: false });
eq(owner, { owner: true, desk: true, chair: false }, "an owner who does not treat: no chair of their own");
const ownerDentist = homeViewAccess({ isAdmin: true, role: "Owner", permissions: [], alsoDentist: true });
eq(ownerDentist, { owner: true, desk: true, chair: true }, "an owner who treats: all three");
const dentist = homeViewAccess({ isAdmin: false, role: "Dentist", permissions: ["access.appointments"], alsoDentist: false });
eq(dentist, { owner: false, desk: true, chair: true }, "a dentist with the appointments permission: calendar and chair");
const dentistNoCal = homeViewAccess({ isAdmin: false, role: "Dentist", permissions: [], alsoDentist: false });
eq(dentistNoCal.desk, false, "the calendar follows the appointments permission, for dentists too");
const reception = homeViewAccess({ isAdmin: false, role: "Receptionist", permissions: ["access.appointments"], alsoDentist: true });
eq(reception, { owner: false, desk: true, chair: false }, "reception: the calendar only — and alsoDentist counts for admins only");

// The band shows every tab to everyone; the page shows the "ask the owner" screen instead.
{
  const tabs = readFileSync(new URL("../src/components/dashboard/HomeViewTabs.tsx", import.meta.url), "utf8");
  assert.ok(!/if \(!isAdmin\) return null/.test(tabs), "the home tabs are hidden from non-admins again");
  assert.ok(/"owner"/.test(tabs) && /"desk"/.test(tabs) && /"chair"/.test(tabs), "a home tab went missing");
  const page = readFileSync(new URL("../src/app/(dashboard)/page.tsx", import.meta.url), "utf8");
  assert.ok(/if \(!allowed\) return <HomeNoAccess \/>/.test(page), "a locked home screen renders its content again");
  const blocked = readFileSync(new URL("../src/components/dashboard/HomeNoAccess.tsx", import.meta.url), "utf8");
  assert.ok(/You need permission from the owner to access this page\./.test(blocked), "the locked page lost its message");
  checks += 5;
}

console.log(`homeView: ${checks} checks passed`);
