package de.partyjukebox.player

/*
 * ===== Lernkarte: MaPlayer =====
 * Media3 (Googles Bibliothek für Musik-Apps) erwartet einen "Player": ein Objekt, das sagt,
 * was gerade läuft (Titel, Cover, Position, Lautstärke) und Befehle annimmt (Play, Pause, Weiter …).
 *
 * Unsere App spielt selbst keine Musik ab – das macht Music Assistant (MA) auf einer Box.
 * Darum ist MaPlayer ein "Fernbedienungs-Player":
 *   - alle 3 Sekunden fragt er MA, was auf dem gewählten Lautsprecher läuft  → poll()
 *   - drückt jemand Play/Weiter (Sperrbildschirm, Uhr, Android Auto) → Befehl an MA
 *
 * SimpleBasePlayer nimmt uns fast alles ab: wir beschreiben nur den Zustand (getState)
 * und reagieren auf Befehle (die Funktionen, die mit "handle…" anfangen).
 *
 * Kotlin-Mini-Wissen:
 *   val = fester Wert, var = veränderbar, "?" = darf leer (null) sein,
 *   "x ?: y" = nimm x, wenn leer dann y,   "it" = das aktuelle Element in einer Schleife/Lambda.
 */

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.DeviceInfo
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONArray
import org.json.JSONObject

class MaPlayer(private val ctx: Context) : SimpleBasePlayer(Looper.getMainLooper()) {

    /** Ein Eintrag der Anzeige: der laufende Titel und die nächsten aus der Warteschlange. */
    private data class Entry(val id: String, val title: String, val artist: String, val album: String,
                             val art: String, val durationMs: Long, val live: Boolean, val quality: String = "",
                             val mi: JSONObject? = null, val song: Boolean = false)   // mi = MA-Eintrag, song = Radio mit Song-Infos

    private val h = Handler(Looper.getMainLooper())
    private var entries: List<Entry> = emptyList()
    private var playing = false
    /** Lautsprecher steht auf TV-Eingang (z. B. Sonos Beam) – dann gilt die MA-Warteschlange nicht */
    @Volatile private var tvMode = false
    private var positionMs = 0L
    private var volume: Int? = null          // null = Lautsprecher ohne regelbare Lautstärke
    private var speakerName = ""              // Name des Lautsprechers (für die Anzeige im Auto)

    /** Android Auto verbunden? Dann "lokal" melden – sonst zeigt das Auto nur "Auf einem anderen Gerät" */
    var carMode = false
        set(v) {
            if (field == v) return
            field = v
            if (v) { carSwitched = false; suggestDismissed = false; boardCur = null; toCar(); Library.load("pnew") { } } else fromCar()
            invalidateState()
            refreshSoon()   // Takt sofort anpassen (Auto = schnell)
        }
    private var carSwitched = false

    /*
     * Podcast-Hörer im Auto (Einstellung „Neue Podcast-Folge vorschlagen“): läuft gerade nichts, zeigt die Medien-Karte die neueste Podcast-Folge
     * ("Neu diese Woche") mit großem ▶ – ein Tipp spielt sie ab. Weiter/Zurück blendet sie aus.
     */
    private var suggestDismissed = false
    // Titel beim Einsteigen: wechselt er (z. B. „Jetzt abspielen“ aus der Push-Nachricht), gilt der Vorschlag als erledigt
    private var boardCur: String? = null
    private fun showSuggestion() = carMode && !playing && !suggestDismissed && Library.podcastUser() && Library.suggestion != null

    private fun suggestEntry(): Entry {
        val e = Library.suggestion!!
        val pod = e.optJSONObject("podcast")?.optString("name").orEmpty()
        val art = Library.image(e).ifEmpty { Library.image(e.optJSONObject("podcast")) }
        return Entry("suggest", e.optString("name"), "Neu: $pod", pod, art, e.optLong("duration", 0) * 1000, false)
    }

    /*
     * Einsteigen: Android Auto verbindet sich → Ziel ist das eigene Handy (Ton übers Auto).
     * Musik, die zuhause läuft, bleibt dort (vielleicht hört gerade jemand anderes).
     * Aussteigen: wieder der Lautsprecher von vorher.
     */
    private fun toCar() {
        val phone = PhonePlayer.playerId(ctx)
        if (phone.isEmpty()) return            // Handy-Player noch nicht bereit → poll() versucht es weiter
        carSwitched = true
        val cur = playerId()
        if (cur == phone) return
        Endpoint.prefs(ctx).edit().putString("aa_pid_home", cur).putString("aa_pid", phone).apply()
        MainActivity.js("window.playerCmd&&window.playerCmd('select:$phone')")
        refreshSoon()
    }

    private fun fromCar() {
        val prefs = Endpoint.prefs(ctx)
        val home = prefs.getString("aa_pid_home", "") ?: ""
        if (home.isEmpty() || playerId() != PhonePlayer.playerId(ctx)) return
        prefs.edit().putString("aa_pid", home).remove("aa_pid_home").apply()
        MainActivity.js("window.playerCmd&&window.playerCmd('select:$home')")
        refreshSoon()
    }
    private var lastPid = ""
    private var polling = false
    private var tick = 0
    private var ignorePlayUntil = 0L          // nach "Abspielen von …" kein extra Play-Befehl hinterher

    private val ma get() = MaClient.get(ctx)

    /** gewählter Lautsprecher (kommt von der Jukebox-Seite bzw. aus Android Auto) */
    fun playerId(): String = Endpoint.prefs(ctx).getString("aa_pid", "") ?: ""

    /** Handy selbst als Lautsprecher → Lautstärketasten regeln das Handy */
    fun isPhone(): Boolean { val p = PhonePlayer.playerId(ctx); return p.isNotEmpty() && p == playerId() }

    /** true = Tasten regeln die Box, false = Tasten regeln das Handy */
    fun isRemote(): Boolean = volume != null && !isPhone()

    // ---------------------------------------------------------------- Zustand für Media3
    /*
     * Lernkarte: kurzer Hinweis im Player-Bildschirm
     * Android Auto zeigt bei eigenen Knöpfen nur das Symbol. Damit man sieht, was ein Tipp bewirkt hat,
     * steht ein paar Sekunden lang ein Hinweis in der zweiten Zeile (statt des Interpreten), danach wieder normal.
     */
    @Volatile private var note = ""
    @Volatile private var noteUntil = 0L
    fun showNote(text: String, ms: Long = 4000) {
        note = text; noteUntil = System.currentTimeMillis() + ms
        h.post { invalidateState() }
        h.postDelayed({ invalidateState() }, ms + 100)
    }

    override fun getState(): SimpleBasePlayer.State {
        val remote = isRemote() && !carMode
        val cb = Player.Commands.Builder().addAll(
            Player.COMMAND_PLAY_PAUSE, Player.COMMAND_STOP,
            Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_PREVIOUS,
            Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_MEDIA_ITEM, Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
            Player.COMMAND_GET_CURRENT_MEDIA_ITEM, Player.COMMAND_GET_TIMELINE, Player.COMMAND_GET_METADATA,
            Player.COMMAND_SET_MEDIA_ITEM, Player.COMMAND_CHANGE_MEDIA_ITEMS
        )
        if (remote) cb.addAll(Player.COMMAND_GET_DEVICE_VOLUME, Player.COMMAND_SET_DEVICE_VOLUME_WITH_FLAGS,
            Player.COMMAND_ADJUST_DEVICE_VOLUME_WITH_FLAGS)

        // jede ID darf nur einmal vorkommen (Media3 prüft das)
        val shown = if (showSuggestion()) listOf(suggestEntry()) else entries
        val playlist = shown.distinctBy { it.id }.mapIndexed { i, e ->
            val mb = MediaMetadata.Builder()
                .setTitle(e.title)
                // kurz eingeblendeter Hinweis (z. B. "🎚 Klang: Rock") statt Interpret – nur beim laufenden Titel
                .setArtist(if (i == 0 && System.currentTimeMillis() < noteUntil) note else withSpeaker(e))
                .setAlbumTitle(e.album)
                .setArtworkUri(ArtProvider.uri(e.art))   // Cover über unseren ArtProvider (lädt mit Anmeldung)
                .setIsPlayable(true).setIsBrowsable(false)
            // laufender Titel: Cover zusätzlich als Bild mitgeben – die Uhr kann content:// vom Handy nicht laden
            if (i == 0) artBytes(e.art)?.let { mb.setArtworkData(it, MediaMetadata.PICTURE_TYPE_FRONT_COVER) }
            val md = mb.build()
            val b = SimpleBasePlayer.MediaItemData.Builder(e.id)
                .setMediaItem(MediaItem.Builder().setMediaId(e.id).setMediaMetadata(md).build())
                .setMediaMetadata(md)
                .setIsSeekable(!e.live && e.durationMs > 0)
                .setIsDynamic(e.live)
                .setDurationUs(if (e.live || e.durationMs <= 0) C.TIME_UNSET else e.durationMs * 1000)
            if (e.live) b.setLiveConfiguration(MediaItem.LiveConfiguration.Builder().build())  // Radio: kein Fortschrittsbalken
            b.build()
        }

        // Box mit Lautstärke = "remote" (Tasten → Box), sonst "local" (Tasten → Handy)
        val device = if (remote) DeviceInfo.Builder(DeviceInfo.PLAYBACK_TYPE_REMOTE).setMinVolume(0).setMaxVolume(100).build()
                     else DeviceInfo.Builder(DeviceInfo.PLAYBACK_TYPE_LOCAL).build()

        val s = SimpleBasePlayer.State.Builder()
            .setAvailableCommands(cb.build())
            .setPlaylist(playlist)
            .setPlayWhenReady(playing, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
            .setPlaybackState(if (playlist.isEmpty()) Player.STATE_IDLE else Player.STATE_READY)
            .setDeviceInfo(device)
        if (remote) s.setDeviceVolume(volume ?: 0)
        if (playlist.isNotEmpty()) {
            s.setCurrentMediaItemIndex(0)
            // Position läuft von selbst weiter, solange gespielt wird
            s.setContentPositionMs(SimpleBasePlayer.PositionSupplier.getExtrapolating(positionMs, if (playing) 1f else 0f))
        }
        return s.build()
    }

    /** "Broilers · 🔊 Wohnzimmer" – zeigt im Auto, wo die Musik gerade läuft (nicht beim eigenen Handy) */
    /** Radio: "ROSÉ & Bruno Mars · 📻 WDR 2 · MP3 128k" – damit klar ist, dass es Radio ist (keine Länge, kein Spulen) */
    private fun withSpeaker(e: Entry): String {
        val artist = when {
            e.live && !e.song -> "📻 Live-Radio"
            e.song && e.artist == e.album -> "📻 " + e.artist   // Sender liefert nur den Titel
            else -> e.artist
        }
        val station = if (e.song && e.album.isNotEmpty() && e.album != e.artist) "📻 " + e.album else ""
        return listOf(artist, station, if (speakerName.isEmpty() || isPhone()) "" else "🔊 $speakerName", e.quality)
            .filter { it.isNotEmpty() }.joinToString(" · ")
    }

    /**
     * Wiedergabequalität aus den Stream-Daten von MA, z. B. "FLAC 24/96" (Hi-Res), "FLAC 16/44,1", "OGG 320k".
     * (wie die Qualitätsanzeige in der Jukebox-Seite)
     */
    private fun quality(sd: JSONObject?): String {
        val af = sd?.optJSONObject("audio_format") ?: return ""
        val ct = af.optString("content_type").lowercase()
        if (ct.isEmpty() || ct == "null") return ""
        val lossless = Regex("flac|wav|alac|aif|pcm").containsMatchIn(ct)
        val sr = af.optInt("sample_rate", 0); val bd = af.optInt("bit_depth", 0); val br = af.optInt("bit_rate", 0)
        val name = if (ct.startsWith("pcm")) "PCM" else ct.uppercase()
        val khz = (sr / 1000.0).let { if (it % 1.0 == 0.0) it.toInt().toString() else it.toString().replace('.', ',') }
        return when {
            lossless && sr > 0 && bd > 0 -> "$name $bd/$khz"
            !lossless && br > 0 -> "$name ${br}k"
            else -> name
        }
    }

    // ---------------------------------------------------------------- Befehle → Music Assistant
    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
        if (playWhenReady && System.currentTimeMillis() < ignorePlayUntil) return done()
        if (playWhenReady && showSuggestion()) {
            // neue Folge abspielen
            val uri = Library.suggestion?.optString("uri").orEmpty()
            suggestDismissed = true; playing = true
            Library.playEpisode(this, uri)
            return done()
        }
        playing = playWhenReady  // sofort anzeigen, MA bestätigt beim nächsten Abfragen
        queueCmd(if (playWhenReady) "play" else "pause")
        return done()
    }

    override fun handleStop(): ListenableFuture<*> { queueCmd("stop"); return done() }

    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
        val q = playerId()
        if (showSuggestion()) { suggestDismissed = true; invalidateState(); return done() }   // Vorschlag wegwischen
        when (seekCommand) {
            Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> queueCmd("next")
            Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> queueCmd("previous")
            Player.COMMAND_SEEK_TO_MEDIA_ITEM -> {
                // Titel aus der Warteschlange antippen (Uhr, Android Auto)
                val id = entries.distinctBy { it.id }.getOrNull(mediaItemIndex)?.id
                if (mediaItemIndex > 0 && id != null && q.isNotEmpty())
                    ma.send("player_queues/play_index", o("queue_id" to q, "index" to id)) { _, _ -> refreshSoon() }
            }
            else -> if (q.isNotEmpty() && positionMs >= 0) {
                this.positionMs = positionMs
                ma.send("player_queues/seek", o("queue_id" to q, "position" to (positionMs / 1000).toInt())) { _, _ -> refreshSoon() }
            }
        }
        return done()
    }

    /** Android Auto / Sprachsuche will etwas abspielen → Library.play() entscheidet, was genau */
    override fun handleSetMediaItems(mediaItems: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<*> {
        val item = mediaItems.getOrNull(if (startIndex in mediaItems.indices) startIndex else 0)
        if (item != null) {
            ignorePlayUntil = System.currentTimeMillis() + 3000
            Library.play(this, item)
        }
        return done()
    }

    override fun handleSetDeviceVolume(deviceVolume: Int, flags: Int): ListenableFuture<*> { setVolume(deviceVolume); return done() }
    override fun handleIncreaseDeviceVolume(flags: Int): ListenableFuture<*> { adjustVolume(+1); return done() }
    override fun handleDecreaseDeviceVolume(flags: Int): ListenableFuture<*> { adjustVolume(-1); return done() }
    override fun handleRelease(): ListenableFuture<*> { stopPolling(); return done() }

    private fun done(): ListenableFuture<*> = Futures.immediateVoidFuture()

    /** Lautstärketaste: +1 lauter, -1 leiser (in 3er-Schritten) */
    fun adjustVolume(dir: Int) {
        // eigenes Handy als Lautsprecher: direkt im Player regeln (meldet MA den neuen Wert selbst)
        if (isPhone()) { SendspinPlayer.changeVolume(dir * 3); refreshSoon(); return }
        volume?.let { setVolume(it + dir * 3) }
    }

    private fun setVolume(v: Int) {
        val q = playerId(); if (q.isEmpty()) return
        val nv = v.coerceIn(0, 100)
        volume = nv; invalidateState()
        // erst die ganze Gruppe versuchen, sonst nur den einen Lautsprecher
        ma.send("players/cmd/group_volume", o("player_id" to q, "volume_level" to nv)) { _, err ->
            if (err != null) ma.send("players/cmd/volume_set", o("player_id" to q, "volume_level" to nv)) { _, _ -> }
        }
    }

    /*
     * Lernkarte: Herz-Knopf (Favorit)
     * Wie in der Jukebox-Seite: der laufende Titel wird in Music Assistant als Favorit markiert.
     * Läuft Radio mit Song-Infos, suchen wir den Song (Interpret + Titel) und markieren ihn – nicht den Sender.
     * Ob ein Titel schon Favorit ist, steht am Bibliotheks-Eintrag (music/get_library_item).
     */
    var favOn = false
        private set
    private var favKey = ""
    private var favItem: JSONObject? = null   // gilt als Favorit (bei Radio: der gefundene Song)
    private var favLib: JSONObject? = null    // passender Bibliotheks-Eintrag (zum Entfernen nötig)
    private var favTick = 0
    private val songCache = HashMap<String, JSONObject?>()

    private fun setFav(v: Boolean) { if (favOn != v) { favOn = v; onFavChanged?.invoke() } }

    private fun favCheck(e: Entry?) {
        val typeChanged = (curEntry?.mi?.optString("media_type") != e?.mi?.optString("media_type")) || ((curEntry?.durationMs ?: 0L) <= 0L) != ((e?.durationMs ?: 0L) <= 0L)
        curEntry = e
        if (typeChanged) onFavChanged?.invoke()   // Podcast ↔ Musik: ±15-s-Knöpfe ein/aus
        val key = when {
            e == null -> ""
            e.song -> "r|" + e.artist + "|" + e.title
            else -> e.mi?.optString("uri").orEmpty()
        }
        if (key == favKey && ++favTick % 20 != 0) return   // neuer Titel sofort, sonst ab und zu nachsehen
        if (key != favKey) { favKey = key; favItem = null; favLib = null; setFav(false); onFavChanged?.invoke() }   // neuer Titel → Knopfreihe neu (±15 s)
        if (e == null || key.isEmpty()) return
        if (e.song) {
            if (songCache.containsKey(key)) { favUse(key, songCache[key]); return }
            ma.send("music/search", o("search_query" to e.artist + " " + e.title, "media_types" to JSONArray().put("track"), "limit" to 8)) { r, _ ->
                val a = (r as? JSONObject)?.optJSONArray("tracks")
                val list = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }
                val nt = norm(e.title)
                val na = norm(e.artist).substringBefore(" ")
                val hit = list.firstOrNull { norm(it.optString("name")) == nt && (na.isEmpty() || norm(artists(it)).contains(na)) }
                    ?: list.firstOrNull { norm(it.optString("name")).startsWith(nt) }
                if (songCache.size > 50) songCache.clear()
                songCache[key] = hit
                favUse(key, hit)
            }
        } else favUse(key, e.mi)
    }

    private fun favUse(key: String, item: JSONObject?) {
        if (key != favKey) return
        favItem = item
        if (item == null) { setFav(false); return }
        if (item.optString("provider") == "library") { favLib = item; setFav(item.optBoolean("favorite")); return }
        ma.send("music/get_library_item", o("media_type" to item.optString("media_type", "track"), "item_id" to item.optString("item_id"),
            "provider_instance_id_or_domain" to item.optString("provider"))) { r, _ ->
            if (key != favKey) return@send
            val l = r as? JSONObject
            favLib = l
            setFav(l?.optBoolean("favorite") ?: item.optBoolean("favorite"))
        }
    }

    private fun norm(x: String) = x.lowercase().replace(Regex("\\(.*?\\)|\\[.*?\\]|feat\\..*$"), "")
        .replace(Regex("[^a-z0-9äöüß]+"), " ").trim()

    /** Podcast oder Hörbuch? Dann zeigt Android Auto ±15-s-Knöpfe */
    private var curEntry: Entry? = null
    fun spokenWord(): Boolean {
        val e = curEntry ?: return false
        val t = e.mi?.optString("media_type").orEmpty()
        return !e.live && e.durationMs > 0 && (t == "podcast_episode" || t == "audiobook")
    }

    /** 15 s vor/zurück im laufenden Titel */
    fun seekBy(deltaMs: Long) {
        val q = playerId(); val e = entries.firstOrNull()
        if (q.isEmpty() || e == null || e.live) return
        val max = if (e.durationMs > 0) e.durationMs - 1000 else Long.MAX_VALUE
        val target = (currentPosition + deltaMs).coerceIn(0L, maxOf(0L, max))
        positionMs = target; invalidateState()
        showNote(if (deltaMs < 0) "⏪ 15 s zurück" else "15 s vor ⏩")
        ma.send("player_queues/seek", o("queue_id" to q, "position" to (target / 1000).toInt())) { _, _ -> refreshSoon() }
    }

    /** Herz gedrückt: Favorit an/aus */
    fun toggleFav() {
        val e = entries.firstOrNull()
        val it = favItem ?: run { showNote(if (e?.song == true) "♡ „" + e.title + "“ nicht gefunden" else "♡ Gerade läuft kein Titel"); return }
        val on = !favOn
        setFav(on); showNote(if (on) "❤️ Favorit" else "♡ Kein Favorit mehr")
        val recheck = { h.postDelayed({ favKey = ""; refreshSoon() }, 2500) }
        if (on) ma.send("music/favorites/add_item", o("item" to it.optString("uri"))) { _, err ->
            if (err != null) { setFav(false); showNote("Favorit ging nicht") } else recheck()
        } else {
            val l = favLib
            if (l == null || l.optString("item_id").isEmpty()) { setFav(true); showNote("Favorit ging nicht"); return }
            ma.send("music/favorites/remove_item", o("media_type" to l.optString("media_type", "track"), "library_item_id" to l.optString("item_id"))) { _, err ->
                if (err != null) { setFav(true); showNote("Favorit ging nicht") } else recheck()
            }
        }
    }

    /** Liste leeren: alle kommenden Titel entfernen, die MA noch nicht geladen hat (laufender spielt weiter) */
    fun clearUpcoming() {
        val q = playerId(); if (q.isEmpty()) return
        ma.send("player_queues/get", o("queue_id" to q)) { r, _ ->
            val qu = r as? JSONObject ?: return@send
            val ci = qu.optInt("current_index", -1)
            val buf = if (qu.isNull("index_in_buffer")) ci else qu.optInt("index_in_buffer", ci)
            ma.send("player_queues/items", o("queue_id" to q, "limit" to 2000, "offset" to maxOf(0, buf + 1))) { r2, _ ->
                val a = r2 as? JSONArray ?: return@send
                for (i in 0 until a.length()) {
                    val id = a.optJSONObject(i)?.optString("queue_item_id").orEmpty()
                    if (id.isNotEmpty()) ma.send("player_queues/delete_item", o("queue_id" to q, "item_id_or_index" to id)) { _, _ -> }
                }
                refreshSoon()
            }
        }
    }

    /**
     * "Ins Auto holen": Liste des angezeigten Lautsprechers (ab dem laufenden Song) vorne ins Handy einfügen,
     * die bisherige Auto-Liste bleibt dahinter. Der Lautsprecher zuhause stoppt.
     * MA-Option "play" = sofort spielen, vorhandene Titel bleiben erhalten.
     */
    fun pullToPhone() {
        val src = playerId(); val phone = PhonePlayer.playerId(ctx)
        if (src.isEmpty() || phone.isEmpty() || src == phone) return
        ma.send("player_queues/get", o("queue_id" to src)) { r, _ ->
            val qu = r as? JSONObject ?: return@send
            val idx = maxOf(0, qu.optInt("current_index", 0))
            val pos = qu.optDouble("elapsed_time", 0.0).toInt()
            ma.send("player_queues/items", o("queue_id" to src, "limit" to 200, "offset" to idx)) { r2, _ ->
                val a = r2 as? JSONArray ?: return@send
                val uris = JSONArray()
                for (i in 0 until a.length()) {
                    val it = a.optJSONObject(i) ?: continue
                    val u = it.optJSONObject("media_item")?.optString("uri").orEmpty().ifEmpty { it.optString("uri") }
                    if (u.isNotEmpty() && u != "null") uris.put(u)
                }
                if (uris.length() == 0) return@send
                // ist noch jemand zuhause? Dann läuft die Musik dort weiter, sonst aus
                othersHome { home -> if (!home) ma.send("player_queues/stop", o("queue_id" to src)) { _, _ -> } }
                ma.send("player_queues/play_media", o("queue_id" to phone, "media" to uris, "option" to "play")) { _, _ ->
                    // an der Stelle weiter, an der der Song zuhause war
                    if (pos > 5) h.postDelayed({ ma.send("player_queues/seek", o("queue_id" to phone, "position" to pos)) { _, _ -> } }, 2500)
                    refreshSoon()
                }
            }
        }
        Endpoint.prefs(ctx).edit().putString("aa_pid", phone).apply()
        MainActivity.js("window.playerCmd&&window.playerCmd('select:$phone')")
        refreshSoon()
    }

    /*
     * Anwesenheit aus Home Assistant: "Ich" = die Person, die in der Jukebox unter Persönlich → Auto
     * eingestellt ist; geprüft werden alle anderen Personen (über das Add-on).
     * Unbekannt (keine Verbindung, nichts eingestellt) → lieber weiterlaufen lassen.
     */
    private fun othersHome(cb: (Boolean) -> Unit) {
        val me = CarPrefs.mePerson(ctx)
        Thread {
            val all = presence()
            val home = if (me.isEmpty() || all == null) true else all.filterKeys { it != me }.values.any { it == "home" }
            h.post { cb(home) }
        }.start()
    }

    /** Personen-Zustände vom Add-on (/party/presence); null = nicht erreichbar */
    private fun presence(): Map<String, String>? = try {
        val c = java.net.URL(Endpoint.base + "party/presence").openConnection() as java.net.HttpURLConnection
        c.connectTimeout = 3000; c.readTimeout = 6000
        Endpoint.cookie().takeIf { it.isNotEmpty() }?.let { c.setRequestProperty("Cookie", it) }
        if (c.responseCode != 200) null else {
            val a = JSONObject(c.inputStream.bufferedReader().readText()).optJSONArray("persons") ?: JSONArray()
            (0 until a.length()).mapNotNull { a.optJSONObject(it) }.associate { it.optString("id") to it.optString("state") }
        }
    } catch (e: Exception) { null }

    fun queueCmd(c: String) {
        val q = playerId(); if (q.isEmpty()) return
        busyAt = System.currentTimeMillis()
        // Handy-Lautsprecher schläft (Leerlauf)? Erst aufwecken, dann den Befehl schicken
        if (q == PhonePlayer.playerId(ctx) && !SendspinPlayer.isConnected()) {
            SendspinPlayer.wake(ctx, "Taste $c")
            SendspinPlayer.whenReady { ma.send("player_queues/$c", o("queue_id" to q)) { _, _ -> refreshSoon() } }
            return
        }
        ma.send("player_queues/$c", o("queue_id" to q)) { _, _ -> refreshSoon() }
    }

    // ---------------------------------------------------------------- Abfragen bei MA
    fun startPolling() { if (polling) return; polling = true; h.post(pollTask) }
    fun stopPolling() { polling = false; h.removeCallbacks(pollTask) }
    fun refreshSoon() { if (!polling) return; h.removeCallbacks(pollTask); h.postDelayed(pollTask, 800) }

    private val pollTask = object : Runnable {
        override fun run() {
            if (!polling) return
            val ms = pollMs()
            h.postDelayed(this, ms)
            Endpoint.keepAliveAsync(ctx)
            poll()
            if (ms >= DEEP_IDLE_MS) h.postDelayed({ MaClient.get(ctx).closeIdle() }, 8000)   // nach der Antwort Verbindung zu
        }
    }

    /*
     * Lernkarte: Akku sparen beim Nachfragen
     * Schnell (3 s) nur, wenn jemand hinschaut: Auto verbunden oder App offen.
     * Läuft Musik und das Handy liegt in der Tasche: 15 s (reicht für die Benachrichtigung).
     * Nichts läuft: 60 s. Jede Anfrage weckt WLAN/Mobilfunk – weniger Anfragen = weniger Akku.
     */
    private var busyAt = System.currentTimeMillis()
    private fun pollMs(): Long {
        val now = System.currentTimeMillis()
        if (carMode || uiVisible || playing) busyAt = now
        return when {
            carMode || uiVisible -> 3_000L
            playing -> 15_000L
            now - busyAt < 600_000L -> 60_000L
            else -> DEEP_IDLE_MS   // 10 min nichts los: nur noch alle 15 min nachsehen, Verbindung dazwischen zu
        }
    }

    /*
     * Lernkarte: Cover für die Uhr
     * Android Auto lädt das Cover über die content://-Adresse (ArtProvider). Die Uhr ist ein anderes Gerät –
     * sie bekommt nur, was als fertiges Bild in den Metadaten steckt. Darum laden wir das Cover des
     * laufenden Titels einmal, verkleinern es auf 320 px (klein = schnell über Bluetooth) und hängen es an.
     */
    private val artCache = object : LinkedHashMap<String, ByteArray>(4, 0.75f, true) {
        override fun removeEldestEntry(e: MutableMap.MutableEntry<String, ByteArray>?) = size > 3
    }
    private val artLoading = HashSet<String>()

    private fun artBytes(url: String?): ByteArray? {
        if (url.isNullOrEmpty()) return null
        artCache[url]?.let { return it }
        if (artLoading.add(url)) Thread {
            val b = try {
                ctx.contentResolver.openInputStream(ArtProvider.uri(url)!!)?.use { inp ->
                    val bmp = android.graphics.BitmapFactory.decodeStream(inp)
                    bmp?.let {
                        val sc = android.graphics.Bitmap.createScaledBitmap(it, 320, 320 * it.height / maxOf(1, it.width), true)
                        val out = java.io.ByteArrayOutputStream()
                        sc.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, out)
                        out.toByteArray()
                    }
                }
            } catch (e: Exception) { null }
            h.post { artLoading.remove(url); if (b != null) { artCache[url] = b; invalidateState() } }
        }.start()
        return null
    }

    private fun poll() {
        if (carMode && !carSwitched) toCar()
        val q = playerId()
        if (q != lastPid) { lastPid = q; entries = emptyList(); volume = null; speakerName = ""; tick = 0; invalidateState(); onPlayerChanged?.invoke() }
        if (q.isEmpty()) return
        ma.send("player_queues/get", o("queue_id" to q)) { r, _ ->
            val qu = r as? JSONObject ?: return@send
            if (q != playerId()) return@send   // inzwischen anderer Lautsprecher gewählt
            if (tvMode) {   // Fernseher läuft: alten Titel der Warteschlange nicht als "läuft" zeigen
                playing = true; positionMs = 0
                entries = listOf(Entry("tv", "TV-Ton", speakerName.ifEmpty { "Fernseher" }, "", "", 0, true))
                invalidateState(); return@send
            }
            val was = playing
            playing = qu.optString("state") == "playing"
            if (was != playing) AppLog.add("Medienkarte: " + q + (if (playing) " spielt" else " pausiert/aus") + (if (carMode) " (Auto)" else ""))
            positionMs = (qu.optDouble("elapsed_time", 0.0) * 1000).toLong()
            val cur = qu.optJSONObject("current_item")?.let { toEntry(it) }
            favCheck(cur)
            if (carMode) {
                // im Auto lief schon etwas / anderer Titel als beim Einsteigen → ▶ setzt diesen fort statt den Vorschlag zu starten
                if (boardCur == null) boardCur = cur?.id ?: ""
                if (playing || (cur?.id ?: "") != boardCur) suggestDismissed = true
            }
            if (cur == null) {
                // im Auto statt Fehlermeldung ("Auswahl konnte nicht geladen werden") einen Hinweis zeigen
                entries = if (carMode) listOf(Entry("empty", "Gerade läuft nichts", "Playlists oder Suche wählen", "", "", 0, false)) else emptyList()
                invalidateState(); return@send
            }
            if (entries.firstOrNull()?.id != cur.id || tick % 10 == 0) {
                // neuer Titel (oder alle 30 s): die nächsten 30 der Warteschlange neu holen
                val idx = qu.optInt("current_index", 0)
                ma.send("player_queues/items", o("queue_id" to q, "limit" to 31, "offset" to idx)) { r2, _ ->
                    val a = r2 as? JSONArray
                    val list = mutableListOf(cur)
                    if (a != null) for (i in 0 until a.length()) {
                        val it = a.optJSONObject(i) ?: continue
                        if (it.optString("queue_item_id") != cur.id) list.add(toEntry(it))
                    }
                    entries = list; invalidateState()
                }
            } else {
                entries = listOf(cur) + entries.drop(1); invalidateState()
            }
        }
        // Lautsprecher-Zustand: im Auto/bei offener App öfter (TV-Eingang schnell erkennen), sonst selten
        if (tick++ % (if (carMode || uiVisible) 2 else 5) == 0) ma.send("players/get", o("player_id" to q)) { r, _ ->
            val p = r as? JSONObject ?: return@send
            val cm = p.optJSONObject("current_media")
            val tv = p.optString("active_source") == "tv" || cm?.optString("source_id") == "tv" || cm?.optString("uri") == "homeTheater-input"
            if (tv != tvMode) { tvMode = tv; if (tv) entries = emptyList(); refreshSoon() }
            speakerName = p.optString("display_name").takeUnless { it.isEmpty() || it == "null" } ?: p.optString("name")
            val group = (p.optJSONArray("group_childs")?.length() ?: 0) > 1
            volume = when {
                group && !p.isNull("group_volume") -> p.optInt("group_volume")
                p.isNull("volume_level") -> null
                else -> p.optInt("volume_level")
            }
            invalidateState()
        }
    }

    /** Lautstärke-Meldung der Jukebox-Seite (schneller als unser Abfragen) */
    fun fromPage(v: Int) { if (volume != null) { volume = v.coerceIn(0, 100); invalidateState() } }

    /** Ein Warteschlangen-Eintrag von MA → Entry (Radio: laufender Song aus den Stream-Daten) */
    private fun toEntry(ci: JSONObject): Entry {
        fun s(o: JSONObject?, k: String) = o?.optString(k).orEmpty().takeUnless { it == "null" }.orEmpty()
        val mi = ci.optJSONObject("media_item")
        var title = s(mi, "name").ifEmpty { s(ci, "name") }
        var artist = mi?.let { artists(it) }.orEmpty()
        var album = s(mi?.optJSONObject("album"), "name")
        var art = Library.image(ci)
        val sd = ci.optJSONObject("streamdetails")
        val radio = s(mi, "media_type") == "radio" || s(sd, "media_type") == "radio"
        if (radio) {
            val station = title
            val sm = sd?.optJSONObject("stream_metadata")
            var st = s(sm, "title")
            var sa = s(sm, "artist")
            if (st.isEmpty()) {
                val raw = s(sd, "stream_title")
                val k = raw.indexOf(" - ")
                if (k > 0) { sa = raw.substring(0, k); st = raw.substring(k + 3) } else st = raw
            }
            s(sm, "image_url").takeIf { it.startsWith("http") }?.let { art = it }
            if (st.isNotEmpty()) { title = st; artist = sa.ifEmpty { station }; album = station }
            else { artist = "Radio"; album = station }
        }
        val d = ci.optDouble("duration", 0.0)
        val dur = if (d.isNaN()) 0L else (d * 1000).toLong()
        val id = s(ci, "queue_item_id").ifEmpty { title }
        return Entry(id, title.ifEmpty { "Jukebox" }, artist, album, art, dur, radio, quality(sd), mi, radio && album.isNotEmpty() && artist != "Radio" && title != album)
    }

    companion object {
        /** der laufende Player (für MainActivity / Jukebox-Seite) */
        @JvmField var instance: MaPlayer? = null
        /** App-Seite gerade sichtbar? (MainActivity setzt das in onResume/onPause) */
        @JvmField @Volatile var uiVisible = false
        /** anderer Lautsprecher gewählt → Knopfreihe im Auto anpassen (setzt JukeboxService) */
        @JvmField var onPlayerChanged: (() -> Unit)? = null
        /** Herz an/aus hat sich geändert → Knopfreihe neu (setzt JukeboxService) */
        @JvmField var onFavChanged: (() -> Unit)? = null
        private const val DEEP_IDLE_MS = 900_000L
        private val main = Handler(Looper.getMainLooper())

        /** Seite meldet eine Änderung → gleich bei MA nachsehen */
        @JvmStatic fun poke() { main.post { instance?.refreshSoon() } }
        @JvmStatic fun pageVolume(v: Int) { main.post { instance?.fromPage(v) } }

        fun artists(it: JSONObject): String {
            val a = it.optJSONArray("artists") ?: return it.optString("artist_str", "")
            return (0 until a.length()).mapNotNull { i -> a.optJSONObject(i)?.optString("name")?.takeIf { n -> n.isNotEmpty() } }
                .joinToString(", ")
        }

        /** kleines Hilfsmittel: o("a" to 1, "b" to "x") baut ein JSON-Objekt {"a":1,"b":"x"} */
        fun o(vararg kv: Pair<String, Any?>): JSONObject = JSONObject().apply { kv.forEach { (k, v) -> put(k, v) } }
    }
}
