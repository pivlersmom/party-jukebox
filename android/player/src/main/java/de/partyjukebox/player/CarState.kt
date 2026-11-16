package de.partyjukebox.player

import android.content.Context
import android.net.Uri

/*
 * Lernkarte: Läuft Android Auto wirklich gerade im Auto?
 * Die Android-Auto-App ("gearhead") bleibt auf dem Handy oft mit unserer Mediensitzung verbunden – auch zuhause.
 * Darum zählte die App sich als "im Auto" (kein Start-Sound, Auto-Sonderregeln). Android Auto selbst meldet über
 * einen kleinen Datenanbieter, ob gerade eine Projektion aufs Autodisplay läuft (dieselbe Abfrage nutzt Googles
 * CarConnection): 0 = kein Auto, 1 = eingebautes Android-Auto-System, 2 = Handy projiziert ins Auto.
 */
object CarState {
    private val URI: Uri = Uri.parse("content://androidx.car.app.connection")

    /** true/false, oder null wenn Android Auto nicht antwortet (dann alte Zählweise benutzen) */
    fun projecting(ctx: Context): Boolean? = try {
        ctx.contentResolver.query(URI, arrayOf("CarConnectionState"), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getInt(c.getColumnIndexOrThrow("CarConnectionState")) != 0 else false
        }
    } catch (e: Exception) { null }
}
