package de.partyjukebox.player;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Eigene Verbindung zu Music Assistant über den Add-on-Proxy (ma/ws) – für Android Auto,
 * auch wenn die Jukebox-Seite gerade nicht offen ist. Zuhause direkt, unterwegs über Nabu Casa (Ingress).
 */
final class MaClient {
    interface Cb { void done(Object result, String error); }

    private static final String TAG = "JukeboxMa";
    private static MaClient inst;

    private final Context ctx;
    private final Handler h = new Handler(Looper.getMainLooper());
    private final OkHttpClient http = new OkHttpClient.Builder()
            .pingInterval(25, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS).build();
    private WebSocket ws;
    private boolean ready = false, connecting = false;
    private int seq = 1;
    private final Map<String, Cb> pend = new HashMap<>();
    private final Map<String, JSONArray> partial = new HashMap<>();
    private final Map<String, Cb> partialCb = new HashMap<>();
    private final List<Object[]> waiting = new ArrayList<>();

    static synchronized MaClient get(Context c) {
        if (inst == null) inst = new MaClient(c.getApplicationContext());
        return inst;
    }

    private MaClient(Context c) { ctx = c; }

    /** Befehl senden; Antwort kommt im Haupt-Thread. */
    synchronized void send(String command, JSONObject args, Cb cb) { send(command, args, cb, null, 25000); }

    /** onPartial bekommt bei langen Listen (z. B. Playlist-Titel) schon die ersten Teile. */
    synchronized void send(String command, JSONObject args, Cb cb, Cb onPartial, long timeoutMs) {
        if (ready && ws != null) { doSend(command, args, cb, onPartial, timeoutMs); return; }
        waiting.add(new Object[]{command, args, cb, onPartial, timeoutMs});
        connect();
    }

    private synchronized void connect() {
        if (connecting || ready) return;
        connecting = true;
        new Thread(() -> {
            String r = Endpoint.resolve(ctx, false);
            if (!"local".equals(r) && !"remote".equals(r)) {
                fail("local".equals(r) ? "" : ("token".equals(r) ? "HA-Token fehlt" : "Jukebox nicht erreichbar"));
                return;
            }
            String url = Endpoint.base.replaceFirst("^http", "ws") + "ma/ws";
            Request.Builder rb = new Request.Builder().url(url);
            String ck = Endpoint.cookie();
            if (!ck.isEmpty()) rb.header("Cookie", ck);
            synchronized (MaClient.this) { ws = http.newWebSocket(rb.build(), listener); }
        }).start();
    }

    private void fail(String err) {
        List<Object[]> w;
        synchronized (this) { connecting = false; ready = false; ws = null; w = new ArrayList<>(waiting); waiting.clear(); }
        for (Object[] o : w) post((Cb) o[2], null, err.isEmpty() ? "Keine Verbindung" : err);
        Map<String, Cb> p;
        synchronized (this) { p = new HashMap<>(pend); pend.clear(); partial.clear(); partialCb.clear(); }
        for (Cb cb : p.values()) post(cb, null, "Verbindung getrennt");
    }

    private final WebSocketListener listener = new WebSocketListener() {
        @Override public void onMessage(WebSocket w, String text) {
            try {
                JSONObject o = new JSONObject(text);
                if (o.has("server_id") && !o.has("message_id")) {
                    JSONObject a = new JSONObject().put("token", "addon");
                    w.send(new JSONObject().put("message_id", "auth").put("command", "auth").put("args", a).toString());
                    return;
                }
                String id = o.optString("message_id", "");
                if (id.isEmpty()) return;  // Ereignisse ignorieren
                if ("auth".equals(id)) {
                    List<Object[]> todo;
                    synchronized (MaClient.this) {
                        if (o.has("error_code")) { connecting = false; }
                        ready = !o.has("error_code"); connecting = false;
                        todo = new ArrayList<>(waiting); waiting.clear();
                    }
                    if (!ready) { fail("Anmeldung bei Music Assistant fehlgeschlagen"); return; }
                    for (Object[] t : todo) doSend((String) t[0], (JSONObject) t[1], (Cb) t[2], (Cb) t[3], (Long) t[4]);
                    return;
                }
                if (o.optBoolean("partial", false)) {  // Teil-Ergebnisse (z. B. Playlist-Titel) sammeln
                    JSONArray acc;
                    synchronized (MaClient.this) { acc = partial.get(id); if (acc == null) { acc = new JSONArray(); partial.put(id, acc); } }
                    JSONArray part = o.optJSONArray("result");
                    if (part != null) for (int i = 0; i < part.length(); i++) acc.put(part.get(i));
                    Cb pc; synchronized (MaClient.this) { pc = partialCb.get(id); }
                    if (pc != null) { JSONArray copy = new JSONArray(acc.toString()); post(pc, copy, null); }
                    return;
                }
                Cb cb; JSONArray acc;
                synchronized (MaClient.this) { cb = pend.remove(id); acc = partial.remove(id); partialCb.remove(id); }
                if (cb == null) return;
                if (o.has("error_code")) { post(cb, null, o.optString("details", "Fehler " + o.optString("error_code"))); return; }
                Object res = o.opt("result");
                if (acc != null && res instanceof JSONArray) { JSONArray r2 = (JSONArray) res; for (int i = 0; i < r2.length(); i++) acc.put(r2.get(i)); res = acc; }
                else if (acc != null && res == null) res = acc;
                post(cb, res, null);
            } catch (Exception e) {
                Log.w(TAG, "Nachricht: " + e);
            }
        }
        @Override public void onFailure(WebSocket w, Throwable t, Response r) { Log.w(TAG, "Verbindung: " + t); fail("Verbindung fehlgeschlagen"); }
        @Override public void onClosed(WebSocket w, int code, String reason) { fail("Verbindung getrennt"); }
    };

    private void doSend(String command, JSONObject args, Cb cb, Cb onPartial, long timeoutMs) {
        final String id = String.valueOf(seq++);
        try {
            JSONObject m = new JSONObject().put("message_id", id).put("command", command).put("args", args == null ? new JSONObject() : args);
            synchronized (this) { if (cb != null) pend.put(id, cb); if (onPartial != null) partialCb.put(id, onPartial); }
            if (ws == null || !ws.send(m.toString())) { synchronized (this) { pend.remove(id); } post(cb, null, "Nicht verbunden"); return; }
            h.postDelayed(() -> { Cb c; JSONArray acc; synchronized (MaClient.this) { c = pend.remove(id); acc = partial.remove(id); partialCb.remove(id); }
                if (c != null) { if (acc != null && acc.length() > 0) c.done(acc, null); else c.done(null, "Zeitüberschreitung"); } }, timeoutMs);
        } catch (Exception e) { post(cb, null, e.toString()); }
    }

    private void post(Cb cb, Object res, String err) { if (cb != null) h.post(() -> cb.done(res, err)); }

    /** Verbindung neu aufbauen (z. B. nach Wechsel zwischen WLAN und Mobilfunk). */
    synchronized void reset() {
        try { if (ws != null) ws.close(1000, "reset"); } catch (Exception ignored) { }
        ws = null; ready = false; connecting = false;
    }
}
