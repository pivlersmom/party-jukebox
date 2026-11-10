package de.partyjukebox.player

/*
 * ===== Lernkarte: Service + MediaSession =====
 * Ein "Service" ist ein Teil der App ohne Bildschirm – er läuft weiter, wenn die App zu ist.
 * Android Auto, Sperrbildschirm, Uhr und Benachrichtigung reden NICHT mit der App-Seite,
 * sondern mit diesem Service.
 *
 *   Android Auto ──► MediaLibrarySession ──► MaPlayer  ──► Music Assistant ──► Box
 *                         │
 *                         └── Callback: "Was liegt im Ordner X?" → Library
 *
 * Die "Session" ist die Steckdose, an die sich alle Fernbedienungen anschließen.
 * Der "Callback" ist eine Sammlung von Funktionen, die Android aufruft, wenn etwas gefragt wird.
 * Media3 baut die Benachrichtigung mit Cover und Knöpfen automatisch aus dem Player-Zustand.
 */

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture

class JukeboxService : MediaLibraryService() {
    private var session: MediaLibrarySession? = null

    override fun onCreate() {
        AppLog.init(this)
        super.onCreate()
        CrashLog.install(this)
        Library.app = applicationContext
        AppLog.add("Medien-Dienst gestartet · Benachrichtigungen " +
            (if (androidx.core.app.NotificationManagerCompat.from(this).areNotificationsEnabled()) "erlaubt" else "AUS") +
            (if (android.os.Build.VERSION.SDK_INT >= 26) " · Kanäle: " + (getSystemService(android.app.NotificationManager::class.java)
                ?.notificationChannels?.joinToString { it.id + "=" + it.importance } ?: "?") else ""))
        // Jukebox-Logo statt Play-Zeichen (Benachrichtigung, Android-Auto-Karte)
        setMediaNotificationProvider(DefaultMediaNotificationProvider.Builder(this).build().apply { setSmallIcon(R.drawable.ic_stat_jukebox) })
        val player = MaPlayer(this)
        MaPlayer.instance = player
        // Tippen auf die Benachrichtigung öffnet die App
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        session = MediaLibrarySession.Builder(this, player, Callback()).setSessionActivity(open)
            .setCustomLayout(layout())
            .setCommandButtonsForMediaItems(ImmutableList.of(swButton))   // Knopf neben den Schaltern
            .build()
        Library.session = session
        // Sitzung gleich beim Dienst anmelden: dann zeigt Android die Medienkarte (Schnellzugriff, Sperrbildschirm)
        // auch, wenn sich noch kein Gerät (Auto, Uhr) verbunden hat
        session?.let { addSession(it) }
        MaPlayer.onPlayerChanged = { showLayout(); refreshKlang() }
        MaPlayer.onFavChanged = { showLayout() }
        player.startPolling()
        refreshHome()
        // Handy-Player auch starten, wenn nur Android Auto die App weckt (z. B. nach einem Update)
        if (PhonePlayer.enabled(this)) { PhonePlayer.start(this); KeepAliveService.sync(this) }
    }

    /** Android fragt: "Mit welcher Session soll ich mich verbinden?" */
    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

    /** Fehlersuche: wann Media3 die Benachrichtigung (Medienkarte im Schnellzugriff) aktualisiert */
    private var lastNotifLog = 0L
    override fun onUpdateNotification(session: MediaSession, startInForegroundRequired: Boolean) {
        if (System.currentTimeMillis() - lastNotifLog > 60_000) {
            lastNotifLog = System.currentTimeMillis()
            val p = session.player
            AppLog.add("Benachrichtigung: Vordergrund=$startInForegroundRequired · Zustand=${p.playbackState} · spielt=${p.playWhenReady} · Titel=${p.mediaItemCount}")
        }
        try { super.onUpdateNotification(session, startInForegroundRequired) }
        catch (e: Exception) { AppLog.add("⚠ Benachrichtigung: $e") }
    }

    /** App aus der Liste der letzten Apps gewischt: Musik auf der Box läuft einfach weiter */
    override fun onTaskRemoved(rootIntent: Intent?) { }

    override fun onDestroy() {
        main.removeCallbacks(carTick)
        Library.session = null
        MaPlayer.onPlayerChanged = null
        MaPlayer.onFavChanged = null
        MaPlayer.instance = null
        session?.let { it.player.release(); it.release() }
        session = null
        super.onDestroy()
    }

    /** Antworten auf die Fragen von Android Auto */
    /*
     * Eigener Knopf "Liste leeren" (Android Auto, Benachrichtigung):
     * SessionCommand = der Befehl (Name frei wählbar), CommandButton = wie er aussieht.
     */
    private val clearCmd = SessionCommand("jukebox.CLEAR_QUEUE", Bundle.EMPTY)
    @Suppress("DEPRECATION")
    private val clearButton = CommandButton.Builder()
        .setDisplayName("Liste leeren")
        .setIconResId(R.drawable.ic_clear_queue)
        .setSessionCommand(clearCmd)
        .build()

    private val toCarCmd = SessionCommand("jukebox.TO_CAR", Bundle.EMPTY)
    @Suppress("DEPRECATION")
    private val toCarButton = CommandButton.Builder()
        .setDisplayName("Ins Auto holen")
        .setIconResId(R.drawable.ic_to_car)
        .setSessionCommand(toCarCmd)
        .build()

    /* Knopf "Umschalten" neben jedem Schalter in ⚙ Einstellungen (Android Auto: Custom Browse Action) */
    private val swCmd = SessionCommand(Library.SW_TOGGLE, Bundle.EMPTY)
    @Suppress("DEPRECATION")
    private val swButton = CommandButton.Builder()
        .setDisplayName("Umschalten")
        .setIconResId(R.drawable.ic_stat_jukebox)
        .setIconUri(ArtProvider.icon("toggle"))
        .setSessionCommand(swCmd)
        .build()

    /*
     * Lernkarte: Knopf mit wechselndem Aussehen
     * Der erste Schalter aus ⚙ Einstellungen (z. B. Heimkommen) bekommt einen Knopf im Player-Bildschirm.
     * Ein CommandButton ist unveränderlich – bei jedem Umschalten bauen wir einen neuen (anderes Symbol,
     * anderer Text) und geben Android Auto mit setCustomLayout die neue Knopfreihe.
     */
    private val homeCmd = SessionCommand("jukebox.HOME_SW", Bundle.EMPTY)
    private var homeSw: Triple<String, String, Boolean>? = null

    @Suppress("DEPRECATION")
    private fun homeButton(sw: Triple<String, String, Boolean>) = CommandButton.Builder()
        .setDisplayName(sw.second + (if (sw.third) ": AN" else ": AUS"))
        .setIconResId(if (sw.third) R.drawable.ic_home_on else R.drawable.ic_home_off)
        .setSessionCommand(homeCmd)
        .build()

    /*
     * Lernkarte: Klang-Knopf im Player-Bildschirm
     * Jeder Tipp schaltet zur nächsten Klang-Voreinstellung (DSP-Preset aus Music Assistant) des gewählten
     * Lautsprechers, nach der letzten kommt "aus". Der Name steht auf dem Knopf – kein Sprung, man bleibt im Player.
     */
    private val klangCmd = SessionCommand("jukebox.KLANG", Bundle.EMPTY)
    private var klangName = "Klang"
    private val main = android.os.Handler(android.os.Looper.getMainLooper())

    /*
     * Lernkarte: "Auto noch da?" nachzählen
     * Android Auto verbindet sich oft mehrfach und meldet sich nicht immer ab (z. B. kabellos, Auto aus).
     * Dann blieb "im Auto" für immer an: Abfrage alle 3 s, kein Leerlauf-Schlaf → hoher Akkuverbrauch.
     * Darum jede Minute nachzählen, welche Auto-Verbindungen wirklich noch bestehen.
     */
    private fun carRecount() {
        val n = session?.connectedControllers?.count { isCar(it) } ?: 0
        if (n != cars) {
            if (n == 0 && cars > 0) AppLog.add("Android Auto weg (ohne Abmeldung) – Auto-Modus aus")
            cars = n
            MaPlayer.instance?.carMode = n > 0
        }
    }
    private val carTick = object : Runnable { override fun run() { carRecount(); main.postDelayed(this, 60_000) } }

    @Suppress("DEPRECATION")
    private fun klangButton() = CommandButton.Builder()
        .setDisplayName(klangName)
        .setIconResId(R.drawable.ic_klang)
        .setSessionCommand(klangCmd)
        .build()

    /* ±15 s: nur bei Podcast/Hörbuch (bei Musik bleibt es bei Titel vor/zurück) */
    private val backCmd = SessionCommand("jukebox.BACK15", Bundle.EMPTY)
    private val fwdCmd = SessionCommand("jukebox.FWD15", Bundle.EMPTY)

    @Suppress("DEPRECATION")
    private fun seekButton(back: Boolean) = CommandButton.Builder()
        .setDisplayName(if (back) "15 s zurück" else "15 s vor")
        .setIconResId(if (back) R.drawable.ic_back15 else R.drawable.ic_fwd15)
        .setSessionCommand(if (back) backCmd else fwdCmd)
        .build()

    /* Herz: laufender Titel als Favorit (gefüllt = schon Favorit) */
    private val favCmd = SessionCommand("jukebox.FAV", Bundle.EMPTY)

    @Suppress("DEPRECATION")
    private fun favButton(on: Boolean) = CommandButton.Builder()
        .setDisplayName(if (on) "Favorit entfernen" else "Als Favorit")
        .setIconResId(if (on) R.drawable.ic_fav_on else R.drawable.ic_fav_off)
        .setSessionCommand(favCmd)
        .build()

    /** "Ins Auto holen" nur, wenn gerade nicht schon das Handy spielt; "Liste leeren" ganz hinten (landet ggf. im ⋯-Menü) */
    private fun layout(): ImmutableList<CommandButton> {
        val onPhone = MaPlayer.instance?.playerId().let { it != null && it.isNotEmpty() && it == PhonePlayer.playerId(this) }
        val l = mutableListOf<CommandButton>()
        homeSw?.let { l.add(homeButton(it)) }
        if (MaPlayer.instance?.spokenWord() == true) { l.add(0, seekButton(false)); l.add(0, seekButton(true)) }
        l.add(klangButton())
        l.add(favButton(MaPlayer.instance?.favOn == true))
        if (!onPhone) l.add(toCarButton)
        l.add(clearButton)
        return ImmutableList.copyOf(l)
    }

    private fun showLayout() = main.post { try { session?.setCustomLayout(layout()) } catch (e: Exception) { } }

    /** Voreinstellungen + aktueller Klang des Lautsprechers → (Liste id/Name, aktuelle id oder "" = aus, DSP-Einstellung) */
    private fun loadKlang(cb: (List<Pair<String, String>>, String, org.json.JSONObject?) -> Unit) {
        val pid = MaPlayer.instance?.playerId().orEmpty()
        if (pid.isEmpty()) { cb(emptyList(), "", null); return }
        val ma = MaClient.get(this)
        ma.send("config/dsp_presets/get", org.json.JSONObject()) { r, _ ->
            val a = r as? org.json.JSONArray
            val presets = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }
                .map { it.optString("preset_id") to it.optString("name") }.filter { it.first.isNotEmpty() }
            ma.send("config/players/dsp/get", org.json.JSONObject().put("player_id", pid)) { c, _ ->
                val cfg = c as? org.json.JSONObject
                val cur = if (cfg?.optBoolean("enabled") == true) cfg.optString("preset_id").takeUnless { it == "null" } ?: "?" else ""
                cb(presets, cur, cfg)
            }
        }
    }

    private fun klangLabel(presets: List<Pair<String, String>>, cur: String) = when (cur) {
        "" -> "Klang: aus"
        else -> "Klang: " + (presets.firstOrNull { it.first == cur }?.second ?: "eigener")
    }

    private fun refreshKlang() = loadKlang { presets, cur, _ -> klangName = klangLabel(presets, cur); showLayout() }

    /** nächste Voreinstellung; nach der letzten (oder bei eigenem Klang) → aus; aus → erste */
    private fun nextKlang() = loadKlang { presets, cur, cfg ->
        val pid = MaPlayer.instance?.playerId().orEmpty()
        if (pid.isEmpty() || presets.isEmpty()) { klangName = "Klang: keine Voreinstellungen"; showLayout(); MaPlayer.instance?.showNote("🎚 Keine Klang-Voreinstellungen"); return@loadKlang }
        val i = presets.indexOfFirst { it.first == cur }
        val ma = MaClient.get(this)
        if (cur == "" || (i in 0 until presets.size - 1)) {
            val next = presets[if (cur == "") 0 else i + 1]
            klangName = "Klang: " + next.second; showLayout(); MaPlayer.instance?.showNote("🎚 " + klangName)
            ma.send("config/players/dsp/apply_preset", org.json.JSONObject().put("player_id", pid).put("preset_id", next.first)) { _, _ -> refreshKlang() }
        } else {
            klangName = "Klang: aus"; showLayout(); MaPlayer.instance?.showNote("🎚 Klang: aus")
            val c = cfg ?: org.json.JSONObject()
            c.put("enabled", false)
            ma.send("config/players/dsp/save", org.json.JSONObject().put("player_id", pid).put("config", c)) { _, _ -> refreshKlang() }
        }
    }

    /** Zustand des Schalters holen und die Knopfreihe erneuern */
    /** Haus-Knopf + Klang holen; klappt es gleich nach dem Start nicht (noch keine Verbindung), nochmal versuchen */
    private fun refreshHome(n: Int = 0): Unit = Library.firstSwitch { sw ->
        homeSw = sw
        showLayout()
        refreshKlang()
        if (sw == null && n < 3) main.postDelayed({ refreshHome(n + 1) }, 5000)
    }

    private inner class Callback : MediaLibrarySession.Callback {

        /*
         * Lernkarte: "Weiterspielen" von außen (Mini-Player im Schnellzugriff, Kopfhörer-/Lenkradtaste)
         * Ist gerade keine Wiedergabe aktiv, fragt Android die zuletzt benutzte Medien-App, was sie weiterspielen
         * kann. Ohne Antwort springt Android zu einer anderen App (z. B. Spotify). Jetzt: die Jukebox setzt die
         * Warteschlange in Music Assistant fort.
         */
        override fun onPlaybackResumption(session: MediaSession, controller: MediaSession.ControllerInfo):
                ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            AppLog.add("Weiterspielen angefragt (" + controller.packageName + ")")
            MaPlayer.instance?.queueCmd("play")
            val p = session.player
            val items = (0 until p.mediaItemCount).map { p.getMediaItemAt(it) }
            return Futures.immediateFuture(MediaSession.MediaItemsWithStartPosition(items, 0, p.currentPosition))
        }

        /** Wer sich verbindet (Android Auto, Uhr …), darf auch unseren eigenen Befehl benutzen */
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
            if (isCar(controller)) { main.removeCallbacks(carTick); main.postDelayed(carTick, 60_000) }
            if (isCar(controller)) { cars++; SendspinPlayer.wake(this@JukeboxService, "Android Auto"); MaPlayer.instance?.carMode = true; refreshHome() }
            val cmds = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon().add(clearCmd).add(toCarCmd).add(swCmd).add(homeCmd).add(klangCmd).add(favCmd).add(backCmd).add(fwdCmd).build()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(cmds)
                .setCustomLayout(layout())
                .build()
        }

        override fun onDisconnected(session: MediaSession, controller: MediaSession.ControllerInfo) {
            if (isCar(controller)) { cars = maxOf(0, cars - 1); if (cars == 0) MaPlayer.instance?.carMode = false }
            main.postDelayed({ carRecount() }, 1500)
        }

        /** Knopf gedrückt → kommende Titel in MA entfernen (der laufende spielt weiter) */
        override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo,
                                     customCommand: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
            if (customCommand.customAction == toCarCmd.customAction) {
                MaPlayer.instance?.pullToPhone()
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
            }
            if (customCommand.customAction == homeCmd.customAction) {
                val sw = homeSw ?: run { refreshHome(); return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS)) }
                // sofort umgedreht anzeigen, dann schalten und den echten Zustand nachladen
                homeSw = sw.copy(third = !sw.third); session.setCustomLayout(layout())
                MaPlayer.instance?.showNote("🏠 " + sw.second + (if (!sw.third) ": AN" else ": AUS"))
                Library.toggleLive(sw.first) { refreshHome() }
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
            }
            if (customCommand.customAction == backCmd.customAction || customCommand.customAction == fwdCmd.customAction) {
                MaPlayer.instance?.seekBy(if (customCommand.customAction == backCmd.customAction) -15_000L else 15_000L)
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
            }
            if (customCommand.customAction == favCmd.customAction) {
                MaPlayer.instance?.toggleFav()
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
            }
            if (customCommand.customAction == klangCmd.customAction) {
                nextKlang()
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
            }
            if (customCommand.customAction == swCmd.customAction) {
                // Android Auto schickt die ID des Eintrags mit, neben dem der Knopf gedrückt wurde
                val f = SettableFuture.create<SessionResult>()
                Library.toggleLive(args.getString("androidx.media.utils.extras.KEY_CUSTOM_BROWSER_ACTION_MEDIA_ITEM_ID")) { msg ->
                    f.set(SessionResult(SessionResult.RESULT_SUCCESS, Bundle().apply {
                        putString("androidx.media.utils.extras.KEY_CUSTOM_BROWSER_ACTION_RESULT_MESSAGE", msg)
                    }))
                }
                return f
            }
            if (customCommand.customAction == clearCmd.customAction) {
                MaPlayer.instance?.clearUpcoming()
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
            }
            return Futures.immediateFuture(@Suppress("DEPRECATION") SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
        }

        /** Startpunkt der Bibliothek + Hinweise: Suche möglich, Inhalte als Liste */
        override fun onGetLibraryRoot(session: MediaLibrarySession, browser: MediaSession.ControllerInfo,
                                      params: LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> {
            Library.preload()
            MaPlayer.poke()
            val ex = Bundle().apply {
                putBoolean("android.media.browse.SEARCH_SUPPORTED", true)
                putInt(Library.STYLE_BROWSABLE, Library.LIST)
                putInt(Library.STYLE_PLAYABLE, Library.LIST)
            }
            return Futures.immediateFuture(LibraryResult.ofItem(Library.rootItem(), LibraryParams.Builder().setExtras(ex).build()))
        }

        /** Inhalt eines Ordners. "SettableFuture" = ein Versprechen: die Antwort kommt später (wenn MA geantwortet hat) */
        override fun onGetChildren(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String,
                                   page: Int, pageSize: Int, params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            val f = SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()
            Library.load(parentId) { list -> f.set(LibraryResult.ofItemList(page(list, page, pageSize), params)) }
            return f
        }

        /** Suche (Lupe bzw. Sprache): erst "ich suche", dann melden, wie viele Treffer es gibt */
        override fun onSearch(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, query: String,
                              params: LibraryParams?): ListenableFuture<LibraryResult<Void>> {
            Library.search(query) { list ->
                results[query] = list
                session.notifySearchResultChanged(browser, query, list.size, params)
            }
            return Futures.immediateFuture(LibraryResult.ofVoid())
        }

        override fun onGetSearchResult(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, query: String,
                                       page: Int, pageSize: Int, params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            results[query]?.let { return Futures.immediateFuture(LibraryResult.ofItemList(page(it, page, pageSize), params)) }
            val f = SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()
            Library.search(query) { list -> results[query] = list; f.set(LibraryResult.ofItemList(page(list, page, pageSize), params)) }
            return f
        }

        /** Android Auto schickt nur die ID des angetippten Eintrags – die reichen wir unverändert an MaPlayer weiter */
        override fun onAddMediaItems(mediaSession: MediaSession, controller: MediaSession.ControllerInfo,
                                     mediaItems: MutableList<MediaItem>): ListenableFuture<MutableList<MediaItem>> =
            Futures.immediateFuture(mediaItems)
    }

    private val results = HashMap<String, List<MediaItem>>()

    /** Android Auto meldet sich mit dem Paketnamen "gearhead" */
    private var cars = 0
    private fun isCar(c: MediaSession.ControllerInfo) = c.packageName.contains("gearhead") || c.packageName.contains("android.car")

    /** Android Auto fragt evtl. seitenweise (z. B. 0–99, 100–199) */
    private fun page(list: List<MediaItem>, page: Int, size: Int): List<MediaItem> {
        if (size <= 0 || size >= list.size) return if (page <= 0) list else emptyList()
        val from = page * size
        return if (from >= list.size) emptyList() else list.subList(from, minOf(list.size, from + size))
    }
}
