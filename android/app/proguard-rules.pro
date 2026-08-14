# Firestore maps documents onto these classes by field name via reflection, so R8
# renaming their fields would silently produce empty appointments at runtime —
# in the release build only.
-keep class com.alphadental.clinic.data.** { *; }

# WorkManager constructs this by class name, so nothing in the compiled code appears to build it
# and R8 is free to strip or rename it. That failure shows up only in a release build, as
# reminders that queue on the server and are never sent by the phone, with no error anywhere.
-keep class com.alphadental.clinic.sms.SmsWorker { *; }
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
