# Recently Deleted — the everyday undo

Backups and point-in-time recovery live in the Google Cloud console. A clinic admin has no access
to them and should not need any: those protect against a disaster, and the everyday emergency is
not a disaster. It is *"I just deleted the wrong patient."*

Before this, that was a phone call and an hour in a console. The assistant photographed a record
before deleting it; a person clicking Delete did not — the AI was recoverable and the human was
not. A deleted patient left one line in the activity log saying a patient of that name once
existed, carrying none of her data.

Now: **Settings → Recently Deleted**, press **Restore**, thirty seconds.

```
Everyday mistake  →  Recently Deleted  →  the clinic fixes it themselves
Real disaster     →  Backups / PITR    →  the operator, in the console
```

## Where the bin lives, and why it looks wrong

`deleted_records` is a **root** collection, not `clinics/{clinicId}/deleted_records`.

That looks like a tenancy mistake until you read the blanket grant in `firestore.rules`: every
clinic subcollection is readable by every clinic member, and rules OR together, so a narrower block
underneath cannot take that back. A bin under the clinic would have been readable by the whole
clinic **by construction** — and its entries are complete patient records: allergies, medical
history, the odontogram, image URLs. The narrower rule would have looked like protection and
provided none. This was caught in review before it shipped.

At the root with `allow read, write: if false`, no client touches it. `/api/records/bin` serves the
list, filtered to the collections the caller may delete.

A second reason: a member-writable bin entry would be an arbitrary-write capability into any
collection, because restore executes whatever the entry names using the Admin SDK.

## What is in the bin, and what is deliberately not

**In:** `patients`, `patient_media`, `prescriptions`, `treatment_plans`, `diagnosis_chats`,
`inventory`, `drugs`, `marketing_content`, `attendance`, and — Admin-only — `services`, `leads`.

**Never:**

| | Why |
|---|---|
| `ledger`, `clinical_notes`, `appointments` | Already have guarded routes that refuse a charge with payments against it, rebalance the lab fee, and keep the note↔charge cascade atomic. A generic route would be a fourth door with none of that. Money already has its own before/after trail in `ledger_audit`. |
| `system_logs`, `ledger_audit`, `ai_deletion_log`, `ai_usage`, `sms_outbox`, `whatsapp_outbox`, … | Audit trails, the credit meter, and outbound message queues. The rules close these on purpose; putting them behind a route that bypasses rules would convert "un-erasable" into "erasable". |
| `clinics` (the tenant record) | See below. |

The allow-list is written out by hand in `src/lib/recycleBin.ts` and **not** derived from
`COLLECTION_WRITE_PERMISSIONS`. That map mirrors only one of the three layers the rules use, and
`holdsPermission` treats an unlisted collection as *open to any member* — safe inside the rules
only because the exclusion chain already refused it. A server route inherits the map without that
gate. Absent from the table means DENY.

## What restore will and will not do

- **It never overwrites.** If something already occupies the original location, restore refuses and
  asks a person to compare. The document id is the only foreign key this app has: restoring under a
  fresh id would orphan every pointer at it, and overwriting would destroy whatever was charted in
  the gap — `patients.teethData` is written wholesale with no per-tooth history, so an overwrite
  leaves nothing to reconcile against.
- **Single use.** Two operators, or a double click, cannot restore twice.
- **It checks the record still has a home.** Restoring a prescription whose patient is gone would
  create live medical data no screen can reach — every read of it is `where patientId ==`, issued
  from a patient page that will not load. Refused, with the reason.
- **Restoring needs more than deleting did.** A restore is a *create* performed with the Admin SDK,
  so the create permission the rules would have demanded is required explicitly. Undoing a deletion
  is not a lesser act than making one.
- **A few fields are reset on the way back**, because they enrol the record in something ongoing: a
  diagnosis chat returns on the standard model tier rather than the expensive one; an accepted
  treatment plan returns as a draft so it does not text the patient about stale prices; scheduled
  marketing returns unscheduled.
- **Everything else is verbatim.** Re-stamping `createdAt` on a radiograph would file a years-old
  image under "today" — a falsified record, not a cosmetic bug. Restored documents carry a
  `restoredAt` marker so a write-back is distinguishable from a record nobody ever questioned.

## Image files are never deleted, in either direction

Deleting a `patient_media` record removes the pointer; the file stays in Cloud Storage. That was
already true — nothing in this codebase has ever deleted a stored object from the client — but the
confirm dialog used to claim "permanently delete this media file", which was never accurate. The
copy now says what happens.

The bin records the object **path**, never the download URL: a URL carries a token that can be
rotated, and a snapshot is static JSON nothing will rewrite, so a verbatim URL written back weeks
later can point at nothing while the restore reports success.

Blobs are not deleted on purge either — one stored object can be referenced by several records
(duplicating a media item copies the link without re-uploading), so deleting bytes on the strength
of one record could blank an image still in use. Purging copies the paths to `storage_orphans`
first, because the bin entry was the last document anywhere that named them.

## Retention: nothing expires on its own

The screen shows an expiry date. **It is advisory — no timer deletes anything.**

A TTL policy was considered and rejected: it would be an untriggered permanent delete of what is,
by then, the only copy of a patient record; 30 days is the wrong number for a system whose
retention obligations run to years; the policy cannot be declared from this repo, so CI could never
assert it exists; and the house pattern for expiry fields is a plain number, which a TTL policy
silently ignores — producing a bin everyone believes expires and which never does.

Permanent removal is **Delete permanently**, Admin-only, deliberate. That is the answer to an
erasure request, and it does not wait for a timer.

## Deployment order — this part matters

Ship in this order. The rules change must not land before the routes exist, or every delete button
in the app breaks.

1. **The routes** (`/api/records/*`) — deploy first, nothing uses them yet.
2. **The rules** — `allow delete: if false` on the binned collections, plus their names in the
   `memberMayWrite` exclusion chain. Without the exclusion the blanket grant re-opens them and the
   bin becomes advisory: the record is gone, Recently Deleted is empty, and the feature looks
   broken rather than bypassed.
3. **The client** — the rewired delete buttons and the Recently Deleted screen.

Steps 1 and 3 ride the same Vercel deploy; step 2 is published by hand in the Firebase console, and
should be published **after** that deploy is live.

## The clinic delete is not in the bin

`superadmin/page.tsx` deletes the clinic's own document. Everything under it — every patient,
ledger row, note and image — survives in the subtree, so "permanently delete" was wrong in both
halves: nothing is fully deleted, and recreating the record reattaches the lot. The bin cannot help:
`clinics` is a root collection, so a snapshot filed under the clinic would be unreachable, and one
filed at the root would restore a document that instantly re-grants access to everyone still
holding a role for it.

The copy now says what it actually does. The real fix is a soft delete (set `status` away from
Active — `isClinicActive` and the read-only banner already key off it) plus an explicit purge that
walks the subtree. **That is not built.**

## Known follow-ups, written down rather than forgotten

- `handleDuplicateMedia` copies a URL instead of copying the object, so two records can share one
  blob. No blob sweeper may be built until that changes.
- The `<img>` tags have no `onError` fallback, so a missing object renders blank under a correct
  filename and date. A clinical image must never fail silently.
- `TeethChart` uploads to a global `clinical_notes/` prefix rather than a per-clinic path, which
  makes per-clinic erasure impossible.
- `functions/index.js` falls back to matching a patient **by name** when an id no longer resolves,
  so automation could message a different patient with the same name. The bin makes patient
  deletion routine, which makes this worth fixing soon.
