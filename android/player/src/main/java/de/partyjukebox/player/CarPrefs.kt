package de.partyjukebox.player

import android.content.Context
import org.json.JSONObject

/*
 * Einstellungen fürs Auto, pro Handy gespeichert (Jukebox → Einstellungen → Persönlich → Auto):
 *  - me_person: wer bin ich? (person.xyz) – für "Ist noch jemand zuhause?" beim Einsteigen/Aussteigen
 *  - pod_suggest: im Auto die neueste Podcast-Folge vorschlagen
 *  - rtc: unterwegs per WebRTC statt über Nabu Casa verbinden (Standard: aus)
 *  - startSound: Start-Sound beim App-Start (Standard: an)
 * Fehlt etwas, wird einmalig eine frühere Zuordnung übernommen, falls der Build eine mitbringt (siehe Legacy).
 */
object CarPrefs {
    private fun user(c: Context) = Endpoint.prefs(c).getString("aa_user", "") ?: ""

    fun mePerson(c: Context): String {
        val p = Endpoint.prefs(c)
        p.getString("me_person", null)?.let { return it }
        val legacy = Legacy.mePerson(user(c))
        if (legacy.isNotEmpty()) p.edit().putString("me_person", legacy).apply()
        return legacy
    }

    fun podSuggest(c: Context?): Boolean {
        if (c == null) return false
        val p = Endpoint.prefs(c)
        if (p.contains("pod_suggest")) return p.getBoolean("pod_suggest", false)
        val u = user(c); if (u.isEmpty()) return false
        val legacy = Legacy.podcastUser(u)
        p.edit().putBoolean("pod_suggest", legacy).apply()
        return legacy
    }

    @JvmStatic fun get(c: Context): String = JSONObject().put("me", mePerson(c)).put("podSuggest", podSuggest(c))
        .put("rtc", Endpoint.prefs(c).getBoolean("ss_rtc", false))
        .put("startSound", Endpoint.prefs(c).getBoolean("start_sound", true)).toString()

    @JvmStatic fun set(c: Context, json: String) {
        val o = try { JSONObject(json) } catch (e: Exception) { return }
        val e = Endpoint.prefs(c).edit()
        if (o.has("me")) e.putString("me_person", o.optString("me"))
        if (o.has("podSuggest")) e.putBoolean("pod_suggest", o.optBoolean("podSuggest"))
        if (o.has("rtc")) e.putBoolean("ss_rtc", o.optBoolean("rtc"))   // gilt ab der nächsten Verbindung
        if (o.has("startSound")) e.putBoolean("start_sound", o.optBoolean("startSound"))
        e.apply()
    }
}
