package com.alphadental.clinic;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * The three calls this phone makes to the clinic system.
 *
 * <p>Plain {@link HttpURLConnection} on purpose — adding a networking library to
 * pull three small JSON documents would be more dependency than the job needs,
 * and this runs on a background thread where blocking calls are fine.
 */
final class SmsApi {

    /** One message the server wants this phone to send. */
    static final class OutboxMessage {
        final String id;
        final String to;
        final String text;

        OutboxMessage(String id, String to, String text) {
            this.id = id;
            this.to = to;
            this.text = text;
        }
    }

    /** What happened when this phone tried to send one message. */
    static final class Ack {
        final String id;
        final boolean sent;
        final String error;

        Ack(String id, boolean sent, String error) {
            this.id = id;
            this.sent = sent;
            this.error = error;
        }
    }

    static final class ApiException extends Exception {
        /** True when the server says this phone is no longer a valid sender. */
        final boolean unauthorized;

        ApiException(String message, boolean unauthorized) {
            super(message);
            this.unauthorized = unauthorized;
        }
    }

    private static final int CONNECT_TIMEOUT_MS = 20000;
    private static final int READ_TIMEOUT_MS = 30000;

    private SmsApi() {
    }

    /** Exchange a pairing code for this phone's long-lived token. */
    static void pair(Context context, String code, String deviceName) throws ApiException {
        JSONObject body = new JSONObject();
        try {
            body.put("code", code);
            body.put("deviceName", deviceName);
            body.put("platform", "android");
        } catch (Exception e) {
            throw new ApiException("Could not build the pairing request", false);
        }

        JSONObject response = request(SmsConfig.endpoint("api/sms/pair"), "POST", null, body);
        String token = response.optString("token", "");
        if (token.isEmpty()) {
            throw new ApiException("The server did not return a token", false);
        }

        SmsConfig.savePairing(context, token, response.optString("deviceId", ""), response.optString("clinicId", ""));
    }

    /** Claim the next batch of messages waiting for this phone. */
    static List<OutboxMessage> claim(Context context) throws ApiException {
        JSONObject response = request(SmsConfig.endpoint("api/sms/outbox"), "GET", SmsConfig.token(context), null);

        List<OutboxMessage> out = new ArrayList<>();
        JSONArray messages = response.optJSONArray("messages");
        if (messages == null) {
            return out;
        }
        for (int i = 0; i < messages.length(); i++) {
            JSONObject item = messages.optJSONObject(i);
            if (item == null) {
                continue;
            }
            String id = item.optString("id", "");
            if (!id.isEmpty()) {
                out.add(new OutboxMessage(id, item.optString("to", ""), item.optString("text", "")));
            }
        }
        return out;
    }

    /** Report back which messages actually went out, and why the rest did not. */
    static void acknowledge(Context context, List<Ack> acks) throws ApiException {
        if (acks.isEmpty()) {
            return;
        }

        JSONObject body = new JSONObject();
        try {
            JSONArray results = new JSONArray();
            for (Ack ack : acks) {
                JSONObject item = new JSONObject();
                item.put("id", ack.id);
                item.put("sent", ack.sent);
                if (ack.error != null) {
                    item.put("error", ack.error);
                }
                results.put(item);
            }
            body.put("results", results);
        } catch (Exception e) {
            throw new ApiException("Could not build the report", false);
        }

        request(SmsConfig.endpoint("api/sms/outbox"), "POST", SmsConfig.token(context), body);
    }

    private static JSONObject request(String url, String method, String token, JSONObject body) throws ApiException {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/json");
            if (token != null && !token.isEmpty()) {
                connection.setRequestProperty("Authorization", "Bearer " + token);
            }

            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
            }

            int status = connection.getResponseCode();
            String payload = readAll(status >= 400 ? connection.getErrorStream() : connection.getInputStream());

            JSONObject json;
            try {
                json = payload.isEmpty() ? new JSONObject() : new JSONObject(payload);
            } catch (Exception e) {
                // An HTML error page from a proxy or a cold start, not our API.
                throw new ApiException("The clinic system did not answer properly", false);
            }

            if (status == 401 || status == 403) {
                throw new ApiException(json.optString("error", "This phone is no longer paired"), true);
            }
            if (status >= 400 || !json.optBoolean("ok", false)) {
                throw new ApiException(json.optString("error", "Request failed (" + status + ")"), false);
            }

            return json;
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(e.getMessage() == null ? "No connection" : e.getMessage(), false);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String readAll(InputStream stream) {
        if (stream == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        } catch (Exception ignored) {
            // A truncated body is handled by the JSON parse above.
        }
        return builder.toString();
    }
}
