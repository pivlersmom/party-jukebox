package de.partyjukebox.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/** Startet die TV-Anzeige nach dem Einschalten der Box – nur wenn in der Einrichtung aktiviert. */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (action == null) return;
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)
                && !"com.htc.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }
        if (!ServerAddress.autostart(context) || ServerAddress.get(context).isEmpty()) return;
        try {
            Intent start = new Intent(context, MainActivity.class);
            start.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            context.startActivity(start);
        } catch (Exception e) {
            // Ab Android 10 ohne "Über anderen Apps einblenden" blockiert – kein Absturz
            Log.w("PartyJukeboxTV", "Autostart nicht möglich", e);
        }
    }
}
