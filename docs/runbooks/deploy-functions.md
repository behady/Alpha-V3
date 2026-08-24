# Deploying the Cloud Functions

Vercel deploys the app on every push to `main`, but it knows nothing about Cloud Functions — those
live in Firebase and are a separate deploy. That gap is why `functions/` drifted out of step with
the rest of the system and stayed broken for months: nothing deployed it automatically, so nothing
ever noticed.

Two ways to do it. The first needs no terminal and is a one-time setup.

---

## A. From the browser (recommended)

### One-time: give GitHub permission to deploy (~10 minutes)

GitHub needs a key that lets it deploy on your behalf. This is all browser work.

**1. Create the key**

- Go to **console.cloud.google.com → IAM & Admin → Service Accounts**, project `alpha-v2-ffc98`.
- **Create service account**. Name it `github-deploy`.
- Grant it these roles — the minimum a functions deploy needs:
  - **Cloud Functions Admin** — create, update and delete functions
  - **Service Account User** — run the deploy as the functions' own identity
  - **Artifact Registry Writer** — functions are built into container images, which are stored here
  - **Firebase Admin SDK Administrator Service Agent**
  - **Firebase Extensions Viewer** — see below; not obvious, and the deploy fails without it

> **Why an Extensions role for a functions deploy.** Part-way through, `firebase deploy --only
> functions` lists the project's extension instances — it needs to know which deployed functions
> belong to an extension so it does not treat them as yours and offer to delete them. Without
> permission that call returns `403, The caller does not have permission` and the deploy stops,
> after the code has already been loaded and analysed, which makes it look like a code problem
> rather than a permissions one. It happens whether or not the project uses any extensions.
- Open the finished account → **Keys** → **Add key → Create new key → JSON**. A file downloads.

**2. Give the key to GitHub**

- Open the downloaded `.json` in any text editor and copy **all** of it.
- Go to **github.com/behady/Alpha-V3 → Settings → Secrets and variables → Actions**.
- **New repository secret**:
  - Name `FIREBASE_SERVICE_ACCOUNT`, value: the whole JSON you copied.
- Add a second secret:
  - Name `FIREBASE_PROJECT_ID`, value `alpha-v2-ffc98`.

**3. Delete the downloaded file.** GitHub has it now. That file is a key to your project, and a
copy sitting in Downloads is a copy that can leak.

### Every time after that

- **Automatically** — any push to `main` that changes something under `functions/` deploys it.
  Ordinary app work never triggers it.
- **By hand** — **Actions** tab → **Deploy Cloud Functions** → **Run workflow**.

### The deletion switch

The manual run has a checkbox: **"Allow removing functions that no longer exist in the code."**

Leave it **off** normally. Turn it **on** only when a deploy is meant to remove functions — for
example the run that clears the seven dead exports deleted on 2026-08-24. Off is the safe default
because a routine push should never be able to quietly delete a function somebody depends on.

---

## B. From a terminal

If you have Node and a clone of the repo:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only functions --project alpha-v2-ffc98
```

Add `--force` only when the deploy is meant to delete functions; without it the CLI asks first.

---

## When a deploy fails

Two failures worth recognising, both hit on the first real run of this workflow:

**`Detected node engine 24 in package.json, which is not a supported version.`**
Cloud Functions supports Node 20 and 22 only. Whatever `functions/package.json` says under
`engines` must be one of those. This is a hard stop before anything is built.

**`Request to firebaseextensions.googleapis.com/... had HTTP Error: 403`**
The deploying service account is missing **Firebase Extensions Viewer**. See the role list above.

A general rule for this workflow: read the LAST error line, not the warnings above it. A firebase
deploy prints a lot of deprecation noise that is not the failure — the `Error:` line is.

Note also that GitHub's **Re-run jobs** button replays the *original* commit, not the current one.
After pushing a fix, start a **new** run from **Run workflow** rather than re-running the failed
one, or you will watch the same error twice.

## Checking it worked

**Firebase console → Functions.** The list should match the exports in `functions/index.js` and its
siblings. After the 2026-08-24 cleanup that is 13 functions; the seven `notify*` names should be
gone.

Then wait for a scheduled job to fire and look at its logs:

- `dailyClinicReportToOwner` runs at **23:50** Africa/Cairo. Its log line reads
  `N clinic(s) — X sent, Y idle, Z failed`. A clinic with no activity that day is counted as idle
  and is deliberately sent nothing — reporting zeros would read as a measurement, and a closed
  Friday would look identical to a broken job.
- If it says `no ownerNumber for <clinicId>`, that clinic has not set an owner number under
  **Settings → WhatsApp**. The PDF is still stored; nobody is notified.

## What CI does and does not check

`ci.yml` parse-checks every `functions/*.js` on each push, and the deploy workflow does it again
before deploying. That catches an unparseable file. It cannot catch a wrong Firestore path — the
actual defect that hid here — because that requires real data to notice. `functions/` still has no
unit tests; the checks above are a floor, not a safety net.
