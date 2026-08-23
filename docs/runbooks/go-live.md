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
