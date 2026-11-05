package de.partyjukebox.player

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

/*
 * Lernkarte: App aktualisiert sich selbst
 * 1. Die App fragt das Jukebox-Add-on: "Welche Version ist die neueste?" (party/appupdate).
 *    Das Add-on schaut im GitHub-Release nach – mit dem Token aus den Add-on-Optionen, das Handy braucht keinen.
 * 2. Ist sie neuer: Hinweis "Update verfügbar". Ein Tipp lädt die APK über das Add-on in den
 *    App-Cache (nicht in "Downloads") und öffnet den Android-Installer.
 * 3. Nach dem Update (oder beim nächsten Start) wird die Datei gelöscht – es sammelt sich nichts an.
 * Android verlangt einmalig die Erlaubnis "Apps aus dieser Quelle installieren".
 */
object Updater {
    private val ASSET_PREFIX = BuildConfig.UPDATE_PREFIX   // z. B. "PartyJukeboxPlayer-" (Dateiname im Release)
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var lastCheck = 0L
    @Volatile private var busy = false

    private fun dir(c: Context) = File(c.cacheDir, "update")

    /** Update-Datei(en) entfernen – nach dem Update und bei jedem Start */
    @JvmStatic fun cleanup(c: Context) { try { dir(c).listFiles()?.forEach { it.delete() } } catch (e: Exception) { } }

    /** "3.9.22" > "3.9.21"? (Zahlen einzeln vergleichen) */
    private fun newer(a: String, b: String): Boolean {
        val x = a.split('.', '-').map { it.toIntOrNull() ?: 0 }
        val y = b.split('.', '-').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(x.size, y.size)) {
            val p = x.getOrElse(i) { 0 }; val q = y.getOrElse(i) { 0 }
            if (p != q) return p > q
        }
        return false
    }

    /** beim Öffnen der App: höchstens alle 6 h nachsehen (force = sofort, z. B. aus den Einstellungen) */
    @JvmStatic fun check(a: Activity, force: Boolean) {
        if (busy || (!force && System.currentTimeMillis() - lastCheck < 6 * 3600_000L)) return
        lastCheck = System.currentTimeMillis()
        Thread {
            val j = try { get("party/appupdate") } catch (e: Exception) { null }
            val arr = j?.optJSONArray("assets")
            val asset = (0 until (arr?.length() ?: 0)).mapNotNull { arr?.optJSONObject(it) }
                .firstOrNull { it.optString("name").startsWith(ASSET_PREFIX) }
            // Version aus dem Dateinamen ("…-3.9.26.apk"), sonst aus dem Release-Namen
            val ver = asset?.optString("name")?.removePrefix(ASSET_PREFIX)?.removeSuffix(".apk")?.takeIf { it.isNotEmpty() && it[0].isDigit() }
                ?: j?.optString("version").orEmpty()
            main.post {
                if (a.isFinishing) return@post
                if (j == null || j.optBoolean("ok") != true || asset == null) {
                    if (force) Toast.makeText(a, "Keine Update-Info (Add-on: App-Updates eingerichtet?)", Toast.LENGTH_LONG).show()
                    return@post
                }
                if (!newer(ver, BuildConfig.VERSION_NAME)) {
                    if (force) Toast.makeText(a, "Jukebox ist aktuell (" + BuildConfig.VERSION_NAME + ")", Toast.LENGTH_SHORT).show()
                    return@post
                }
                AlertDialog.Builder(a)
                    .setTitle("Update verfügbar")
                    .setMessage("Jukebox $ver ist da (installiert: ${BuildConfig.VERSION_NAME}).\nJetzt laden und installieren?")
                    .setNegativeButton("Später", null)
                    .setPositiveButton("Installieren") { _, _ -> download(a, asset.optString("name"), asset.optLong("size")) }
                    .show()
            }
        }.start()
    }

    private fun get(path: String): JSONObject? {
        val c = java.net.URL(Endpoint.base + path).openConnection() as java.net.HttpURLConnection
        c.connectTimeout = 5000; c.readTimeout = 20000
        Endpoint.cookie().takeIf { it.isNotEmpty() }?.let { c.setRequestProperty("Cookie", it) }
        return if (c.responseCode in 200..299) JSONObject(c.inputStream.bufferedReader().readText()) else null
    }

    private fun download(a: Activity, name: String, size: Long) {
        if (busy) return
        busy = true
        Toast.makeText(a, "Update wird geladen …", Toast.LENGTH_SHORT).show()
        Thread {
            val f = File(dir(a).apply { mkdirs() }, "jukebox-update.apk")
            val ok = try {
                cleanup(a)
                val c = java.net.URL(Endpoint.base + "party/appupdate/apk?name=" + Uri.encode(name)).openConnection() as java.net.HttpURLConnection
                c.connectTimeout = 8000; c.readTimeout = 60000
                Endpoint.cookie().takeIf { it.isNotEmpty() }?.let { c.setRequestProperty("Cookie", it) }
                if (c.responseCode !in 200..299) false
                else { c.inputStream.use { inp -> f.outputStream().use { inp.copyTo(it) } }; size <= 0 || f.length() == size }
            } catch (e: Exception) { AppLog.add("Update laden: $e"); false }
            busy = false
            main.post {
                if (!ok) { f.delete(); Toast.makeText(a, "Update konnte nicht geladen werden", Toast.LENGTH_LONG).show(); return@post }
                install(a, f)
            }
        }.start()
    }

    private fun install(a: Activity, f: File) {
        // einmalig: "Apps aus dieser Quelle installieren" erlauben
        if (Build.VERSION.SDK_INT >= 26 && !a.packageManager.canRequestPackageInstalls()) {
            Toast.makeText(a, "Bitte erlauben, dann nochmal „Installieren“", Toast.LENGTH_LONG).show()
            a.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.packageName)))
            lastCheck = 0
            return
        }
        val uri = FileProvider.getUriForFile(a, a.packageName + ".updates", f)
        a.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
