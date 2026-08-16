---
title: Roles and permissions
summary: Decide what each person can see and do. Two layers: their role, then the individual switches.
section: setup
order: 4
roles: Admin
---

Access works in two layers. Get the first one right and the second is usually quick.

1. **The role** — the job they do. This is one choice from a list.
2. **The permissions** — individual switches for pages and actions. This is where the detail lives.

## Where to find it

**Settings → Users**, then press **Manage Access** on the person's card. A panel slides in from the side with everything about that person's access.

![The Manage Access panel with role at the top and permission groups below](/help/en/manage-access-panel.png)

---

## Layer 1 — the role

There are four roles.

| Role | What it means |
|---|---|
| **Admin** | Full access to everything, always. |
| **Dentist** | A treating dentist. Appears in appointment lists and dentist reports. Can always open the clinical chart and orthodontics. |
| **Receptionist** | Front desk. Sees only what you switch on. |
| **Assistant** | Chairside or general staff. Sees only what you switch on. |

> **Admin ignores every permission switch.** If you set someone to Admin, all the switches below stop mattering — they can see and do everything, including money, settings and deleting records. Only give Admin to people who should run the whole clinic.

### "Also acts as Dentist"

This toggle appears **only when the role is Admin**. Switch it on when the owner is also a treating dentist — they'll then show up in the dentist list when booking appointments, and in the per-dentist reports.

Switching someone away from Admin turns this off automatically.

---

## Layer 2 — the permissions

There are **26 switches**, in groups. The count on each person's card — for example *8 of 26* — tells you how many are on.

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

## Suggested starting points

Reasonable defaults. Adjust to your clinic.

**Receptionist** — Patients · Add patients · Edit patients · Appointments · Book appointments · Edit appointments · Finance · Add transactions

**Dentist** — Patients · Appointments · Reports (the clinical chart and orthodontics come with the role)

**Assistant** — Patients · Appointments · Inventory · Add inventory · Edit inventory

Notice that no starting point includes **Delete**. Deletion is worth granting deliberately, one person at a time, after they've settled in.

---

## Two things that look like bugs but aren't

### "It says 0 of 26, but they can already see Patients and Appointments"

Anyone you add with **Add Team Member** starts with a small set of built-in permissions that let them open Patients and Appointments. Those built-in ones are not shown as switches, so the counter reads 0 while the menu clearly shows two items.

Nothing is wrong. Set the switches you actually want and the counter will start moving.

### "I turned on everything and they still can't see the AI pages"

Some pages have **no switch at all** and are Admin-only, no matter what you do:

- Briefing
- Leads
- Attendance (the AI one)

If a member of staff needs one of these, the only way today is to make them an Admin — which gives them everything else too. Think carefully before doing that for a receptionist.

Everything else in the menu — Dashboard, Patients, Appointments, Inventory, Finance, Reports, Attendance — can be granted with the switches above. Dashboard and Attendance are open to every member of staff automatically.

## What's next

Your clinic is set up and your team is in. From here, move on to the day-to-day: adding patients and booking appointments.
