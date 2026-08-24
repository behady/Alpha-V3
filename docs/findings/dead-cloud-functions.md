# Eight notification features cannot fire

Found 2026-08-24 while checking a defect the recycle-bin review raised. Not caused by any recent
change — this has been true since the app became multi-tenant.

## The mismatch

`functions/index.js` registers Firestore triggers on **root** collections:

| Trigger watches | The app actually writes to |
|---|---|
| `appointments/{appointmentId}` (×3) | `clinics/{clinicId}/appointments/{id}` |
| `attendance/{recordId}` | `clinics/{clinicId}/attendance/{id}` |
| `inventory/{itemId}` | `clinics/{clinicId}/inventory/{id}` |
| `ledger/{ledgerId}` | `clinics/{clinicId}/ledger/{id}` |
| `lab_orders/{orderId}` | `clinics/{clinicId}/lab_orders/{id}` |

A trigger on `appointments/{id}` does not match `clinics/abc/appointments/xyz`. Nothing is ever
written to the root paths — the Firestore console shows only `clinics`, `join_requests`, `meta_*`,
`system_logs` and `users` at the root — so these functions have never run in v3 and cannot.

The same applies to `dailyClinicReportToOwner`, which is scheduled correctly (`50 23 * * *`) but
reads `collection("settings")` and `collection("ledger")` at the root and therefore reports on an
empty database.

`resolvePatientFromAppointment` also falls back to `where("name", "==", patientName)` when an id
does not resolve, which would message a **different patient who happens to share a name** — a real
privacy defect, currently unreachable only because the function it serves never runs. It must be
deleted as part of any revival, not ported.

## What this means in practice

Silently absent, with no error anywhere because nothing ever fires:

- doctor alerted on a new / changed / cancelled appointment
- low-stock alert
- payment-received alert
- clock-in alert
- lab-order alert
- the 23:50 daily owner report

The app has no push-notification code of its own (`grep` for `sendPush`/`notifyDoctor` across
`src/` returns nothing outside migration helpers), so these functions are the only path. Nothing
replaced them.

## What IS working

- **`functions/marketingAutomations.js`** — clinic-aware, iterates `collection("clinics")`.
  `reviewRequestsNightly`, `birthdayCampaigns`, `leadSpeedAlerts` and `occasionRadarPush` are fine.
- **`functions/metaLeads.js`** — the live Meta webhook at
  `alpha-v2-ffc98.cloudfunctions.net/metaLeadsWebhook`.
- **Appointment reminders** — Vercel cron → `/api/automation/reminders`, daily at 03:00
  (`vercel.json`), clinic-scoped and correct.

So the migration to multi-tenancy reached the marketing automations and the reminder job, and
stopped before the notification triggers.

## Fixing it

Each trigger moves to `clinics/{clinicId}/<collection>/{id}` and takes `clinicId` from
`event.params`, then reads settings and recipients from that clinic rather than the root. The
name-based patient fallback is deleted rather than ported.

Worth confirming in the Firebase console whether these are deployed at all before doing the work:
if they were never deployed to this project, this is dead code to remove rather than triggers to
repair, and the honest fix is deletion plus a note that the feature does not exist.
