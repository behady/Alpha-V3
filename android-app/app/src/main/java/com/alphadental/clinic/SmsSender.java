package com.alphadental.clinic;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.telephony.SmsManager;

import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Sends one text message and waits to find out whether it actually left.
 *
 * <p>The waiting is the important part. {@code sendTextMessage} returns
 * immediately and tells you nothing — it hands the message to the radio and
 * walks away. If the app reported success at that point, a clinic with no
 * signal, no credit, or a SIM the carrier has throttled would see a screen full
 * of "Sent" beside patients who were never told anything. So this blocks on the
 * result broadcast Android sends back, and only calls it sent when the network
 * says {@code RESULT_OK}.
 *
 * <p>Long messages are split into parts by the platform. Every part has to
 * succeed: a reminder that arrives with its second half missing is worse than
 * one that never arrives, because nobody knows to resend it.
 */
final class SmsSender {

    /** Result of one send attempt. */
    static final class Result {
        final boolean sent;
        final String error;

        private Result(boolean sent, String error) {
            this.sent = sent;
            this.error = error;
        }

        static Result ok() {
            return new Result(true, null);
        }

        static Result failure(String reason) {
            return new Result(false, reason);
        }
    }

    /**
     * How long to wait for the network to accept a message before giving up on
     * this attempt. Generous: a phone reconnecting to a cell after a night on a
     * shelf can take a while, and a timeout here only means the message returns
     * to the queue for the next poll — nothing is lost.
     */
    private static final long SEND_TIMEOUT_SECONDS = 60;

    private static final String ACTION_SENT = "com.alphadental.clinic.SMS_SENT";

    private SmsSender() {
    }

    static Result send(Context context, String destination, String body, int requestCode) {
        if (destination == null || destination.trim().isEmpty()) {
            return Result.failure("No phone number");
        }
        if (body == null || body.trim().isEmpty()) {
            return Result.failure("Empty message");
        }

        SmsManager smsManager = resolveSmsManager(context);
        if (smsManager == null) {
            return Result.failure("This phone has no SMS service");
        }

        ArrayList<String> parts;
        try {
            parts = smsManager.divideMessage(body);
        } catch (Exception e) {
            return Result.failure("Could not prepare the message: " + e.getMessage());
        }
        if (parts == null || parts.isEmpty()) {
            return Result.failure("Could not prepare the message");
        }

        final CountDownLatch latch = new CountDownLatch(parts.size());
        final AtomicReference<String> failure = new AtomicReference<>(null);
        final String action = ACTION_SENT + "." + requestCode;

        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                int code = getResultCode();
                if (code != android.app.Activity.RESULT_OK) {
                    // First failure wins: it is the one worth reporting back.
                    failure.compareAndSet(null, describe(code));
                }
                latch.countDown();
            }
        };

        // NOT_EXPORTED: the only thing that ever fires this is our own
        // PendingIntent coming back from the telephony service.
        ContextCompat.registerReceiver(
                context.getApplicationContext(), receiver, new IntentFilter(action),
                ContextCompat.RECEIVER_NOT_EXPORTED);

        try {
            ArrayList<PendingIntent> sentIntents = new ArrayList<>(parts.size());
            for (int i = 0; i < parts.size(); i++) {
                Intent intent = new Intent(action).setPackage(context.getPackageName());
                sentIntents.add(PendingIntent.getBroadcast(
                        context.getApplicationContext(),
                        requestCode * 100 + i,
                        intent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            }

            if (parts.size() == 1) {
                smsManager.sendTextMessage(destination, null, parts.get(0), sentIntents.get(0), null);
            } else {
                smsManager.sendMultipartTextMessage(destination, null, parts, sentIntents, null);
            }

            if (!latch.await(SEND_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                return Result.failure("The phone did not confirm the message was sent");
            }

            String reason = failure.get();
            return reason == null ? Result.ok() : Result.failure(reason);
        } catch (SecurityException e) {
            return Result.failure("Permission to send text messages was refused");
        } catch (Exception e) {
            return Result.failure(e.getMessage() == null ? "Send failed" : e.getMessage());
        } finally {
            try {
                context.getApplicationContext().unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
                // Already gone; nothing to clean up.
            }
        }
    }

    /**
     * The SmsManager for the SIM the user chose as their default for messages.
     * On a dual-SIM phone the deprecated static {@code SmsManager.getDefault()}
     * can pick the wrong slot, which sends the clinic's reminders off the wrong
     * SIM — and the wrong bill.
     */
    private static SmsManager resolveSmsManager(Context context) {
        try {
            SmsManager fromSystem = context.getSystemService(SmsManager.class);
            if (fromSystem != null) {
                return fromSystem;
            }
        } catch (Exception ignored) {
            // Fall through to the older accessor below.
        }
        try {
            return SmsManager.getDefault();
        } catch (Exception e) {
            return null;
        }
    }

    /** Turn Android's numeric failure codes into something a clinic can act on. */
    private static String describe(int resultCode) {
        switch (resultCode) {
            case SmsManager.RESULT_ERROR_NO_SERVICE:
                return "No mobile signal when the message was sent";
            case SmsManager.RESULT_ERROR_RADIO_OFF:
                return "The phone's mobile radio was off (flight mode?)";
            case SmsManager.RESULT_ERROR_NULL_PDU:
                return "The phone rejected the message format";
            case SmsManager.RESULT_ERROR_LIMIT_EXCEEDED:
                return "The phone hit its limit on messages sent — the carrier may be throttling this SIM";
            case SmsManager.RESULT_ERROR_GENERIC_FAILURE:
                return "The network refused the message (out of credit, or the number is blocked)";
            default:
                return "The phone could not send this message (code " + resultCode + ")";
        }
    }
}
