package de.partyjukebox.player;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class PermissionReceiver extends BroadcastReceiver {
    // Token kommt aus local.properties (ha.token=…) bzw. dem GitHub-Secret HA_TOKEN – nicht im Quellcode

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getStringExtra("action");
        String deviceId = intent.getStringExtra("device_id");
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (deviceId != null) nm.cancel(deviceId.hashCode());
        // Home Assistant zuhause: gleicher Rechner wie das Add-on, Port 8123; Token aus der App
        final String host = Endpoint.LOCAL.replaceFirst("^https?://", "").replaceFirst("[:/].*$", "");
        final String HA_URL = "http://" + host + ":8123";
        final String HA_TOKEN = Endpoint.token(context);
        new Thread(() -> {
            try {
                String value = deviceId + ":" + action;
                URL url = new URL(HA_URL + "/api/services/input_text/set_value");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Authorization", "Bearer " + HA_TOKEN);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                JSONObject body = new JSONObject();
                body.put("entity_id", "input_text.jukeboxerlaubnis");
                body.put("value", value);
                OutputStream os = conn.getOutputStream();
                os.write(body.toString().getBytes());
                os.close();
                conn.getResponseCode();
                conn.disconnect();
            } catch (Exception e) {}
        }).start();
        if (MainActivity.webView != null) {
            MainActivity.webView.post(() ->
                MainActivity.webView.evaluateJavascript(
                    "window.onFcmPermission && window.onFcmPermission('" + action + "','" + deviceId + "');", null));
        }
    }
}
