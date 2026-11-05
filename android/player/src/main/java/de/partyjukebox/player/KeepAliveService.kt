package de.partyjukebox.player

/*
 * ===== Lernkarte: Vordergrund-Dienst =====
 * Android beendet Apps im Hintergrund, um Akku zu sparen. Ausnahme: ein "Vordergrund-Dienst"
 * mit dauerhafter Benachrichtigung. Den brauchen wir nur, wenn das Handy selbst Lautsprecher
 * ist (PhonePlayer) – sonst spielt ja die Box und das Handy darf schlafen.
 */

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class KeepAliveService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null   // niemand verbindet sich direkt

    override fun onCreate() {
        super.onCreate()
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            else startForeground(ID, notification())
        } catch (e: Exception) {
            Log.w("JukeboxKeep", "Vordergrund nicht erlaubt: $e"); stopSelf(); return
        }
        PhonePlayer.start(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() { PhonePlayer.stop(); super.onDestroy() }

    private fun notification(): Notification {
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CH) == null)
                nm.createNotificationChannel(NotificationChannel(CH, "Handy-Player", NotificationManager.IMPORTANCE_MIN))
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CH)
            .setSmallIcon(R.drawable.ic_stat_jukebox)
            .setContentTitle("Handy-Player bereit")
            .setContentText("Das Handy ist als Lautsprecher in Music Assistant verfügbar")
            .setContentIntent(open).setOngoing(true).setSilent(true)
            .build()
    }

    companion object {
        private const val ID = 43
        private const val CH = "vanpis_phone"

        /** Dienst an/aus – passend zum Schalter "Handy als Lautsprecher" */
        @JvmStatic fun sync(c: Context) {
            val i = Intent(c, KeepAliveService::class.java)
            if (PhonePlayer.enabled(c)) {
                try { ContextCompat.startForegroundService(c, i) } catch (e: Exception) { Log.w("JukeboxKeep", "Start: $e") }
            } else c.stopService(i)
        }
    }
}
