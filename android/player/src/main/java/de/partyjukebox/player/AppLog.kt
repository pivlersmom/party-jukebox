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
    /*
     * Lernkarte: Verlauf auf dem Handy
     * Zusätzlich bleiben die letzten 500 Zeilen in einer kleinen Datei (mit Datum) – die Seite
     * "Meldungen der App" in den Einstellungen liest sie über getAppLog() und übersetzt sie.
     */
    private val history = ArrayDeque<String>()
    private val day = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.GERMANY)
    @Volatile private var file: java.io.File? = null
    private var writes = 0

    @JvmStatic fun init(c: android.content.Context) {
        if (file != null) return
        val f = java.io.File(c.filesDir, "applog.txt")
        synchronized(history) {
            val old = try { if (f.exists()) f.readLines().filter { it.isNotBlank() } else emptyList() } catch (e: Exception) { emptyList<String>() }
            val cur = history.toList(); history.clear()
            (old + cur).takeLast(500).forEach { history.addLast(it) }   // ältere aus der Datei zuerst
            file = f
            try { f.writeText(history.joinToString("\n", postfix = if (history.isEmpty()) "" else "\n")) } catch (e: Exception) { }   // gekürzt neu schreiben
        }
    }

    /** letzte Zeilen als JSON-Liste (neueste zuletzt) */
    @JvmStatic fun recent(): String = synchronized(history) { JSONArray(history.toList()).toString() }

    private fun keep(msg: String) {
        synchronized(history) {
            val line = day.format(Date()) + " " + msg
            history.addLast(line)
            while (history.size > 500) history.removeFirst()
            try {
                if (++writes % 200 == 0) file?.writeText(history.joinToString("\n", postfix = "\n"))   // Datei klein halten
                else file?.appendText(line + "\n")
            } catch (e: Exception) { }
        }
    }

    private val pending = ArrayList<String>()
    private val fmt = SimpleDateFormat("HH:mm:ss", Locale.GERMANY)
    @Volatile private var sending = false
    @Volatile private var lastFlush = 0L

    fun i(tag: String, msg: String) { Log.i(tag, msg); add(msg) }
    fun w(tag: String, msg: String) { Log.w(tag, msg); add("⚠ $msg") }

    fun add(msg: String) {
        keep(msg)
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
