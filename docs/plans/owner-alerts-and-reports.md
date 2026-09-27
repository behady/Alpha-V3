# Owner alerts & reports over WhatsApp — plan (2026-09-27)

Agreed in a 20-question session with the owner. This is the build brief; nothing here is built yet.

## 1. What the owner decided

| Topic | Decision |
|---|---|
| Who receives | Any staff member, by **role preset** (Owner / Admin / Dentist / Receptionist / Assistant), adjustable per alert and per person |
| Priority | Reports first, then more real-time alerts |
| Daily timing | Morning brief **and** evening close, each with its own hour in settings. "Super customizable." |
| Periodic | Weekly, monthly, and payroll-period reports |
| Daily content | Money, appointments, patients & leads, team — each section on/off, per recipient role |
| Money detail | Owner chooses: totals / totals + per dentist / full breakdown (dentist, method, branch, payer) |
| Format | Text message + branded PDF attached |
| Language | Follows the clinic language setting |
| New alerts | Money risks, patient flow, bot & leads, operations — every one with its own on/off and sub-options |
| Thresholds | Owner sets each (number field with a sensible default) |
| Batching | Per alert: instant / hourly digest / fold into the evening report |
| Channels | WhatsApp + app push |
| Global number | An Alpha-owned **Wapilot** number, connected from the superadmin dashboard, used **only for owner/staff alerts** for clinics that have not connected their own number |
| Packaging | The global number is a **cheap add-on**; free when the clinic already connected its own number for the auto-messages or bot add-on |
| Owner Q&A | Later phase; design so a reply to a report can reach the AI assistant |
| Settings home | New "Alerts & Reports" settings page, web + Android |
| Multi-clinic | One message per clinic, clinic name in the header |
| Comparisons | Yes: vs the same weekday last week, and month-to-date vs previous month-to-date |
| First milestone | Settings page + daily text reports |

## 2. What already exists (build on it, do not duplicate)

- **Notification centre** (`src/lib/notificationCatalog.ts`, settings UI `NotificationSettings.tsx`, delivery `notificationDelivery.ts`, Cloud Functions copy generated). Thirty alerts in one catalogue, each with: roles it goes to (with ceilings and fixed audiences), bell on/off, push on/off, per-alert timings (minutes, hours, or hour-of-day), clinic quiet hours, per-user mutes. Already includes `morningBriefClinic`, `morningBriefDentist` (07:00) and `eveningDigest` (21:00, push only, three numbers: collected, seen, no-shows). Runs hourly in Cloud Functions (`functions/pushPhase1.js`).
- **Six WhatsApp owner toggles** (Settings → WhatsApp): appointment add/edit/delete, finance add/edit/delete → one `ownerNumber`, free text, via `lib/whatsappOwnerAlerts.ts`. Silently skipped when the clinic has no gateway.
- **Wapilot credentials** resolve per clinic from `clinic_secrets/{clinicId}`, with a *platform* fallback (legacy `settings/wapilot` doc, then env) that the code itself calls temporary and reports as source `platform`. Today that fallback is used for **patient** messages too.
- **Per-purpose WhatsApp gate** in `lib/whatsappDelivery.ts`: `whatsappIntegration` add-on for automatic messages, `whatsappBot` for the receptionist bot.
- **Reports page** and helpers: `reportHelpers.ts` (cash-basis `ledgerCashValue`, date ranges), `dentistReport.ts` (per-dentist money and attendance by bucket), `payerReport.ts`, `/api/payroll` (period hours + commission).
- **PDF senders** already exist for treatment plans, prescriptions and x-ray explainers (`/api/whatsapp/send-*-pdf`), so "document over WhatsApp" is a solved path on both gateways.
- **Add-on catalogue** `src/lib/featureCatalog.ts`; every module is a per-clinic switch.

## 3. Architecture

### 3.1 WhatsApp becomes the third channel of the notification centre

One alert, three switches: **bell · push · WhatsApp**. The catalogue, role targeting, timings, quiet hours and mutes are reused unchanged. This is the one place the plan departs from the literal answer "new page": the new **Alerts & Reports** page *is* the notification settings page, renamed, given a WhatsApp column and a Reports section. Two separate pages would mean two switches for the same event that can disagree, which is the exact bug the catalogue was written to end.

- `NotifyEvent` gains `whatsapp?: boolean` (catalogue default) and `NotifyEventPref` gains `whatsapp?: boolean`.
- `deliverClinicNotification` gains a WhatsApp leg: for every targeted member with a phone and WhatsApp enabled for that event, send the text (and document, for reports) through the resolver in 3.4.
- **Recipient is a person, not a number.** Phone comes from the member's profile (staff row or owner user doc). The old single `ownerNumber` is kept only as a fallback for the owner when their profile has no phone, and the settings page nudges to fill the profile.
- **Role presets**: Owner = everything; Admin = money + operations + front desk; Dentist = own brief + own production line; Receptionist = front desk + leads; Assistant = arrivals only. Presets are just the catalogue's default `roles` per event; the owner adjusts per alert as today, plus a new **per-person override** ("Dr Ahmed: WhatsApp off") stored on the member.
- **Migration of the six old toggles**: they become catalogue events (`appointmentAdded`, `appointmentEdited`, `appointmentDeleted`, `paymentAdded`, `paymentEdited`, `paymentDeleted`, staff-made; bot-made bookings already exist as `botBooked` etc.). A one-time read of `ownerAlerts` seeds `events.<id>.whatsapp = true` for the owner role; the matrix is removed from the WhatsApp settings page and `whatsappOwnerAlerts.ts` is deleted.

### 3.2 Reports = a new catalogue group `reports`

| Event | Default hour | Default roles | Notes |
|---|---|---|---|
| `morningBrief` (extends `morningBriefClinic`) | 07:00 | Owner, Admin, Receptionist | Today's bookings, first slot, gaps, yesterday's money, debts due today, handoffs still waiting |
| `morningBriefDentist` | 07:00 | Dentist (fixed) | Unchanged; gains WhatsApp |
| `eveningReport` (extends `eveningDigest`) | 21:00 | Owner, Admin | Full day close, see sections below |
| `weeklyReport` | Sat 08:00 | Owner, Admin | Week vs previous week |
| `monthlyReport` | 1st, 08:00 | Owner | Month vs previous month, per dentist, per payer |
| `payrollReport` | when the payroll window closes | Owner, Admin | Hours, lates, commission per person, from `/api/payroll` |

Each report has, in settings: on/off · roles · send hour (and weekday / day-of-month) · **sections** checklist (Money, Appointments, Patients & leads, Team) · **money detail** (totals / +per dentist / full) · **comparisons** on/off · **attach PDF** on/off. Stored under `alertPreferences.reports.<id>`.

**Sections, evening report**
- Money: collected today by method, expenses, net, new debt created, debt collected; per dentist / full breakdown by setting; comparison arrows.
- Appointments: seen, no-show, cancelled, rescheduled, walk-ins; tomorrow's count and first slot.
- Patients & leads: new patients, new leads by source, bot conversations, handoffs waiting, reviews requested.
- Team: who attended, late arrivals, per-dentist production (only if money detail ≥ per dentist).

**Comparisons**: same weekday last week (daily), previous week (weekly), previous month-to-date (monthly). Shown as `↑ 12%` / `↓ 8%` next to the figure; no comparison line when the base is zero.

**Text shape**: clinic name header (mandatory on the shared number, see 3.4), date line, then sections with a bold heading each, Arabic or English by clinic setting. Target: readable in ten seconds on a phone.

**PDF**: server-rendered, branded with the clinic's logo and colours, same tables the Reports page shows, one page per section. Uploaded to `clinics/{id}/reports/{yyyy-mm-dd}-{kind}.pdf` in Storage, sent as a document through the same path the treatment-plan PDF uses. Generated once per clinic per run and shared by every recipient.

**Multi-clinic**: the job runs per clinic; an owner of three clinics gets three messages, each headed by its clinic.

### 3.3 New real-time alerts (catalogue entries with thresholds and batching)

Every entry gets `batching?: "instant" | "hourly" | "daily"` in prefs (default instant). `hourly` and `daily` write to `clinics/{id}/alert_queue`; an hourly Cloud Function flushes the hourly ones as one grouped message, and the evening report absorbs the daily ones as an "Also today" section.

| Group | Event | Threshold (default) |
|---|---|---|
| Money risks | `discountAbove` | percent (20) |
| | `expenseAbove` | EGP (2,000) |
| | `paymentDeleted`, `paymentEdited` | — (migrated) |
| | `paymentBackdated` | days (1) |
| Patient flow | `noShowMarked` | — |
| | `sameDayCancellation` | — |
| | `walkInBooked` | — |
| | `patientWaitingLong` | minutes after check-in (20) |
| Bot & leads | `newLead`, `botHandedOff`, `patientWaitingReplyEscalated`, `unhappyReview` | exist; gain WhatsApp |
| | `complaintKeyword` | word list (clinic-editable, seeded) |
| Operations | `staffLate` | minutes after shift start (15) |
| | `staffAbsent` | hour of day (11) |
| | `labCaseOverdue` | days past due (1) |
| | `stockLow` | exists |
| | `aiCreditsLow` | credits (20); `aiCreditsOut` stays |

Thresholds use the existing `timings` mechanism (it already stores numbers per event and key); percent and EGP are new `kind`s for the input's label and range only.

### 3.4 Delivery: own number first, Alpha number second, push always

Resolution for an alert or report to a person:

1. Clinic has its **own** gateway connected (Meta official or Wapilot) → send from it. Free, no add-on check beyond the connection.
2. Else clinic has the **`ownerAlertsLine`** add-on → send from the **platform Wapilot number**.
3. Else → bell + push only; the settings page shows "WhatsApp needs a connected number or the Alerts line add-on" with a link.

Rules for the platform number:
- **Owner and staff numbers only. Never a patient.** Guarded in code by a new purpose `"staff"` in `deliverWhatsAppMessage`; the platform config is only reachable through that purpose.
- Every message starts with the clinic name, because one number serves many clinics.
- Credentials live in a server-only doc `platform_secrets/wapilot` written from a new **superadmin → Platform WhatsApp** card (instance id, token, test send, last-send status). Replaces the legacy `settings/wapilot` doc and env fallback.
- Add-on key `ownerAlertsLine` in `featureCatalog.ts`, group messaging. Auto-granted (shown as "included") when `whatsappIntegration` or `whatsappBot` is on **and** a clinic number is connected; otherwise sold cheaply on its own.
- Wapilot is an unofficial gateway. Low volume to known staff numbers keeps the ban risk small; it must never carry marketing or patient traffic.

**Decided 2026-09-27:** the platform number is for alerts only. The existing platform fallback for *patient* messages is removed in M1; a clinic with no own number sends patient messages by click-to-send (`manual` mode), which the code already supports. The platform line is a **new** Wapilot number, not the current one.

### 3.5 Owner Q&A (later, but designed now)

Inbound on the platform number is already webhooked (`/api/webhooks/whatsapp-inbound`). Keep a `phone → uid → clinicIds` map when a staff alert is sent, so a reply can be attributed to a person and a clinic, then handed to the AI assistant with that person's permissions. Reports end with one line: "Reply with a question about these numbers" only once this phase ships.

### 3.6 Android

Same Alerts & Reports screen in the rebuilt app (settings write machinery exists; the Auto SMS screen is the template). New push channels for the new groups. Per standing rule, it ships in the same APK as the next batch, not one per feature.

## 4. Milestones

**M1 — testable first: settings + daily text reports**
1. Catalogue: `whatsapp` channel, `reports` group, six migrated events, per-person override.
2. Alerts & Reports page (web): WhatsApp column, role presets, Reports section with hour/sections/detail/comparisons.
3. Morning brief + evening report as text over WhatsApp, with comparisons, clinic-language.
4. Delivery resolver (own number → platform → push), purpose `staff`, platform number card in superadmin, `ownerAlertsLine` add-on.
5. Firebase deploy of the functions copy (one is already owed).
Done when: the owner receives tonight's evening report on WhatsApp from a clinic with no connected number, and the six old alerts still arrive.

**M2 — PDF + periodic**: branded PDF attachment; weekly, monthly, payroll reports.

**M3 — real-time catalogue**: the new alerts in 3.3 with thresholds, hourly/daily batching, alert_queue flush.

**M4 — phone + replies**: Android screen and channels; owner Q&A through the AI assistant.

## 5. Status

**Milestone 1 — built 2026-09-27** (branch `claude/owner-alerts`, pushed to `main`):

- Catalogue: `whatsapp` is the third switch on every alert the web server raises (`waReady`); the
  six grid alerts are catalogue events (`appointmentAdded/Edited/Deleted`, `paymentAdded/Edited/Deleted`)
  and old grid ticks are honoured through `legacyOwnerKey`; a `reports` group holds the morning brief,
  each dentist's day and the close-out, each with sections, money detail, comparisons and language.
- Delivery: `deliverClinicNotification` sends WhatsApp to each targeted person via `lib/staffWhatsapp.ts`
  (own Meta number → own Wapilot → platform line if the `ownerAlertsLine` add-on is on → nothing).
  Recipients' numbers live in `alertPreferences.people.<uid>.phone`; the owner falls back to the old
  `ownerNumber`. Per-person WhatsApp off switch in the same map.
- Reports: `/api/automation/staff-reports` runs hourly (Vercel cron), WhatsApp only, deduplicated per
  clinic/report/day in `clinics/{id}/report_sends`. Text from `lib/reports/staffReportText.ts` over
  the existing `buildBriefing`. The "Test" button on a report row sends the real report to the tester.
- Platform line: superadmin → Platform → "Alerts line" card writes `clinic_secrets/platform.wapilot`;
  the old `settings/wapilot` shared fallback for patient messages is gone.
- Settings → Alerts & reports: WhatsApp column, report options under each report row, a
  "WhatsApp recipients" block, and a line saying which number WhatsApp leaves from.

**Milestone 2 — built 2026-09-27:** `weeklyReport` (weekday + hour), `monthlyReport` and `payrollReport`
(day-of-month + hour) in the Reports group, built from `buildBriefing` week/month; "Attach PDF" on every
report except the dentist's day, rendered server-side with jsPDF (`lib/reports/staffReportPdf.ts`) and sent
as a document (`sendStaffDocument`: Storage signed URL → Meta link / Wapilot bytes). Arabic PDFs need a real
Arabic font in `public/fonts` (`NotoNaskhArabic-Regular.ttf` or `Amiri-Regular.ttf`) — the Cairo file there is
Latin-only — or `REPORT_ARABIC_FONT_URL`; without one the PDF falls back to English. Also shipped between the
milestones: the **staff line** (`lib/bot/staffLine.ts`): a number on the recipients block is answered as staff
by the bot, kept out of the Chats inbox, and can ask for reports by a word.

**Milestone 3 — built 2026-09-27:** twelve real-time alerts with owner-set thresholds (`percent` / `egp` /
`count` / `days` timing kinds): `discountAbove`, `expenseAbove`, `paymentBackdated` (from `/api/finance/ledger`
and the clinical charge route via `lib/alerts/moneyAlerts.ts`), `noShowMarked`, `sameDayCancellation`,
`walkInBooked` (booking service + dashboard status buttons → owner-alert route), `patientWaitingLong`,
`staffLate`, `staffAbsent`, `labCaseOverdue`, `aiCreditsLow` (`lib/alerts/sweep.ts`, cron `/api/automation/alert-sweep`
every 10 min, one marker per subject in `alert_marks`), `complaintKeyword` (both inbound webhooks, word list in
`lib/alerts/complaint.ts`). Per-alert **batching** (`events.<id>.batching`: instant / hourly / daily): the bell row
is always immediate; batched items wait in `alert_queue` and the sweep sends one grouped message per event at the
top of the hour or at the close-out hour.

**Not done yet:** Cloud-Functions-raised alerts on WhatsApp
with thresholds and batching (M3); WhatsApp for alerts raised by Cloud Functions (arrivals, SLA
escalations, stock) — they show "—" in the WhatsApp column until the Functions half can reach a
gateway; Android screen (M4); month-to-date comparison in the daily text (needs a second briefing build).

## 6. Decided 2026-09-27 (was open)

- `ownerAlertsLine` add-on price: **590 EGP / year**.
- Platform line: a **new** Wapilot number, connected from the superadmin card once the owner has it.
- Shared number carries staff alerts only; patient fallback removed (3.4).

Still to watch: many staff rows have no phone today; the page will show who is unreachable.
