# Meta ad results (Conversions API for WhatsApp ads)

A short guide for a clinic that runs Click-to-WhatsApp ads ("Send message" ads on Facebook and
Instagram). The first part is for the clinic owner. The last part, **For the developer**, is the
technical detail.

---

## What it does, in one paragraph

Today Meta only knows that someone **opened a chat** from your ad. It does not know whether that
person booked, came in, or paid, so it keeps finding you more people who like to chat. With this
switched on, the system quietly tells Meta, for every ad chat: **"this one booked"**, **"this one
confirmed"**, **"this one came in, and the visit was worth X pounds"**. Meta can then show your ads
to more people like the ones who actually came in.

Nothing changes for the desk or the patients. Nobody sees a message. It is a report that goes to
Meta in the background.

## What it does NOT do

- **It only reports patients who came from an ad.** The first WhatsApp message from an ad carries
  a hidden "click id" from Meta. Only chats with that id are reported. Walk-ins, phone bookings,
  word of mouth and ordinary WhatsApp chats are never sent. (A patient who came from an ad is
  remembered: an appointment within **28 days** of the click still counts for that ad. Meta does
  not publish a window for click ids — 28 days is our own choice. The click's time is the first
  time that click id reached us.)
- **The "From ad" tag on the patient file.** A new patient the bot registers from an ad gets the
  small **From ad** tag straight away. A patient who **already had a file** and then taps an ad
  gets the tag only once this card is switched on and one of their bookings has been processed —
  so in a clinic with the card off, an existing patient who came back through an ad has no tag.
  That is expected; the click is still kept on their WhatsApp chat.
- **One booking and one confirmation per ad click.** The first booking and the first confirmation
  after an ad click are reported. A returning patient who books again on the same click is not
  reported again, and moving an appointment to another time is not a new booking (a
  **Rescheduled** appointment still counts as booked). A booking and a confirmation are things
  that happened, so they are still reported if the appointment is later **Cancelled**, a **No
  Show**, **Delayed**, **Late** or **Rescheduled** — that is exactly what Meta needs to learn which
  ads bring bookings. A confirmation is withdrawn only if the booking is set back to
  **Unconfirmed (Scheduled)** before the report went; a booking only if the appointment is deleted.
- **It needs the official WhatsApp number (Meta Cloud API).** Clinics that use the QR-code line
  (the gateway / WaPilot) do see which ad a chat came from, but Meta asks for the clinic's
  *WhatsApp Business Account ID* with every report, and a QR line does not have one. Meta will most
  likely refuse those reports. Use this only on a clinic whose official number is connected in the
  **WhatsApp Business (Meta)** card.
- **One "visit" report per visit, sent about 3 hours after the patient arrives.** A report cannot
  be corrected once sent, and the system sends each one only once. So it waits 3 hours after
  check-in for the dentist to enter the day's treatments, then sends that visit's charges.
  Treatments added after that are not sent. If the check-in is undone before the 3 hours are up
  (status moved back, appointment cancelled or deleted), nothing is sent; a later real arrival is
  reported instead.
- **A withdrawn report is never sent late.** If a booking is un-confirmed or a check-in is undone
  before its report went, a report that was never tried is simply dropped, and a later real
  confirmation or arrival is reported instead. If it was a **retry that was still waiting** when
  the booking was un-confirmed or the check-in was undone (Meta did not answer the first try in
  time), it is closed (shown as **Set back to unconfirmed** / **Check-in undone**) and never sent
  again — Meta may already have the first try, and Meta counts every copy it gets.
- **Nothing older than 7 days.** Meta refuses events older than a week, so an appointment edited
  long after the fact is skipped, not sent.
- **It does not change your ads by itself.** The reports start flowing; you decide when to tell
  Meta to optimise for them (see **Making the ads use it** below).
- **Nothing goes to Meta until you switch it on.** In every clinic the system already keeps every
  new ad click on the WhatsApp chat (and on a patient the bot registers from an ad) — that costs
  nothing extra and is what lets the first reports work on day one. But while the card is off,
  bookings and visits are not even queued, and no report is sent.

---

## Step 1. Get three things from Meta

> Meta renames its menus often. The names below are what they were called when this was written;
> if a menu looks different, look for the closest match. Nothing here can break your ads.

You need to be an admin of the clinic's **Meta Business portfolio** (business.facebook.com).

**Before you start (the Meta app).** Meta only accepts these reports from an app that has been
given the right access. As written today (Meta changes the wording often): the app needs the
`whatsapp_business_manage_events` permission with **Advanced access**, and Meta's **Marketing API**
access tier for the Conversions API. If the test in Step 3 fails with a permission error even with
a fresh token, this is the usual reason — check the app in **developers.facebook.com → App
Review**.

**A. The Dataset ID** (a long number)

1. Open **Events Manager** (business.facebook.com/events_manager).
2. Click **Connect data** (the green **+** on the left).
3. Choose **Messaging** / **WhatsApp**, then pick the clinic's WhatsApp Business account.
   - Meta often creates a dataset for the WhatsApp account by itself. If you already see one named
     after the clinic's WhatsApp account, use that one instead of making a new one.
4. Open the dataset → **Settings**. Copy the **Dataset ID** (Meta may also call it the *Pixel ID*).

**B. The WhatsApp Business Account ID** (a long number)

- **Business settings** → **Accounts** → **WhatsApp accounts** → click the clinic's account. The ID
  is shown at the top. (Also visible in **WhatsApp Manager** next to the account name.)
- If it is already filled in the **WhatsApp Business (Meta)** card, you can skip it: the system
  uses that one.

**C. An access token**

- If the **WhatsApp Business (Meta)** card already has a token saved, try that first: leave the
  token box empty and press **Send test event** (Step 3). If the test works, you are done.
- If the test says the token has no permission, make a new one:
  1. **Business settings** → **Users** → **System users** → pick (or add) the system user.
  2. **Assign assets**: give it the clinic's **WhatsApp account** and the **dataset** from step A
     (full control).
  3. **Generate new token**. Choose the clinic's app, expiry **Never**, and tick these
     permissions: `whatsapp_business_management` and `whatsapp_business_manage_events`.
  4. Copy the token (it starts with `EAA`). Meta shows it only once.

Keep the token private. Paste it only into the card below — never into a chat, an email or a
screenshot.

## Step 2. Paste them in

**Settings → WhatsApp →** scroll to the **WhatsApp Business (Meta)** card. Right under it is a
new card, **Meta ad results (Conversions API)**.

1. **Dataset ID** — paste A.
2. **WhatsApp Business Account ID** — paste B, or leave empty to use the card above.
3. **Access token** — paste C, or leave empty to use the card above. Once saved it is never shown
   again; leave the box empty to keep it.
4. Leave **Send results to Meta** OFF for now. Press **Save**.

## Step 3. Test it

1. In **Events Manager** → your dataset → **Test events**, copy the test code (looks like
   `TEST12345`).
2. Paste it into **Test event code** in the card and press **Save**. With the switch still off,
   the card shows **Off** with a small note **test code saved**. (Once the switch is on, a saved
   code makes the card show **Test mode** instead.)
3. Press **Send test event**. You should see **Meta received the test event**.
4. Back in Events Manager → **Test events**, the event appears within a minute or so.
5. **Now CLEAR the test event code and Save.** With the switch on and a test code saved, **real**
   bookings and visits are **not sent at all** — they wait (up to 7 days) and go to Meta by
   themselves once you clear the code. Only the **Send test event** button uses the code.
   Anything left waiting more than 7 days is skipped as **Too old for Meta**, so do not leave the
   code in.

The test needs at least one real ad chat on the clinic (it borrows that chat's click id). If none
has arrived yet, open the clinic's WhatsApp from one of its own ads once.

## Step 4. Switch it on

Turn **Send results to Meta** ON and press **Save**. From now on, every ad patient's booking,
confirmation and visit is reported.

The **Recent events** list in the card shows each report: **Sent**, waiting, retrying, **Failed**,
or skipped with a reason:

| Reason shown | What it means |
| --- | --- |
| No ad click | The patient did not come from an ad (or the click is more than 28 days old). Normal — most patients. |
| Already reported for this ad | This ad click's booking or confirmation was already sent. Normal for returning patients. |
| No patient | The appointment has no patient file, so there is no ad click to look up. |
| Appointment gone | The appointment was deleted before the report went. |
| Cancelled | Only on older rows. Today a booking or confirmation is still reported when the appointment is later cancelled — it did happen. A cancelled **visit** is not reported (see Check-in undone). |
| Set back to unconfirmed | A retry was still waiting when the booking was moved back to Unconfirmed (Scheduled). Closed, never sent again — Meta may already have the first try. |
| Check-in undone | A retry was still waiting when the check-in was undone (moved back or cancelled) within the 3-hour wait. Closed, never sent again — Meta may already have the first try. |
| Sent (recorded late) | Meta took the report, but the system could not write that down at the time. It was written later and was **not** sent twice. |
| Too old for Meta | The moment was more than 7 days ago (Meta refuses older reports), or it waited too long — for example while the switch was off or a test code was saved. |
| Meta refused it | Meta answered with an error. The note shows Meta's message — usually a wrong ID or token. |
| Out of attempts | Meta could not be reached 5 times in a row. |
| Test did not go through | A **Send test event** that Meta did not accept. The note shows why. |
| Unknown event | An internal mix-up; should never appear. Tell the developer. |
| Feature was off / Settings incomplete | Only on older rows, from before the queue learned to wait. |

**Send pending now** sends whatever is waiting without waiting for the next automatic run. If the
card is off, half set up or in test mode, it sends nothing and says which of the three is in the
way.

**Reports already in the queue wait** while the switch is off, the settings are incomplete, or a
test code is saved. Nothing in the queue is lost for 7 days: switch it back on, finish the
settings or clear the test code, and they go out on the next run. But **while the switch is off,
new bookings and visits are not queued at all** — they are not caught up later.

To stop: switch **Send results to Meta** OFF. No new bookings or visits are queued from then on;
anything already waiting stays waiting (and is skipped as **Too old for Meta** after 7 days) unless
you switch it back on.

---

## What is reported to Meta

| What happened in the clinic | Event Meta sees | Value |
| --- | --- | --- |
| Appointment booked (by the desk, the bot, online, anywhere) | **LeadSubmitted** | — |
| Appointment confirmed (or booked already confirmed) | **QualifiedLead** | — |
| Patient arrived — the first of Checked In / In Chair / Checking Out / Completed | **Purchase** | the visit's treatment charges, in EGP |

- **LeadSubmitted and QualifiedLead are reported once per ad click.** A returning patient's later
  bookings on the same click are not reported again, and a reschedule is not a new booking — a
  **Rescheduled** appointment still counts as booked. Confirming, un-confirming and confirming
  again is one QualifiedLead.
- **A booking and a confirmation stay reported** if the appointment later goes Cancelled, No Show,
  Delayed, Late or Rescheduled — they happened. A booking is dropped only if the appointment is
  deleted; a confirmation is withdrawn only if the booking is set back to **Unconfirmed
  (Scheduled)** before it was sent.
- **Purchase is reported once per visit.** Checked In → In Chair → Completed is one visit, one
  Purchase, sent about 3 hours after arrival. If the check-in is undone before then (status moved
  back, cancelled, deleted), nothing is sent and a later real arrival is reported instead.
- **Withdrawn, never sent late.** A withdrawn report that was never tried is dropped quietly (the
  later real confirmation or arrival is reported instead). A retry that was still waiting when the
  confirmation or check-in was undone is closed as **Set back to unconfirmed** / **Check-in
  undone** and never sent again, because Meta may already have the first try and Meta counts every
  copy.
- The Purchase value is the sum of the treatments charged on that visit **after discounts** (what
  the patient is charged), entered within about 3 hours of arrival. A visit with no charge entered
  is reported with 0.
- An appointment that is Cancelled or a No Show from the start reports nothing, and a cancelled or
  no-show appointment never reports a visit.

## How reliable it is

- **Nothing is missed when the app is closed.** A Firebase trigger watches every appointment save,
  from every screen, the bot and the online booking page, and puts the report in a queue.
- **The queue is sent every 10 minutes.** If Meta is down or busy, the report is retried after
  5 minutes, 20 minutes, 1 hour and 3 hours — five tries in about four and a half hours.
- **A wrong ID or a bad token is not retried** (it would fail the same way every time). Those show
  as **Failed** in the list with Meta's message. Fix the setting; new reports go through.
- **Each report is sent once — by us, not by Meta.** Meta does **not** remove repeated reports for
  WhatsApp ads; it counts whatever it receives. So the system guards against repeats itself: one
  queue row per appointment and event, a lock so two overlapping runs cannot send the same row,
  a row is never sent again once it is marked sent, and bookings/confirmations are reported once
  per ad click.
- **The one gap left.** If Meta accepts a report but the answer never reaches us (the connection
  times out at the wrong moment), the system cannot tell it arrived and sends it again on the
  retry. Meta then counts it twice. This is rare, and there is no way to close it from our side.

---

## Making the ads use it

Reports flowing in is step one. Meta only optimises for them when the ad set is told to.

> Ads Manager's wording changes often and differs between accounts. Treat these as directions,
> not exact button names.

1. **Wait for steady numbers first.** Meta's own guidance is roughly **50 events a week per ad set**
   before it can learn well. Check the dataset's **Overview** in Events Manager.
2. **Start with the booking event**, not the visit. Bookings (**LeadSubmitted**) or confirmations
   (**QualifiedLead**) come in far more often than visits, so Meta learns faster. Move to
   **Purchase** later, once visits alone reach good weekly numbers.
3. In **Ads Manager**, duplicate the current Click-to-WhatsApp campaign (or create a new one):
   - Objective: **Sales** (sometimes **Leads**), with **Messaging apps → WhatsApp** as the
     conversion location.
   - Performance goal: **Maximise number of conversions** (or *purchases*), and pick this dataset
     and the event (for example **LeadSubmitted**).
4. Keep the old campaign running at first and move budget across gradually.
5. **Give it 1–2 weeks** before judging. The first days (Meta calls it the *learning phase*) are
   usually more expensive.
6. Compare **cost per booking** in **Reports → Marketing → WhatsApp ads**, not cost per chat.

---

## For the developer

### Files

| File | What it is |
| --- | --- |
| `src/lib/metaConversions.ts` | The pure core: status → event mapping, event ids, click choice, request body, response classification, retry schedule, settings parsing. No I/O. |
| `src/lib/metaConversionsServer.ts` | The I/O half: settings (with the WhatsApp-card fallback), the queue worker, the Graph POST, purchase value, patient click carry-over, test send. |
| `functions/metaConversions.js` | Firestore trigger `onAppointmentConversion` on `clinics/{clinicId}/appointments/{id}`. Queues only; never sends. |
| `functions/metaConversionsPlan.js` | The trigger's pure plan — a JavaScript twin of `conversionTriggers` (Cloud Functions cannot import the web TypeScript). Kept in step by the parity test. |
| `src/app/api/automation/meta-conversions/route.ts` | The sender. Vercel cron every 10 minutes (`vercel.json`); cron-secret / automation-token auth. |
| `src/app/api/admin/meta-conversions/route.ts` | The card's API: read/save settings (token write-only), test send, send now, recent events. Admins only. |
| `src/components/settings/MetaConversionsCard.tsx` | The settings card, under the WhatsApp Business (Meta) card. |
| `src/lib/bot/respond.ts` (`withNewAdClick`, and the bot's patient registration) | Keeps every new ad click on the conversation, from the snapshot it already read; stamps `adAttribution` on a patient the bot registers from an ad. Never looks up an existing patient. |
| `scripts/meta-capi-test-event.mts` | Command-line test send (below). |

### Data

| Path | Contents |
| --- | --- |
| `clinic_secrets/{clinicId}.metaCapi` | `{ enabled, datasetId, wabaId, token, testEventCode, updatedAt, updatedBy }`. Empty `wabaId` / `token` fall back to `clinic_secrets/{clinicId}.metaWhatsapp.wabaId` / `.token`. Server-only. |
| `clinic_secrets/{clinicId}/meta_conversion_events/{id}` | Queue and log in one: one row per appointment and event (the Purchase row is per visit; the id is built in `metaConversions.ts`). `status` pending → sent / retry → failed / skipped (`reason`), `dueAt`, `attempts`, `lockedUntil` while a run holds it, the click used, `value`, the redacted `payload`, Meta's `response` (`httpStatus`, `eventsReceived`, `fbtraceId`, `error`). Created with `create()` by the trigger, so a re-delivered trigger is a no-op. Under `clinic_secrets` because every path there is denied to clients, while any `clinics/{id}/*` subcollection is open to every clinic member. |
| `clinics/{clinicId}/patients/{patientId}.adAttribution` | Newest click on top + `clicks[]` (newest first, max 10). Built only by `attributionFromClicks`; never overwritten with null. Written when the bot registers a patient from an ad, and by the sender's carry-over (`rememberPatientClicks`) when one of the patient's bookings is processed in a clinic with the switch on — so an existing patient who taps an ad has no `adAttribution` (and no From ad tag) until then. |
| `clinics/{clinicId}/whatsapp_conversations/{key}.adClicks` | Every click on the chat (`mergeClicks`, max 10). The first-ad-wins `ad` / `adAt` fields beside it are unchanged; the ad reports read those. |

### Behaviour worth knowing

- Off unless `clinic_secrets/{clinicId}.metaCapi.enabled === true`. The trigger reads nothing on a
  write whose status did not move; on a booking/confirm/visit it reads the switch and **queues
  nothing if off** — bookings and visits made while off are never caught up. Rows queued while it
  was on wait (stay pending, not skipped) while the switch is off, the settings are incomplete or
  a test code is saved, and go out on the next run once it is back on / complete / the code is
  cleared; only `MAX_EVENT_AGE_MS` (7 days) ends them, as `too_old`. A run that stops on one of
  those returns `summary.paused` (`disabled` / `not_configured` / `test_mode`), which the card's
  **Send pending now** turns into a reason.
- **Capture runs in every clinic.** `withNewAdClick` (`respond.ts`) keeps every new ad click on
  the chat, and the bot stamps `adAttribution` on a patient it registers from an ad, whatever the
  switch says. Both ride on writes the bot already makes, so they cost no extra reads. An
  **existing** patient who taps an ad is not looked up on the message path (that lookup could scan
  thousands of patients per click); their clicks reach the patient file only through the sender's
  carry-over (`clicksForPatient` → `rememberPatientClicks`) once the switch is on and one of their
  bookings is processed. Nothing is sent to Meta unless the switch is on.
- **Click time = first arrival.** A click's `clickedAt` is the first time that click id reached us;
  a later copy of the same id does not move it.
- **Meta does not deduplicate business-messaging events.** Its Conversions API for Business
  Messaging docs tell partners to dedupe before sending; the `event_id` we send is not a guard.
  Our guards are the only protection: `create()` in the trigger (one row per appointment and
  event), the claim lock (`lockedUntil`, `CLAIM_LOCK_MS`) between overlapping runs, a sent row is
  never sent again, and once-per-click markers for LeadSubmitted / QualifiedLead. Residual risk: a
  request that times out after Meta already accepted it is retried and counted twice. Not fixable
  from our side; accepted.
- The click is chosen when the event is **sent**, not when it is queued (the trigger reads no
  clicks). `pickClick` takes the newest click at or before the event, at most 28 days old
  (`MAX_CLICK_AGE_MS`); a click after the event did not cause it and is never used. Meta publishes
  a 7-day window for phone matching and none for click ids; 28 days is our choice. No click →
  `skipped / no_click`.
- LeadSubmitted and QualifiedLead are sent **once per ad click** (`already_credited` for the next
  booking on the same click). A reschedule is not a new booking; Rescheduled still counts as
  booked. `recheckAppointment`: a LeadSubmitted is sent whenever the appointment still exists, any
  status (Cancelled / No Show / Rescheduled included); a QualifiedLead is sent at any status except
  exactly `Scheduled` (set back to unconfirmed → `not_confirmed`). Only a deleted appointment ends
  either as `appointment_gone`. Old rows may still carry reason `cancelled`; nothing writes it now.
- **Click markers** (`clinic_secrets/{clinicId}/meta_conversion_clicks/{hash}_{event}`) are reserved
  (`state: "sending"`, `eventId`) before the send and the click is stamped on the row in the same
  transaction. Sent → `state: "sent"`. Refused outright (`failed`) → the marker is deleted. A
  **retry** (timeout, 5xx, 429) keeps the marker `sending` under that row: the try may have reached
  Meta. Another row on the same click then reads the owner row: sent → `already_credited`; still
  open → deferred 5 min (`busy`, no try spent); missing or final without a send → takes the click.
  There is no age-based takeover.
- Purchase is **once per visit**, due `eventTime + 3 h` (`PURCHASE_SETTLE_MS`); value = sum of
  `chargeAmount(row)` over `ledger` rows with this `appointmentId`, `type === "procedure"`, not
  deleted/cancelled — `cost` is already net of the discount, so the value is after discounts. It is
  withdrawn if the check-in is undone before it is due (status moved back, cancelled, deleted).
- **Withdrawn rows.** A withdrawn row with no send attempt yet is removed silently, so a later real
  confirmation / arrival queues and reports a fresh one. A retry that was still waiting when the
  moment was undone is ended as `skipped` with reason `not_confirmed` (QualifiedLead) or
  `visit_undone` (Purchase) and is never re-sent — Meta may already have the first try, and Meta
  does not dedupe. A QualifiedLead with no try counted but whose click marker is reserved or
  credited under its own event id (a run died after reserving, maybe after posting) is ended the
  same way (`dropUndoneRow` → `maybe_sent`).
- **Recorded late.** If Meta accepts a row but its `sent` cannot be written, the row is locked for a
  day with `sentUnrecorded: true` plus the send's details (click, attempts, payload, response,
  value); the run that claims it after that writes only `status: "sent"`, `reason:
  "recorded_late"` and `sentAt`. A lead whose marker already says `sent` under the row's own event
  id is recorded the same way. Neither is posted again.
- Retry on 5xx, 429, network/timeout, Meta's `is_transient`, and throttle codes 4/17/32/613/80004.
  Any other 4xx fails at once (`meta_rejected`). `MAX_ATTEMPTS = 5`, delays 5 m / 20 m / 1 h / 3 h,
  then `out_of_attempts`.
- **Test mode.** While `testEventCode` is saved, the worker sends **no real events** — they wait
  (up to 7 days) and go out once the code is cleared. Only the test send (card button / script)
  puts `test_event_code` in a body. The admin GET returns `testMode: boolean` for the card.
- The token goes only in the `Authorization: Bearer` header — never in the URL, the log, an API
  response or a console line. Logged payloads go through `redactPayload`.
- Graph version: env `META_CAPI_GRAPH_VERSION`, default `v23.0` (same as the lead-form webhook).
  Meta's current docs already show newer versions; v23.0 is expected to expire around mid-2027 —
  bump the env before then.
- `partner_agent` is `alpha-dental`, overridable with env `META_CAPI_PARTNER_AGENT`. Meta prefers a
  partner name it assigned; set it if Meta gives one.
- **Meta-side prerequisites** (Meta's wording changes; check before relying on it): the app needs
  `whatsapp_business_manage_events` with Advanced access and Meta's Marketing API access tier for
  the Conversions API; the system-user token needs `whatsapp_business_management` +
  `whatsapp_business_manage_events`. The dataset for a WABA can be read with
  `GET /{WABA_ID}/dataset`, or created with `POST /{WABA_ID}/dataset`, instead of clicking through
  Events Manager.
- **Phone fallback (built, not switched on).** `MatchKey` has a `phone` variant (SHA-256 of the
  E.164 digits + the Facebook Page id → `user_data.ph` / `page_id`) for chats with no click id.
  Nothing selects it yet; turning it on is a change to the worker's choice of key, plus a place to
  store the Page id.

### Deploy

Two pipelines (see `docs/runbooks/deploy-functions.md`):

1. **Web app** (routes, card, cron, worker) — Vercel deploys on push to `main`. The cron entry in
   `vercel.json` starts with that deploy.
2. **The trigger** — `onAppointmentConversion` is a Cloud Function. A push to `main` that touches
   `functions/` runs the **Deploy Cloud Functions** GitHub workflow; or by hand, from a machine with
   `functions/` installed (`cd functions && npm ci`):

   ```bash
   firebase deploy --only functions:onAppointmentConversion --project alpha-v2-ffc98
   ```

   Never add `--force`. The Firestore database is named `default`; the trigger must name it. A
   first-ever Firestore trigger can need extra Eventarc permissions on the deploying account — if
   the workflow fails on that, the error line says which role.

Order does not matter much: until the trigger is deployed nothing is queued, and until the web app
is deployed the queue just waits (events older than 7 days are then skipped, not sent). Both are
inert for every clinic until its switch is on.

### Tests

```bash
npm run test:capi          # pure: parsing, mapping (+ parity with functions/metaConversionsPlan.js), payload, retries
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:capi-worker   # the queue worker against the emulator (start it first)
```

### Command-line test send

```bash
npx tsx scripts/meta-capi-test-event.mts --clinic <clinicId> --code TEST12345 --dry
npx tsx scripts/meta-capi-test-event.mts --clinic <clinicId> --code TEST12345 [--ctwa <ctwa_clid>] [--event Purchase]
```

Reads `.env.local` (production Firestore). Refuses to send without a test code. `--dry` prints the
body and endpoint and sends nothing. Without `--ctwa` it uses the clinic's newest recorded ad click.
Prints Meta's `events_received`, `fbtrace_id` and error; never prints the token.

### When Meta says nothing arrived

1. Card **Recent events**: is there a row at all? None → the trigger is not deployed, or the
   switch was off when the booking or visit happened (nothing is queued while off). A row
   `No ad click` → the patient had no click.
2. Row **Failed** with code 190 → token expired or revoked. Code 100 → wrong dataset id, or the
   dataset is not linked to this WhatsApp account. Permission errors → the system user lacks the
   dataset or `whatsapp_business_manage_events`.
3. Rows stuck **Pending** and the card says **Test mode** → a test code is still saved; real
   events wait until it is cleared. Clear it and Save.
4. Row **Sent** but nothing in Events Manager → look under the dataset's **Overview** (it can take
   a while to show), and check the dataset is the one linked to this WhatsApp account. Use
   `fbtrace_id` when asking Meta support.
