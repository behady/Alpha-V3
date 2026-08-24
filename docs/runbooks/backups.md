# Backups — switching on Firestore disaster recovery

The security rules protect against bad **access**. Nothing yet protects against a bad **write** —
a buggy deploy, a script applied twice, an accidental bulk delete. That protection is two switches
in the Google Cloud console, and both are storage-priced: for a database this size, pennies per
month. (The project must be on the Blaze pay-as-you-go plan, which it already is if Cloud
Functions run.)

Note for every step: this project's database is literally named `default` — not the usual
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

## If disaster ever comes

Do not attempt a restore alone under stress — open a Claude session on this repo and say what
happened and when. The honest division of labour: **the switches above are yours to flip today;
the restore, if ever needed, is guided work.** What makes that guided work possible — the
versions, the backups — only exists if the switches were on before the disaster.

For the record, the shape of each path:

- **PITR repair** (damage less than 7 days old, scoped): read the affected documents at a
  timestamp before the damage and write them back. Finest instrument, shortest reach.
- **Backup restore** (older or total): Disaster recovery tab → Backups → Restore → into a new
  database → verify → copy data back into `default`.

## The habit

Once a quarter, open the Disaster recovery tab and confirm backups are listed with recent dates.
A backup nobody has ever seen exist is a hope, not a backup.
