package com.alphadental.clinic;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * The background job that actually sends the clinic's reminders.
 *
 * <p>It wakes up, asks the server what is waiting, sends each message from this
 * phone's SIM, and reports back exactly what happened. Everything it can get
 * wrong is designed to fail towards "the message goes out later" rather than
 * "the message is quietly lost":
 *
 * <ul>
 *   <li>Claiming happens server-side, so two phones cannot send the same text.</li>
 *   <li>A message the phone claims but never reports on returns to the queue
 *       after fifteen minutes.</li>
 *   <li>A send is only acknowledged as sent when the network confirms it.</li>
 * </ul>
 *
 * <p>Fifteen minutes is WorkManager's shortest allowed period, and it is plenty:
 * a reminder queued at 07:00 for tomorrow's appointment is not made worse by
 * arriving at 07:12.
 */
public class SmsSyncWorker extends Worker {

    private static final String TAG = "AlphaSmsWorker";

    /** The repeating job. Kept unique so re-scheduling never stacks up duplicates. */
    public static final String PERIODIC_WORK = "alpha_sms_periodic";

    /** A one-off run, used right after pairing so the first send is not a 15-minute wait. */
    private static final String ONE_OFF_WORK = "alpha_sms_now";

    public SmsSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();

        if (!SmsConfig.isPaired(context)) {
            SmsConfig.recordSync(context, "This phone is not paired with a clinic", 0);
            return Result.success();
        }

        if (!hasSmsPermission(context)) {
            // Retrying cannot help: only the person holding the phone can grant
            // this, from the app's own screen.
            SmsConfig.recordSync(context, "Permission to send text messages has not been granted", 0);
            return Result.success();
        }

        List<SmsApi.OutboxMessage> messages;
        try {
            messages = SmsApi.claim(context);
        } catch (SmsApi.ApiException e) {
            if (e.unauthorized) {
                // The clinic unpaired this phone. Forget the token rather than
                // knocking on the door every fifteen minutes forever.
                SmsConfig.clearPairing(context);
                cancel(context);
                SmsConfig.recordSync(context, "This phone was unpaired from the clinic", 0);
                return Result.success();
            }
            SmsConfig.recordSync(context, "Could not reach the clinic system: " + e.getMessage(), 0);
            return Result.retry();
        }

        if (messages.isEmpty()) {
            SmsConfig.recordSync(context, "Nothing waiting to send", 0);
            return Result.success();
        }

        List<SmsApi.Ack> acks = new ArrayList<>(messages.size());
        int sent = 0;
        for (int i = 0; i < messages.size(); i++) {
            SmsApi.OutboxMessage message = messages.get(i);
            SmsSender.Result result = SmsSender.send(context, message.to, message.text, i + 1);
            acks.add(new SmsApi.Ack(message.id, result.sent, result.error));
            if (result.sent) {
                sent++;
            } else {
                Log.w(TAG, "Could not send " + message.id + ": " + result.error);
            }
        }

        try {
            SmsApi.acknowledge(context, acks);
        } catch (SmsApi.ApiException e) {
            // The texts genuinely went out; only the report failed. Retrying the
            // whole job is safe — the server holds those messages as claimed and
            // will not hand them to anyone else until the claim times out, and
            // this phone re-acknowledges them on the next run.
            SmsConfig.recordSync(context, "Sent " + sent + ", but could not report back: " + e.getMessage(), sent);
            return Result.retry();
        }

        SmsConfig.recordSync(context, "Sent " + sent + " of " + messages.size(), sent);
        return Result.success();
    }

    // ------------------------------------------------------------- scheduling

    public static boolean hasSmsPermission(Context context) {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS)
                == PackageManager.PERMISSION_GRANTED;
    }

    /** Start (or keep) the repeating poll. Safe to call as often as you like. */
    public static void schedule(Context context) {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                SmsSyncWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build();

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_WORK,
                // KEEP, not UPDATE: replacing the request on every app start would
                // reset the 15-minute timer each time, so on a phone somebody opens
                // often the job might never actually run.
                ExistingPeriodicWorkPolicy.KEEP,
                request);
    }

    /** Poll once, right now. Used immediately after pairing and after a manual retry. */
    public static void runNow(Context context) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(SmsSyncWorker.class)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build();

        WorkManager.getInstance(context)
                .enqueueUniqueWork(ONE_OFF_WORK, ExistingWorkPolicy.REPLACE, request);
    }

    public static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK);
    }
}
