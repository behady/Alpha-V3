# Backups — switching on Firestore disaster recovery

The security rules protect against bad **access**. Nothing yet protects against a bad **write** —
a buggy deploy, a script applied twice, an accidental bulk delete. That protection is two switches
in the Google Cloud console, and both are storage-priced: for a database this size, pennies per
month. (The project must be on the Blaze pay-as-you-go plan, which it already is if Cloud
Functions run.)

Two things to get right before clicking anything:

**Which project.** It is `alpha-v2-ffc98` — despite the name. The v2 label is a leftover: this
project was kept and v3 built inside it, with old per-clinic v2 projects migrated in as tenants
(see `src/components/superadmin/MigrateTab.tsx`). `scripts/connect-meta-page.mjs` points its live
Meta webhook at `alpha-v2-ffc98.cloudfunctions.net`, which is the giveaway. Confirm against
`NEXT_PUBLIC_FIREBASE_PROJECT_ID` in Vercel — that variable is what the live app actually talks
to, and is the only authoritative answer.

**Which database.** This project's database is literally named `default` — not the usual
`(default)`. Pick the one named exactly `default` wherever a database has to be chosen.

## The two switches (about 5 minutes)

Open **console.cloud.google.com** → make sure the Firebase project is selected at the top →
search for **Firestore** → open the **Disaster recovery** tab.

### 1. Point-in-time recovery (the 7-day time machine)

Press **Edit** and enable **Point-in-time recovery**.

From then on, Firestore keeps every version of every document for the last 7 days, minute by
minute. If a bug mangles ledger rows on Tuesday, the data as it stood Monday 23:59 is readable
and can be copied back — surgically, just the damaged rows, without touching the rest.

### 2. Scheduled backups (the daily photograph)

Still on the Disaster recovery tab: **create a backup schedule** —

- **Daily**, retention **30 days**.

This is the protection PITR cannot give. The two are different mechanisms and only one of them
can be lengthened:

| | Window | Adjustable? |
|---|---|---|
| Point-in-time recovery | 7 days, minute-by-minute | **No — 7 days is the hard ceiling** |
| Scheduled backups | one snapshot per run | **Yes — up to 14 weeks retention** |

So "keep it for a month" is a backup-retention setting, not a PITR setting. 30 days of daily
backups means 30 restorable snapshots at any moment; PITR stays at 7 days no matter what, and is
the finer instrument within its window.

A backup restores into a **new database** in the same project, which is deliberately
non-destructive — the broken database stays as evidence while the restored copy is checked.

### What it costs

Backup storage is billed at **$0.00004 per GiB-hour ≈ $0.029 per GiB-month**, and each daily
backup is charged as a full copy of the database at the moment it was taken. So:

    monthly cost ≈ database size (GiB) × number of retained backups × $0.029

At 30 daily backups retained:

| Database size | Stored | Cost per month |
|---|---|---|
| 250 MB | 7.5 GiB | ~$0.22 |
| 500 MB | 15 GiB | ~$0.44 |
| 1 GB | 30 GiB | ~$0.88 |
| 2 GB | 60 GiB | ~$1.75 |

PITR adds roughly $0.03–0.13 per GiB-month on top — pennies at this scale.

Find the real number under **Firebase console → Firestore → Usage**. Note that patient photos
and X-rays live in Cloud Storage, not Firestore, so they are NOT part of this figure — a clinic's
Firestore database is text and numbers, and is usually a few hundred megabytes even after years.

**Restores cost $0.20 per GiB, once, only if you ever actually restore.**

If the monthly figure ever looks uncomfortable, the cheaper shape is **daily retained 7 days plus
weekly retained 14 weeks** — 21 snapshots instead of 30, covering three and a half months instead
of one, at about two-thirds the cost. Daily-for-30 is the simpler thing to reason about, which is
why it is the recommendation.

## "Would restoring drag every clinic back in time?"

No. This is the question worth being sure about before selling to a second clinic, and the answer
rests on one fact: **a restore never overwrites the live database.** Both recovery paths produce a
*separate copy* alongside it.

    live database  ──────────────────────────────────────►  keeps running, all clinics, untouched
                          │
                          └── restore / clone ──►  a NEW database, frozen at the chosen moment

Nobody is logged out. No other clinic notices anything. The restored copy is just a second
database sitting in the project that you can read from.

Recovery then means **copying back only the damaged clinic's documents** from that copy into the
live database. Everything in this system lives under `clinics/{clinicId}/…` — that layout, chosen
for tenancy isolation, is exactly what makes per-clinic recovery possible: one clinic's subtree
can be lifted out and written back without touching a single document belonging to anyone else.

The same is true of the PITR path, without even making a copy: a *stale read* asks the live
database "what did these documents look like at 14:32 yesterday?", and the answer is written back
to just those documents. Reads at a past timestamp are non-destructive by construction — the rest
of the database, and every other clinic, carries on at the present moment throughout.

So the honest shape of a bad day:

| | Blast radius |
|---|---|
| Taking the backup / clone | none — nothing in the live database changes |
| Reading the damaged clinic's old data | none — reads only |
| Writing the repaired documents back | exactly the documents named, in one clinic |

**The copy-back tool is `scripts/restore-clinic.mjs`.** See "The copy-back tool" below.

One correction to the sentence above, because the whole per-clinic story leans on it: *everything*
does not live under `clinics/{clinicId}/`. Clinic **records** do. Five root collections hold
clinic-linked data and sit outside the subtree deliberately, so the blanket clinic-member grant
cannot reach them — `clinic_secrets` (the WhatsApp gateway token), `meta_pages` and
`meta_integrations` (the Facebook page mapping and its access token), `meta_lead_events` (the lead
replay queue), and `join_requests`. A restored clinic therefore comes back with its records and
**without its integrations**. That is the right call — every one of those holds a credential, and
re-writing a credential from an old snapshot can resurrect one that has since been rotated — but
it is not what anyone would assume, so the script prints it on every run.

## If disaster ever comes

Do not attempt a restore alone under stress — open a Claude session on this repo and say what
happened and when. The honest division of labour: **the switches above are yours to flip today;
the restore, if ever needed, is guided work.** What makes that guided work possible — the
versions, the backups — only exists if the switches were on before the disaster.

For the record, the shape of each path:

- **PITR repair** (damage less than 7 days old, scoped): read the affected documents at a
  timestamp before the damage and write them back. Finest instrument, shortest reach.
- **Backup restore** (older than 7 days, or total loss): Disaster recovery tab → Backups →
  Restore → into a NEW database → verify the copy looks right → copy the affected clinic's
  subtree back into `default`. The new database can be deleted once the repair is confirmed;
  keep it until then.

## Status

**2026-08-24: both switches are on** for `alpha-v2-ffc98`, database `default`.

- Point-in-time recovery: enabled, 7-day retention, earliest version time 2026-08-24 14:14 UTC+3.
- Scheduled backups: daily, 30-day retention.

Two things that look wrong at first and are not:

- **The Backups list reads "No rows to display" on day one.** The first snapshot is taken on the
  schedule's next run, within 24 hours — the schedule existing is not the same as a backup
  existing. The real confirmation is a row appearing the following day, and that check is the
  point of the habit below.
- **The PITR window starts short and grows.** "Earliest version time" is the moment PITR was
  switched on, so for the first week the reachable past is shorter than 7 days: on day 3 you can
  rewind 3 days, not 7. From day 8 it is a rolling 7-day window. Nothing before 2026-08-24 14:14
  is recoverable by PITR, ever.

## The habit

Once a quarter, open the Disaster recovery tab and confirm backups are listed with recent dates.
A backup nobody has ever seen exist is a hope, not a backup.

---

## The copy-back tool

```bash
# 1. See what would happen. Writes nothing.
node scripts/restore-clinic.mjs --clinic <clinicId> --from <snapshot-db>

# 2. Do it.
node scripts/restore-clinic.mjs --clinic <clinicId> --from <snapshot-db> \
  --apply --confirm <clinicId> --state restore-<clinicId>.json
```

`--from` is the name you gave the database when you restored the backup into it. `--to` defaults
to `default`, which is this project's live database.

### It puts things back. It does not put things right.

The default is **additive**: a document missing from the live database is written; a document
already there is left alone, *even when it differs from the snapshot*.

That asymmetry is the most important thing about this tool. A restore happens after damage nobody
has fully mapped — that is why you are restoring rather than repairing. There is no snapshot of
the present, so a document the clinic legitimately changed since the backup exists in exactly one
place. Overwriting it would destroy that change silently, and you would find out months later.
Leaving it has a worst case of "a damaged document survived", which is listed in a CSV at the end
and can be dealt with by hand.

If the disaster mangled data rather than deleting it, overwriting is a two-step. The dry run writes
`restore-<clinic>-differs-<stamp>.csv`, one row per document that exists in both and differs, with
the collection, the document id, when each side last changed, and which top-level fields differ —
field *names*, never values, because that file lands in your working directory. Delete the rows you
do not want replaced and feed it back with `--overwrite-list <file>`. The script prints the exact
command.

An approval is a decision about a specific version: if a document changed again between the dry run
and the overwrite, it is left alone and listed as *moved on*.

`--overwrite-all` exists for a collection that is wholly corrupt. It asks a second time, in words,
and requires typing `OVERWRITE`.

### It never resurrects a deliberate deletion

"Missing from the live database" is what this tool treats as "destroyed by the incident". It
equally means somebody deleted it and meant to.

The sharp case: a patient asks to be erased on Monday, the record is purged, the images go.
The incident is Wednesday; the snapshot is from Sunday. A naive restore finds that patient's
record, notes, ledger rows, prescriptions, plans and media all "missing" and puts every one back —
while `deleted_records_history`, which nothing ever deletes, goes on recording that they were
purged. The clinic would end up holding identifiable records it had certified as erased, with no
bin entry and no signal, and the run would exit 0.

So before writing anything, the script reads `deleted_records_history` for this clinic and skips
everything named there. It reports the count.

### The clinic document is its own decision

`clinics/{clinicId}` is never overwritten, at any flag. If it is *missing*, restoring it needs
`--create-clinic-doc` and typing `CREATE`, because it is not really a data restore:

- Re-creating it **reattaches the whole clinic**. Deleting that one document is how a clinic is
  detached while its records stay intact, so putting it back re-grants access to everyone still
  holding a role for it.
- It carries `ownerId`, and the self-heal endpoint grants Admin to whoever matches that field.
  Rewinding it after an ownership change hands the previous owner a route back to Admin.
- It carries `status`, `expiresAt` and the billing fields. A clinic suspended **for abuse** would
  come back Active.

The script prints those fields before asking.

### What it refuses, always

**`users`.** That document *is* the access-control system — `clinicRoles` and `clinicPermissions`
are read by every rule in `firestore.rules`. Revocation is implemented as deleting two keys, so
restoring a pre-2026-08-23 snapshot would hand all twenty-four revoked ghost accounts their keys
back, and nothing on any screen would show it. Worse, those maps are keyed by *every* clinic a
person works at, so writing one user document back while repairing clinic A would clobber their
access at clinic B.

**The root collections**, listed above. Credentials are not restored from old snapshots.

**The recycle bin.** Things deliberately deleted stay deleted.

### What it holds back unless you name it

Some collections *do* something when restored rather than merely recording something. `sms_outbox`
is the sharp one: the queue worker claims anything still `queued`, and `isDue()` has no upper
bound on age, so a restored week-old queue re-sends every reminder that was in flight that day — at
cost, to patients whose appointments have already happened.

`staff` is held for a different reason, and it is the least obvious thing here. Restoring a deleted
staff row re-links the ghost account it belonged to: the revoker matches a user document to a staff
record by staffId, uid **or lowercased email**, and refuses to revoke anyone who matches one. So
restoring `staff` does not merely fail to help — it disarms the tool built to remove those
accounts, for exactly the accounts it was built for. And because this tool only puts back what is
missing, the rows it would restore are precisely the ones somebody deleted: the people who were
offboarded.

The dry run lists these with the reason and the flag to release each one:
`--include sms_outbox`. One at a time, named out loud. Releasing one and overwriting it is refused
outright — overwriting a queue does not put an old message back, it un-sends a recent one and the
worker sends it again.

Two individual documents are refused even though `settings` restores: `settings/wapilot`, the
legacy WhatsApp credential that was deliberately moved out to `clinic_secrets` because `settings`
is readable by every clinic member; and `settings/counters`, the transactional generator behind
patient file numbers — rewind it and the next patients registered are stamped with numbers already
printed on existing records.

### If it stops halfway

Pass `--state <file>` and it saves progress after every page. Re-run the identical command and it
picks up where it stopped. Running it twice is safe by construction: the second pass finds
everything it wrote already present and identical, and does nothing.

The state file is tied to the clinic and both database names. It refuses to resume a file written
for a different restore.

### What it does not cover

Printed on every run, and worth repeating here: **Cloud Storage is not in a Firestore backup.**
Patient photographs and X-rays are files. A restored patient record can point at an image that no
longer exists. Logins are not restored either — if the disaster removed staff access, this script
does not bring it back, and that repair is separate and deliberate.
