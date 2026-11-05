package de.partyjukebox.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Nach einem App-Update oder Neustart des Handys: Handy-Player wieder starten,
 * ohne dass man die App erst öffnen muss.
 */
class StartReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        Updater.cleanup(c)   // installierte Update-Datei wieder löschen
        if (!PhonePlayer.enabled(c)) return
        KeepAliveService.sync(c)
        PhonePlayer.start(c)
    }
}
