package com.alphadental.clinic.sms

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Sends one text message and waits to find out whether it actually left.
 *
 * The waiting is the whole point. `sendTextMessage` returns immediately and tells you nothing — it
 * hands the message to the radio and walks away. Reporting success at that moment would fill the
 * clinic's screen with "Sent" beside patients who were never told anything, on a phone with no
 * credit or no signal. So this blocks on the result broadcast Android sends back, and only calls
 * it sent when the network says RESULT_OK.
 *
 * Long messages are split into parts by the platform, and every part has to succeed: a reminder
 * that arrives with its second half missing is worse than one that never arrives, because nobody
 * knows to resend it.
 */
object SmsSender {

    /** Result of one send attempt. */
    data class Result(val sent: Boolean, val error: String? = null)

    /**
     * How long to wait for the network to accept a message before giving up on this attempt.
     * Generous: a phone reconnecting to a cell after a night on a shelf can take a while, and a
     * timeout here only returns the message to the queue for the next poll — nothing is lost.
     */
    private const val SEND_TIMEOUT_SECONDS = 60L

    private const val ACTION_SENT = "com.alphadental.clinic.SMS_SENT"

    fun send(context: Context, destination: String, body: String, requestCode: Int): Result {
        if (destination.isBlank()) return Result(false, "No phone number")
        if (body.isBlank()) return Result(false, "Empty message")

        val smsManager = resolveSmsManager(context)
            ?: return Result(false, "This phone has no SMS service")

        val parts = runCatching { smsManager.divideMessage(body) }.getOrNull()
        if (parts.isNullOrEmpty()) return Result(false, "Could not prepare the message")

        val latch = CountDownLatch(parts.size)
        val failure = AtomicReference<String?>(null)
        val action = "$ACTION_SENT.$requestCode"

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (resultCode != Activity.RESULT_OK) {
                    // First failure wins: it is the one worth reporting back.
                    failure.compareAndSet(null, describe(resultCode))
                }
                latch.countDown()
            }
        }

        // NOT_EXPORTED: the only thing that ever fires this is our own PendingIntent coming back
        // from the telephony service.
        ContextCompat.registerReceiver(
            context.applicationContext,
            receiver,
            IntentFilter(action),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )

        return try {
            val sentIntents = ArrayList<PendingIntent>(parts.size)
            parts.indices.forEach { i ->
                val intent = Intent(action).setPackage(context.packageName)
                sentIntents += PendingIntent.getBroadcast(
                    context.applicationContext,
                    requestCode * 100 + i,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            }

            if (parts.size == 1) {
                smsManager.sendTextMessage(destination, null, parts[0], sentIntents[0], null)
            } else {
                smsManager.sendMultipartTextMessage(destination, null, parts, sentIntents, null)
            }

            if (!latch.await(SEND_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                return Result(false, "The phone did not confirm the message was sent")
            }

            failure.get()?.let { Result(false, it) } ?: Result(true)
        } catch (e: SecurityException) {
            Result(false, "Permission to send text messages was refused")
        } catch (e: Exception) {
            Result(false, e.message ?: "Send failed")
        } finally {
            runCatching { context.applicationContext.unregisterReceiver(receiver) }
        }
    }

    /**
     * The SmsManager for the SIM the user chose as their default for messages.
     *
     * On a dual-SIM phone the deprecated static getDefault() can pick the wrong slot, which sends
     * the clinic's reminders off the wrong SIM — and onto the wrong bill.
     */
    private fun resolveSmsManager(context: Context): SmsManager? =
        runCatching { context.getSystemService(SmsManager::class.java) }.getOrNull()
            ?: runCatching { @Suppress("DEPRECATION") SmsManager.getDefault() }.getOrNull()

    /** Android's numeric failure codes, turned into something a clinic can act on. */
    private fun describe(resultCode: Int): String = when (resultCode) {
        SmsManager.RESULT_ERROR_NO_SERVICE -> "No mobile signal when the message was sent"
        SmsManager.RESULT_ERROR_RADIO_OFF -> "The phone's mobile radio was off (flight mode?)"
        SmsManager.RESULT_ERROR_NULL_PDU -> "The phone rejected the message format"
        SmsManager.RESULT_ERROR_LIMIT_EXCEEDED ->
            "The phone hit its limit on messages sent — the carrier may be throttling this SIM"
        SmsManager.RESULT_ERROR_GENERIC_FAILURE ->
            "The network refused the message (out of credit, or the number is blocked)"
        else -> "The phone could not send this message (code $resultCode)"
    }
}
