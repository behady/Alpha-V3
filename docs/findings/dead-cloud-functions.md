# Cloud Functions: one live bug, seven pieces of dead code

> **Resolved 2026-08-24.** Both parts fixed — see the Resolution section at the end.

Investigated 2026-08-24. **This file corrects an earlier version of itself** — the first pass
reasoned from the repository alone and concluded that eight notification features were deployed and
silently failing. The Firebase console showed otherwise: 13 functions are deployed, and the seven
"failing" ones are not among them. They were never deployed, and were already replaced. Recorded
here rather than quietly edited, because the wrong conclusion was reached in a plausible way and
the correction is the useful part: **the repo cannot tell you what is deployed.**

## The one real bug: the nightly owner report reads an empty database

`dailyClinicReportToOwner` **is** deployed, on `50 23 * * *`, and the console shows it running
(1 request per 24h). It reads:

```js
admin.firestore().collection("ledger")       // root
admin.firestore().collection("appointments") // root
admin.firestore().collection("settings")     // root
```

Every one of those is a v2 root path. This app writes to `clinics/{clinicId}/…`, and the Firestore
console shows no root `ledger`, `appointments` or `settings` at all. So the job finds nothing, and
then proceeds anyway: it builds a report of zeros, renders it to PDF, uploads it to
`daily-reports/{date}/Daily-Clinic-Report.pdf`, signs a URL and sends it.

The result is a nightly report stating the clinic took no money, completed no appointments and
performed no procedures — every night, indefinitely. It also writes a new PDF to Storage each
night forever.

There is no error to notice. The queries succeed; they simply match nothing.

**Fix:** iterate `collection("clinics")` the way `pushPhase1.js` and `marketingAutomations.js`
already do, read each clinic's own subcollections, and send that clinic's owner their own report.
Refusing to send when there is genuinely no activity would also be an improvement over reporting
zeros as though they were measured.

## The seven dead exports

`functions/index.js` exports these, and none are deployed:

`notifyDoctorOnNewAppointment`, `notifyDoctorOnUpdateAppointment`,
`notifyDoctorOnDeleteAppointment`, `notifyOnLowInventory`, `notifyOnNewPayment`,
`notifyOnClockIn`, `notifyOnLabOrder`

They trigger on root paths (`appointments/{id}`, `inventory/{itemId}`, `ledger/{ledgerId}`,
`attendance/{recordId}`, `lab_orders/{orderId}`) which nothing writes to. They are v2 leftovers
that `pushPhase1.js` superseded — the replacements are deployed and clinic-aware.

They are harmless while undeployed and dangerous the moment somebody runs `firebase deploy
--only functions` without reading them: seven broken triggers would appear at once, and
`resolvePatientFromAppointment` would come with them. That helper falls back to
`where("name", "==", patientName)` when an id does not resolve, which would message **a different
patient who happens to share a name**. Delete the seven exports and the helper.

## What is deployed and working

| Function | Trigger | Clinic-aware |
|---|---|---|
| `onPatientCheckedIn` | `clinics/{clinicId}/appointments/{id}` | yes |
| `onSlotFreed` | `clinics/{clinicId}/appointments/{id}` | yes |
| `onLowStock` | `clinics/{clinicId}/inventory/{itemId}` | yes |
| `morningBrief`, `leadsDueToday`, `eveningDigest` | scheduled | yes (`pushPhase1.js`) |
| `reviewRequestsNightly`, `birthdayCampaigns`, `leadSpeedAlerts`, `occasionRadarPush` | scheduled | yes (`marketingAutomations.js`) |
| `metaLeadsWebhook`, `retryMetaLeadEvents` | HTTP / scheduled | yes (`metaLeads.js`) |

Appointment reminders are separate again: Vercel cron → `/api/automation/reminders`, 03:00 daily
(`vercel.json`), clinic-scoped and correct.

The three document triggers showed 0 requests in 24h at the time of checking. That is not evidence
of a fault — they fire on specific transitions (a check-in, a slot being freed, stock crossing a
threshold), and a quiet day produces none.

## Two smaller notes

- The document triggers run in **europe-west2** while everything scheduled runs in
  **us-central1**. Not a fault; worth knowing before debugging latency or reading logs in the
  wrong region.
- 20 exports in `index.js`, 13 functions deployed. Nothing in the repo records which is which, and
  the names differ enough that the mismatch is invisible without opening the console. A comment at
  the top of `index.js` naming the undeployed ones would have prevented the wrong conclusion above.


---

## Resolution (2026-08-24)

**The seven dead exports and their private helpers are deleted.** `functions/index.js` went from
715 lines to ~360, and its export list now matches the 13 functions actually deployed. An audit
established which helpers were reachable only from the doomed exports before anything was cut; the
`wapilotClient` require in particular *looks* deletable — two of its three names appear only inside
the doomed handlers — but all three are still needed by the nightly report, and removing it would
have broken the one function that was deployed. `whatsappMessageDefaults.js` stays as a file
(`leadWelcome.js` and `marketingAutomations.js` both need it); only `index.js`'s require of it went.

**The nightly report now reports on real clinics.** The audit found a second cause beneath the one
recorded above: the job used `admin.firestore()`, which binds the conventional `"(default)"`
database, while this project's database is literally named `"default"`. So it was querying paths
that do not exist *in a database that does not exist* — two independent silent failures stacked on
each other, which is why nothing ever errored.

What changed, beyond the paths:

- `getFirestore(admin.app(), "default")`, matching every module written after that discovery.
- Iterates clinics the way `marketingAutomations.js` does, treating a missing `status` as Active.
- Reads `clinics/{id}/ledger` and `clinics/{id}/appointments` filtered on the **`date` string**,
  not a `createdAt` timestamp range — `date` is what the rest of the system treats as
  authoritative, so a payment entered next morning for yesterday lands in the right report. This
  also makes the nightly figure agree with the 21:00 evening digest, which queries the same way.
- Owner number from `clinics/{id}/settings/whatsapp`, the path the Settings screen actually writes.
- Storage path is `clinics/{id}/daily-reports/{date}/…`. The old path had no tenant in it, so two
  clinics on one day wrote the same object and the second overwrote the first — handing one
  practice's owner a link to another practice's patients.
- Signed URL expiry cut from 7 days to 48 hours. The URL needs no authentication and the PDF names
  every patient seen that day, so its lifetime *is* its access control.
- One clinic failing no longer aborts the run for everyone after it.
- **A clinic with no activity gets no message.** Reporting zeros reads as a measurement; a closed
  Friday would look identical to a broken job, which is precisely how the old version hid.
- The PDF carries the clinic's name, and tables that are capped now say "showing 80 of 95" instead
  of silently disagreeing with the summary count above them.

Still not done, and deliberately out of scope: nothing deletes old report PDFs (now N per day
rather than one), the WhatsApp credentials are still process-wide rather than per clinic, and there
is no `storage.rules` file, so the signed URL remains the only control on the object.
