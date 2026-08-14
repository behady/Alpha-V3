# Alpha Dental — Android app

A **native** Android app for the Alpha Dental clinic system. Not a browser in
disguise — the screens are built into the app, and it talks straight to the
Firebase database.

Written in Kotlin with Jetpack Compose. Version 2.0.0.

---

## What it is, and what it deliberately is not

What it does natively:

- **Today's schedule**, live, and **working with no signal**
- **Check patients in** and move them through the visit
- **Book, move and cancel** appointments, with the clinic's real hours and slots
- **Find any patient**, see what they owe, their visits and their treatment
- **Take a payment**, with the doctor commission and lab fee split correctly
- **Record a procedure**, billed and linked to the ledger
- **Teeth chart** — tap a tooth to filter its treatment history
- **Write a prescription**
- **Clock in and out**, with the clinic geofence
- **Send SMS reminders** from this phone's SIM
- **Call or WhatsApp** a patient from anywhere they appear

Everything else — reports, inventory, prescriptions, clinical notes, settings,
the AI screens — stays on the website, reachable from **More → Open full
system**. That opens a real Chrome tab, not an embedded browser, which is why
Google sign-in and downloads work there.

That split is the whole design. The website is 21 screens and 54,000 lines;
rewriting all of it here would take months and leave two copies of everything to
keep in step forever. The app covers the hot path natively and leaves the long
tail in one place.

### It replaces the old WebView app

The previous app was a browser window with an app icon — it downloaded every
screen from the website, so it needed the website to be up and could not work
offline. This one keeps the same package name and the same signing key, so it
**installs straight over the old app**. Nobody needs to uninstall anything, and
staff stay signed in.

---

## Getting it onto a phone

1. Find **`AlphaDental.apk`** in this folder.
2. Send it to the phone however is easiest — WhatsApp to yourself, email, Google
   Drive, or a USB cable.
3. On the phone, open the file.
4. Android will say *"your phone is not allowed to install unknown apps from
   this source."* Normal for anything not from the Play Store. Tap **Settings**,
   turn on **Allow from this source**, press back, then **Install**.
5. Sign in with **email and password**.

### Google sign-in is not offered

Not because it is broken — because it needs an Android OAuth client registered
in the Firebase console, which has not been done. An app showing a button that
always fails is worse than one that does not show it.

Anyone who only ever signs in with Google needs a password first: open the
system in a normal browser and use **Forgot Password?**.

---

## What to check after installing

| # | Do this | What should happen |
|---|---------|--------------------|
| 1 | Open the app, sign in | You land on a home screen with your name on it |
| 2 | Look at what it shows you | A dentist sees their next patient; reception sees the waiting room; an owner sees the day's numbers |
| 3 | Close the app fully and reopen | Still signed in, straight to today |
| 4 | Tap **Day**, swipe through days | Appointments in time order, colour-coded by status |
| 5 | Tap an appointment | A sheet slides up with Call, WhatsApp and the status buttons |
| 6 | Tap **Checked In** | The card turns green here **and on the website within a second** |
| 7 | Turn on aeroplane mode | An amber "Working offline" bar appears; the day is still there |
| 8 | Check someone in while offline | It changes immediately and says **"Not sent yet"** underneath |
| 9 | Turn aeroplane mode off | "Not sent yet" disappears as it reaches the clinic |
| 10 | Tap a patient's **Call** | The dialler opens with the number filled in |
| 11 | **More → Open full system** | The website opens in a Chrome tab, already signed in |
| 12 | **More → العربية** | The app switches to Arabic |

Step 8 and 9 are the ones worth doing properly. That behaviour — showing a
change immediately but refusing to claim it reached the clinic until it did — is
the point of the whole offline design.

---

## Known limits, honestly

1. **It has not been run on a real phone yet.** It compiles and is signed, but
   there was no device or emulator available to test against live clinic data.
   The first install is the first real test — work through the table above.

2. **Read-only for everything except appointment status.** You cannot yet book,
   reschedule, cancel, write clinical notes or take payments in the app. Those
   are the next steps.

3. **You can only search what the phone has already seen.** Offline, Firestore
   serves what it has cached. A patient nobody has opened on that phone is not
   there. Prefetching tomorrow's patients is a planned improvement.

4. **A write saved offline can still be rejected.** Security rules run on the
   server. If a queued change breaks them, it fails when it finally syncs — long
   after the person walked away. The app checks permissions before letting you
   act, which prevents the common cases.

5. **The dentist's "my patients" filter matches on name.** Appointments store a
   doctor's *name*, not an id. If the name on the account does not match the name
   on the appointments, the filter falls back to showing the whole day rather
   than an empty screen.

6. **SMS sending is on but untested on a real SIM.** Turn it on in
   **More → Send reminders from this phone**. The phone then checks the queue
   every 15 minutes and texts anything waiting. Two things to know: every
   message is billed to that SIM, and the app must be excluded from battery
   saver or Android will eventually stop the checks. The card shows the last
   check and what happened.

7. **Android 8.0 and newer.** Chosen to match the app it replaces — nobody
   confirmed the oldest phone in the clinic.

---

## Building it

Double-click **`build-apk.bat`**. It leaves a fresh `AlphaDental.apk` here.

Or open this `android` folder in Android Studio and use
*Build → Build App Bundle(s) / APK(s) → Build APK(s)*.

### What the build needs

- The Android SDK (already at `C:\Users\PC\AppData\Local\Android\Sdk`)
- **Java 21**, at `C:\Users\PC\.jdks\jbr-21.0.11`

Java 21 specifically, and this is not a preference. Android Studio's own JBR is
Java **25**, which the Android Gradle Plugin refuses with an error that is just
the version number; the system JDK is **11**, which is too old.

The JDK this project used to point at, under `Downloads\jdk21_extracted`, was
gutted on 2026-08-14 — only `bin` and `lib\modules` were left, so every build
died with `could not open lib\jvm.cfg`. `build-apk.bat` now uses the JetBrains
JDK 21 under `.jdks` and falls back to the old path if it is ever restored. If
both vanish, install any JDK 21 and update the `JAVA_HOME` line at the top of
`build-apk.bat`.

### If the clinic's web address ever changes

It is written in exactly one place: the `WEB_URL` line in `app/build.gradle.kts`.
Change it there and rebuild. Only the **Open full system** button uses it —
patient data comes straight from Firebase, so a wrong address there sends staff
to the wrong website but cannot corrupt anything.

Worth knowing: a stale Vercel deployment keeps answering with a working-looking
page rather than an error, so a wrong address here shows no symptom at all until
somebody notices the site looks out of date.

### Releasing an update

Bump `versionCode` and `versionName` in `app/build.gradle.kts` before
rebuilding, or Android may refuse to install over the existing copy.

---

## The two files that are not in git

Both are deliberately excluded, and both matter.

### `alpha-dental-release.jks` + `keystore.properties`

The key that stamps the app as genuinely yours, and its passwords. **This is the
same key the old app used** — that is what lets this version install over it.

A backup lives in `C:\Users\PC\Downloads\alpha-dental-signing-key-backup\`.
Copy it somewhere safer: a password manager or an encrypted drive. If it is
lost, every phone would have to uninstall before it could install an update.

### `firebase.properties`

Five values telling the app which Firebase project to talk to. Normally Android
apps carry a `google-services.json` for this, which requires registering an
Android app in the Firebase console; these five values do the same job with no
console step.

**If it goes missing**, recreate it from `.env.local` in the website project:

```properties
firebase.projectId=<NEXT_PUBLIC_FIREBASE_PROJECT_ID>
firebase.apiKey=<NEXT_PUBLIC_FIREBASE_API_KEY>
firebase.appId=<NEXT_PUBLIC_FIREBASE_APP_ID>
firebase.senderId=<NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID>
firebase.storageBucket=<NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET>
```

A Firebase API key is an identifier, not a password — it says *which project*,
and what actually protects the data is `firestore.rules`. It is kept out of git
for tidiness, not secrecy.

---

## What is in here

| File | What it does |
|------|--------------|
| `AlphaApp.kt` | Connects to Firebase. **Binds to the database named `default`** — see below |
| `MainActivity.kt` | The app shell: bottom tabs, which screen shows, the More page |
| `AppViewModel.kt` | All screen state in one place, and the day being viewed |
| `data/Models.kt` | Appointment and session shapes, matching the website's field names |
| `data/Repository.kt` | Every read and write. Firestore only — no server calls |
| `ui/Theme.kt` | The website's mobile colours, type and status palette |
| `ui/Components.kt` | Appointment card, status pill, offline bar, stat tiles |
| `ui/LoginScreen.kt` | Sign in |
| `ui/HomeScreen.kt` | The three role dashboards |
| `ui/DayScreen.kt` | One day's appointments |
| `ui/AppointmentSheet.kt` | The sheet with Call, WhatsApp and status buttons |
| `ui/PatientsScreen.kt` | Patient search |
| `ui/PatientSheet.kt` | One patient: balance, visits, call/WhatsApp |
| `sms/SmsWorker.kt` | The 15-minute job that claims and sends queued reminders |
| `sms/SmsSender.kt` | Sends one text and waits for the network to confirm it |

### The one thing most likely to break

This project's Firestore database is literally named **`default`**, not the
conventional `(default)`, which does not exist here at all. `AlphaApp.kt` binds
to it by name for that reason.

If that ever gets "tidied up" to a plain `FirebaseFirestore.getInstance()`, the
app will sign in perfectly and then show a clinic with **no patients and no
appointments**, with no error anywhere to explain why. The website hits the same
trap and solves it the same way.
