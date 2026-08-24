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

### 2. Scheduled backups (the weekly photograph)

Still on the Disaster recovery tab: **create a backup schedule** —

- **Daily**, retention **14 days**, and if the console allows both, add **weekly** with the
  longest retention offered.

This is the protection PITR cannot give: PITR's window is 7 days, so a problem discovered on day
10 needs the cold-storage backup. A backup restores into a **new database** in the same project,
which is deliberately non-destructive — the broken database stays as evidence while the restored
copy is checked.

## If disaster ever comes

Do not attempt a restore alone under stress — open a Claude session on this repo and say what
happened and when. The honest division of labour: **the switches above are yours to flip today;
the restore, if ever needed, is guided work.** What makes that guided work possible — the
versions, the backups — only exists if the switches were on before the disaster.

For the record, the shape of each path:

- **PITR repair** (damage < 7 days old, scoped): read the affected documents at a timestamp
  before the damage and write them back.
- **Backup restore** (older or total): Disaster recovery tab → Backups → Restore → into a new
  database → verify → copy data back into `default`.

## The habit

Once a quarter, open the Disaster recovery tab and confirm backups are listed with recent dates.
A backup nobody has ever seen exist is a hope, not a backup.
