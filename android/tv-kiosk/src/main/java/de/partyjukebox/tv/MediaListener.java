package de.partyjukebox.tv;

import android.content.ComponentName;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.service.notification.NotificationListenerService;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;

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
        JSONObject j = new JSONObject();
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
                if (t != null) j.put("title", t);
                if (a != null) j.put("sub", a);
            }
        }
        // Signatur ohne Position: nur echte Änderungen (Titel, Zustand, Länge) sofort senden
        String sig = j.optString("pkg") + "|" + j.optString("state") + "|" + j.optString("title") + "|" + j.optLong("dur");
        long nowMs = SystemClock.elapsedRealtime();
        if (sig.equals(lastSig) && nowMs - lastSent < 20000) return;
        if (send(base + "/party/tvmedia", j.toString())) { lastSig = sig; lastSent = nowMs; }
    }

    private static boolean send(String url, String body) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(4000);
            c.setReadTimeout(4000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
            return c.getResponseCode() / 100 == 2;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
