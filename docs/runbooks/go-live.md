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

> **2026-08-23: this step is complete and its UI is gone.** The owner ran the preview, revoked the
> ghost accounts, applied the backfill, and published the rules. The amber panel and the
> "Temporary Database Repair Bot" card were then removed from Settings — one-time migration tools
> earn their exit, and a button that rewrites every account's permissions should not sit in a
> settings page forever. The server routes remain (`/api/admin/backfill-permissions`,
> `/api/admin/repair` — both Admin-scoped to the caller's own clinic) and so does the terminal
> script, for any OTHER pre-existing clinic that migrates later; a clinic created after this date
> never needs them, because every route that seeds staff writes `clinicPermissions` from day one.

**From the app (no terminal needed — UI since removed, see above):** Settings → Users → the amber panel at the top →
**Preview changes**. It lists every member of staff and exactly what they will be given. Read it,
then press **Apply**. Nothing is written until you press Apply.

**Ghost accounts come first.** The preview also lists, in red, every account that holds a role at
the clinic but matches no staff record — staff deleted by older code that never took the role key
back, test signups, duplicate documents. The first run against real data found four members of
staff and twenty-four of these. They are invisible on every screen, yet each can sign in and read
the whole clinic today, because read access follows the role alone. **Revoke access for all**
takes this clinic's key back from them (role and permission map for this clinic only — their other
clinics are untouched), re-verifying each against live data server-side, and never the caller's
own account. Apply never backfills a ghost, so the order between revoke and apply cannot arm one —
but revoke them anyway: the reads are already too much. If someone real appears in the red list,
their staff record is missing — run the team repair, then preview again.

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

> **2026-08-24: verified in production.** Rules published after the backfill; an Assistant without
> `appointments.delete` attempted an appointment delete and was refused with the permission named
> in the error toast. First enforced permission denial in this system's history — the checkboxes
> have been live decoration since they were built.

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

---

# Third rollout — the expiry gate the money migration removed

Nothing to publish and nothing to run. Deploy the app and it is in force.

## What was wrong

`firestore.rules` has checked whether a clinic is still entitled to write since before any of this
work: `isClinicActive()` reads `status` and `expiresAt`, and `memberMayWrite` consults it on every
member write. That check was correct and is still there.

It governs writes the **browser** makes directly. The Admin SDK bypasses Firestore rules entirely —
that is what it is for. So when payments, procedures and appointment deletes moved server-side to
make the permission checkboxes real, they moved out from behind the expiry gate in the same commit.
Nobody deleted the lock. The traffic started using a door that had never had one.

The count at the time of the fix: 59 API routes, 37 writing through the Admin SDK, **4** that asked
whether the clinic was active. `finance/ledger` was not one of the four. An expired clinic could go
on taking payments indefinitely, and the only reason it had not happened yet is that no clinic had
reached its expiry date.

Two of those four were local copies that tested `status` alone. Both would have let a clinic whose
`expiresAt` had passed delete freely — which is the exact gap that made the rules stop trusting
`status` on its own. Both have been removed in favour of the shared decision.

## How it works now

`src/lib/clinicStatus.ts` holds the decision once. `requireStaffUser` applies it, so all 37 routes
inherit it rather than each remembering. `ClinicContext` and the read-only banner read the same
module, so the banner and the server cannot disagree.

**It is opt-out, not opt-in.** A route is gated by existing; a read waives it with
`allowInactive: true`. That direction is the whole point — an opt-in gate is one the next route
will not have, which is precisely how this bug happened. The eleven current exemptions are pinned
in `tests/permissions.test.mts`, so adding a twelfth requires editing that list and saying why.

**Reads keep working.** Deliberately, and matching the rules, where `isClinicActive` is consulted
from `memberMayWrite` and from no read grant. A clinic that stops paying keeps full read access to
its own records. The alternative is holding a dentist's patient history hostage over an invoice,
which is both wrong and, for medical records, probably not ours to do.

**Superadmins are exempt**, because reactivating a lapsed clinic is done from the superadmin panel
and a gate that locked them out would lock the clinic out permanently.

**A clinic document that cannot be read counts as active.** By then the caller's role at that
clinic is already established, so a missing document means the read failed — and denying every
write in response would turn a degraded read into a total outage for a paying clinic, silently, at
the worst possible moment.

**A non-timestamp `expiresAt` does not expire the clinic.** This mirrors the rules'
`!(expires is timestamp) || expires > request.time` guard. The server could parse an ISO string and
deliberately does not: being stricter than the rules means the same write is allowed from the
browser and refused by the route, which is the split-brain the shared module exists to prevent.

## Checking it

Set a clinic's `expiresAt` to a past date in the Firebase console (or its `status` to `Suspended`),
then in that clinic:

- Every screen still loads, and every record still reads. The red banner names which of the two it
  is rather than saying "suspended or expired".
- Taking a payment fails with *"This clinic's subscription has ended. Records stay readable, but
  new entries are paused until it is renewed."* — not a raw permission error.
- Recently Deleted still lists what is in the bin; Restore refuses. Seeing what you lost must not
  depend on the subscription. Putting it back is a write.

Put the field back afterwards.
