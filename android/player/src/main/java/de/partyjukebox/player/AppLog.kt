package de.partyjukebox.player

import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/*
 * Lernkarte: Fern-Log für die Fehlersuche
 * Wichtige Ereignisse des Handy-Players (Verbinden, Abbrüche, Netzwechsel, Aussetzer …) werden gesammelt
 * und alle 30 s an das Jukebox-Add-on geschickt. Dort landen sie im Add-on-Protokoll von Home Assistant –
 * so kann man auch unterwegs nachlesen, was passiert ist. Klappt das Senden nicht (Funkloch), bleiben die
 * Zeilen liegen und gehen beim nächsten Mal mit (höchstens 1000).
 */
object AppLog {
    private val pending = ArrayList<String>()
    private val fmt = SimpleDateFormat("HH:mm:ss", Locale.GERMANY)
    @Volatile private var sending = false
    @Volatile private var lastFlush = 0L

    fun i(tag: String, msg: String) { Log.i(tag, msg); add(msg) }
    fun w(tag: String, msg: String) { Log.w(tag, msg); add("⚠ $msg") }

    fun add(msg: String) {
        synchronized(pending) {
            pending.add(fmt.format(Date()) + " " + msg)
            while (pending.size > 1000) pending.removeAt(0)
        }
        if (System.currentTimeMillis() - lastFlush > 30_000) flush()
    }

    fun flush() {
        if (sending) return
        val lines = synchronized(pending) { if (pending.isEmpty()) return; ArrayList(pending) }
        sending = true; lastFlush = System.currentTimeMillis()
        Thread {
            try {
                val c = java.net.URL(Endpoint.base + "party/applog").openConnection() as java.net.HttpURLConnection
                c.requestMethod = "POST"; c.connectTimeout = 5000; c.readTimeout = 10000; c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                Endpoint.cookie().takeIf { it.isNotEmpty() }?.let { c.setRequestProperty("Cookie", it) }
                val body = JSONObject().put("dev", Build.MODEL + " " + BuildConfig.VERSION_NAME).put("lines", JSONArray(lines))
                c.outputStream.use { it.write(body.toString().toByteArray()) }
                if (c.responseCode in 200..299) synchronized(pending) { repeat(minOf(lines.size, pending.size)) { pending.removeAt(0) } }
            } catch (e: Exception) { } finally { sending = false }
        }.start()
    }
}
