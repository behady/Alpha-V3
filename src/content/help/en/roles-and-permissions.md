---
title: Roles and permissions
summary: Decide what each person can see and do. Two layers: their role, then the individual switches.
section: setup
order: 4
roles: Owner, Admin
---

Access works in two layers. Get the first one right and the second is usually quick.

1. **The role** — the job they do. This is one choice from a list.
2. **The permissions** — individual switches for pages and actions. This is where the detail lives.

## Where to find it

**Settings → Users**, then press **Manage Access** on the person's card. A panel slides in from the side with everything about that person's access.

![The Manage Access panel with role at the top and permission groups below](/help/en/manage-access-panel.png)

---

## Layer 1 — the role

There are five roles.

| Role | What it means |
|---|---|
| **Owner** | The person the clinic belongs to. Full access, and protected: no other admin can change their role, remove them, or reset their password. One per clinic. |
| **Admin** | Full access to everything, always. A manager who can do anything the owner can do day to day. |
| **Dentist** | A treating dentist. Appears in appointment lists and dentist reports. Starts with the clinical chart and orthodontics. |
| **Receptionist** | Front desk. Starts with patients, the diary and taking payments. |
| **Assistant** | Chairside or general staff. Starts with patients, the diary and the clinical chart. |

> **Owner and Admin ignore every permission switch.** If you set someone to Admin, all the switches below stop mattering — they can see and do everything, including money, settings and deleting records. Only give Admin to people who should run the whole clinic.

### About Owner

You didn't pick this role — whoever created the clinic got it automatically.

- **Owner isn't in the dropdown.** You can't set someone to Owner, and you can't move the owner to another role.
- **The owner is protected.** No other admin can change their access, delete them, or force a new password on them. That is the whole point of the role: an Admin you invite for a fortnight can't lock you out of your own clinic.
- **There is exactly one.** To change who it is, the current owner presses **Transfer clinic ownership** on someone else's Manage Access panel. That person becomes the Owner, and the outgoing owner becomes an Admin — keeping every day-to-day power, giving up only the protection.
- **Only the owner can do that**, and you can't undo it from your side afterwards. Ask before you press it.

### "Also acts as Dentist"

This toggle appears **only for Owner and Admin**. Switch it on when the person running the clinic also treats patients — they'll then show up in the dentist list when booking appointments, and in the per-dentist reports.

Switching someone away from Admin turns this off automatically.

---

## Layer 2 — the permissions

There are **28 switches**, in groups. The count on each person's card — for example *11 of 28* — tells you how many are on.

Picking a role ticks a ready-made set of them. From there **every switch is yours**: anything a role turns on, you can turn off, and it stays off.

### The rule that explains all of it

- **"Module access" switches open a page.** Without one, the page is not in their menu at all.
- **"Actions" switches decide what they can do once inside.**

You almost always need both. Turning on *Add patients* without *Patients* means they have permission to add a patient but no way to reach the screen.

### Module access — opens the page

| Switch | Opens |
|---|---|
| Patients | The patient list and patient files |
| Appointments / calendar | The appointment calendar |
| Lab tracking | Lab case tracking |
| Finance / ledger | The money ledger |
| Inventory | Stock |
| Reports | The reports section |
| Settings (full page) | The settings page |
| Clinical chart | The clinical chart inside a patient's file |
| Orthodontic module | Orthodontic cases |

Dentists get the clinical chart and orthodontics from their role. You only need those two switches to give a **non**-dentist access — an assistant who writes up notes, for example.

### Actions — what they can do inside

| Group | Switches |
|---|---|
| Patients | Add · Edit · Delete |
| Appointments | Book/create · Edit/reschedule · Delete |
| Finance | Add transactions · Edit · Delete |
| Inventory | Add items · Edit · Delete |
| Clinical chart | Edit notes · Delete notes |
| Reports | Export / download |
| Attendance | Attendance admin (see the whole team's attendance) |

Every member of staff can open Attendance to check themselves in. The *Attendance admin* switch is what lets someone see everyone else's.

### The Settings switch that catches everyone

There are two, and they do different things:

- **Settings link (sidebar)** — puts the Settings icon in the menu.
- **Settings (full page)** — actually lets them open it.

Give someone only one and they either see a link that rejects them, or have access to a page with no way to reach it. **Turn on both, or neither.**

---

## Doing it quickly

- Use the **search box** at the top of the panel to find a switch by name instead of scrolling.
- Each group has **Select All** / **Deselect All** — the fastest way to give someone a whole area.
- Every change saves the moment you flick it. There is no Save button, and no way to cancel — flick it back if you change your mind.
- Changes normally reach the person straight away. If they're already signed in and nothing changed, ask them to refresh.

## What each role starts with

Pick the role and these are already on. Change any of them afterwards.

**Dentist — 14 switches**
Dashboard · Patients · Appointments · Lab tracking · Reports · Clinical chart · Orthodontics · Add patients · Edit patients · Book appointments · Edit appointments · Edit clinical notes · Edit stock · Add transactions

*Add transactions* is there because saving a billed treatment writes both the clinical note **and** its charge — without it, half the save fails. The Finance **page** is not included: posting the charge a treatment produces is not the same as reading the clinic's takings.

**Receptionist — 11 switches**
Dashboard · Patients · Appointments · Finance · Reports · Add patients · Edit patients · Book appointments · Edit appointments · Cancel appointments · Add transactions

*Edit transactions* is deliberately off: correcting a payment keyed in wrong is an admin's job.

**Assistant — 13 switches**
Dashboard · Patients · Appointments · Lab tracking · Inventory · Clinical chart · Add patients · Edit patients · Book appointments · Edit appointments · Edit clinical notes · Add stock · Edit stock

**Owner and Admin — all 28**, shown greyed out because the role answers "yes" to every one regardless.

Notice that no starting point includes **Delete** — apart from cancelling a booking, which is reception's job. Deletion is worth granting deliberately, one person at a time, after they've settled in. Neither does any of them include Settings or Marketing.

### The preset bar

Above the switches is a line like **Receptionist preset · 11 switches** and, under it, either *matches the preset* or something like *2 added · 1 removed*. That tells you at a glance whether this person is a standard receptionist or one you have tuned by hand.

**Reset to preset** puts them back — useful when you have experimented and want a clean slate. Each switch that belongs to the role's preset carries a small grey tag with the role name, so you can see what came from the role and what you added.

**Changing someone's role re-deals all their switches** from the new role's preset. The app warns you first, because it throws away anything you had tuned by hand.

---

## Two things that look like bugs but aren't

### "I switched something off for a dentist — will it stay off?"

Yes. The switches are the truth: whatever the panel shows is exactly what is stored and exactly what is enforced. A role fills them in when you pick it and then gets out of the way.

The one thing that overwrites them is **changing the role**, which re-deals the new role's preset. You get a warning first.

### "I turned on everything and they still can't see the AI pages"

Some pages have **no switch at all** and are Owner/Admin-only, no matter what you do:

- Briefing
- Leads
- Attendance (the AI one)

If a member of staff needs one of these, the only way today is to make them an Admin — which gives them everything else too. Think carefully before doing that for a receptionist.

Everything else in the menu — Dashboard, Patients, Appointments, Inventory, Finance, Reports, Attendance — can be granted with the switches above. Dashboard and Attendance are open to every member of staff automatically.

## What's next

Your clinic is set up and your team is in. From here, move on to the day-to-day: adding patients and booking appointments.
