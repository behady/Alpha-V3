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

**What does not exist yet is the copy-back tool.** The mechanism is sound and the data layout
supports it; nobody has written and tested the script that walks one clinic's subtree from a
restored copy into the live database. Until that exists, the copy-back is hand-guided work. Worth
building before the second paying clinic, not before the first.

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

## The habit

Once a quarter, open the Disaster recovery tab and confirm backups are listed with recent dates.
A backup nobody has ever seen exist is a hope, not a backup.
