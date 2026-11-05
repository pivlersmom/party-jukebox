package de.partyjukebox.player;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

/**
 * Das Handy als dauerhafter Music-Assistant-Lautsprecher.
 * Seit 3.1: eigener Sendspin-Player (SendspinPlayer.kt) – ohne MA-App und ohne Webseite,
 * am Leben gehalten vom Vordergrund-Dienst (KeepAliveService.kt).
 */
final class PhonePlayer {
    private static final Handler h = new Handler(Looper.getMainLooper());

    private PhonePlayer() { }

    static boolean enabled(Context c) { return Endpoint.prefs(c).getBoolean("phone_player", false); }

    static void setEnabled(Context c, boolean on) {
        Endpoint.prefs(c).edit().putBoolean("phone_player", on).apply();
        h.post(() -> KeepAliveService.sync(c));  // Vordergrund-Dienst startet/stoppt den Player
    }

    /** Player-ID in Music Assistant (MA verpackt den Sendspin-Player, z. B. "upca11908e") */
    static String playerId(Context c) {
        String id = Endpoint.prefs(c).getString("phone_pid", "");
        return id == null || id.isEmpty() || !enabled(c) ? "" : id;
    }

    /** für die Seite: erst gesetzt, wenn MA den Player angenommen hat */
    static String connectedId(Context c) { return SendspinPlayer.isConnected() ? playerId(c) : ""; }

    static void start(Context c) { SendspinPlayer.start(c); }

    static void stop() { SendspinPlayer.stop(); }
}
