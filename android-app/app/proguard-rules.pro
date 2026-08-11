# The download bridge is only ever called from JavaScript, so R8 cannot see the
# call sites. Without this the release build silently breaks PDF/Excel saving.
-keepclassmembers class com.alphadental.clinic.** {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.alphadental.clinic.DownloadBridge { *; }
