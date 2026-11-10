package de.partyjukebox.player

/*
 * ===== Lernkarte: Library =====
 * Das ist die "Bibliothek" für Android Auto: welche Reiter, Ordner und Titel es gibt.
 * Android Auto fragt: "Was liegt im Ordner X?"  → load("X") holt die Liste bei Music Assistant.
 *
 * Jeder Eintrag ist ein MediaItem mit einer ID. Unsere IDs erklären sich selbst:
 *   "pl"                     = Ordner Playlists
 *   "open|album|spotify|…"   = Album öffnen (Titel anzeigen)
 *   "play:spotify://track/…" = abspielen
 *   "spk:<player_id>"        = Lautsprecher wählen
 *   "air:<station>"          = AI-Radio starten
 *
 * "object" in Kotlin = es gibt genau ein Exemplar davon (wie ein Werkzeugkasten, den alle teilen).
 */

import android.content.Context
import android.os.Bundle
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.session.MediaLibraryService
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.text.Normalizer
import de.partyjukebox.player.MaPlayer.Companion.artists
import de.partyjukebox.player.MaPlayer.Companion.o

object Library {
    private val h = android.os.Handler(android.os.Looper.getMainLooper())
    const val ROOT = "root"
    private const val TAG = "JukeboxAuto"
    // Anzeige-Hinweise für Android Auto (feste Namen aus der Android-Doku)
    const val STYLE_BROWSABLE = "android.media.browse.CONTENT_STYLE_BROWSABLE_HINT"
    const val STYLE_PLAYABLE = "android.media.browse.CONTENT_STYLE_PLAYABLE_HINT"
    private const val GROUP = "android.media.browse.CONTENT_STYLE_GROUP_TITLE_HINT"
    const val LIST = 1
    const val GRID = 2   // große Kacheln

    lateinit var app: Context
    var session: MediaLibraryService.MediaLibrarySession? = null

    private fun p() = Endpoint.prefs(app)
    private fun ma() = MaClient.get(app)
    private fun pid() = p().getString("aa_pid", "") ?: ""
    private fun user() = p().getString("aa_user", "") ?: ""
    private fun providers(): JSONArray = try { JSONArray(p().getString("aa_providers", "[]")) } catch (e: Exception) { JSONArray() }

    /** Benutzer + Musikquellen des gewählten Profils mitschicken (jede Person sieht ihre eigenen Musikdienste) */
    private fun withProfile(a: JSONObject, provKey: String?): JSONObject {
        val pv = providers()
        if (provKey != null && pv.length() > 0) a.put(provKey, pv)
        if (user().isNotEmpty()) a.put("user", user())
        return a
    }

    // ---------------------------------------------------------------- Zwischenspeicher
    private val PRELOAD = listOf("pl", "fav", "rec", "art", "alb", "radio", "pod", "book", "air")
    private val cache = HashMap<String, List<MediaItem>>()
    private val cacheSig = HashMap<String, String>()
    private val cacheAt = HashMap<String, Long>()
    private var preloadedAt = 0L

    private fun ckey(parent: String) = "$parent|${user()}|${providers()}"
    private fun cacheable(parent: String) = parent in PRELOAD || parent in listOf("spk", "pnew", "pfav", "pdisc") ||
        parent.startsWith("open|") || parent.startsWith("row|")

    /** wie lange eine Liste gilt, bevor sie im Hintergrund aufgefrischt wird */
    private fun ttl(parent: String): Long = when {
        parent == "spk" -> 0L                       // was läuft, ändert sich ständig
        parent == "pnew" -> 60 * 60_000L            // neue Folgen: stündlich
        parent == "pdisc" -> 12 * 60 * 60_000L      // Podcast-Entdeckungen: zweimal am Tag
        parent.startsWith("row|") -> 30 * 60_000L   // Vorschläge
        else -> 120_000L
    }
    private fun now() = System.currentTimeMillis()

    /** beim Verbinden von Android Auto: alle Reiter-Listen schon einmal holen */
    fun preload() {
        if (now() - preloadedAt < 60000) return
        preloadedAt = now()
        PRELOAD.forEach { fetch(it) { } }
        if (podcastUser()) listOf("pnew", "pfav", "pdisc").forEach { fetch(it) { } }
    }

    /** Liste für einen Ordner: aus dem Speicher sofort, sonst bei MA holen */
    fun load(parent: String, out: (List<MediaItem>) -> Unit) {
        if (!cacheable(parent)) { fetch(parent, out); return }
        val k = ckey(parent)
        val c = cache[k]
        if (c != null) {
            out(c)
            // im Hintergrund auffrischen (Lautsprecher immer – dort ändert sich ständig, was läuft)
            if (now() - (cacheAt[k] ?: 0L) >= ttl(parent)) fetch(parent) { }
            return
        }
        fetch(parent, out)
    }

    private fun fetch(parent: String, out: (List<MediaItem>) -> Unit) {
        val k = ckey(parent)
        loadRaw(parent) { items ->
            val sig = items.joinToString("\n") { it.mediaId + "|" + it.mediaMetadata.subtitle }
            val old = cacheSig[k]
            val had = cache.containsKey(k)
            val fresh = now() - (cacheAt[k] ?: 0L) < 3000   // gerade erst vollständig nachgereicht
            if (cacheable(parent) && items.isNotEmpty() && !fresh) { cache[k] = items; cacheSig[k] = sig; cacheAt[k] = now() }
            out(items)
            if (had && old != null && old != sig) changed(parent)
            // Lernkarte: leer = meist "noch keine Verbindung" (z. B. gleich nach dem App-Start im Auto).
            // Android Auto merkt sich die leere Liste – darum nachladen und Bescheid geben, sobald etwas da ist.
            if (items.isEmpty() && (emptyTries[k] ?: 0) < 3) {
                emptyTries[k] = (emptyTries[k] ?: 0) + 1
                main.postDelayed({ fetch(parent) { if (it.isNotEmpty()) changed(parent) } }, 4000)
            } else if (items.isNotEmpty()) emptyTries.remove(k)
            warmArt(items)
        }
    }

    private val emptyTries = HashMap<String, Int>()
    private val main = android.os.Handler(android.os.Looper.getMainLooper())

    private fun changed(parent: String) { try { session?.notifyChildrenChanged(parent, 0, null) } catch (e: Exception) { } }

    /** die ersten 40 Cover schon im Hintergrund laden, damit Android Auto sie gleich hat */
    private fun warmArt(items: List<MediaItem>) = Thread {
        items.take(40).forEach { m ->
            val u = m.mediaMetadata.artworkUri ?: return@forEach
            try { app.contentResolver.openFileDescriptor(u, "r")?.close() } catch (e: Exception) { }
        }
    }.start()

    // ---------------------------------------------------------------- Ordner
    fun rootItem(): MediaItem = folder(ROOT, app.applicationInfo.loadLabel(app.packageManager).toString(), null)

    private fun lib(cmd: String, args: JSONObject, playlists: Boolean, out: (List<MediaItem>) -> Unit) =
        ma().send(cmd, withProfile(args, "provider")) { r, _ -> out(items(r, playlists)) }

    private fun loadRaw(parent: String, out: (List<MediaItem>) -> Unit) {
        try {
            when (parent) {
                ROOT -> out(listOf(   // Android Auto zeigt höchstens 4 Reiter
                    folder("start", "Start", null),
                    folder("spk", "Lautsprecher", "Wo soll die Musik laufen?"),
                    folder("pl", "Playlists", null, GRID),
                    folder("more", "Mehr", null)))
                "start" -> start(out)
                "pnew" -> newEpisodes(out)
                "pfav" -> lib("music/podcasts/library_items", o("favorite" to true, "limit" to 50, "order_by" to "sort_name"), false, out)
                "pdisc" -> discoverPodcasts(out)
                "myfav" -> {   // persönliche Favoriten, nach Art sortiert
                    val rank = listOf("playlist", "album", "podcast", "radio", "audiobook", "artist", "track")
                    val l = (0 until myFavs.length()).mapNotNull { myFavs.optJSONObject(it) }
                        .sortedWith(compareBy({ rank.indexOf(it.optString("media_type")).let { r -> if (r < 0) 99 else r } }, { it.optString("name").lowercase() }))
                    out(items(JSONArray(l), false))
                }
                "set" -> settings(out)
                in swTaps -> toggleFolder(parent, out)
                "more" -> out(listOf(
                    folder("set", "⚙ Einstellungen", "Heimkommen & Co. · App " + BuildConfig.VERSION_NAME),
                    folder("fav", "Lieblingssongs", null),
                    folder("rec", "Zuletzt gehört", "Deine letzten Titel", GRID),
                    folder("art", "Künstler", null, GRID),
                    folder("alb", "Alben", null, GRID),
                    folder("radio", "Radio", null, GRID),
                    folder("pod", "Podcasts", null, GRID),
                    folder("book", "Hörbücher", null, GRID),
                    folder("air", "AI Radio", null, GRID)))
                "art" -> lib("music/artists/library_items", o("limit" to 300, "order_by" to "sort_name"), false, out)
                "alb" -> lib("music/albums/library_items", o("limit" to 300, "order_by" to "sort_name"), false, out)
                "radio" -> lib("music/radios/library_items", o("limit" to 200, "order_by" to "sort_name"), false, out)
                "pod" -> lib("music/podcasts/library_items", o("limit" to 200, "order_by" to "sort_name"), false, out)
                "book" -> lib("music/audiobooks/library_items", o("limit" to 200, "order_by" to "sort_name"), false, out)
                "pl" -> lib("music/playlists/library_items", o("limit" to 150, "order_by" to "sort_name"), true, out)
                "fav" -> lib("music/tracks/library_items", o("favorite" to true, "limit" to 150), false, out)
                "rec" -> ma().send("music/recently_played_items", withProfile(o("limit" to 40), "providers")) { r, _ -> out(items(r, false)) }
                "air" -> ma().send("ai_radio/stations/list", null) { r, _ ->
                    val a = r as? JSONArray ?: (r as? JSONObject)?.optJSONArray("stations") ?: JSONArray()
                    out((0 until a.length()).mapNotNull { i ->
                        val st = a.optJSONObject(i) ?: return@mapNotNull null
                        val sid = st.optString("station_id", st.optString("id", ""))
                        if (sid.isEmpty()) null else playable("air:$sid", st.optString("name", sid), st.optString("description", ""))
                    })
                }
                "spk" -> speakers(out)
                else -> when {
                    parent.startsWith("open|") -> openItem(parent, out)
                    parent.startsWith("row|") -> recRow(parent, out)
                    else -> out(emptyList())
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "load $parent: $e")
            out(emptyList())
        }
    }

    /** Lautsprecher-Liste: das eigene Handy zuerst, dann alle anderen (ohne Gruppen-Mitglieder) */
    private fun speakers(out: (List<MediaItem>) -> Unit) = ma().send("players/all", null) { r, err ->
        if (err != null) AppLog.add("Lautsprecher-Liste: $err")
        val a = r as? JSONArray ?: JSONArray()
        val cur = pid()
        val phone = PhonePlayer.playerId(app)
        val l = mutableListOf<MediaItem>()
        val all = (0 until a.length()).mapNotNull { a.optJSONObject(it) }
        all.firstOrNull { phone.isNotEmpty() && it.optString("player_id") == phone && it.optBoolean("available", true) }?.let {
            l.add(playable("spk:$phone", "📱 Dieses Handy (im Auto)", if (phone == cur) "✓ gewählt" else ""))
        }
        for (pl in all) {
            if (!pl.optBoolean("available", true) || !pl.optBoolean("enabled", true)) continue
            val synced = pl.optString("synced_to", "")
            if (synced.isNotEmpty() && synced != "null") continue
            val id = pl.optString("player_id")
            if (id == phone) continue
            val name = pl.optString("display_name", pl.optString("name", id))
            val st = pl.optString("playback_state", pl.optString("state", ""))
            // was läuft dort gerade? (zum Nachsehen, ohne umzuschalten)
            val cm = pl.optJSONObject("current_media")
            val t = cm?.optString("title").orEmpty().takeUnless { it == "null" }.orEmpty()
            val a = cm?.optString("artist").orEmpty().takeUnless { it == "null" }.orEmpty()
            val what = listOf(t, a).filter { it.isNotEmpty() }.joinToString(" – ")
            val now = when {
                st == "playing" -> "▶ " + what.ifEmpty { "spielt" }
                st == "paused" && what.isNotEmpty() -> "⏸ $what"
                else -> null
            }
            val sub = listOfNotNull(if (id == cur) "✓ gewählt" else null, now).joinToString(" · ")
            l.add(playable("spk:$id", name, sub))
        }
        out(l)
    }

    /** Künstler, Album oder Playlist öffnen: oben „Alle abspielen“, darunter die Titel (bzw. Alben). */
    private fun openItem(id: String, out: (List<MediaItem>) -> Unit) {
        val f = id.split("|", limit = 5)
        if (f.size < 5) { out(emptyList()); return }
        val (_, type, prov, itemId, uri) = f
        val a = o("item_id" to itemId, "provider_instance_id_or_domain" to prov)
        val head = listOf(playable("play:$uri", "▶ Alle abspielen", ""))
        if (type == "artist") {
            ma().send("music/artists/artist_tracks", a) { r, _ ->
                val tracks = grouped(items(r, false), "Titel")
                ma().send("music/artists/artist_albums", o("item_id" to itemId, "provider_instance_id_or_domain" to prov)) { r2, _ ->
                    out(head + tracks + grouped(items(r2, false), "Alben"))
                }
            }
            return
        }
        // lange Playlists kommen in Teilen: erste Titel sofort zeigen, Rest nachreichen
        val cmd = when (type) {
            "album" -> "music/albums/album_tracks"
            "podcast" -> "music/podcasts/podcast_episodes"
            else -> "music/playlists/playlist_tracks"
        }
        var sent = false
        ma().send(cmd, a, { r, _ ->
            val full = head + items(r, false)
            if (!sent) { sent = true; out(full); return@send }
            val k = ckey(id); cache[k] = full; cacheAt[k] = now()
            changed(id)
        }, { part, _ ->
            if (sent || (part as? JSONArray)?.length() ?: 0 == 0) return@send
            sent = true
            out(head + items(part, false))
        }, 120000)
    }

    // ---------------------------------------------------------------- Einstellungen im Auto
    /*
     * Die Schalter kommen aus den Jukebox-Einstellungen ("Schalter auswählen", z. B. Heimkommen)
     * und werden über das Add-on geschaltet – gleiche Liste wie auf dem Handy.
     * Antippen = umschalten.
     */
    private fun settings(out: (List<MediaItem>) -> Unit) = addon("GET", "party/switches", null) { j ->
        val a = j?.optJSONArray("switches") ?: JSONArray()
        val l = mutableListOf<MediaItem>()
        for (i in 0 until a.length()) {
            val x = a.optJSONObject(i) ?: continue
            val on = x.optString("state") == "on"
            // Ordner statt "abspielbar": Antippen öffnet eine Bestätigung, Android Auto springt NICHT zum Player
            val tap = "swt|" + (++swSeq) + "|" + x.optString("id")
            swTaps[tap] = Triple(x.optString("id"), !on, x.optString("name"))
            // Kein Ordner mehr: Android Auto lädt Ordner manchmal schon vorab (z. B. beim Zurück) – das hat
            // ungewollt geschaltet. "Abspielbar" schaltet nur bei echtem Antippen (AA zeigt danach den Player).
            swTaps.remove(tap)
            l.add(withAction(playable("sw|" + x.optString("id") + "|" + (if (on) "1" else "0"),
                (if (on) "✅ " else "⬜ ") + x.optString("name"),
                if (on) "an · antippen = ausschalten" else "aus · antippen = einschalten")))
        }
        if (l.isEmpty()) l.add(playable("sw|none|0", "Keine Schalter ausgewählt", "In der Jukebox: Einstellungen → Schalter auswählen"))
        out(l)
    }

    /*
     * Lernkarte: Warum ein Ordner?
     * Ein "abspielbarer" Eintrag lässt Android Auto sofort zum Player springen.
     * Ein Ordner öffnet dagegen eine Liste – die nutzen wir als Bestätigung ("ist jetzt AN").
     * Jedes Antippen bekommt eine eigene Nummer (swSeq). Fragt Android Auto denselben Ordner
     * nochmal (z. B. beim Zurückgehen), wird NICHT erneut geschaltet – die Antwort kommt aus swDone.
     */
    private var swSeq = 0L
    private val swTaps = HashMap<String, Triple<String, Boolean, String>>()   // Ordner-ID → (Schalter, Ziel an?, Name)
    private val swDone = HashMap<String, List<MediaItem>>()                  // schon geschaltet → Bestätigung

    private fun toggleFolder(tap: String, out: (List<MediaItem>) -> Unit) {
        swDone[tap]?.let { out(it); return }
        val (eid, on, name) = swTaps[tap] ?: run { out(emptyList()); return }
        addon("POST", "party/switch", JSONObject().put("entity_id", eid).put("on", on)) { j ->
            val ok = j?.optBoolean("ok") == true
            // Bestätigung ist wieder ein Ordner (kein "abspielbar"): Antippen schaltet zurück, ohne zum Player zu springen
            val next = "swt|" + (++swSeq) + "|" + eid
            swTaps[next] = Triple(eid, if (ok) !on else on, name)
            // Titel = nur der Name (wird beim nächsten Antippen zur Überschrift), Zustand im Untertitel
            val l = listOf(folder(next, name,
                if (!ok) "⚠ Schalten fehlgeschlagen · antippen = nochmal" else (if (on) "✅ jetzt AN · antippen = ausschalten" else "⬜ jetzt AUS · antippen = einschalten")))
            if (ok) swDone[tap] = l
            out(l)
            changed("set")
        }
    }

    /*
     * Lernkarte: "Custom Browse Action"
     * Android Auto kann neben einem Listeneintrag eigene Knöpfe zeigen. Der Eintrag sagt per
     * "supportedCommands", welche Knöpfe er hat; der Knopf selbst ist im JukeboxService angemeldet.
     * Tippen auf den Knopf → onCustomCommand im Service → toggleLive hier. Die Liste bleibt stehen.
     */
    const val SW_TOGGLE = "jukebox.SW_TOGGLE"
    private fun withAction(m: MediaItem) =
        m.buildUpon().setMediaMetadata(m.mediaMetadata.buildUpon().setSupportedCommands(listOf(SW_TOGGLE)).build()).build()

    /** Knopf "Umschalten": aktuellen Zustand frisch holen, umdrehen, Meldung zurück */
    fun toggleLive(mediaId: String?, cb: (String) -> Unit) {
        val eid = swTaps[mediaId ?: ""]?.first ?: mediaId?.substringAfterLast("|").orEmpty()
        if (!eid.contains(".")) { cb("Unbekannter Schalter"); return }
        addon("GET", "party/switches", null) { j ->
            val a = j?.optJSONArray("switches") ?: JSONArray()
            var cur: JSONObject? = null
            for (i in 0 until a.length()) if (a.optJSONObject(i)?.optString("id") == eid) cur = a.optJSONObject(i)
            if (cur == null) { cb("Schalter nicht gefunden"); return@addon }
            val on = cur.optString("state") != "on"
            val name = cur.optString("name")
            addon("POST", "party/switch", JSONObject().put("entity_id", eid).put("on", on)) { r ->
                changed("set")
                cb(if (r?.optBoolean("ok") == true) "$name: " + (if (on) "AN" else "AUS") else "$name: Schalten fehlgeschlagen")
            }
        }
    }

    /** erster ausgewählter Schalter (für den Knopf im Player-Bildschirm): (id, Name, an?) oder null */
    fun firstSwitch(cb: (Triple<String, String, Boolean>?) -> Unit) = addon("GET", "party/switches", null) { j ->
        val x = j?.optJSONArray("switches")?.optJSONObject(0)
        cb(x?.let { Triple(it.optString("id"), it.optString("name"), it.optString("state") == "on") })
    }

    private fun toggleSwitch(id: String) {
        val f = id.split("|"); if (f.size < 3 || f[1] == "none") return
        addon("POST", "party/switch", JSONObject().put("entity_id", f[1]).put("on", f[2] != "1")) { changed("set") }
    }

    /** Anfrage ans Jukebox-Add-on (zuhause direkt, unterwegs über Nabu Casa) – Antwort im Haupt-Thread */
    /** ♥ aus Auto/Medienkarte auch in die persönliche Favoriten-Liste (Add-on) – wie das ♥ in der Jukebox */
    fun personalFav(it: JSONObject, on: Boolean) {
        val uid = (p().getString("aa_uid", "") ?: "").ifEmpty { "default" }
        val slim = JSONObject().put("uri", it.optString("uri")).put("media_type", it.optString("media_type", "track"))
            .put("name", it.optString("name")).put("item_id", it.opt("item_id")).put("provider", it.optString("provider")).put("favorite", true)
        it.optJSONArray("artists")?.let { a ->
            val o = JSONArray(); for (i in 0 until minOf(4, a.length())) o.put(JSONObject().put("name", a.optJSONObject(i)?.optString("name")))
            slim.put("artists", o)
        }
        it.optJSONObject("album")?.optString("name")?.takeIf { n -> n.isNotEmpty() }?.let { n -> slim.put("album", JSONObject().put("name", n)) }
        (it.optJSONObject("image") ?: it.optJSONObject("metadata")?.optJSONArray("images")?.optJSONObject(0))?.let { im ->
            slim.put("image", JSONObject().put("path", im.optString("path")).put("provider", im.optString("provider"))
                .put("remotely_accessible", im.optBoolean("remotely_accessible")))
        }
        addon("POST", "party/favs", JSONObject().put("user", uid).put("item", slim).put("on", on)) { }
    }

    private fun addon(method: String, path: String, body: JSONObject?, cb: (JSONObject?) -> Unit) = Thread {
        val res = try {
            val c = java.net.URL(Endpoint.base + path).openConnection() as java.net.HttpURLConnection
            c.requestMethod = method; c.connectTimeout = 4000; c.readTimeout = 10000
            Endpoint.cookie().takeIf { it.isNotEmpty() }?.let { c.setRequestProperty("Cookie", it) }
            if (body != null) {
                c.doOutput = true; c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            if (c.responseCode in 200..299) JSONObject(c.inputStream.bufferedReader().readText()) else null
        } catch (e: Exception) { null }
        h.post { cb(res) }
    }.start()

    // ---------------------------------------------------------------- Start-Reiter (je Person)
    /*
     * Podcast-Profil: neueste Folgen der ♥-Podcasts vorne, dann die Podcasts,
     *          neue Podcasts mit ähnlichem Geschmack, zuletzt gehört.
     * Musik-Profil: Vorschläge der Musikdienste (neue Titel, Mixe …) vorne, zuletzt gehört dahinter.
     */
    fun podcastUser() = CarPrefs.podSuggest(app)

    /** neueste ungehörte Folge (für die Medien-Karte im Auto) – kommt aus "Neu diese Woche" */
    @Volatile var suggestion: JSONObject? = null; private set

    /*
     * Lernkarte: Start-Reiter pro Person
     * Die Reihenfolge stellt man in der Jukebox ein (Einstellungen → Startseite, ▲▼ und ein/aus).
     * Sie liegt im Add-on (party/favs) – hier holen wir sie und bauen die Ordner in genau dieser Reihenfolge.
     *   recent → Zuletzt gehört · fav → Meine Favoriten · rec → Vorschläge der Musikdienste
     *   pl → Meine Playlists · pods → neue Folgen + Meine Podcasts · podrec → Neue Podcasts für dich
     */
    private fun start(out: (List<MediaItem>) -> Unit) {
        val uid = p().getString("aa_uid", "") ?: ""
        addon("GET", "party/favs?user=" + java.net.URLEncoder.encode(uid.ifEmpty { "default" }, "UTF-8"), null) { j ->
            val prefs = j?.optJSONObject("prefs") ?: JSONObject()
            val favs = j?.optJSONArray("items") ?: JSONArray()
            myFavs = favs
            val podCount = (0 until favs.length()).count { favs.optJSONObject(it)?.optString("media_type") == "podcast" }
            val ids = listOf("recent", "fav", "rec", "pl", "pods", "podrec")
            var order = prefs.optJSONArray("order")?.let { a -> (0 until a.length()).map { a.optString(it) }.filter { it in ids } }
            if (order == null) {
                order = ids
                val podTop = if (prefs.has("podtop")) prefs.optBoolean("podtop") else (podCount >= 3 || podcastUser())
                if (podTop) order = listOf("pods", "podrec") + ids.filter { it != "pods" && it != "podrec" }
            }
            order = order + ids.filter { it !in order!! }
            val hidden = prefs.optJSONArray("hidden")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()
            val hasPods = podCount > 0 || podcastUser()
            recRows { rows ->
                val l = mutableListOf<MediaItem>()
                for (id in order!!) {
                    if (id in hidden) continue
                    when (id) {
                        "recent" -> l.add(folder("rec", "Zuletzt gehört", null, GRID))
                        "fav" -> if (favs.length() > 0) l.add(folder("myfav", "Meine Favoriten", "Playlists, Alben, Podcasts …", GRID))
                        "rec" -> l.addAll(rows)
                        "pl" -> l.add(folder("pl", "Meine Playlists", null, GRID))
                        "pods" -> if (hasPods) {
                            suggestion?.let { e -> l.add(episodeItem(e, "▶ Neu: " + podcastName(e))) }
                            l.add(folder("pnew", "Neue Podcast-Folgen", "Neueste Folgen deiner ♥-Podcasts"))
                            l.add(folder("pfav", "Meine Podcasts", null, GRID))
                        }
                        "podrec" -> if (hasPods) l.add(folder("pdisc", "Neue Podcasts für dich", "Ähnlich wie deine Lieblinge", GRID))
                    }
                }
                out(l)
            }
        }
    }

    /** persönliche Favoriten aus dem Add-on (für „Meine Favoriten“), zuletzt beim Start geladen */
    private var myFavs: JSONArray = JSONArray()

    /** Vorschlags-Zeilen der Musikdienste (Tidal, Spotify …) als Ordner mit großen Kacheln */
    private fun recRows(cb: (List<MediaItem>) -> Unit) {
        ma().send("music/recommendations", null) { r, _ ->
            val a = r as? JSONArray ?: JSONArray()
            val pv = providers().let { p -> (0 until p.length()).map { p.optString(it) } }
            val l = mutableListOf<MediaItem>()
            for (i in 0 until a.length()) {
                val f = a.optJSONObject(i) ?: continue
                val prov = f.optString("provider"); val id = f.optString("item_id")
                if (prov == "recommendations" || prov == "musicbrainz" || prov.startsWith("tunein")) continue
                if (pv.isNotEmpty() && prov !in pv) continue
                if (!f.optBoolean("enabled_by_default", true)) continue
                l.add(folder("row|$prov|$id", german(f.optString("name")), null, GRID))
                if (l.size >= 6) break
            }
            cb(l)
        }
    }

    private fun german(n: String): String = when {
        n.equals("Custom mixes", true) -> "Deine Mixe"
        n.equals("New Tracks", true) -> "Neue Titel"
        n.equals("New Albums", true) -> "Neue Alben"
        n.equals("Radio stations for you", true) -> "Radio für dich"
        n.equals("The Hits", true) -> "Die Hits"
        n.equals("Recent albums", true) -> "Zuletzt gehörte Alben"
        n.equals("Top Tracks", true) -> "Top-Titel"
        n.equals("Featured Playlists", true) -> "Empfohlene Playlists"
        n.equals("New German Playlists", true) -> "Neue deutsche Playlists"
        n.startsWith("Because you listened to", true) -> "Weil du " + n.substring(24).trim() + " gehört hast"
        n.equals("Made For You", true) -> "Für dich gemacht"
        else -> n
    }

    /** Inhalt einer Vorschlags-Zeile */
    private fun recRow(id: String, out: (List<MediaItem>) -> Unit) {
        val f = id.split("|", limit = 3); if (f.size < 3) { out(emptyList()); return }
        ma().send("music/recommendations/items", o("provider" to f[1], "item_id" to f[2]), { r, _ ->
            val a = r as? JSONArray ?: JSONArray()
            val keep = JSONArray()
            for (i in 0 until a.length()) a.optJSONObject(i)?.takeIf { it.optString("media_type") != "folder" }?.let { keep.put(it) }
            out(items(keep, false))
        }, null, 60000)
    }

    private fun podcastName(e: JSONObject) = e.optJSONObject("podcast")?.optString("name").orEmpty()

    /** Erscheinungsdatum einer Folge als "yyyy-MM-dd" (leer = unbekannt) */
    private fun released(e: JSONObject): String {
        val d = e.optJSONObject("metadata")?.optString("release_date").orEmpty()
        return if (d.length >= 10 && d != "null") d.substring(0, 10) else ""
    }

    private fun episodeItem(e: JSONObject, title: String? = null): MediaItem {
        val d = released(e)
        val date = if (d.length == 10) d.substring(8, 10) + "." + d.substring(5, 7) + "." else ""
        val sub = listOf(if (title != null) e.optString("name") else podcastName(e), date).filter { it.isNotEmpty() }.joinToString(" · ")
        val md = MediaMetadata.Builder().setTitle(title ?: e.optString("name")).setSubtitle(sub).setArtist(sub)
            .setArtworkUri(ArtProvider.uri(image(e).ifEmpty { image(e.optJSONObject("podcast")) }))
            .setIsBrowsable(false).setIsPlayable(true).setMediaType(MediaMetadata.MEDIA_TYPE_PODCAST_EPISODE).build()
        return MediaItem.Builder().setMediaId("play:" + e.optString("uri")).setMediaMetadata(md).build()
    }

    /**
     * "Neu diese Woche": von jedem ♥-Podcast die erste Seite Folgen holen (Spotify liefert die neuesten zuerst),
     * Folgen der letzten 7 Tage nach Datum sortieren. Keine neue? Dann je Podcast die neueste.
     */
    private fun newEpisodes(out: (List<MediaItem>) -> Unit) {
        ma().send("music/podcasts/library_items", withProfile(o("favorite" to true, "limit" to 12), "provider")) { r, _ ->
            val pods = (r as? JSONArray)?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) } }.orEmpty()
            if (pods.isEmpty()) { suggestion = null; out(emptyList()); return@send }
            val all = mutableListOf<JSONObject>()
            var left = pods.size
            var sent = false
            fun finish() {
                if (sent) return; sent = true
                val weekAgo = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date(now() - 7 * 86_400_000L))
                val sorted = all.filter { !it.optBoolean("fully_played", false) }.sortedByDescending { released(it) }   // schon gehörte Folgen sind nicht „neu“
                val week = sorted.filter { released(it) >= weekAgo }
                val show = week.ifEmpty { sorted.distinctBy { podcastName(it) } }.take(30)
                suggestion = week.firstOrNull { !it.optBoolean("fully_played", false) }
                out(show.map { episodeItem(it) })
                changed("start")
            }
            h.postDelayed({ finish() }, 25000)   // spätestens nach 25 s anzeigen, was da ist
            for (p in pods) {
                var got = false
                val take = { res: Any? ->
                    if (!got) {
                        got = true
                        val a = res as? JSONArray
                        if (a != null) for (i in 0 until minOf(a.length(), 10)) a.optJSONObject(i)?.let { e ->
                            if (e.optJSONObject("podcast") == null) e.put("podcast", JSONObject().put("name", p.optString("name")))
                            all.add(e)
                        }
                        if (--left == 0) finish()
                    }
                }
                ma().send("music/podcasts/podcast_episodes",
                    o("item_id" to p.optString("item_id"), "provider_instance_id_or_domain" to p.optString("provider", "library")),
                    { res, _ -> take(res) }, { part, _ -> take(part) }, 60000)
            }
        }
    }

    /** Suchbegriffe für "ähnlicher Geschmack" (aus ihren ♥-Podcasts: True Crime, Comedy-Talk …) */
    private val TASTE = listOf("True Crime", "Verbrechen", "Comedy Talk", "Freundinnen Podcast", "Crime Podcast deutsch")

    /** neue Podcasts suchen, die noch nicht in ihrer Bibliothek sind */
    private fun discoverPodcasts(out: (List<MediaItem>) -> Unit) {
        ma().send("music/podcasts/library_items", withProfile(o("limit" to 300), "provider")) { lr, _ ->
            val have = (lr as? JSONArray)?.let { a -> (0 until a.length()).map { norm(a.optJSONObject(it)?.optString("name")) } }.orEmpty().toSet()
            val found = LinkedHashMap<String, JSONObject>()
            var left = TASTE.size
            for (t in TASTE) {
                val a = withProfile(o("search_query" to t, "limit" to 10), "providers")
                a.put("media_types", JSONArray(listOf("podcast")))
                ma().send("music/search", a) { r, _ ->
                    val arr = (r as? JSONObject)?.optJSONArray("podcasts")
                    if (arr != null) for (i in 0 until arr.length()) {
                        val p = arr.optJSONObject(i) ?: continue
                        val n = norm(p.optString("name"))
                        if (n.isNotEmpty() && n !in have && n !in found) found[n] = p
                    }
                    if (--left == 0) out(items(JSONArray(found.values.take(30)), false))
                }
            }
        }
    }

    // ---------------------------------------------------------------- Suche
    fun search(q: String, out: (List<MediaItem>) -> Unit) {
        if (q.isBlank()) { out(emptyList()); return }
        val a = withProfile(o("search_query" to q.trim(), "limit" to 8), "providers")
        a.put("media_types", JSONArray(listOf("track", "artist", "album", "playlist", "radio", "podcast", "audiobook")))
        ma().send("music/search", a) { r, _ ->
            val res = r as? JSONObject ?: run { out(emptyList()); return@send }
            /*
             * Gruppen mit Überschrift. Wichtig: Android Auto zeigt in Suchergebnissen nur ABSPIELBARE Einträge –
             * Ordner (Playlist, Album, Künstler) würden verschwinden. Darum hier alles abspielbar:
             * Antippen spielt die ganze Playlist / das Album / den Sender.
             */
            val groups = listOf("tracks" to "Titel", "radio" to "Radio", "playlists" to "Playlists", "albums" to "Alben",
                "artists" to "Künstler", "podcasts" to "Podcasts", "audiobooks" to "Hörbücher")
            out(groups.flatMap { (key, label) -> grouped(items(relevant(res.optJSONArray(key), q, key != "tracks"), false, playOnly = true), label) })
        }
    }

    private fun norm(s: String?): String = Normalizer.normalize((s ?: "").lowercase(), Normalizer.Form.NFD)
        .replace(Regex("\\p{M}"), "").replace("ß", "ss").replace(Regex("[^a-z0-9]+"), " ").trim()

    /** 3 = alle Wörter im Namen, 2 = alle Wörter in Name + Künstler/Besitzer, 0 = passt nicht */
    private fun score(it: JSONObject, words: List<String>): Int {
        val name = " ${norm(it.optString("name"))} "
        val more = "$name ${norm(artists(it))} ${norm(it.optString("owner"))}"
        val w = words.filter { it.isNotEmpty() }
        return when { w.all { name.contains(it) } -> 3; w.all { more.contains(it) } -> 2; else -> 0 }
    }

    /** Künstler/Alben/Playlists: nur passende Treffer, Titel nur sortieren */
    private fun relevant(arr: JSONArray?, q: String, strict: Boolean): JSONArray {
        if (arr == null) return JSONArray()
        val words = norm(q).split(" ")
        val all = (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.map { it to score(it, words) }
        val hit = all.filter { it.second > 0 }.sortedByDescending { it.second }.map { it.first }
        val rest = if (strict) emptyList() else all.filter { it.second == 0 }.map { it.first }
        return JSONArray(hit + rest)
    }

    private fun grouped(list: List<MediaItem>, group: String) = list.map { m ->
        val ex = Bundle(m.mediaMetadata.extras ?: Bundle()).apply { putString(GROUP, group) }
        m.buildUpon().setMediaMetadata(m.mediaMetadata.buildUpon().setExtras(ex).build()).build()
    }

    // ---------------------------------------------------------------- Abspielen
    fun play(player: MaPlayer, item: MediaItem) {
        val id = item.mediaId
        val query = item.requestMetadata.searchQuery?.toString()
        when {
            id.startsWith("spk:") -> selectSpeaker(player, id.substring(4))
            id.startsWith("sw|") -> toggleSwitch(id)
            id.startsWith("play:") -> playUri(player, id.substring(5))
            id.startsWith("open|") -> playUri(player, id.split("|", limit = 5).getOrNull(4))
            id.startsWith("air:") -> {
                val q = player.playerId(); if (q.isEmpty()) return
                ma().send("ai_radio/start", o("station_id" to id.substring(4), "player_id_override" to q)) { _, e ->
                    if (e != null) Log.w(TAG, "AI Radio: $e"); player.refreshSoon()
                }
            }
            !query.isNullOrBlank() -> playFromSearch(player, query)
            else -> player.queueCmd("play")
        }
    }

    /** „Hey Google, spiele … auf Party-Jukebox“: Name passt genau → Künstler/Playlist/Album, sonst bester Treffer */
    private fun playFromSearch(player: MaPlayer, query: String) {
        val a = withProfile(o("search_query" to query.trim(), "limit" to 5), "providers")
        a.put("media_types", JSONArray(listOf("track", "artist", "playlist", "album")))
        ma().send("music/search", a) { r, _ ->
            val res = r as? JSONObject ?: return@send
            val ql = query.trim().lowercase()
            for (k in listOf("artists", "playlists", "albums")) {
                val first = res.optJSONArray(k)?.optJSONObject(0) ?: continue
                if (first.optString("name").lowercase() == ql) { playUri(player, first.optString("uri")); return@send }
            }
            for (k in listOf("tracks", "artists", "playlists", "albums")) {
                val first = res.optJSONArray(k)?.optJSONObject(0) ?: continue
                playUri(player, first.optString("uri")); return@send
            }
        }
    }

    fun playEpisode(player: MaPlayer, uri: String?) = playUri(player, uri)

    private fun playUri(player: MaPlayer, uri: String?) {
        val q = player.playerId()
        if (q.isEmpty() || uri.isNullOrEmpty()) return
        ma().send("player_queues/play_media", withProfile(o("queue_id" to q, "media" to uri, "option" to "play"), null)) { _, e ->
            if (e != null) Log.w(TAG, "Abspielen: $e")
            player.refreshSoon()
        }
    }

    /** Lautsprecher wechseln – läuft gerade Musik, zieht sie mit um */
    /**
     * Lautsprecher antippen = ansehen und steuern. Musik wird NICHT verschoben
     * (im Auto läuft das Handy weiter). Mitnehmen geht über den Knopf "Ins Auto holen".
     */
    private fun selectSpeaker(player: MaPlayer, id: String) {
        p().edit().putString("aa_pid", id).apply()
        MainActivity.js("window.playerCmd&&window.playerCmd('select:$id')")   // Jukebox-Seite (falls offen) mitziehen
        player.refreshSoon()
        changed("spk")
    }

    // ---------------------------------------------------------------- Hilfen
    private fun items(r: Any?, playlists: Boolean, playOnly: Boolean = false): List<MediaItem> {
        val a = r as? JSONArray ?: return emptyList()
        val l = mutableListOf<MediaItem>()
        for (i in 0 until a.length()) {
            if (l.size >= 200) break
            val it = a.optJSONObject(i) ?: continue
            val uri = it.optString("uri"); if (uri.isEmpty()) continue
            val type = it.optString("media_type", "")
            val owner = it.optString("owner", "")
            val sub = when (type) {
                "track" -> artists(it)
                "artist" -> "Künstler"
                "album" -> "Album · ${artists(it)}"
                "playlist" -> if (owner.isEmpty()) "Playlist" else "Playlist · $owner"
                "radio" -> "Radiosender"
                "podcast" -> "Podcast"
                "audiobook" -> "Hörbuch"
                else -> ""
            }
            val md = MediaMetadata.Builder().setTitle(it.optString("name")).setSubtitle(sub).setArtist(sub)
                .setArtworkUri(ArtProvider.uri(image(it)))
            if (!playOnly && type in listOf("artist", "album", "playlist", "podcast")) {
                val oid = "open|$type|${it.optString("provider", "library")}|${it.optString("item_id")}|$uri"
                md.setIsBrowsable(true).setIsPlayable(false).setMediaType(when (type) {
                    "artist" -> MediaMetadata.MEDIA_TYPE_ARTIST
                    "album" -> MediaMetadata.MEDIA_TYPE_ALBUM
                    "playlist" -> MediaMetadata.MEDIA_TYPE_PLAYLIST
                    else -> MediaMetadata.MEDIA_TYPE_PODCAST
                })
                l.add(MediaItem.Builder().setMediaId(oid).setMediaMetadata(md.build()).build())
            } else {
                md.setIsBrowsable(false).setIsPlayable(true).setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
                l.add(MediaItem.Builder().setMediaId("play:$uri").setMediaMetadata(md.build()).build())
            }
        }
        return l
    }

    /** Cover wie in der Jukebox-Seite (imgUrl): direkte Adresse, proxy_id oder ma/imageproxy */
    private fun pick(x: JSONObject?): Any? {
        if (x == null) return null
        val im = x.opt("image")
        if (im is JSONObject || (im is String && im.isNotEmpty())) return im
        val ims = x.optJSONObject("metadata")?.optJSONArray("images") ?: return null
        if (ims.length() == 0) return null
        for (i in 0 until ims.length()) { val y = ims.optJSONObject(i); if (y?.optString("type") == "thumb") return y }
        return ims.optJSONObject(0)
    }

    fun image(it: JSONObject?): String {
        if (it == null) return ""
        val mi = it.optJSONObject("media_item")
        val im = pick(it) ?: pick(mi) ?: pick(it.optJSONObject("album")) ?: pick(mi?.optJSONObject("album")) ?: return ""
        return try {
            if (im is String) return if (im.startsWith("http")) im else ""
            val o = im as JSONObject
            val enc = "UTF-8"
            val proxy = o.optString("proxy_id")
            if (proxy.isNotEmpty()) return Endpoint.base + "ma/imageproxy/" + URLEncoder.encode(proxy, enc) + "?size=512"
            val path = o.optString("path", "")
            if (path.isEmpty()) return ""
            if (o.optBoolean("remotely_accessible") && path.startsWith("http")) return path
            Endpoint.base + "ma/imageproxy?path=" + URLEncoder.encode(URLEncoder.encode(path, enc), enc) +
                "&provider=" + URLEncoder.encode(o.optString("provider", ""), enc) + "&size=512"
        } catch (e: Exception) { "" }
    }

    /** Ordner (zum Durchblättern); style = wie der Inhalt angezeigt wird (Liste oder große Kacheln) */
    private fun folder(id: String, title: String, sub: String?, style: Int = LIST): MediaItem {
        val ex = Bundle().apply { putInt(STYLE_BROWSABLE, style); putInt(STYLE_PLAYABLE, style) }
        val md = MediaMetadata.Builder().setTitle(title).setSubtitle(sub).setIsBrowsable(true).setIsPlayable(false)
            .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED).setExtras(ex).build()
        return MediaItem.Builder().setMediaId(id).setMediaMetadata(md).build()
    }

    /** etwas zum Antippen (Titel, Lautsprecher, Sender) */
    private fun playable(id: String, title: String, sub: String): MediaItem {
        val md = MediaMetadata.Builder().setTitle(title).setSubtitle(sub.ifEmpty { null }).setIsBrowsable(false).setIsPlayable(true).build()
        return MediaItem.Builder().setMediaId(id).setMediaMetadata(md).build()
    }
}
