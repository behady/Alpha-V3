# Alpha Dental — Android app

This folder builds an Android app (`.apk`) for the Alpha Dental clinic system.

**Nothing outside this folder is touched.** The website in `src/` is completely
unchanged — this is a separate, self-contained project that sits beside it.

---

## What this app actually is

It is a **native Android app that shows your live clinic system**. Think of it
as your website in its own app icon, with the browser's address bar, tabs and
menus removed, plus the things a website alone cannot do on a phone.

It is **not** a separate copy of the system. There is one database, one set of
patients, one login. Whatever you change on the phone appears on the desktop
immediately, and the other way round — because they are the same system.

### Why it was built this way

Your clinic system is not just web pages. A large part of it runs on a server:
the AI briefings, WhatsApp sending, the nightly reminder job, PDF generation on
the server, and all the Firebase security. Those pieces cannot be packed inside
a phone. So the app shows the real, live system rather than a stripped-down
imitation of it — you keep every feature, and there is nothing extra to keep in
sync.

**This means the app needs an internet connection.** With no signal it shows a
"could not be reached" screen and a Try again button, the same as the website
would.

---

## Getting it onto a phone

1. Find the file **`AlphaDental.apk`** in this folder.
2. Send it to the phone however is easiest — WhatsApp to yourself, email,
   Google Drive, or a USB cable.
3. On the phone, open the file.
4. Android will say *"For your security, your phone is not allowed to install
   unknown apps from this source."* This is normal for any app that does not
   come from the Play Store. Tap **Settings**, turn on **Allow from this
   source**, then press back and tap **Install** again.
5. The Alpha Dental icon appears in the app list.

Repeat the same steps to install a newer version later — it replaces the old
one and keeps you logged in.

---

## Try these after installing

Work through this list once. If anything behaves differently from the
description, that is a real problem worth reporting.

| # | Do this | What should happen |
|---|---------|--------------------|
| 1 | Tap the Alpha Dental icon | A dark screen with the tooth logo appears for a moment, then the login page |
| 2 | Sign in with **email and password** | You land on the dashboard, exactly like the website |
| 3 | Close the app completely and reopen it | You are still signed in — no need to log in again |
| 4 | Open a patient, then press the phone's **back** button | It goes back one page inside the app, not straight out |
| 5 | Keep pressing back until you reach the dashboard, then press back twice | "Press back again to close Alpha Dental", then it closes |
| 6 | Pull down from the very top of a page | A spinner appears and the page refreshes |
| 7 | Open a prescription and tap the button that makes the PDF | A box appears: "Saved to Downloads". Tap **Open** — the PDF opens in the phone's PDF viewer |
| 8 | Go to Reports and export to Excel | Same "Saved to Downloads" box, and the file is in the phone's Downloads folder |
| 9 | Open a patient and tap to upload a photo | The phone offers both **Camera** and the file picker. Take a photo — it uploads |
| 10 | Tap a patient's phone number | The phone's dialler opens with the number filled in |
| 11 | Tap something that sends a WhatsApp message | WhatsApp opens, not a web page inside the app |
| 12 | Turn on aeroplane mode and reopen the app | The "could not be reached" screen with a Try again button |
| 13 | Turn aeroplane mode off and tap Try again | The system loads normally |
| 14 | Switch the phone to dark mode | The bar at the top of the screen matches the page instead of clashing with it |

---

## Sending appointment reminders as text messages

This app can turn one clinic phone into the thing that sends your 24-hour
appointment reminders, as ordinary SMS from its own SIM card.

It exists because WhatsApp is not available to every clinic — the official
WhatsApp Business API needs business verification documents, and automating a
normal WhatsApp number risks having it banned. A SIM card has neither problem.
The system decides what to send and when; this phone does the sending.

### Setting it up

1. On a computer, sign in as **Admin** and go to **Settings → SMS**.
2. Turn on **Send from the clinic phone**, and choose whether reminders go out
   by WhatsApp, by SMS, or by both.
3. Press **Pair a phone**. An eight-character code appears.
4. On the clinic phone, open the Alpha Dental app, go to the same
   **Settings → SMS** screen, and press **Pair this phone**. It pairs itself —
   no typing. (If you are setting up a *different* phone, type the code there
   instead. The code lasts ten minutes and works once.)
5. Android asks for permission to send text messages. Say yes. Without it,
   nothing pairs — the app will not let you end up with a phone that appears in
   the list but silently sends nothing.

That phone now checks for waiting reminders every fifteen minutes, including
when the app is closed and after the phone restarts.

### Before you turn it on

| | |
|---|---|
| **It costs money** | Every message is billed to that SIM at your normal SMS rate. WhatsApp is free; this is not. |
| **Arabic is expensive** | One Arabic character anywhere in the message drops it from 160 characters per text to 70. A long reminder is billed as three or four messages. The settings screen shows the real count as you type — watch it. |
| **The phone must be alive** | On, charged, in signal, and not "optimised" into sleep by Android's battery settings. Exclude Alpha Dental from battery optimisation on that phone. |
| **Carriers watch consumer SIMs** | Sending a lot of near-identical messages from a personal line can get the number throttled or blocked. This is fine for a normal clinic's daily reminders; it is not a marketing tool. |
| **Nothing is faked** | A reminder is only ever reported as *Sent* once the network confirms it left the handset. Until then Settings → SMS shows it as *Waiting*. If the phone is flat in a drawer, you will see the queue standing still rather than a screen full of green ticks. |

### Checking it works

Settings → SMS lists the paired phone with its **last seen** time, and the most
recent messages with their real status. A phone that is working shows a last-seen
time within the last fifteen minutes.

---

## Known limits — read this before rolling it out

These are real limitations, not bugs to be fixed later by accident:

1. **Google sign-in does not work inside the app.** Google refuses to show its
   sign-in page inside any app like this one — that is Google's rule, and no
   app can work around it. The app detects this and shows a message telling
   staff to use email and password. **Anyone who only ever signed in with
   Google needs a password set before they can use the app.** They can do that
   from "Forgot Password?" on the login page in a normal browser.

2. **Push notifications do not arrive.** The web notification system the site
   uses (`fcmClient`) does not function inside an app shell like this. Staff
   will not get pop-up alerts on their phone. Making that work needs real
   Firebase Cloud Messaging built into the app — a separate piece of work.

3. **Nothing works offline.** As explained above, the system lives on the
   server. No signal means no app.

4. **The talking avatar's voice will be silent.** Android's app browser has no
   speech engine. The rest of that screen works; only the spoken output is
   missing. (Your code already checks for this and hides it, so it will not
   break.)

5. **Android 8.0 and newer only.** Anything older cannot install it.

6. **This app can never go on the Google Play Store while SMS sending is in
   it.** Google only permits the `SEND_SMS` permission for an app that is the
   phone's default messaging app. That is not a problem today — Alpha Dental is
   installed by copying the APK onto the phone, which is what the instructions
   above describe — but it does close the Play Store door. If you ever want to
   publish there, the SMS permission has to come out of `AndroidManifest.xml`
   first, and reminders go back to WhatsApp only.

---

## If the web address ever changes

The address is written in exactly one place:

`app/src/main/java/com/alphadental/clinic/AppConfig.java`

Open it, change `START_URL`, add the new address to the `IN_APP_HOSTS` list
just below it, then run `build-apk.bat`. Nothing else needs editing.

---

## Rebuilding the app

Double-click **`build-apk.bat`**. It takes about a minute and leaves a fresh
`AlphaDental.apk` in this folder.

If you would rather use Android Studio: open this `android-app` folder as a
project and use *Build → Build App Bundle(s) / APK(s) → Build APK(s)*.

### What the build needs

- The Android SDK (already installed at
  `C:\Users\PC\AppData\Local\Android\Sdk`)
- **Java 21**, extracted at `C:\Users\PC\Downloads\jdk21_extracted\jdk-21.0.12+8`

Java 21 specifically: the Java bundled with Android Studio (25) is too new for
this version of the build tool, and the system Java (11) is too old. If you
ever move that folder, update the `JAVA_HOME` line at the top of
`build-apk.bat`.

### Releasing an update

Bump `versionCode` and `versionName` in `app/build.gradle.kts` before
rebuilding, otherwise Android may refuse to install over the existing copy.

---

## The signing key — do not lose this

`alpha-dental-release.jks` is the key that stamps the app as genuinely yours.
Its passwords are in `keystore.properties`. Both are deliberately kept out of
git, because anyone holding them could publish an app that pretends to be
Alpha Dental.

**Copy both files somewhere safe** (a password manager, an encrypted drive).
If they are lost, a future update cannot install over the current app — every
phone would have to uninstall and reinstall, which is disruptive but survivable
while the app is sideloaded. If Alpha Dental ever goes on the Play Store,
losing the key becomes permanent: that listing can never be updated again.

---

## What is in here

| File | What it does |
|------|--------------|
| `AppConfig.java` | The web address and which links stay inside the app |
| `MainActivity.java` | The screen itself — back button, refresh, uploads, links |
| `DownloadBridge.java` | Catches PDFs and spreadsheets the website builds |
| `DownloadScripts.java` | The small piece of JavaScript that hands them over |
| `FileSaver.java` | Writes the finished file into the phone's Downloads |
| `SmsBridge.java` | Lets the Settings → SMS page pair the phone it is open on |
| `SmsConfig.java` | Remembers this phone's pairing token between runs |
| `SmsApi.java` | Talks to the clinic system: claim messages, report results |
| `SmsSender.java` | Sends one text and waits for the network to confirm it |
| `SmsSyncWorker.java` | The every-fifteen-minutes job that does all of the above |
| `tools/make_icons.py` | Redraws the app icon if you want to change it |
| `build-apk.bat` | Builds everything |

### About the download plumbing

It is worth knowing why three files exist just to save a file. Your reports and
prescriptions are built **inside the browser** by jsPDF and SheetJS, not
downloaded from a server. An app browser has no Downloads folder of its own, so
those files would simply vanish when tapped — every Export button would look
broken. Those three files catch the file the moment the page produces it and
put it where the phone expects it.
