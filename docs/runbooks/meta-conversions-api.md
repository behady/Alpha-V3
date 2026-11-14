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
  remembered: their next appointments within 90 days of the click are reported too. The patient
  file shows a small **From ad** tag for them.)
- **It needs the official WhatsApp number (Meta Cloud API).** Clinics that use the QR-code line
  (the gateway / WaPilot) do see which ad a chat came from, but Meta asks for the clinic's
  *WhatsApp Business Account ID* with every report, and a QR line does not have one. Meta will most
  likely refuse those reports. Use this only on a clinic whose official number is connected in the
  **WhatsApp Business (Meta)** card.
- **One "visit" report per appointment, sent about 3 hours after the patient arrives.** Meta keeps
  only the **first** copy of each report and ignores later corrections. So the system waits 3 hours
  after check-in for the dentist to enter the day's treatments, then sends the value once.
  Treatments added after that are not sent.
- **Nothing older than 7 days.** Meta refuses events older than a week, so an appointment edited
  long after the fact is skipped, not sent.
- **It does not change your ads by itself.** The reports start flowing; you decide when to tell
  Meta to optimise for them (see **Making the ads use it** below).

---

## Step 1. Get three things from Meta

> Meta renames its menus often. The names below are what they were called when this was written;
> if a menu looks different, look for the closest match. Nothing here can break your ads.

You need to be an admin of the clinic's **Meta Business portfolio** (business.facebook.com).

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
2. Paste it into **Test event code** in the card and press **Save**. The card shows **Test mode**.
3. Press **Send test event**. You should see **Meta received the test event**.
4. Back in Events Manager → **Test events**, the event appears within a minute or so.
5. **Now CLEAR the test event code and Save.** While a test code is set, *every* report — real
   ones too — goes to Test Events only, and Meta does **not** use them to improve the ads.

The test needs at least one real ad chat on the clinic (it borrows that chat's click id). If none
has arrived yet, open the clinic's WhatsApp from one of its own ads once.

## Step 4. Switch it on

Turn **Send results to Meta** ON and press **Save**. From now on, every ad patient's booking,
confirmation and visit is reported.

The **Recent events** list in the card shows each report: **Sent**, waiting, retrying, **Failed**,
or skipped with a reason:

| Reason shown | What it means |
| --- | --- |
| No ad click | The patient did not come from an ad. Normal — most patients. |
| Too old for Meta | The moment was more than 7 days ago. |
| Feature was off | It was switched off when the report came due. |
| Settings incomplete | Switched on, but the dataset, account ID or token is missing. |
| Out of attempts | Meta could not be reached 5 times in a row. |

**Send pending now** sends whatever is waiting without waiting for the next automatic run.

To stop: switch **Send results to Meta** OFF. Nothing else is needed.

---

## What is reported to Meta

| What happened in the clinic | Event Meta sees | Value |
| --- | --- | --- |
| Appointment booked (by the desk, the bot, online, anywhere) | **LeadSubmitted** | — |
| Appointment confirmed (or booked already confirmed) | **QualifiedLead** | — |
| Patient arrived — the first of Checked In / In Chair / Checking Out / Completed | **Purchase** | the visit's treatment charges, in EGP |

- Each appointment reports each event **once**, ever. Checked In → In Chair → Completed is one
  visit, one Purchase. Confirming, un-confirming and confirming again is one QualifiedLead.
- The Purchase value is the sum of the treatments charged on that appointment (before discounts),
  entered within about 3 hours of arrival. A visit with no charge entered is reported with 0.
- Cancelled and No Show report nothing.

## How reliable it is

- **Nothing is missed when the app is closed.** A Firebase trigger watches every appointment save,
  from every screen, the bot and the online booking page, and puts the report in a queue.
- **The queue is sent every 10 minutes.** If Meta is down or busy, the report is retried after
  5 minutes, 20 minutes, 1 hour and 3 hours — five tries in about four and a half hours.
- **A wrong ID or a bad token is not retried** (it would fail the same way every time). Those show
  as **Failed** in the list with Meta's message. Fix the setting; new reports go through.
- **No duplicates.** Every report carries a fixed id (appointment + event), so even if something
  is sent twice Meta counts it once.

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
| `src/lib/bot/respond.ts` (`rememberAdClick`) | Keeps every ad click on the conversation and the patient. |
| `scripts/meta-capi-test-event.mts` | Command-line test send (below). |

### Data

| Path | Contents |
| --- | --- |
| `clinic_secrets/{clinicId}.metaCapi` | `{ enabled, datasetId, wabaId, token, testEventCode, updatedAt, updatedBy }`. Empty `wabaId` / `token` fall back to `clinic_secrets/{clinicId}.metaWhatsapp.wabaId` / `.token`. Server-only. |
| `clinic_secrets/{clinicId}/meta_conversion_events/{appointmentId}_{eventName}` | Queue and log in one. `status` pending → sent / retry → failed / skipped (`reason`), `dueAt`, `attempts`, the click used, `value`, the redacted `payload`, Meta's `response` (`httpStatus`, `eventsReceived`, `fbtraceId`, `error`). Created with `create()` by the trigger, so a re-delivered trigger is a no-op. Under `clinic_secrets` because every path there is denied to clients, while any `clinics/{id}/*` subcollection is open to every clinic member. |
| `clinics/{clinicId}/patients/{patientId}.adAttribution` | Newest click on top + `clicks[]` (newest first, max 10). Built only by `attributionFromClicks`; never overwritten with null. |
| `clinics/{clinicId}/whatsapp_conversations/{key}.adClicks` | Every click on the chat (`mergeClicks`, max 10). The first-ad-wins `ad` / `adAt` fields beside it are unchanged; the ad reports read those. |

### Behaviour worth knowing

- Off unless `clinic_secrets/{clinicId}.metaCapi.enabled === true`. The trigger reads nothing on a
  write whose status did not move; on a booking/confirm/visit it reads the switch and stops if off.
- The click is chosen when the event is **sent**, not when it is queued: the bot writes the
  appointment a moment before the referral is stored. `pickClick` takes the newest click at or
  before the event, at most 90 days old. No click → `skipped / no_click`.
- Purchase is due `eventTime + 3 h` (`PURCHASE_SETTLE_MS`); value = sum of `chargeAmount(row)` over
  `ledger` rows with this `appointmentId`, `type === "procedure"`, not deleted/cancelled.
- Retry on 5xx, 429, network/timeout, Meta's `is_transient`, and throttle codes 4/17/32/613/80004.
  Any other 4xx fails at once. `MAX_ATTEMPTS = 5`, delays 5 m / 20 m / 1 h / 3 h.
- A set `testEventCode` rides on **every** event (`test_event_code` in the body) until cleared.
- The token goes only in the `Authorization: Bearer` header — never in the URL, the log, an API
  response or a console line. Logged payloads go through `redactPayload`.
- Graph version: env `META_CAPI_GRAPH_VERSION`, default `v23.0` (same as the lead-form webhook).
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
   patient had no click (`No ad click`).
2. Row **Failed** with code 190 → token expired or revoked. Code 100 → wrong dataset id, or the
   dataset is not linked to this WhatsApp account. Permission errors → the system user lacks the
   dataset or `whatsapp_business_manage_events`.
3. Row **Sent** but nothing in Events Manager → check the test code: while set, events show only
   under **Test events**. Use `fbtrace_id` when asking Meta support.
