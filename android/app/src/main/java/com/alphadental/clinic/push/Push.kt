package com.alphadental.clinic.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import com.alphadental.clinic.BuildConfig
import com.alphadental.clinic.MainActivity
import com.alphadental.clinic.R
import com.alphadental.clinic.sms.SmsPrefs
import com.alphadental.clinic.sms.SmsWorker
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Push notifications: how the clinic hears about things while the app is closed.
 *
 * The token registry is the website's own — the same `/api/push/register-token` endpoint, the
 * same `users/{uid}.fcmTokens` list, the same pruning of dead tokens on send. One registry means
 * the server never has to know or care whether a person will be reached on their laptop's browser
 * or the phone in their pocket; it sends to every device the account has, and whichever is alive
 * shows it.
 *
 * What arrives is deliberately boring: a title and a body. No patient identifiers in the payload
 * beyond what the sender chose to put in the text, and tapping simply opens the app — the fresh
 * data is read from Firestore on open, never trusted from a notification.
 */
const val CHANNEL_ID = "alpha_clinic"

fun ensureNotificationChannel(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(
        NotificationChannel(
            CHANNEL_ID,
            "Clinic alerts",
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = "Bookings, messages waiting to send, and other clinic events."
        }
    )
}

object PushRegistrar {

    private const val TAG = "AlphaPush"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * Put this device's token on the signed-in user's list.
     *
     * Called after sign-in and again whenever FCM rotates the token. Failure is logged and
     * forgotten rather than surfaced: a push token that registers a minute late on a flaky
     * connection is not something to interrupt a receptionist about.
     */
    fun register() {
        scope.launch {
            runCatching {
                val user = FirebaseAuth.getInstance().currentUser ?: return@launch
                val fcmToken = FirebaseMessaging.getInstance().token.await()
                val idToken = user.getIdToken(false).await().token ?: return@launch

                val url = URL(BuildConfig.WEB_URL.trimEnd('/') + "/api/push/register-token")
                val connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    doOutput = true
                    connectTimeout = 15_000
                    readTimeout = 30_000
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Authorization", "Bearer $idToken")
                }
                try {
                    connection.outputStream.use {
                        it.write(JSONObject().put("token", fcmToken).toString().toByteArray(Charsets.UTF_8))
                    }
                    connection.inputStream.use { it.readBytes() }
                } finally {
                    connection.disconnect()
                }
            }.onFailure { Log.w(TAG, "Could not register the push token: ${it.message}") }
        }
    }
}

class AlphaMessagingService : FirebaseMessagingService() {

    /** FCM rotates tokens on its own schedule; a stale one means silent non-delivery. */
    override fun onNewToken(token: String) {
        PushRegistrar.register()
    }

    /**
     * Show what arrived.
     *
     * Handled here for every message rather than letting the SDK auto-display, so foreground and
     * background behave identically — an alert that only appears when the app is closed reads as
     * flaky to whoever is waiting on it.
     */
    override fun onMessageReceived(message: RemoteMessage) {
        // A wake is a machine-to-machine nudge, not something to show anybody: the server has
        // queued a message and wants this phone to send it now rather than at its next
        // fifteen-minute poll. Nothing is displayed.
        if (message.data["type"] == "sms_wake") {
            if (SmsPrefs.isSender(this)) SmsWorker.runNow(this)
            return
        }

        val title = message.notification?.title
            ?: message.data["title"]
            ?: return
        val body = message.notification?.body ?: message.data["body"] ?: ""

        ensureNotificationChannel(this)

        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            ),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()

        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        // Distinct ids so a booking alert does not overwrite a messages-waiting alert.
        manager.notify(System.currentTimeMillis().toInt(), notification)
    }
}
