# The download bridge is only ever called from JavaScript, so R8 cannot see the
# call sites. Without this the release build silently breaks PDF/Excel saving.
-keepclassmembers class com.alphadental.clinic.** {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.alphadental.clinic.DownloadBridge { *; }
-keep class com.alphadental.clinic.SmsBridge { *; }

# WorkManager builds this class by name, so nothing in the compiled code appears
# to construct it and R8 is free to strip or rename it. That failure only shows
# up in a release build, as reminders that queue on the server and are never sent
# by the phone — with no error anywhere to explain why.
-keep class com.alphadental.clinic.SmsSyncWorker { *; }
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
