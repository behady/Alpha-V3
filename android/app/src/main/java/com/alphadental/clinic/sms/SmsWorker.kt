package com.alphadental.clinic.sms

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.alphadental.clinic.Firebase
import com.alphadental.clinic.data.Repository
import com.google.firebase.firestore.FieldValue
import kotlinx.coroutines.tasks.await
import java.util.concurrent.TimeUnit

/**
 * The background job that sends the clinic's appointment reminders from this phone's SIM.
 *
 * It reads the queue straight out of Firestore — there is no server call anywhere in here. The
 * nightly job on the server writes messages into `clinics/{id}/sms_outbox`; this picks them up,
 * sends them, and writes back what actually happened.
 *
 * Everything that can go wrong is arranged to fail towards "the message goes out later" rather
 * than "the message is quietly lost":
 *
 *  - Claiming is a transaction, so two phones in one clinic cannot both send the same reminder.
 *  - A message claimed by a phone that then dies returns to the queue after fifteen minutes.
 *  - A send is only marked sent once the network confirms it (see SmsSender).
 */
class SmsWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val context = applicationContext

        if (!SmsPrefs.isSender(context)) return Result.success()

        if (!hasSmsPermission(context)) {
            // Retrying cannot help — only the person holding the phone can grant this.
            SmsPrefs.recordRun(context, "Permission to send text messages has not been granted", 0)
            return Result.success()
        }

        val session = Repository.loadSession().getOrElse {
            // Signed out, or the account lost its clinic. Nothing to send as.
            SmsPrefs.recordRun(context, "Not signed in on this phone", 0)
            return Result.success()
        }

        // Tells the server's nightly job that a phone is alive and willing to send. Without a
        // recent heartbeat it stops queueing, rather than piling messages up where nothing will
        // ever collect them.
        runCatching { Repository.heartbeatSmsDevice(session.clinicId, SmsPrefs.deviceId(context), deviceName()) }

        val claimed = runCatching { claimBatch(session.clinicId) }.getOrElse { error ->
            SmsPrefs.recordRun(context, "Could not read the queue: ${error.message}", 0)
            return Result.retry()
        }

        if (claimed.isEmpty()) {
            SmsPrefs.recordRun(context, "Nothing waiting to send", 0)
            return Result.success()
        }

        var sent = 0
        claimed.forEachIndexed { index, message ->
            val result = SmsSender.send(context, message.to, message.text, index + 1)
            if (result.sent) sent++ else Log.w(TAG, "Could not send ${message.id}: ${result.error}")
            runCatching { Repository.ackSms(session.clinicId, message.id, result.sent, result.error) }
        }

        SmsPrefs.recordRun(context, "Sent $sent of ${claimed.size}", sent)
        return Result.success()
    }

    /**
     * Take ownership of up to a batch of waiting messages.
     *
     * Each is claimed in its own transaction: the claim either wins outright or loses to another
     * phone, and a message can never be handed to two senders. Claiming one at a time rather than
     * as one big transaction means a single contested message does not force the whole batch to
     * retry.
     */
    private suspend fun claimBatch(clinicId: String): List<Repository.QueuedSms> =
        Repository.claimQueuedSms(clinicId, deviceId = SmsPrefs.deviceId(applicationContext), limit = BATCH_SIZE)

    private fun deviceName(): String {
        val manufacturer = android.os.Build.MANUFACTURER.orEmpty().trim()
        val model = android.os.Build.MODEL.orEmpty().trim()
        return when {
            model.isEmpty() -> "Clinic phone"
            manufacturer.isEmpty() || model.startsWith(manufacturer, ignoreCase = true) -> model
            else -> "$manufacturer $model"
        }
    }

    companion object {
        private const val TAG = "AlphaSmsWorker"

        /** Enough for a normal clinic day, small enough to finish inside one wake-up. */
        private const val BATCH_SIZE = 25

        private const val PERIODIC_WORK = "alpha_sms_periodic"
        private const val ONE_OFF_WORK = "alpha_sms_now"

        fun hasSmsPermission(context: Context): Boolean =
            ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) ==
                PackageManager.PERMISSION_GRANTED

        /**
         * Start the repeating poll. Fifteen minutes is WorkManager's shortest allowed period, and
         * it is plenty: a reminder queued at 07:00 for tomorrow is not made worse by going at 07:12.
         */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<SmsWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
                )
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_WORK,
                // KEEP, not UPDATE: replacing the request on every app start would reset the
                // 15-minute timer each time, so on a phone somebody opens often it might never run.
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        /** Poll once, now. Used right after the toggle is turned on. */
        fun runNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<SmsWorker>()
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
                )
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(ONE_OFF_WORK, ExistingWorkPolicy.REPLACE, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK)
        }
    }
}

/**
 * What this phone remembers about being the clinic's SMS sender.
 *
 * Held in SharedPreferences rather than anywhere Firebase-shaped, because the worker runs when the
 * app is closed and there is no screen or session to ask.
 */
object SmsPrefs {

    private const val PREFS = "alpha_sms"
    private const val KEY_IS_SENDER = "is_sender"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_LAST_RUN = "last_run_at"
    private const val KEY_LAST_RESULT = "last_result"
    private const val KEY_SENT_TOTAL = "sent_total"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isSender(context: Context): Boolean = prefs(context).getBoolean(KEY_IS_SENDER, false)

    fun setSender(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_IS_SENDER, enabled).apply()
    }

    /**
     * A stable id for this handset.
     *
     * ANDROID_ID is per-app and per-device and survives app restarts, which is all a claim marker
     * needs. It is not used to identify a person and never leaves the clinic's own database.
     */
    @Suppress("HardwareIds")
    fun deviceId(context: Context): String {
        val existing = prefs(context).getString(KEY_DEVICE_ID, null)
        if (!existing.isNullOrBlank()) return existing

        val id = runCatching {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        }.getOrNull()?.takeIf { it.isNotBlank() } ?: java.util.UUID.randomUUID().toString()

        prefs(context).edit().putString(KEY_DEVICE_ID, id).apply()
        return id
    }

    fun recordRun(context: Context, result: String, sentNow: Int) {
        val p = prefs(context)
        p.edit()
            .putLong(KEY_LAST_RUN, System.currentTimeMillis())
            .putString(KEY_LAST_RESULT, result)
            .putInt(KEY_SENT_TOTAL, p.getInt(KEY_SENT_TOTAL, 0) + sentNow)
            .apply()
    }

    fun lastRunAt(context: Context): Long = prefs(context).getLong(KEY_LAST_RUN, 0L)
    fun lastResult(context: Context): String = prefs(context).getString(KEY_LAST_RESULT, "").orEmpty()
    fun sentTotal(context: Context): Int = prefs(context).getInt(KEY_SENT_TOTAL, 0)
}
