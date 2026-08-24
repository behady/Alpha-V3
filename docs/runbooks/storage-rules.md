# Cloud Storage rules, and the paths that made them impossible

## What was wrong

Firestore keeps a patient at `clinics/{clinicId}/patients/{patientId}`. Their **files** went here:

| Path | Clinic in it? |
|---|---|
| `patients/{patientId}/avatar_*` | no |
| `patients/{patientId}/media/*` | no |
| `clinical_notes/tooth_{n}_{ts}.jpg` | no — and no patient either |
| `clinicProfile/logo_{ts}_{name}` | no |
| `staff_profiles/{uid}_{ts}` | n/a — the uid is global, which is fine |
| `clinics/{clinicId}/booking_hero_*` | yes |

The records were tenant-scoped. The files were not. The last two rows above are worse than
unscoped — they are flat folders that **every clinic in the system shares**, holding intraoral
photographs and clinic logos with nothing in the path to say whose they are.

This is not a rule that was written too loosely. It is a rule that **cannot be written**. Given
`clinical_notes/tooth_11_1724500000000.jpg`, a Storage rule has a filename and no way to learn
which clinic it belongs to — the path does not say, and there is nothing to look it up by. So any
rule covering that prefix is either *deny everyone* or *allow every signed-in user*. If it was the
second, a free-trial signup could enumerate the folder and download every clinic's clinical
photography.

**There was also no `storage.rules` in the repository at all**, and no `storage` entry in
`firebase.json`. Whatever governed the bucket lived only in the Firebase console: unversioned, not
reviewed, not diffable — the same state `firestore.rules` was in when it was found to have drifted
ahead of the repo with no record of what had changed or why.

## What changed

- `src/lib/storagePaths.ts` builds every upload path, and every one that belongs to a clinic starts
  `clinics/{clinicId}/`. A blank clinic id throws rather than falling through to a shared folder.
- All seven upload sites call it. None builds a path inline any more, and
  `tests/storagePaths.test.mjs` fails if an eighth one tries.
- `storage.rules` exists, is versioned, and is wired into `firebase.json`.

## Why the rules can be as strict as they are

**The app never reads Storage by path.** It uploads, calls `getDownloadURL()`, and stores that URL
in Firestore; every `<img>` renders from the stored URL. A download URL carries its own token and
does not consult rules at all. There is no `listAll()` anywhere in the codebase.

So denying path-based access to the legacy prefixes costs nothing: images already uploaded keep
displaying from the URLs already stored, while the ability to browse or enumerate those folders
goes away. `getDownloadURL()` *does* consult the rules, which is why members can read inside their
own clinic — that call happens moments after an upload.

## Publishing — the order matters

**Deploy the app first, then publish the rules.** The new rules deny the legacy prefixes by name.
Publish them while the currently-live build is still uploading to `patients/…`, and every upload in
every clinic fails until the deploy lands.

1. **Deploy.** Vercel builds from `main`. Confirm the Production deployment's commit matches
   `origin/main`.
2. **Upload one file** in the live app — a patient photo is easiest. It must succeed. It is now
   going to `clinics/{clinicId}/patients/{patientId}/media/…`, and it works under the old console
   rules because those already permit writes under `clinics/` (that is where `booking_hero` has
   always gone).
3. **Publish the rules.** Firebase console → Storage → Rules → paste `storage.rules` → Publish.
4. **Upload a second file**, and open an *older* patient photo uploaded before today. The first
   proves the new rules did not break the new path; the second proves legacy images still display,
   because their stored URLs bypass rules.

### Rollback

Firebase console → Storage → Rules → **History** → restore the previous ruleset. Seconds, no
deploy. Roll the rules back before the app, as with Firestore.

## What this does not do

**Existing files stay where they are.** Nothing was moved. They are unreachable by path and
reachable by their stored URL, which is the correct end state for data that cannot be attributed
to a clinic — but it does mean per-clinic erasure is still impossible *for files uploaded before
this change*. Deleting a clinic cannot find them.

Moving them would require reading every `imageUrl` and `storagePath` in every clinic, copying each
object to its new home, and rewriting the Firestore field — safe to do, but a migration with real
failure modes, and not one to run in the same week as a launch. It is worth doing before the
bucket holds more than one clinic's history.

**Whether the old console rules were actually permissive is unknown.** They were never in the repo,
so there is no record of what they said. The exposure described above is what the paths *allowed* a
rule to be, not a confirmed breach. Storage access logs would settle it; the fix is the same either
way.
