package de.partyjukebox.player;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Merkt sich den letzten Absturz (Zeit, Thread, Stacktrace), damit die Seite ihn beim nächsten Start
 * über AndroidMediaSession.getLastCrash() abholen und nach Home Assistant (input_text.jukebox_diagnose) schreiben kann.
 */
final class CrashLog {
    private static final String PREFS = "vanpis_crash";
    private static final String KEY = "last";
    private static volatile boolean installed = false;

    private CrashLog() { }

    static synchronized void install(Context ctx) {
        if (installed) return;
        installed = true;
        final Context app = ctx.getApplicationContext();
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            try {
                StringWriter sw = new StringWriter();
                e.printStackTrace(new PrintWriter(sw));
                String st = sw.toString();
                if (st.length() > 3000) st = st.substring(0, 3000);
                String when = new SimpleDateFormat("dd.MM. HH:mm:ss", Locale.GERMANY).format(new Date());
                app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                        .putString(KEY, when + " [" + t.getName() + "] " + st).commit();
                    // auch ins Fern-Log (wird beim nächsten Start mitgeschickt)
                    try { AppLog.INSTANCE.add("⚠ Absturz [" + t.getName() + "] " + st.substring(0, Math.min(600, st.length())).replace('\n', ' ')); } catch (Throwable ignored) { }
            } catch (Throwable ignored) { }
            if (prev != null) prev.uncaughtException(t, e);
        });
    }

    /** Letzten Absturz holen und löschen (leer = keiner). */
    static String take(Context ctx) {
        SharedPreferences p = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String s = p.getString(KEY, "");
        if (!s.isEmpty()) p.edit().remove(KEY).apply();
        return s;
    }
}
