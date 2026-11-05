package de.partyjukebox.player

/*
 * ===== Lernkarte: ContentProvider als Briefkasten =====
 * Die App "Jukebox Steuerung" (eigenes Symbol in Android Auto) hat keine eigene Anmeldung.
 * Sie ruft hier call("addon", …) auf; wir schicken die Anfrage mit unserer Verbindung
 * (zuhause direkt, unterwegs Nabu Casa) ans Add-on und geben die Antwort zurück.
 * Erlaubt nur für Apps mit unserer Signatur (permission ...CONTROL, protectionLevel=signature).
 * Nur die zwei Schalter-Pfade und die Klang-Befehle (DSP) von Music Assistant sind erlaubt – sonst nichts.
 */

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class SwitchProvider : ContentProvider() {
    private val allowed = setOf("GET party/switches", "POST party/switch")

    private val maAllowed = setOf("config/players/dsp/get", "config/players/dsp/save", "config/players/dsp/apply_preset",
        "config/dsp_presets/get", "players/get")

    /**
     * Klang-Befehl an Music Assistant (über unsere bestehende MA-Verbindung).
     * "player_id": "@aa" wird durch den Lautsprecher ersetzt, der gerade in Android Auto gewählt ist.
     * Wartet höchstens 20 s auf die Antwort (call() läuft nicht im Haupt-Thread).
     */
    private fun ma(extras: Bundle): Bundle? {
        val command = extras.getString("command") ?: return null
        if (command !in maAllowed) return null
        val ctx = context ?: return null
        val args = try { JSONObject(extras.getString("args") ?: "{}") } catch (e: Exception) { return null }
        if (args.optString("player_id") == "@aa") {
            val pid = Endpoint.prefs(ctx).getString("aa_pid", "") ?: ""
            if (pid.isEmpty()) return Bundle().apply { putString("error", "Kein Lautsprecher gewählt") }
            args.put("player_id", pid)
        }
        val done = CountDownLatch(1)
        var res: Any? = null; var err: String? = null
        MaClient.get(ctx).send(command, args) { r, e -> res = r; err = e; done.countDown() }
        if (!done.await(20, TimeUnit.SECONDS)) err = "Zeitüberschreitung"
        return Bundle().apply {
            err?.let { putString("error", it) }
            putString("json", JSONObject().put("r", res ?: JSONObject.NULL).toString())
            putString("player_id", args.optString("player_id"))
        }
    }

    override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
        if (method == "ma" && extras != null) return ma(extras)
        if (method != "addon" || extras == null) return null
        val m = extras.getString("method") ?: return null
        val path = extras.getString("path") ?: return null
        if ("$m $path" !in allowed) return null
        val ctx = context ?: return null
        return try {
            Endpoint.resolve(ctx.applicationContext, false)
            val c = java.net.URL(Endpoint.base + path).openConnection() as java.net.HttpURLConnection
            c.requestMethod = m; c.connectTimeout = 5000; c.readTimeout = 10000
            Endpoint.cookie().takeIf { it.isNotEmpty() }?.let { c.setRequestProperty("Cookie", it) }
            extras.getString("body")?.let { b ->
                c.doOutput = true; c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(b.toByteArray()) }
            }
            if (c.responseCode !in 200..299) return null
            val txt = c.inputStream.bufferedReader().readText()
            JSONObject(txt)   // nur gültiges JSON weitergeben
            Bundle().apply { putString("json", txt) }
        } catch (e: Exception) { null }
    }

    override fun onCreate() = true
    override fun query(u: Uri, p: Array<out String>?, s: String?, a: Array<out String>?, o: String?): Cursor? = null
    override fun getType(u: Uri): String? = null
    override fun insert(u: Uri, v: ContentValues?): Uri? = null
    override fun delete(u: Uri, s: String?, a: Array<out String>?) = 0
    override fun update(u: Uri, v: ContentValues?, s: String?, a: Array<out String>?) = 0
}
