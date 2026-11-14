package de.partyjukebox.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/*
 * Lernkarte: App aktualisiert sich selbst
 * 1. Beim Start fragt die App das Add-on: <Adresse>/apk/versions.json – welche Version liegt dort?
 * 2. Ist sie neuer als die installierte: Dialog "Update verfügbar".
 * 3. "Installieren" lädt die APK vom Add-on und übergibt sie dem Android-Installer (PackageInstaller).
 *    Android fragt einmal nach der Erlaubnis "Apps aus dieser Quelle installieren" und dann
 *    wie immer "Möchtest du diese App aktualisieren?".
 * Höchstens alle 6 Stunden nachsehen, damit es nicht nervt.
 */
public final class Updater {
    private static final String ACTION = "de.partyjukebox.tv.INSTALL_STATUS";
    private static long last = 0;
    private static boolean busy = false;

    private Updater() { }

    /** key: Eintrag in versions.json ("jukebox"/"tv"), file: APK-Name im Ordner apk/ */
    public static void check(final Activity a, final String base, final String key, final String file, boolean force) {
        if (base == null || base.isEmpty() || busy) return;
        if (!force && System.currentTimeMillis() - last < 6 * 3600_000L) return;
        last = System.currentTimeMillis();
        new Thread(() -> {
            try {
                JSONObject j = new JSONObject(new String(get(base + "/apk/versions.json"), "UTF-8")).getJSONObject(key);
                long code = j.optLong("code"), mine = myCode(a);
                final String ver = j.optString("version");
                if (code <= mine) return;
                a.runOnUiThread(() -> {
                    if (a.isFinishing()) return;
                    new AlertDialog.Builder(a)
                            .setTitle("Update verfügbar")
                            .setMessage("Version " + ver + " ist da. Jetzt installieren?")
                            .setPositiveButton("Installieren", (d, w) -> install(a, base + "/apk/" + file))
                            .setNegativeButton("Später", null)
                            .show();
                });
            } catch (Exception ignored) { }
        }).start();
    }

    @SuppressWarnings("deprecation")
    private static long myCode(Context c) throws Exception {
        android.content.pm.PackageInfo p = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
        return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
    }

    private static byte[] get(String u) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        c.setConnectTimeout(8000); c.setReadTimeout(30000); c.setUseCaches(false);
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream o = new ByteArrayOutputStream()) {
            byte[] b = new byte[16384]; int n;
            while ((n = in.read(b)) > 0) o.write(b, 0, n);
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            return o.toByteArray();
        } finally { c.disconnect(); }
    }

    private static void install(final Activity a, final String url) {
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
            Toast.makeText(a, "Bitte „Apps aus dieser Quelle installieren“ erlauben, dann zurück", Toast.LENGTH_LONG).show();
            last = 0;   // beim Zurückkommen gleich nochmal fragen
            try { a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName()))); }
            catch (Exception ignored) { }
            return;
        }
        busy = true;
        Toast.makeText(a, "Update wird geladen …", Toast.LENGTH_SHORT).show();
        final Context app = a.getApplicationContext();
        new Thread(() -> {
            try {
                byte[] apk = get(url);
                PackageInstaller pi = app.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                int id = pi.createSession(sp);
                try (PackageInstaller.Session s = pi.openSession(id)) {
                    try (OutputStream o = s.openWrite("app.apk", 0, apk.length)) { o.write(apk); s.fsync(o); }
                    registerReceiver(app);
                    Intent i = new Intent(ACTION).setPackage(app.getPackageName());
                    int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? 0x02000000 /* FLAG_MUTABLE */ : 0);
                    s.commit(PendingIntent.getBroadcast(app, id, i, fl).getIntentSender());
                }
            } catch (Exception e) {
                busy = false;
                a.runOnUiThread(() -> Toast.makeText(app, "Update fehlgeschlagen: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    private static boolean registered = false;
    private static void registerReceiver(Context app) {
        if (registered) return;
        registered = true;
        BroadcastReceiver r = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, -999);
                if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);   // "Möchtest du diese App aktualisieren?"
                    if (confirm != null) { confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); c.startActivity(confirm); }
                    return;
                }
                busy = false;
                if (st != PackageInstaller.STATUS_SUCCESS)
                    Toast.makeText(c, "Update abgebrochen" + (i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) != null
                            ? ": " + i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) : ""), Toast.LENGTH_LONG).show();
            }
        };
        IntentFilter f = new IntentFilter(ACTION);
        if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(r, f, 4 /* RECEIVER_NOT_EXPORTED */);
        else app.registerReceiver(r, f);
    }
}
