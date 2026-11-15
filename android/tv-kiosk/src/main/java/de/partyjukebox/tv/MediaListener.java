package de.partyjukebox.tv;

import android.content.ComponentName;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.content.pm.PackageManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.service.notification.NotificationListenerService;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.json.JSONArray;

/*
 * Lernkarte: Was läuft gerade auf der TV-Box (HBO Max, Netflix, MagentaTV …)?
 * Android verrät die laufenden Mediensitzungen nur Apps mit "Zugriff auf Benachrichtigungen".
 * Dafür muss die App einen NotificationListenerService haben – diesen hier. Die Berechtigung
 * wird einmalig per ADB erteilt:  cmd notification allow_listener de.partyjukebox.tv/.MediaListener
 * Danach hält Android den Dienst am Leben (auch wenn die Anzeige nicht offen ist) und wir dürfen
 * jede Sitzung fragen: Titel, Gesamtlänge (DURATION), Position und ob sie spielt.
 * Alle 3 Sekunden wird geschaut; ans Add-on geschickt wird nur bei Änderung oder alle 20 Sekunden.
 */
public class MediaListener extends NotificationListenerService {

    private HandlerThread thread;
    private Handler h;
    private String lastSig = "";
    private long lastSent = 0;
    private String lastArtKey = null;
    private volatile MediaController current;
    private volatile boolean running;
    private Thread cmdThread;

    private final Runnable loop = new Runnable() {
        @Override
        public void run() {
            try { check(); } catch (Throwable ignored) { }
            if (h != null) h.postDelayed(this, 3000);
        }
    };

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        if (thread != null) return;
        thread = new HandlerThread("pj-media");
        thread.start();
        h = new Handler(thread.getLooper());
        h.post(loop);
        running = true;
        cmdThread = new Thread(this::cmdLoop, "pj-cmd");
        cmdThread.start();
    }

    /*
     * Lernkarte: Befehle vom Add-on (z. B. Spulen) holt die App per "Long-Poll" ab:
     * Sie fragt /party/tvcmd, das Add-on hält die Anfrage bis zu 25 s offen und antwortet sofort,
     * sobald jemand in der Jukebox am Balken zieht. So braucht die Box keinen eigenen Server.
     */
    private void cmdLoop() {
        while (running) {
            String base = ServerAddress.get(this);
            if (base.isEmpty()) { sleep(10000); continue; }
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(base + "/party/tvcmd").openConnection();
                c.setConnectTimeout(5000);
                c.setReadTimeout(35000);
                if (c.getResponseCode() / 100 != 2) { sleep(10000); continue; }
                JSONArray cmds = new JSONObject(readAll(c.getInputStream())).optJSONArray("cmds");
                if (cmds != null) for (int i = 0; i < cmds.length(); i++) run(cmds.optJSONObject(i));
            } catch (Exception e) {
                sleep(5000);
            } finally {
                if (c != null) c.disconnect();
            }
        }
    }

    private void run(JSONObject cmd) {
        MediaController mc = current;
        if (cmd == null || mc == null) return;
        MediaController.TransportControls tc = mc.getTransportControls();
        String a = cmd.optString("a");
        if ("seek".equals(a)) tc.seekTo(Math.max(0, cmd.optLong("pos")));
        else if ("play".equals(a)) tc.play();
        else if ("pause".equals(a)) tc.pause();
        lastSig = "";   // neuen Stand gleich melden
        if (h != null) { h.removeCallbacks(loop); h.postDelayed(loop, 800); }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) { }
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] b = new byte[4096];
        int n;
        while ((n = in.read(b)) > 0) o.write(b, 0, n);
        in.close();
        return o.toString("UTF-8");
    }

    @Override
    public void onListenerDisconnected() {
        stopLoop();
        super.onListenerDisconnected();
    }

    @Override
    public void onDestroy() {
        stopLoop();
        super.onDestroy();
    }

    private void stopLoop() {
        running = false;
        if (cmdThread != null) cmdThread.interrupt();
        cmdThread = null;
        if (h != null) h.removeCallbacksAndMessages(null);
        if (thread != null) thread.quitSafely();
        h = null;
        thread = null;
    }

    /** Spielende Sitzung bevorzugen, sonst eine pausierte; die eigene App und Bluetooth ignorieren. */
    private void check() throws Exception {
        String base = ServerAddress.get(this);
        if (base.isEmpty()) return;
        MediaSessionManager msm = (MediaSessionManager) getSystemService(MEDIA_SESSION_SERVICE);
        if (msm == null) return;
        List<MediaController> list = msm.getActiveSessions(new ComponentName(this, MediaListener.class));
        MediaController best = null;
        int bestRank = 0;
        for (MediaController c : list) {
            String pkg = c.getPackageName();
            if (pkg == null || pkg.equals(getPackageName()) || pkg.startsWith("com.android.bluetooth")) continue;
            PlaybackState ps = c.getPlaybackState();
            int st = ps == null ? 0 : ps.getState();
            int rank = st == PlaybackState.STATE_PLAYING ? 3 : (st == PlaybackState.STATE_BUFFERING ? 2 : (st == PlaybackState.STATE_PAUSED ? 1 : 0));
            if (rank > bestRank) { bestRank = rank; best = c; }
        }
        current = best;
        JSONObject j = new JSONObject();
        Bitmap art = null;
        String artUri = null;
        if (best != null) {
            PlaybackState ps = best.getPlaybackState();
            MediaMetadata md = best.getMetadata();
            long pos = ps.getPosition();
            float speed = ps.getPlaybackSpeed();
            // Position auf "jetzt" hochrechnen (Android meldet sie nur bei Änderungen neu)
            if (ps.getState() == PlaybackState.STATE_PLAYING && ps.getLastPositionUpdateTime() > 0) {
                pos += (long) ((SystemClock.elapsedRealtime() - ps.getLastPositionUpdateTime()) * speed);
            }
            j.put("pkg", best.getPackageName());
            j.put("state", ps.getState() == PlaybackState.STATE_PLAYING ? "playing" : (ps.getState() == PlaybackState.STATE_PAUSED ? "paused" : "buffering"));
            j.put("pos", Math.max(0, pos));
            j.put("speed", speed);
            if (md != null) {
                j.put("dur", Math.max(0, md.getLong(MediaMetadata.METADATA_KEY_DURATION)));
                String t = md.getString(MediaMetadata.METADATA_KEY_TITLE);
                if (t == null && md.getDescription() != null && md.getDescription().getTitle() != null) t = md.getDescription().getTitle().toString();
                String a = md.getString(MediaMetadata.METADATA_KEY_ARTIST);
                if (a == null && md.getDescription() != null && md.getDescription().getSubtitle() != null) a = md.getDescription().getSubtitle().toString();
                // Alle Metadaten mitschicken (Text kurz, Zahlen) – manche Apps (Prime Video) legen Titel/Länge in andere Felder
                JSONObject meta = new JSONObject();
                for (String k : md.keySet()) {
                    String n = k.replace("android.media.metadata.", "");
                    try {
                        CharSequence cs = md.getText(k);
                        if (cs != null) { String v = cs.toString(); meta.put(n, v.length() > 120 ? v.substring(0, 120) : v); continue; }
                    } catch (Exception ignored) { }
                    try { long v = md.getLong(k); if (v != 0) meta.put(n, v); } catch (Exception ignored) { }
                }
                j.put("meta", meta);
                if (t != null) j.put("title", t);
                if (a != null) j.put("sub", a);
                // Bild der Sendung: Poster/Cover als Bitmap oder als Adresse
                art = md.getBitmap(MediaMetadata.METADATA_KEY_ART);
                if (art == null) art = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
                if (art == null) art = md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
                for (String k : new String[]{MediaMetadata.METADATA_KEY_ART_URI, MediaMetadata.METADATA_KEY_ALBUM_ART_URI, MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI}) {
                    String u = md.getString(k);
                    if (artUri == null && u != null && u.startsWith("http")) artUri = u;
                }
            }
        }
        // Signatur ohne Position: nur echte Änderungen (Titel, Zustand, Länge) sofort senden
        String sig = j.optString("pkg") + "|" + j.optString("state") + "|" + j.optString("title") + "|" + j.optLong("dur");
        long nowMs = SystemClock.elapsedRealtime();
        if (sig.equals(lastSig) && nowMs - lastSent < 20000) return;
        String r = send(base + "/party/tvmedia", j.toString());
        if (r != null) {
            lastSig = sig; lastSent = nowMs;
            if (r.contains("\"needArt\": true")) lastArtKey = null;   // Add-on hat kein Bild (z. B. nach Neustart) → nochmal schicken
        }
        // Bild nur bei neuem Titel schicken
        String key = j.optString("title");
        if (best != null && !key.equals(lastArtKey)) {
            byte[] img = null;
            boolean icon = false;
            if (art != null) img = jpeg(art);
            else if (artUri != null) img = download(artUri);
            if (img == null) {   // App liefert kein Bild (z. B. Disney+) → Banner bzw. Symbol der App selbst
                Bitmap b = appImage(best.getPackageName());
                if (b != null) { img = png(b); icon = true; }
            }
            if (img == null || sendArt(base + "/party/tvart", img, key, icon)) lastArtKey = key;
        }
    }

    /** TV-Banner der App (das breite Bild im Startmenü), sonst ihr Symbol. */
    private Bitmap appImage(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            Drawable d = pm.getApplicationBanner(pkg);
            if (d == null) d = pm.getApplicationIcon(pkg);
            if (d instanceof BitmapDrawable && ((BitmapDrawable) d).getBitmap() != null) return ((BitmapDrawable) d).getBitmap();
            int w = Math.max(1, Math.min(640, d.getIntrinsicWidth() > 0 ? d.getIntrinsicWidth() : 320));
            int hh = Math.max(1, Math.min(640, d.getIntrinsicHeight() > 0 ? d.getIntrinsicHeight() : 180));
            Bitmap b = Bitmap.createBitmap(w, hh, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(b);
            d.setBounds(0, 0, w, hh);
            d.draw(c);
            return b;
        } catch (Exception e) {
            return null;
        }
    }

    /** PNG behält die Transparenz von App-Symbolen. */
    private static byte[] png(Bitmap b) {
        int w = b.getWidth(), hh = b.getHeight(), m = Math.max(w, hh);
        Bitmap s = m > 640 ? Bitmap.createScaledBitmap(b, w * 640 / m, hh * 640 / m, true) : b;
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        s.compress(Bitmap.CompressFormat.PNG, 100, o);
        return o.toByteArray();
    }

    /** Bild verkleinern (max. 600 px) und als JPEG verpacken. */
    private static byte[] jpeg(Bitmap b) {
        int w = b.getWidth(), hh = b.getHeight(), m = Math.max(w, hh);
        Bitmap s = m > 600 ? Bitmap.createScaledBitmap(b, w * 600 / m, hh * 600 / m, true) : b;
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        s.compress(Bitmap.CompressFormat.JPEG, 82, o);
        return o.toByteArray();
    }

    private static byte[] download(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(5000);
            c.setReadTimeout(8000);
            Bitmap b = BitmapFactory.decodeStream(c.getInputStream());
            return b == null ? null : jpeg(b);
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static boolean sendArt(String url, byte[] img, String key, boolean icon) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(4000);
            c.setReadTimeout(8000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", icon ? "image/png" : "image/jpeg");
            if (icon) c.setRequestProperty("X-Kind", "icon");
            c.setRequestProperty("X-Key", java.net.URLEncoder.encode(key, "UTF-8"));
            try (OutputStream o = c.getOutputStream()) { o.write(img); }
            return c.getResponseCode() / 100 == 2;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Schickt JSON, liefert die Antwort (oder null bei Fehler). */
    private static String send(String url, String body) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(4000);
            c.setReadTimeout(4000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
            return c.getResponseCode() / 100 == 2 ? readAll(c.getInputStream()) : null;
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
