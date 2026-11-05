package de.partyjukebox.player;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import android.webkit.CookieManager;

import org.json.JSONObject;

import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Wo ist die Jukebox erreichbar?
 *  - Zuhause: direkt über das Add-on (Port 8099).
 *  - Unterwegs: über Nabu Casa → Home Assistant → Ingress des Add-ons (Sitzung mit dem HA-Token).
 * Blockierende Aufrufe – nur außerhalb des Haupt-Threads verwenden.
 */
final class Endpoint {
    private static final String TAG = "JukeboxEp";
    /** letzter Fehler unterwegs (für die Meldung in der App) */
    static volatile String lastError = "";
    /*
     * Lernkarte: Adressen nicht im Code
     * Zuhause-Adresse (Add-on, Port 8099) und Adresse für unterwegs (z. B. Nabu Casa) werden in der App eingerichtet
     * und nur auf dem Handy gespeichert. Ein Build kann Vorgaben mitbringen (BuildConfig, aus GitHub-Secrets) –
     * im Quellcode steht keine Adresse.
     */
    static volatile String LOCAL = BuildConfig.DEFAULT_HOME_URL;
    static volatile String HA_REMOTE = BuildConfig.DEFAULT_REMOTE_URL;
    private static volatile boolean loaded = false;
    static final String SLUG = "924d7a47_party_jukebox";
    private static final String PREFS = "vanpis";   // Name historisch, bleibt für bestehende Installationen

    static volatile String base = LOCAL;
    static volatile boolean remote = false;
    private static volatile String session = "";
    private static volatile long sessionAt = 0;
    private static volatile long resolvedAt = 0;

    private Endpoint() { }

    static SharedPreferences prefs(Context c) {
        SharedPreferences p = c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!loaded) {   // gespeicherte Adressen haben Vorrang vor den Vorgaben des Builds
            loaded = true;
            String h = p.getString("home_url", ""), r = p.getString("remote_url", "");
            // einmalig: früher fest eingebaute Adressen übernehmen (nur private Version)
            if ((h == null || h.isEmpty()) && (r == null || r.isEmpty()) && !Legacy.HOME.isEmpty()) {
                h = Legacy.HOME; r = Legacy.REMOTE;
                p.edit().putString("home_url", h).putString("remote_url", r).apply();
            }
            if (h != null && !h.isEmpty()) LOCAL = h;
            if (r != null && !r.isEmpty()) HA_REMOTE = r;
            if (!remote) base = LOCAL;
        }
        return p;
    }

    /** Ist überhaupt eine Adresse eingerichtet? */
    static boolean configured(Context c) { prefs(c); return !LOCAL.isEmpty() || !HA_REMOTE.isEmpty(); }

    /** "192.168.1.10" → "http://192.168.1.10:8099/" */
    static String normHome(String s) {
        s = s == null ? "" : s.trim();
        if (s.isEmpty()) return "";
        if (!s.contains("://")) s = "http://" + s;
        String rest = s.substring(s.indexOf("://") + 3);
        String hostPort = rest.contains("/") ? rest.substring(0, rest.indexOf('/')) : rest;
        if (!hostPort.contains(":")) s = s.replaceFirst(java.util.regex.Pattern.quote(hostPort), hostPort + ":8099");
        return s.endsWith("/") ? s : s + "/";
    }

    /** "abc.ui.nabu.casa" → "https://abc.ui.nabu.casa" (ohne / am Ende) */
    static String normRemote(String s) {
        s = s == null ? "" : s.trim();
        if (s.isEmpty()) return "";
        if (!s.contains("://")) s = "https://" + s;
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    static void setAddresses(Context c, String home, String remoteUrl) {
        String h = normHome(home), r = normRemote(remoteUrl);
        prefs(c).edit().putString("home_url", h).putString("remote_url", r).apply();
        LOCAL = h; HA_REMOTE = r; base = h; remote = false; resolvedAt = 0;
    }

    /** HA-Token: aus dem Build (GitHub-Secret) oder in der App eingegeben. */
    static String token(Context c) {
        String t = prefs(c).getString("ha_token", "");
        if (t != null && !t.isEmpty()) return t;
        return BuildConfig.HA_TOKEN == null ? "" : BuildConfig.HA_TOKEN;
    }

    static void setToken(Context c, String t) { prefs(c).edit().putString("ha_token", t == null ? "" : t.trim()).apply(); }

    /** Cookie-Kopfzeile für Anfragen an die aktuelle Adresse (Ingress-Sitzung bzw. Gastgeber-PIN). */
    static String cookie() {
        if (remote) return "ingress_session=" + session;
        if (LOCAL.isEmpty()) return "";
        try { String c = CookieManager.getInstance().getCookie(LOCAL); return c == null ? "" : c; }
        catch (Exception e) { return ""; }
    }

    static String jukeboxUrl() { return base + "jukebox.html"; }

    /** Ergebnis: "local", "remote", "token" (HA-Token fehlt/ungültig) oder "offline". */
    static synchronized String resolve(Context c, boolean force) {
        prefs(c);
        if (!force && System.currentTimeMillis() - resolvedAt < 20000) return remote ? "remote" : "local";
        if (!LOCAL.isEmpty() && reachable(LOCAL + "config.js", 1800)) {
            base = LOCAL; remote = false; resolvedAt = System.currentTimeMillis();
            Log.i(TAG, "Jukebox zuhause erreichbar");
            return "local";
        }
        if (HA_REMOTE.isEmpty()) return "offline";   // keine Adresse für unterwegs eingerichtet
        String tok = token(c);
        if (tok.isEmpty()) return "token";
        try {
            /*
             * Lernkarte: Wie die HA-Oberfläche selbst
             * Die REST-Abkürzungen (/api/hassio/...) sperrt Home Assistant teilweise. Die eigene HA-Oberfläche
             * fragt Add-on-Adresse und Ingress-Sitzung über den WebSocket an ("supervisor/api") – das machen wir auch.
             * Die Adresse wird nur auf dem Handy gemerkt, nie im Code.
             */
            JSONObject[] r = supervisor(tok, new String[][]{
                {"/addons/" + SLUG + "/info", "get"}, {"/ingress/session", "post"}});
            String entry = r[0].optString("ingress_entry", "");
            if (entry.isEmpty()) { lastError = "Add-on ohne Ingress"; return "offline"; }
            JSONObject s = new JSONObject().put("data", r[1]);
            lastError = "";
            session = s.getJSONObject("data").getString("session");
            sessionAt = System.currentTimeMillis();
            base = HA_REMOTE + entry + "/";
            remote = true; resolvedAt = System.currentTimeMillis();
            try {
                CookieManager cm = CookieManager.getInstance();
                cm.setCookie(HA_REMOTE, "ingress_session=" + session + "; path=/; Secure");
                cm.flush();
            } catch (Exception ignored) { }
            Log.i(TAG, "Jukebox unterwegs über Nabu Casa");
            return "remote";
        } catch (SecurityException e) {
            lastError = "Home Assistant lehnt das Token ab (" + e.getMessage() + "). Es muss von einem Administrator-Benutzer stammen.";
            return "token";
        } catch (Exception e) {
            Log.w(TAG, "Nabu Casa: " + e);
            lastError = String.valueOf(e.getMessage());
            return "offline";
        }
    }

    /** Ingress-Sitzung am Leben halten (HA beendet sie sonst nach 15 Minuten). */
    static void keepAlive(Context c) {
        if (!remote || System.currentTimeMillis() - sessionAt < 4 * 60 * 1000) return;
        try {
            supervisor(token(c), new String[][]{{"/ingress/validate_session", "post", "{\"session\":\"" + session + "\"}"}});
            sessionAt = System.currentTimeMillis();
        } catch (Exception e) {
            Log.w(TAG, "Sitzung abgelaufen – neu anmelden: " + e);
            resolve(c, true);
        }
    }

    static void keepAliveAsync(Context c) {
        if (!remote || System.currentTimeMillis() - sessionAt < 4 * 60 * 1000) return;
        new Thread(() -> keepAlive(c)).start();
    }

    static boolean reachable(String url, int ms) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(ms); c.setReadTimeout(ms);
            int code = c.getResponseCode();
            c.disconnect();
            return code > 0 && code < 500;
        } catch (Exception e) { return false; }
    }

    /**
     * Supervisor-Befehle über den HA-WebSocket (wie die HA-Oberfläche): anmelden, Befehle nacheinander, Ergebnisse zurück.
     * cmds: {endpoint, method[, json-daten]}. Wirft SecurityException bei falschem Token / fehlenden Admin-Rechten.
     */
    static JSONObject[] supervisor(String tok, String[][] cmds) throws Exception {
        final LinkedBlockingQueue<String> in = new LinkedBlockingQueue<>();
        okhttp3.OkHttpClient http = new okhttp3.OkHttpClient.Builder().readTimeout(15, TimeUnit.SECONDS).build();
        okhttp3.Request rq = new okhttp3.Request.Builder().url(HA_REMOTE.replaceFirst("https://", "wss://") + "/api/websocket").build();
        okhttp3.WebSocket ws = http.newWebSocket(rq, new okhttp3.WebSocketListener() {
            @Override public void onMessage(okhttp3.WebSocket w, String t) { in.offer(t); }
            @Override public void onFailure(okhttp3.WebSocket w, Throwable t, okhttp3.Response r) { in.offer("{\"type\":\"_fail\",\"msg\":" + JSONObject.quote(String.valueOf(t)) + "}"); }
        });
        try {
            JSONObject m = next(in);                                   // auth_required
            ws.send(new JSONObject().put("type", "auth").put("access_token", tok).toString());
            m = next(in);
            if (!"auth_ok".equals(m.optString("type"))) throw new SecurityException("Anmeldung: " + m.optString("type"));
            JSONObject[] out = new JSONObject[cmds.length];
            for (int i = 0; i < cmds.length; i++) {
                JSONObject q = new JSONObject().put("id", i + 1).put("type", "supervisor/api").put("endpoint", cmds[i][0]).put("method", cmds[i][1]);
                if (cmds[i].length > 2) q.put("data", new JSONObject(cmds[i][2]));
                ws.send(q.toString());
                while (true) {
                    m = next(in);
                    if (m.optInt("id") != i + 1) continue;
                    if (!m.optBoolean("success")) {
                        JSONObject e = m.optJSONObject("error");
                        String code = e == null ? "" : e.optString("code");
                        if ("unauthorized".equals(code)) throw new SecurityException("keine Admin-Rechte");
                        throw new Exception("HA: " + (e == null ? m.toString() : e.optString("message")));
                    }
                    Object res = m.opt("result");
                    out[i] = res instanceof JSONObject ? (JSONObject) res : new JSONObject();
                    break;
                }
            }
            return out;
        } finally { ws.close(1000, "fertig"); }
    }

    private static JSONObject next(LinkedBlockingQueue<String> in) throws Exception {
        String t = in.poll(15, TimeUnit.SECONDS);
        if (t == null) throw new Exception("Nabu Casa antwortet nicht");
        JSONObject m = new JSONObject(t);
        if ("_fail".equals(m.optString("type"))) throw new Exception("Verbindung: " + m.optString("msg"));
        return m;
    }

    private static JSONObject req(String method, String url, String tok, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(8000); c.setReadTimeout(10000);
        c.setRequestProperty("Authorization", "Bearer " + tok);
        c.setRequestProperty("Content-Type", "application/json");
        if (body != null) {
            c.setDoOutput(true);
            OutputStream os = c.getOutputStream(); os.write(body.getBytes("UTF-8")); os.close();
        }
        int code = c.getResponseCode();
        if (code == 401 || code == 403) { c.disconnect(); throw new SecurityException("HTTP " + code); }
        InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
        StringBuilder sb = new StringBuilder();
        if (in != null) {
            BufferedReader br = new BufferedReader(new InputStreamReader(in, "UTF-8"));
            String l; while ((l = br.readLine()) != null) sb.append(l);
            br.close();
        }
        c.disconnect();
        if (code >= 400) throw new Exception("HTTP " + code + " " + sb);
        return new JSONObject(sb.length() == 0 ? "{}" : sb.toString());
    }
}
