# Go-live runbook — money writes behind the API

This change moved every write that touches money (payments, procedures, discounts,
commissions, appointment deletes) out of the browser and behind three server routes.
The Firestore rules that shut the old client-side door are in `firestore.rules` and are
published separately, by hand, in the Firebase console.

**The order matters.** Deploy the app first, then publish the rules. Doing it the other
way round locks the browser out of collections the currently-live build still writes to
directly, and the clinic gets permission errors until the deploy lands.

---

## 1. Deploy the app

Vercel builds from `main`. Confirm the Production deployment's commit matches
`origin/main` before going further — a Preview build of the same commit is **not** the
same thing.

> Why a Preview build must not simply be promoted: `NEXT_PUBLIC_FIREBASE_*` values are
> inlined into the client bundle by Next.js at **build** time, not read at run time
> (`src/lib/firebasePublicConfig.ts`). A build produced under the Preview environment
> carries Preview's Firebase config wherever it is later served from. If Preview and
> Production hold identical values, promoting is harmless; if they differ, the live app
> would talk to the wrong Firebase project. Forcing a fresh Production build costs a few
> minutes and removes the question entirely.

## 2. Prove the server routes are actually serving

Before touching the rules, take **one real payment** on the live app.

It must succeed. If it does, the three routes are live and reachable:

- `POST /api/finance/ledger`
- `POST /api/clinical/procedures`
- `POST /api/appointments/delete`

If it fails, stop. The rules are not the problem yet — do not publish them.

## 3. Publish the Firestore rules

Firebase console → Firestore Database → Rules → paste `firestore.rules` → Publish.

The four collections that change behaviour: `ledger`, `ledger_audit`, `clinical_notes`
(client may now only reorder, via `sortIndex`), and `services` (Admin-write).

Each is excluded **by name** from the blanket `match /{subcollection}/{document=**}`
member-write grant. That exclusion is load-bearing: Firestore rules OR together, so a
collection that falls out of the exclusion chain becomes writable by every clinic member
again, no matter what its own stricter `match` block says.
`tests/permissions.test.mts` fails if any of them drops out.

## 4. Prove it again

Take a **second** payment after publishing. This one proves the rules did not break the
path the first one proved was working.

Then check, in the same session:

- a procedure added to a patient
- a discount applied and saved
- an appointment deleted (the keep-or-delete-services dialog should appear)

## Rollback

Firebase console → Firestore Database → Rules → **History** → select the previous
ruleset → restore. This takes effect in seconds and needs no deploy.

Rolling the *app* back is the Vercel side: promote the previous Production deployment.
Roll the rules back first, then the app — the reverse order locks the older build out.

---

## Afterwards, when convenient

Two scripts remain, both owner-run, neither urgent. Both default to reporting only.

```bash
# 1. Historical payments that were written with no dentist attached.
#    Dry run — writes nothing, prints what it would change:
node scripts/repair-payment-attribution.mjs --clinic <clinicId>

#    Only after reading that report:
node scripts/repair-payment-attribution.mjs --clinic <clinicId> --apply
```

Rows whose commission was corrected by hand in the past are classified `MANUAL_OR_OK`
and are never rewritten — that is the whole reason the classifier exists, and
`tests/repairClassifier.test.mjs` is what holds it to that. Rows it cannot decide come
back as `REVIEW` and are only applied if you name them explicitly with
`--apply-reviewed`.

```bash
# 2. Removes the vestigial patient fields nothing reads any more.
node scripts/strip-vestigial-patient-fields.mjs
```

---

# Second rollout — making the permission checkboxes real

**The order here is not a preference. Publishing the rules before the backfill denies every write
by every non-Admin in every clinic, immediately.**

## What was wrong

`firestore.rules` reads `users/{uid}.clinicPermissions[clinicId]`. The app writes a flat
`users/{uid}.permissions` array. **Nothing, anywhere, wrote `clinicPermissions`.**

A missing map read as null, and `holdsPermission` treated null as "this account predates the
permission system, let it through". Since the field was never written, that branch was the only one
anyone ever took: every permission check in the rules returned true, for every account, always.
Unticking a box on the Users screen hid a button in the browser and changed nothing else — a
receptionist with "Delete patients" switched off could still delete every patient in the clinic
through the console or a copied fetch call.

It also meant permissions could not be per-clinic: one flat array applied at every clinic a person
worked at.

## The three steps, in this order

### 1. Deploy the app

The routes that seed and edit permissions now write `clinicPermissions` through
`src/lib/server/clinicPermissions.ts`: `admin/update-user`, `staff/create`,
`join-requests/approve`, `admin/repair`. Nothing breaks by deploying this first — the field is
simply written from now on, and the rules still ignore it until step 3.

### 2. Backfill the accounts that already exist

**From the app (no terminal needed):** Settings → Users → the amber panel at the top →
**Preview changes**. It lists every member of staff and exactly what they will be given. Read it,
then press **Apply**. Nothing is written until you press Apply.

The route behind it is `POST /api/admin/backfill-permissions`, scoped to the clinic you administer:
it only ever writes the single `clinicPermissions.<thisClinic>` key, through a dotted path that
merges rather than replacing, so an Admin of one clinic can neither read nor rewrite what someone
may do at another.

**From a terminal, across every clinic at once** — needs `.env.local` with a service-account key:

```bash
node scripts/backfill-clinic-permissions.mjs --clinic <id>     # dry run, writes nothing
# read clinic-permissions-backfill-<clinic>-<date>.csv, then:
node scripts/backfill-clinic-permissions.mjs --clinic <id> --apply
```

Either way, read the list before applying — this decides what each member of staff can do.

**Why it does not simply copy the existing array.** The browser's guards also let people through on
their *role* (`PermissionGuard`'s `allowedRoles`, and a dozen ad-hoc `user?.role === "Dentist"`
checks), so a dentist whose stored array is the one permission the invite seeds can still edit a
treatment chart today. Store only that array and enforce it, and that dentist is locked out of their
own job. So each person gets **their role's baseline UNION whatever was explicitly granted** —
nobody loses anything they demonstrably had. The baselines are in `src/lib/permissions.ts`, which is
where to argue with them.

Admins get an empty list on purpose: `isClinicAdmin` short-circuits ahead of the lookup in both the
rules and `apiStaffAuth`, so nothing ever consults a list for them.

### 3. Publish the rules

Only now. `holdsPermission` no longer has its allow-everything branch, so an account with no map is
an account granted nothing.

### 4. Check it

- Sign in as a non-Admin and confirm normal work still works: book an appointment, add a patient,
  write a treatment note.
- Untick a box for someone in Settings → Users, then have them try that action. It should now fail
  in Firestore, not just be hidden.

## Rollback

Firebase console → Firestore Database → Rules → **History** → restore the previous ruleset. That
reopens the fallback and everyone can write again while you work out what went wrong. The backfilled
`clinicPermissions` field is harmless to leave in place — nothing reads it once the old rules are
back.

## What stops this recurring

`tests/permissions.test.mts` now fails if `firestore.rules` reads a field off the user document that
no server route or server lib writes. That check, run against the code as it was, reports:

```
firestore.rules reads these user-document fields, but no server route or server lib ever writes
them — so the rules that consult them decide nothing: clinicPermissions
```

It also asserts the collection→permission maps in `firestore.rules` match
`COLLECTION_WRITE_PERMISSIONS` in `src/lib/permissions.ts`, since that decision is written down
twice and only one copy is enforced.
