package de.partyjukebox.player

/*
 * ===== Lernkarte: SendspinPlayer – das Handy als echter MA-Lautsprecher =====
 * Sendspin ist das Protokoll, mit dem Music Assistant Musik an Lautsprecher schickt.
 * Unsere App meldet sich selbst als Lautsprecher an – ohne MA-App, ohne Webseite.
 *
 *   App ──WebSocket──► MA (Port 8927)
 *     "client/hello"   : Hallo, ich bin "Mein Handy" und kann FLAC (lieber) oder PCM abspielen
 *     "server/hello"   : Willkommen
 *     "client/time"    : Wie spät ist es bei dir?  (Uhren abgleichen, ständig)
 *     "stream/start"   : Gleich kommt Musik in diesem Format
 *     Binär-Pakete     : [4][Zeitstempel 8 Byte][Audio] – "spiele das um Uhrzeit X"
 *     "server/command" : Lautstärke ändern / stumm
 *
 * Warum Uhrzeiten? Damit mehrere Lautsprecher exakt gleichzeitig spielen können.
 * Jedes Audio-Paket sagt, WANN es abgespielt werden soll (in der Uhrzeit von MA).
 * Wir rechnen das mit dem Uhren-Unterschied (offset) in unsere Handy-Uhrzeit um.
 *
 * Zuhause direkt per WLAN. Unterwegs per WebRTC (wie die MA-App), sonst über Nabu Casa (siehe RtcLink.kt).
 */

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTimestamp
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaFormat
import android.util.Base64
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.provider.Settings
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.math.abs

object SendspinPlayer {
    private const val TAG = "JukeboxSendspin"
    private const val PORT = 8927

    private lateinit var app: Context
    private val http = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS).build()
    private var thread: HandlerThread? = null
    private var h: Handler? = null
    @Volatile private var ws: Link? = null
    @Volatile private var running = false
    @Volatile var connected = false; private set
    private var retryMs = 3000L

    /** von MA angenommen? (für die Anzeige in der Jukebox) */
    @JvmStatic fun isConnected() = connected
    /** zuletzt empfangenes Format, z. B. "FLAC 48 kHz" – für die Einstellungen der Jukebox */
    @Volatile private var lastFormat = ""
    @JvmStatic fun format() = if (lastFormat.isEmpty()) "" else lastFormat + (ws?.route?.let { " · $it" } ?: "") + glitchText() + powerText()

    /*
     * Aussetzer-Zähler (seit App-Start), damit man sieht, WO es hakt:
     *   Puffer   = Handy hat zu spät nachgeliefert (Lautsprecher-Puffer lief leer)
     *   spät     = Pakete kamen zu spät an und wurden übersprungen (Netz)
     *   Lücke    = Stille eingefügt, weil die Musik zu früh dran war (Uhren-Abgleich)
     *   verloren = Paket weggeworfen (zu alt beim Start oder Decoder voll)
     */
    private val glitches = java.util.concurrent.atomic.AtomicIntegerArray(4)
    private fun glitch(i: Int) { glitches.incrementAndGet(i) }
    private fun glitchText(): String {
        val names = arrayOf("Puffer", "spät", "Lücke", "verloren")
        val parts = (0 until 4).filter { glitches[it] > 0 }.map { "${glitches[it]} ${names[it]}" }
        return if (parts.isEmpty()) "" else " · Aussetzer: " + parts.joinToString(", ")
    }
    @Volatile private var underrunBase = 0
    /** Hinweis, wenn Android die App bremst (Energiesparmodus / Akku-Optimierung) */
    private fun powerText(): String = try {
        val pm = app.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        when {
            pm.isPowerSaveMode -> " · ⚠ Energiesparmodus an"
            !pm.isIgnoringBatteryOptimizations(app.packageName) -> " · ⚠ Akku-Optimierung aktiv"
            else -> ""
        }
    } catch (e: Exception) { "" }

    // Lautstärke (0–100) und stumm – wird an MA gemeldet und gemerkt
    private var volume = 60
    private var muted = false

    private fun prefs() = Endpoint.prefs(app)

    /** ein Audio-Paket: Zeitstempel (MA-Uhr, µs) + PCM-Daten */
    private class Chunk(val ts: Long, val data: ByteArray)

    /** feste ID dieses Handys – MA erkennt es daran wieder (= Player-ID in MA) */
    @JvmStatic fun clientId(c: Context): String {
        val p = Endpoint.prefs(c)
        p.getString("ss_id", null)?.let { return it }
        val id = "pj-" + UUID.randomUUID().toString().take(8)   // ältere Installationen behalten ihre gespeicherte ID
        p.edit().putString("ss_id", id).apply()
        return id
    }

    /** Name in Music Assistant, z. B. "Mein Handy" */
    @JvmStatic fun name(c: Context): String {
        Endpoint.prefs(c).getString("ss_name", null)?.takeIf { it.isNotBlank() }?.let { return it }
        val dev = try { Settings.Global.getString(c.contentResolver, "device_name") } catch (e: Exception) { null }
        return dev?.takeIf { it.isNotBlank() } ?: Build.MODEL
    }

    /** Lautstärketaste am Handy: Player-Lautstärke ändern und MA melden */
    @JvmStatic fun changeVolume(delta: Int) {
        if (!running) return
        volume = (volume + delta).coerceIn(0, 100); muted = false
        prefs().edit().putInt("ss_vol", volume).putBoolean("ss_muted", false).apply()
        audio.applyVolume()
        sendState(true)
    }

    @JvmStatic fun setName(c: Context, n: String) {
        Endpoint.prefs(c).edit().putString("ss_name", n.trim()).apply()
        if (running) { ws?.close("rename"); }   // neu anmelden mit neuem Namen
    }

    // ---------------------------------------------------------------- Start / Stopp
    @JvmStatic fun start(c: Context) {
        if (running) return
        app = c.applicationContext
        volume = prefs().getInt("ss_vol", 60)
        muted = prefs().getBoolean("ss_muted", false)
        running = true
        thread = HandlerThread("sendspin").also { it.start(); h = Handler(it.looper) }
        h?.post { connect() }
        watchNetwork()
        AppLog.i(TAG, "gestartet als ${name(app)} (${clientId(app)})")
    }

    @JvmStatic fun stop() {
        if (!running) return
        running = false
        watchdogOn = false
        unwatchNetwork()
        try { ws?.send(msg("client/goodbye", JSONObject().put("reason", "shutdown"))) } catch (e: Exception) { }
        val l = ws; ws = null
        try { l?.close("stop") } catch (e: Exception) { }
        connected = false
        audio.end()
        thread?.quitSafely(); thread = null; h = null
    }

    // ---------------------------------------------------------------- Verbindung
    /*
     * Lernkarte: zuhause direkt, unterwegs über das Add-on
     * Zuhause spricht die App direkt mit MA (Port 8927). Unterwegs ist dieser Port nicht erreichbar –
     * dann geht die Verbindung über Home Assistant (Nabu Casa) zum Jukebox-Add-on, das sie an MA weiterreicht:
     *   Handy ──wss──► Nabu Casa ──► HA (Ingress) ──► Add-on /sendspin ──► MA :8927
     * Unterwegs ist mehr Puffer nötig (Mobilfunk schwankt), darum "viaCloud".
     */
    @Volatile private var viaCloud = false

    /*
     * Reihenfolge der Wege:
     *   1. zuhause (Add-on im WLAN erreichbar) → direkt zu MA
     *   2. unterwegs → WebRTC (direkt, wenig Verzögerung); klappt das nicht in 15 s → 30 min Pause für WebRTC
     *   3. unterwegs → über Nabu Casa zum Add-on (funktioniert immer, etwas mehr Verzögerung)
     */
    @Volatile private var rtcBlockUntil = 0L
    private var rtcFails = 0

    /*
     * Lernkarte: Netzwechsel sofort bemerken
     * Wechselt das Handy vom WLAN ins Mobilfunknetz, ist die alte Verbindung tot – das merkt man sonst erst
     * nach ein paar Sekunden (Zeitüberschreitung). Android meldet den Wechsel aber sofort (NetworkCallback):
     * dann gleich neu verbinden. Und ohne WLAN brauchen wir gar nicht erst zu prüfen, ob wir zuhause sind.
     */
    private var netCb: android.net.ConnectivityManager.NetworkCallback? = null
    /** Netz, über das die aktuelle Verbindung läuft (WLAN oder Mobilfunk) */
    @Volatile private var linkNet: android.net.Network? = null
    /** Verbindung abgerissen und noch nicht neu aufgebaut */
    @Volatile private var linkDown = false

    /*
     * Nur reagieren, wenn genau das Netz WEGFÄLLT, über das wir verbunden sind.
     * (Wechselt Android nur das "Standardnetz", z. B. bei schwachem WLAN kurz auf Mobilfunk,
     * läuft die bestehende Verbindung über das WLAN weiter – dann nichts tun, sonst gäbe es unnötige Abbrüche.)
     */
    private fun watchNetwork() {
        if (Build.VERSION.SDK_INT < 24 || netCb != null) return
        val cm = app.getSystemService(android.net.ConnectivityManager::class.java) ?: return
        val cb = object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onLost(n: android.net.Network) {
                if (n == linkNet) h?.post { netChanged() }
            }
            override fun onAvailable(n: android.net.Network) {
                // gerade ohne Verbindung (Funkloch) → nicht auf den nächsten Versuch warten
                // nur nach einem Abbruch (Android meldet beim Anmelden auch die schon vorhandenen Netze → sonst doppelte Verbindung)
                if (running && linkDown) h?.post { if (linkDown && !connected) { AppLog.add("Netz wieder da – verbinde"); retryMs = 3000; retry(300) } }
            }
        }
        val req = android.net.NetworkRequest.Builder().addCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET).build()
        try { cm.registerNetworkCallback(req, cb); netCb = cb } catch (e: Exception) { AppLog.w(TAG, "Netz beobachten: $e") }
    }

    private fun unwatchNetwork() {
        val cb = netCb ?: return
        netCb = null; linkNet = null
        try { app.getSystemService(android.net.ConnectivityManager::class.java)?.unregisterNetworkCallback(cb) } catch (e: Exception) { }
    }

    private fun netChanged() {
        if (!running) return
        AppLog.i(TAG, "Netz der Verbindung weg – sofort neu verbinden")
        retryMs = 3000
        val l = ws
        if (l != null) { if (audio.active() || audio.streaming()) resumeWanted = true; l.close("netchange") } else retry(300)
    }

    /** gibt es überhaupt ein funktionierendes Netz? */
    private fun hasNet(): Boolean {
        if (Build.VERSION.SDK_INT < 23) return true
        val cm = app.getSystemService(android.net.ConnectivityManager::class.java) ?: return true
        val nc = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
        return nc.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    /** gerade im WLAN/LAN? Sonst ist "zuhause" ausgeschlossen (spart die 2-s-Prüfung) */
    private fun onWifi(): Boolean {
        if (Build.VERSION.SDK_INT < 23) return true
        val cm = app.getSystemService(android.net.ConnectivityManager::class.java) ?: return true
        val nc = cm.getNetworkCapabilities(cm.activeNetwork) ?: return true
        // VPN (z. B. FRITZ!Box) zählt mit: darüber ist das Heimnetz auch im Mobilfunk direkt erreichbar
        return nc.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) || nc.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET) ||
            nc.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN)
    }

    private fun connect() {
        if (!running) return
        linkDown = false
        if (Build.VERSION.SDK_INT >= 23) linkNet = try { app.getSystemService(android.net.ConnectivityManager::class.java)?.activeNetwork } catch (e: Exception) { null }
        val host = Endpoint.LOCAL.substringAfter("://").substringBefore(":").substringBefore("/")
        if (onWifi() && Endpoint.reachable(Endpoint.LOCAL + "config.js", 2000)) {
            viaCloud = false
            AppLog.i(TAG, "Verbinde direkt (zuhause)")
            WsLink(http, Request.Builder().url("ws://$host:$PORT/sendspin").build(), "direkt", listener).also { ws = it }.start()
            return
        }
        viaCloud = true
        val rid = prefs().getString("ma_rid", "") ?: ""
        if (rid.isNotEmpty() && prefs().getBoolean("ss_rtc", true) && System.currentTimeMillis() > rtcBlockUntil) {
            AppLog.i(TAG, "Verbinde per WebRTC (unterwegs)")
            val l = RtcLink(app, rid, listener)
            ws = l; l.start()
            h?.postDelayed({
                if (ws === l && !connected) {   // kein Erfolg → WebRTC eine Weile auslassen
                    AppLog.w(TAG, "WebRTC klappt nicht, nehme Nabu Casa")
                    rtcBlockUntil = System.currentTimeMillis() + 30 * 60000L
                    l.close("rtc-timeout")
                }
            }, 15000)
            return
        }
        if (Endpoint.resolve(app, false) != "remote") { retry(60000); return }
        val b = Request.Builder().url(Endpoint.base.replaceFirst("https://", "wss://") + "sendspin")
        Endpoint.cookie().takeIf { it.isNotEmpty() }?.let { b.header("Cookie", it) }
        AppLog.i(TAG, "Verbinde über Nabu Casa (unterwegs)")
        WsLink(http, b.build(), "Nabu Casa", listener).also { ws = it }.start()
    }

    private fun retry(ms: Long = retryMs) {
        connected = false
        if (!running) return
        h?.removeCallbacksAndMessages(null)
        h?.postDelayed({ connect() }, ms)
        retryMs = (retryMs * 2).coerceAtMost(30000)
    }

    private val listener = object : Link.Listener {
        override fun onOpen(l: Link) { if (l === ws) sendHello(l) }

        override fun onText(l: Link, text: String) {
            if (l !== ws) return
            try { onJson(l, JSONObject(text)) } catch (e: Exception) { AppLog.w(TAG, "Nachricht: $e") }
        }

        /** Audio: Byte 0 = Typ (4), Bytes 1–8 = Zeitstempel (µs, MA-Uhr), Rest = PCM/FLAC */
        override fun onBinary(l: Link, data: ByteBuffer) {
            if (l !== ws || data.remaining() < 9) return
            val b = data.order(ByteOrder.BIG_ENDIAN)
            if (b.get().toInt() != 4) return
            val ts = b.long
            val bytes = ByteArray(b.remaining()); b.get(bytes)
            audio.push(ts, bytes)
        }

        override fun onDown(l: Link, reason: String) {
            if (l !== ws) return
            linkDown = true
            val wasRtc = l is RtcLink
            if (wasRtc && !connected && reason != "rtc-timeout" && reason != "rename") {
                // WebRTC scheitert sofort (z. B. MA-Fernzugriff aus) → nach 2 Versuchen Pause, Nabu Casa nehmen
                // (ohne Netz – z. B. Funkloch, DNS geht nicht – zählt das nicht als WebRTC-Fehler)
                if (hasNet() && ++rtcFails >= 2) { rtcBlockUntil = System.currentTimeMillis() + 30 * 60000L; rtcFails = 0 }
            }
            if (wasRtc && connected) rtcFails = 0
            // Lief gerade Musik? Dann nach dem Neuverbinden dafür sorgen, dass sie weiterläuft (Funkloch)
            // (auch nach langem Funkloch: Stream war gestartet und nicht beendet → weiterspielen)
            if ((audio.active() || audio.streaming()) && reason != "rename") resumeWanted = true
            /*
             * Lernkarte: Puffer weiterspielen statt wegwerfen
             * Reißt die Verbindung ab (Funkloch, Netzwechsel), spielt die App die schon empfangene Musik einfach weiter
             * und verbindet im Hintergrund neu. Der neue Stream hat Zeitstempel derselben MA-Uhr: doppelte Stücke
             * sind dann "zu spät" und werden übersprungen – so geht es nahtlos weiter.
             */
            if (reason == "rename" || reason == "stop") audio.end()
            else if (audio.streaming()) AppLog.i(TAG, "Verbindung weg ($reason) – Puffer spielt weiter")
            retry(when { reason == "stall" -> 500; reason == "rename" -> 500; reason == "netchange" -> 300; reason == "rtc-timeout" || (wasRtc && !connected) -> 500; else -> retryMs })
        }
    }

    /**
     * MA "verpackt" unseren Sendspin-Player in einen eigenen Player (ID z. B. "upca11908e").
     * Diese ID brauchen wir für Lautsprecher-Liste und Steuerung → in players/all suchen.
     */
    private fun findMaId(n: Int) {
        if (!connected || n > 5) return
        val me = clientId(app)
        MaClient.get(app).send("players/all", null) { r, _ ->
            val a = r as? JSONArray
            var found: String? = null
            if (a != null) for (i in 0 until a.length()) {
                val pl = a.optJSONObject(i) ?: continue
                val prot = pl.optJSONArray("output_protocols")
                val mine = pl.optString("player_id") == me ||
                    (prot != null && (0 until prot.length()).any { prot.optJSONObject(it)?.optString("output_protocol_id") == me })
                if (mine && !pl.optString("player_id").let { it.startsWith("pj-") || it.startsWith("vanpis-") }) { found = pl.optString("player_id"); break }
                if (mine && found == null) found = pl.optString("player_id")
            }
            if (found != null) { prefs().edit().putString("phone_pid", found).apply(); AppLog.i(TAG, "MA-Player: $found") }
            else h?.postDelayed({ findMaId(n + 1) }, 3000)
        }
    }

    /**
     * Remote-ID von MA (z. B. "MA-ABCD-1234") für WebRTC holen und NUR auf dem Handy speichern.
     * Ist der Fernzugriff in MA ausgeschaltet, bleibt sie leer → unterwegs nur über Nabu Casa.
     */
    private fun fetchRemoteId() {
        MaClient.get(app).send("remote_access/info", null) { r, err ->
            val o = r as? JSONObject ?: run { if (err != null) AppLog.i(TAG, "Remote-ID: $err"); return@send }
            val rid = if (o.optBoolean("enabled")) o.optString("remote_id", "") else ""
            if (rid != prefs().getString("ma_rid", "")) {
                prefs().edit().putString("ma_rid", rid).apply()
                AppLog.i(TAG, if (rid.isEmpty()) "MA-Fernzugriff aus → unterwegs über Nabu Casa" else "Remote-ID gespeichert")
            }
        }
    }

    /*
     * Lernkarte: Funkloch
     * Reißt die Verbindung ab, merkt MA das oft nicht und "spielt" weiter – nur kommt beim Handy nichts mehr an.
     * 1. Nach dem Neuverbinden: kommt in 5 s kein neuer Stream, obwohl MA "playing" sagt → Wiedergabe neu anstoßen.
     * 2. Wächter: Stream offen, aber 10 s keine Daten und MA sagt "playing" → Leitung neu aufbauen (dann greift 1.).
     * Hat jemand pausiert, sagt MA "paused" – dann passiert nichts.
     */
    @Volatile private var resumeWanted = false
    @Volatile private var lastStreamStart = 0L
    private var watchdogOn = false
    private var checkedSilence = -1L   // für diese Stille schon bei MA nachgefragt (spart Akku in Pausen)

    private fun phoneQueue() = prefs().getString("phone_pid", "") ?: ""

    /*
     * Lernkarte: nach dem Funkloch mehrmals nachsehen
     * MA hängt nach dem Neuverbinden manchmal noch an der alten (toten) Verbindung und schickt den Stream dorthin.
     * Darum bis zu 4× (nach 5, 12, 20, 30 s) prüfen: kam kein Stream an, MA meint aber „spielt“ → Fortsetzen anstoßen.
     */
    private var resumeTry = 0
    private fun checkResume(attempt: Int = 0) {
        if (!connected) return
        if (attempt == 0) { if (!resumeWanted) return; resumeWanted = false; resumeTry++ }
        val myTry = resumeTry
        if (audio.receiving()) return   // Musik kommt an
        val q = phoneQueue(); if (q.isEmpty()) return
        MaClient.get(app).send("player_queues/get", JSONObject().put("queue_id", q)) { r, _ ->
            val st = (r as? JSONObject)?.optString("state")
            if (st != null && st != "playing") return@send   // pausiert → nichts tun
            if (st == "playing" && !audio.receiving()) {
                AppLog.i(TAG, "Nach Verbindungsabbruch: Wiedergabe neu anstoßen (Versuch ${attempt + 1})")
                MaClient.get(app).send("player_queues/resume", JSONObject().put("queue_id", q)) { _, e -> if (e != null) AppLog.w(TAG, "Fortsetzen: $e") }
            }
            val next = longArrayOf(7000, 8000, 10000).getOrNull(attempt) ?: return@send
            h?.postDelayed({ if (myTry == resumeTry) checkResume(attempt + 1) }, next)
        }
    }

    /*
     * Verbunden, aber MA schickt keinen Stream, obwohl die Handy-Warteschlange laut MA "spielt"
     * (z. B. hing MA nach einem Netzwechsel noch an der alten Verbindung) → Fortsetzen anstoßen.
     * Frühestens 12 s nach dem Anmelden, danach höchstens alle 20 s.
     */
    @Volatile private var helloAt = 0L
    private var lastNoStreamTry = 0L
    private fun checkNoStream() {
        val now = System.currentTimeMillis()
        if (now - helloAt < 12_000 || now - lastNoStreamTry < 20_000) return
        val q = phoneQueue(); if (q.isEmpty()) return
        lastNoStreamTry = now
        MaClient.get(app).send("player_queues/get", JSONObject().put("queue_id", q)) { r, _ ->
            if ((r as? JSONObject)?.optString("state") != "playing" || audio.streaming()) return@send
            AppLog.w(TAG, "MA spielt, aber kein Stream – Fortsetzen anstoßen")
            MaClient.get(app).send("player_queues/resume", JSONObject().put("queue_id", q)) { _, e -> if (e != null) AppLog.w(TAG, "Fortsetzen: $e") }
        }
    }

    private var logTick = 0
    private fun startWatchdog() {
        if (watchdogOn) return
        watchdogOn = true
        fun tick() {
            if (!running) { watchdogOn = false; return }
            h?.postDelayed({ tick() }, 5000)
            audio.focusCheck()
            // alle 30 s ein Zustandsbericht ins Fern-Log
            if (++logTick % 6 == 0) AppLog.add("Status: " + (if (connected) "verbunden" else "GETRENNT") + " · " + format() +
                " · Puffer " + audio.bufferedMs() + " ms · Uhr " + clock.offset + " µs")
            if (connected && !audio.streaming()) { checkNoStream(); return }
            if (!connected || audio.silentUs() < 10_000_000 || checkedSilence == audio.lastDataUs()) return
            val seen = audio.lastDataUs()
            val q = phoneQueue(); if (q.isEmpty()) return
            val l = ws
            MaClient.get(app).send("player_queues/get", JSONObject().put("queue_id", q)) { r, _ ->
                // erst merken, wenn MA geantwortet hat – im Funkloch scheitert die Abfrage, dann beim nächsten Takt nochmal
                val st = (r as? JSONObject)?.optString("state") ?: return@send
                checkedSilence = seen
                if (st != "playing" || l !== ws || audio.silentUs() < 10_000_000) return@send
                AppLog.w(TAG, "Keine Musik mehr angekommen – Verbindung neu aufbauen")
                resumeWanted = true
                h?.post { l?.close("stall") }
            }
        }
        h?.postDelayed({ tick() }, 5000)
    }

    private fun msg(type: String, payload: JSONObject) = JSONObject().put("type", type).put("payload", payload).toString()

    private fun sendHello(w: Link) {
        // Reihenfolge = Wunsch: zuerst FLAC (verlustfrei gepackt, ca. halbe Datenmenge → spart Akku und Mobilfunk), PCM als Notlösung
        fun fmt(codec: String, rate: Int) = JSONObject().put("codec", codec).put("channels", 2).put("sample_rate", rate).put("bit_depth", 16)
        val p = JSONObject()
            .put("client_id", clientId(app))
            .put("name", name(app))
            .put("version", 1)
            .put("supported_roles", JSONArray().put("player@v1"))
            .put("device_info", JSONObject().put("product_name", Build.MODEL).put("manufacturer", Build.MANUFACTURER)
                .put("software_version", app.applicationInfo.loadLabel(app.packageManager).toString() + " " + BuildConfig.VERSION_NAME))
            .put("player@v1_support", JSONObject()
                .put("supported_formats", JSONArray().put(fmt("flac", 48000)).put(fmt("flac", 44100)).put(fmt("pcm", 48000)).put(fmt("pcm", 44100)))
                // Puffer wie in der offiziellen MA-App: Sekunden × Datenmenge des "schwersten" Formats (PCM 48 kHz =
                // 192 000 Byte/s). MA schickt höchstens 30 s voraus → unterwegs 30 s, zuhause 10 s.
                .put("buffer_capacity", (if (viaCloud) 30 else 10) * 192_000))
        w.send(msg("client/hello", p))
    }

    /** Zustand an MA melden – immer vollständig (ältere Verbindungsart erwartet alle Felder) */
    private fun sendState(@Suppress("UNUSED_PARAMETER") full: Boolean) {
        val pl = JSONObject().put("volume", volume).put("muted", muted)
            .put("output_delay_ms", 0)
            // unterwegs (Nabu Casa, Mobilfunk) mehr Vorlauf und Puffer, damit nichts abreißt
            .put("required_lead_time_ms", if (viaCloud) 3000 else 500).put("min_buffer_ms", if (viaCloud) 8000 else 1500)
            .put("supported_commands", JSONArray().put("volume").put("mute"))
        ws?.send(msg("client/state", JSONObject().put("available", true).put("player", pl)))
    }

    private fun onJson(@Suppress("UNUSED_PARAMETER") w: Link, o: JSONObject) {
        val p = o.optJSONObject("payload") ?: JSONObject()
        when (o.optString("type")) {
            "server/hello" -> {
                connected = true; retryMs = 3000; helloAt = System.currentTimeMillis()
                h?.postDelayed({ findMaId(0) }, 1500)
                h?.postDelayed({ fetchRemoteId() }, 4000)
                AppLog.i(TAG, "angemeldet bei ${p.optString("name")}")
                sendState(true)
                clock.reset(); syncTime(0)
                h?.postDelayed({ checkResume() }, 5000)
                startWatchdog()
            }
            "server/time" -> clock.add(p.optLong("client_transmitted"), p.optLong("server_received"),
                p.optLong("server_transmitted"), nowUs())
            "stream/start" -> p.optJSONObject("player")?.let {
                lastStreamStart = System.currentTimeMillis()
                audio.start(it.optInt("sample_rate", 48000), it.optInt("channels", 2), it.optInt("bit_depth", 16), it.optString("codec"),
                    it.optString("codec_header", ""))
            }
            "stream/clear" -> { val r = p.optJSONArray("roles"); if (r == null || r.toString().contains("player")) audio.clear() }
            "stream/end" -> { val r = p.optJSONArray("roles"); if (r == null || r.toString().contains("player")) audio.end() }
            "server/command" -> p.optJSONObject("player")?.let { c ->
                when (c.optString("command")) {
                    "volume" -> volume = c.optInt("volume", volume).coerceIn(0, 100)
                    "mute" -> muted = c.optBoolean("mute", muted)
                }
                prefs().edit().putInt("ss_vol", volume).putBoolean("ss_muted", muted).apply()
                audio.applyVolume()
                sendState(false)
            }
        }
    }

    // ---------------------------------------------------------------- Uhren-Abgleich
    private fun nowUs() = System.nanoTime() / 1000

    /*
     * Anfangs schnell (alle 0,2 s), dann alle 3 s die Uhrzeit von MA abfragen – aber nur, solange Musik läuft.
     * Ohne Musik reicht alle 60 s: jede Nachricht weckt WLAN/Mobilfunk auf und kostet Akku.
     */
    private fun syncTime(n: Int) {
        if (!connected) return
        ws?.send(msg("client/time", JSONObject().put("client_transmitted", nowUs())))
        val next = when { n < 10 -> 200L; audio.active() -> 3000L; else -> 60000L }
        h?.postDelayed({ syncTime(n + 1) }, next)
    }

    /** Musik startet nach einer Pause → Uhr gleich wieder fein abgleichen (die 60-s-Runde abkürzen) */
    private fun syncSoon() { h?.post { if (connected) { ws?.send(msg("client/time", JSONObject().put("client_transmitted", nowUs()))) } } }

    /**
     * Uhren-Unterschied MA ↔ Handy. Jede Messung hat eine Laufzeit (rtt) –
     * die Messung mit der kürzesten Laufzeit ist die genaueste, die nehmen wir.
     */
    private object clock {
        private class Sample(val rtt: Long, val offset: Long)
        private val samples = ArrayDeque<Sample>()
        @Volatile var offset = 0L; private set     // MA-Uhr minus Handy-Uhr (µs)
        @Volatile var ready = false; private set

        /* neue Verbindung zum selben MA: alte Messwerte weg, aber die bisherige Abweichung gilt weiter,
           bis neue da sind – so kann der Puffer nach einem Funkloch nahtlos weiterspielen */
        @Synchronized fun reset() { samples.clear() }

        /*
         * Lernkarte: Uhr nach Tiefschlaf
         * Die Handy-Uhr (nanoTime) steht still, solange das Handy tief schläft. Danach stimmt der Unterschied
         * zu MA um die Schlafdauer nicht mehr – alte Messungen mit kurzer Laufzeit würden aber weiter "gewinnen".
         * Darum: weicht eine neue Messung um mehr als 0,5 s ab, gelten nur noch die neuen.
         */
        private var jumps = 0
        @Synchronized fun add(ct: Long, sr: Long, st: Long, cr: Long) {
            val rtt = (cr - ct) - (st - sr)
            val off = ((sr - ct) + (st - cr)) / 2
            if (ready && abs(off - offset) > 500_000 && rtt < 2_000_000) {
                if (++jumps >= 2) { samples.clear(); jumps = 0; AppLog.add("Uhr neu abgeglichen (Sprung " + ((off - offset) / 1000) + " ms)") }
            } else jumps = 0
            samples.addLast(Sample(rtt, off))
            while (samples.size > 20) samples.removeFirst()
            offset = samples.minByOrNull { it.rtt }!!.offset
            ready = true
        }

        fun toLocal(serverUs: Long) = serverUs - offset
    }

    // ---------------------------------------------------------------- Audio-Ausgabe
    /**
     * Ein eigener Thread schreibt die Pakete in den AudioTrack (= Lautsprecher des Handys
     * bzw. Bluetooth im Auto) und prüft laufend, ob wir zu früh oder zu spät sind.
     */
    private val audio = object {
        private val queue = LinkedBlockingQueue<Chunk>()
        @Volatile private var track: AudioTrack? = null
        @Volatile private var worker: Thread? = null
        @Volatile private var gen = 0          // erhöht sich bei clear/end → alter Thread hört auf
        private var rate = 48000
        private var frameBytes = 4

        /*
         * Lernkarte: FLAC entpacken mit MediaCodec
         * MediaCodec ist der eingebaute Decoder von Android (oft sogar im Chip).
         * Rein: ein FLAC-Paket von MA (mit Zeitstempel). Raus: PCM, das wir wie bisher in den AudioTrack schreiben.
         * Der Zeitstempel (presentationTimeUs) wandert durch den Decoder mit – so bleibt die Synchronität erhalten.
         * "csd-0" = Kopfdaten des Streams (STREAMINFO), die MA im stream/start mitschickt.
         */
        private var dec: MediaCodec? = null
        private var curCodec = ""
        private var curHeader = ""
        private val info = MediaCodec.BufferInfo()

        private var chCount = 2
        private var routedId = -1
        private fun makeTrack(): AudioTrack {
            val chMask = if (chCount == 1) AudioFormat.CHANNEL_OUT_MONO else AudioFormat.CHANNEL_OUT_STEREO
            val min = AudioTrack.getMinBufferSize(rate, chMask, AudioFormat.ENCODING_PCM_16BIT)
            val t = AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setChannelMask(chMask)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                // ca. 500 ms: hält kurze Aussetzer des Handys aus (Android Auto, Navi); die Zeitstempel gleichen das aus
                .setBufferSizeInBytes(maxOf(min * 2, rate * frameBytes / 2))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            routedId = -1
            /*
             * Lernkarte: Ausgabeweg gewechselt → Lautsprecher-Ausgabe neu aufbauen
             * Spracheingabe (z. B. Claude) öffnet im Auto kurz den "Anruf"-Kanal. Danach blieb unser AudioTrack
             * manchmal am toten Anruf-Kanal hängen: Fortschritt läuft, aber kein Ton (Auto zeigt "Anruf beendet").
             * Ändert Android den Ausgabeweg, bauen wir den AudioTrack neu – der Puffer bleibt erhalten.
             */
            if (Build.VERSION.SDK_INT >= 24) t.addOnRoutingChangedListener({ r ->
                val id = r.routedDevice?.id ?: -1
                if (routedId != -1 && id != routedId) { AppLog.i(TAG, "Ausgabeweg gewechselt ($routedId → $id)"); rebuildSoon() }
                routedId = id
            }, android.os.Handler(Looper.getMainLooper()))
            return t
        }

        private val rebuildRun = Runnable { rebuild() }
        fun rebuildSoon() { h?.removeCallbacks(rebuildRun); h?.postDelayed(rebuildRun, 800) }

        /** neuen AudioTrack mit gleichem Format, Warteschlange + Decoder bleiben – neu ausgerichtet nach Zeitstempel */
        private fun rebuild() {
            val old = track ?: return
            val t = try { makeTrack() } catch (e: Exception) { AppLog.w(TAG, "AudioTrack neu: $e"); return }
            val g = ++gen
            track = t
            underrunBase = 0
            try { old.pause(); old.flush(); old.release() } catch (e: Exception) { }
            applyVolume()
            worker = Thread({ loop(t, g) }, "sendspin-audio").also { it.start() }
        }

        /*
         * Lernkarte: Handy wach halten, solange Musik läuft
         * Mit Bildschirm aus schläft das Handy sonst tief ein: Netz und Prozessor pausieren, der Puffer läuft leer
         * und die Uhr stimmt danach nicht mehr ("Wiedergabe stockt nachts"). Musik-Apps halten darum eine
         * Wach-Sperre (Prozessor) und eine WLAN-Sperre, solange ein Stream läuft – genau so jetzt hier.
         */
        private var wake: android.os.PowerManager.WakeLock? = null
        private var wifi: android.net.wifi.WifiManager.WifiLock? = null
        @Synchronized fun locks(on: Boolean) {
            try {
                if (on) {
                    if (wake == null) wake = (app.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager)
                        .newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "Jukebox:player").apply { setReferenceCounted(false) }
                    if (wifi == null) wifi = (app.applicationContext.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager)
                        .createWifiLock(if (Build.VERSION.SDK_INT >= 29) android.net.wifi.WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                                        else @Suppress("DEPRECATION") android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Jukebox:player")
                            .apply { setReferenceCounted(false) }
                    if (wake?.isHeld != true) wake?.acquire(6 * 3600_000L)
                    if (wifi?.isHeld != true) wifi?.acquire()
                } else {
                    if (wake?.isHeld == true) wake?.release()
                    if (wifi?.isHeld == true) wifi?.release()
                }
            } catch (e: Exception) { AppLog.add("Wach-Sperre: $e") }
        }

        fun start(sampleRate: Int, channels: Int, bits: Int, codec: String, header: String = "") {
            locks(true)
            if ((codec != "pcm" && codec != "flac") || bits != 16) { AppLog.w(TAG, "Format nicht unterstützt: $codec/$bits"); return }
            if (track != null && rate == sampleRate && frameBytes == channels * 2 && codec == curCodec && header == curHeader) return   // Format gleich → weiterlaufen
            end()
            rate = sampleRate; frameBytes = channels * 2; curCodec = codec; curHeader = header
            if (codec == "flac") {
                try {
                    val f = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_FLAC, rate, channels)
                    if (header.isNotEmpty()) f.setByteBuffer("csd-0", ByteBuffer.wrap(Base64.decode(header, Base64.DEFAULT)))
                    dec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_FLAC).apply { configure(f, null, null, 0); start() }
                } catch (e: Exception) { AppLog.w(TAG, "FLAC-Decoder: $e"); dec = null; return }
            }
            chCount = channels
            val t = makeTrack()
            track = t
            underrunBase = 0
            requestFocus()
            applyVolume()
            val g = ++gen
            worker = Thread({ loop(t, g) }, "sendspin-audio").also { it.start() }
            AppLog.i(TAG, "Stream: $curCodec $rate Hz, $channels Kanäle")
            lastFormat = curCodec.uppercase() + " " + (if (rate % 1000 == 0) "${rate / 1000}" else "%.1f".format(rate / 1000.0).replace('.', ',')) + " kHz"
        }

        @Volatile private var lastData = 0L
        fun active() = track != null && nowUs() - lastData < 30_000_000
        /** Stream läuft laut MA (gestartet, nicht beendet), aber seit wie vielen µs kam nichts mehr? */
        fun silentUs() = if (track == null || lastData == 0L) 0L else nowUs() - lastData
        fun lastDataUs() = lastData
        /** grob: wie viel Musik liegt noch in der Warteschlange (ms) */
        fun bufferedMs(): Long = try { queue.sumOf { it.data.size.toLong() } * 1000 / maxOf(1, rate * frameBytes) } catch (e: Exception) { -1 }
        /** Stream wurde gestartet und nicht beendet (egal ob gerade Daten kommen) */
        fun streaming() = track != null
        /** kam in den letzten 3 s Musik an? */
        fun receiving() = track != null && lastData != 0L && nowUs() - lastData < 3_000_000

        /*
         * Doppelte Stücke aussortieren: Nach einem Neuverbinden schickt MA den Stream neu – mit Zeitstempeln
         * derselben Uhr. Was zeitlich nicht hinter dem schon Empfangenen liegt, haben wir schon → weg damit.
         * (Bei Spulen/Titelwechsel kommt vorher stream/clear, das setzt die Grenze zurück.)
         */
        @Volatile private var lastTs = Long.MIN_VALUE
        /** Nachlauf (µs): so viel später als laut Zeitstempel spielen wir gerade (nur unterwegs) */
        @Volatile private var slack = 0L
        private var dupes = 0

        fun push(ts: Long, data: ByteArray) {
            if (track == null) return
            if (ts <= lastTs) { if (++dupes % 100 == 1) AppLog.add("Doppelte Pakete nach Neuverbinden übersprungen ($dupes)"); return }
            lastTs = ts
            if (nowUs() - lastData > 30_000_000) syncSoon()
            lastData = nowUs()
            val d = dec
            if (d == null) { queue.offer(Chunk(ts, data)); return }
            try {
                // … fertiges PCM raus (kann ein Paket hinterherhinken)
                fun drain() {
                    while (true) {
                        val o = d.dequeueOutputBuffer(info, 0)
                        if (o < 0) break
                        if (info.size > 0) {
                            val b = ByteArray(info.size)
                            d.getOutputBuffer(o)?.apply { position(info.offset); get(b) }
                            queue.offer(Chunk(info.presentationTimeUs, b))
                        }
                        d.releaseOutputBuffer(o, false)
                    }
                }
                // FLAC-Paket rein. Kommen viele Pakete auf einmal (Mobilfunk), ist der Decoder kurz voll →
                // abholen und nochmal versuchen statt das Paket wegzuwerfen (sonst kurzer Aussetzer)
                var i = -1
                for (n in 0 until 25) {
                    i = d.dequeueInputBuffer(20_000)
                    if (i >= 0) break
                    drain()
                }
                if (i >= 0) {
                    d.getInputBuffer(i)?.apply { clear(); put(data) }
                    d.queueInputBuffer(i, 0, data.size, ts, 0)
                } else { AppLog.w(TAG, "FLAC-Decoder voll, Paket verloren"); glitch(3) }
                drain()
            } catch (e: Exception) { AppLog.w(TAG, "FLAC: $e") }
        }

        /** Spulen / anderer Titel: Puffer leeren, gleich geht es weiter */
        fun clear() {
            queue.clear(); lastTs = Long.MIN_VALUE; slack = 0
            try { dec?.flush() } catch (e: Exception) { }
            val t = track ?: return
            gen++   // laufender Thread startet neu ausgerichtet
            try { t.pause(); t.flush() } catch (e: Exception) { }
            val g = gen
            worker = Thread({ loop(t, g) }, "sendspin-audio").also { it.start() }
        }

        fun end() {
            gen++
            locks(false)
            queue.clear(); lastTs = Long.MIN_VALUE; slack = 0
            try { dec?.stop(); dec?.release() } catch (e: Exception) { }
            dec = null; curCodec = ""; curHeader = ""
            val t = track; track = null
            try { t?.pause(); t?.flush(); t?.release() } catch (e: Exception) { }
            abandonFocus()
        }

        fun applyVolume() {
            // 0–100 ist "gefühlte" Lautstärke → quadratisch auf die Verstärkung; duck = leiser bei Navi-Ansage
            val g = if (muted) 0f else (volume / 100f).let { it * it } * duck
            try { track?.setVolume(g) } catch (e: Exception) { }
        }

        /*
         * Audio-Fokus: "Ich spiele jetzt Musik" – an Android melden.
         * Erst dann schaltet Android Auto das Auto auf Medien-Ton um, und andere Musik-Apps pausieren.
         * Navi-Ansage → kurz leiser; andere App übernimmt → Wiedergabe in MA pausieren.
         */
        private var focus: AudioFocusRequest? = null
        @Volatile private var duck = 1f
        @Volatile private var duckSince = 0L

        /*
         * Lernkarte: Audio-Fokus kommt nicht zurück
         * Navi-Ansage oder Benachrichtigung nimmt uns kurz den Fokus → wir werden leise/stumm.
         * Normalerweise meldet Android danach "Fokus zurück". Bleibt das aus (kommt mit Android Auto vor),
         * wäre die Musik für immer stumm, obwohl MA weiterspielt. Darum: nach 15 s selbst nochmal anfragen –
         * aber nicht während eines Telefonats.
         */
        fun focusCheck() {
            if (duck >= 1f || Build.VERSION.SDK_INT < 26) return
            val f = focus ?: return
            if (System.currentTimeMillis() - duckSince < 15_000) return
            duckSince = System.currentTimeMillis()
            val am = app.getSystemService(AudioManager::class.java) ?: return
            /*
             * Lernkarte: Spracheingabe (z. B. Claude, Google Assistant) nimmt sich den Audio-Fokus und schaltet
             * manchmal den Modus "Kommunikation" an – und lässt ihn danach stehen. Früher haben wir dann nie wieder
             * übernommen (stumm, Lautstärke im Auto regelte die falsche Ausgabe).
             * Jetzt: echtes Telefonat oder Mikrofon nimmt gerade auf → warten. Sonst Fokus zurückholen.
             */
            if (am.mode == AudioManager.MODE_IN_CALL || am.mode == AudioManager.MODE_RINGTONE) return
            if (am.activeRecordingConfigurations.isNotEmpty()) return   // jemand spricht gerade (Spracheingabe/Anruf über App)
            if (am.requestAudioFocus(f) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                AppLog.i(TAG, "Audio-Fokus selbst zurückgeholt"); duck = 1f; applyVolume(); glitch(0)
            }
        }

        private fun requestFocus() {
            if (Build.VERSION.SDK_INT < 26 || focus != null) return
            val am = app.getSystemService(AudioManager::class.java) ?: return
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setOnAudioFocusChangeListener({ onFocus(it) }, android.os.Handler(Looper.getMainLooper()))
                .build()
            focus = req
            val g = am.requestAudioFocus(req)
            if (g == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) duck = 1f
            AppLog.i(TAG, "Audio-Fokus: $g")
            try { app.registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)) } catch (e: Exception) { }
        }

        /** Bluetooth/Auto getrennt oder Kopfhörer raus → Android meldet "gleich wird es laut" → in MA pausieren */
        private val noisy = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                if (i.action != AudioManager.ACTION_AUDIO_BECOMING_NOISY) return
                AppLog.i(TAG, "Ausgabe getrennt – pausieren")
                pauseInMa()
            }
        }

        private fun pauseInMa() {
            val pid = PhonePlayer.playerId(app)
            if (pid.isNotEmpty()) MaClient.get(app).send("player_queues/pause", JSONObject().put("queue_id", pid)) { _, _ -> }
        }

        /** Pause: Audio-Fokus abgeben (Auto/andere Apps wissen dann: hier spielt nichts) */
        // Pause: nach 5 min ohne Musik die Wach-Sperre lösen (Akku); bei Funkloch kommt vorher wieder Musik
        private val lockOff = Runnable { if (silentUs() > 290_000_000) { locks(false); AppLog.add("Lange Pause – Wach-Sperre gelöst") } }
        private fun idle() { h?.post { abandonFocus(); h?.removeCallbacks(lockOff); h?.postDelayed(lockOff, 300_000) }; AppLog.i(TAG, "Pause – Ausgabe angehalten") }
        private fun resume() { locks(true); if (focus == null) h?.post { requestFocus(); applyVolume() } }

        private fun abandonFocus() {
            val f = focus ?: return
            focus = null; duck = 1f
            try { app.unregisterReceiver(noisy) } catch (e: Exception) { }
            if (Build.VERSION.SDK_INT >= 26) try { app.getSystemService(AudioManager::class.java)?.abandonAudioFocusRequest(f) } catch (e: Exception) { }
        }

        private fun onFocus(change: Int) {
            when (change) {
                AudioManager.AUDIOFOCUS_GAIN -> duck = 1f
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> { duck = 0.3f; duckSince = System.currentTimeMillis() }   // Navi spricht
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> { duck = 0f; duckSince = System.currentTimeMillis() }               // Anruf o. Ä.
                AudioManager.AUDIOFOCUS_LOSS -> {                                // andere Musik-App übernimmt
                    duck = 0f
                    pauseInMa()
                    // Fokus ganz abgeben: beim nächsten Abspielen fragt resume() neu an (sonst bliebe es stumm)
                    h?.post { abandonFocus(); duck = 0f }
                }
            }
            applyVolume()
        }

        private fun loop(t: AudioTrack, g: Int) {
            // Audio-Thread bevorzugt behandeln lassen (wie bei Musik-Apps üblich)
            try { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO) } catch (e: Exception) { }
            var written = 0L            // geschriebene Frames seit Start/Leeren
            var started = false
            var lastFix = 0L
            var dropFrames = 0L         // noch zu überspringende Frames (nach großem Rückstand)
            var oldDrops = 0
            var stallPos = -1L          // letzte abgespielte Position (zum Erkennen einer hängenden Ausgabe)
            var stallSince = nowUs()
            val ats = AudioTimestamp()
            try {
                while (g == gen) {
                    val c = queue.poll(500, TimeUnit.MILLISECONDS)
                    if (c == null) {
                        // 10 s keine Musik (Pause in MA): Lautsprecher-Ausgabe anhalten, sonst hält Android
                        // den Audio-Chip wach und der Akku leert sich. Kommt wieder Musik, startet es neu ausgerichtet.
                        if (started && nowUs() - lastData > 10_000_000) {
                            try { t.pause(); t.flush() } catch (e: Exception) { }
                            started = false; written = 0
                            idle()
                        }
                        continue
                    }
                    if (!started) resume()
                    if (g != gen) break
                    if (!clock.ready) continue
                    val due = clock.toLocal(c.ts) + slack   // wann (Handy-Uhr, µs) das erste Sample erklingen soll (+ Nachlauf)
                    var data = c.data
                    if (!started) {
                        val wait = due - nowUs()
                        if (wait < -50_000) { glitch(3); if (++oldDrops % 50 == 1) AppLog.add("Paket zu alt verworfen (" + (-wait / 1000) + " ms, $oldDrops×)"); continue }   // Paket schon zu alt → verwerfen
                        // Stille bis zum Startzeitpunkt, dann losspielen
                        val sil = maxOf(0L, wait * rate / 1_000_000)
                        writeSilence(t, sil); written += sil
                        t.play(); started = true; lastFix = nowUs()
                    } else if (nowUs() - lastFix > 1_000_000 && t.getTimestamp(ats)) {
                        // Wann würde dieses Paket tatsächlich erklingen?  → mit "due" vergleichen
                        val playsAt = ats.nanoTime / 1000 + (written - ats.framePosition) * 1_000_000 / rate
                        val err = playsAt - due         // > 0: zu spät, < 0: zu früh
                        /*
                         * Lernkarte: hängende Ausgabe erkennen
                         * Nimmt eine andere App kurz das Mikrofon/den Ton (z. B. Gemini im Sperrbildschirm), bleibt der
                         * AudioTrack manchmal stehen: die abgespielte Position wächst nicht mehr, die "Verspätung" wird
                         * riesig (Minuten). Früher wurde dann alles übersprungen → Stille, obwohl MA weiterspielt.
                         * Jetzt: Position bewegt sich 3 s nicht oder Verspätung > 20 s → Ausgabe neu aufbauen.
                         */
                        if (ats.framePosition != stallPos) { stallPos = ats.framePosition; stallSince = nowUs() }
                        if (nowUs() - stallSince > 3_000_000 || abs(err) > 20_000_000) {
                            AppLog.add("Ausgabe hängt (Verspätung " + (err / 1000) + " ms, Position steht) – neu aufbauen")
                            stallSince = nowUs()
                            rebuildSoon(); lastFix = nowUs()
                            continue
                        }
                        /*
                         * Lernkarte: sanft nachregeln statt springen
                         * Handy-Uhr und Lautsprecher (bzw. Auto über Android Auto) laufen nie exakt gleich schnell.
                         * Früher: Abweichung zu groß → Stück überspringen → hörbarer "Millisprung".
                         * Jetzt: Wiedergabe minimal schneller/langsamer (höchstens ±0,5 %, nicht hörbar),
                         * bis die Abweichung weg ist. Nur bei großen Abweichungen (Funkloch) wird gesprungen.
                         */
                        val hard = if (viaCloud) 1_500_000L else 200_000L
                        /*
                         * Lernkarte: unterwegs lieber später als mit Lücke
                         * Kommt im Mobilfunk etwas verspätet an, sprang die Wiedergabe früher nach vorn → hörbarer Aussetzer.
                         * Der Handy-Player spielt allein (kein anderer Lautsprecher muss synchron sein), also darf er einfach
                         * etwas später spielen: die Verspätung wird als "Nachlauf" gemerkt, es geht lückenlos weiter.
                         * Erst ab 15 s Nachlauf wird wirklich gesprungen. Mit vollem Puffer holt er langsam (0,5 %) auf.
                         */
                        if (viaCloud && err > hard && slack + err < 15_000_000L) {
                            slack += err
                            AppLog.add("Nachlauf +" + (err / 1000) + " ms (jetzt " + (slack / 1000) + " ms) – keine Lücke")
                        } else if (abs(err) > hard) {
                            if (err > 0 && slack > 0) { AppLog.add("Nachlauf " + (slack / 1000) + " ms zu groß – springe"); slack = 0 }
                            val frames = abs(err) * rate / 1_000_000
                            glitch(if (err > 0) 1 else 2)
                            AppLog.add("Sprung: " + (if (err > 0) "zu spät " else "zu früh ") + (abs(err) / 1000) + " ms")
                            if (err > 0) dropFrames = frames   // zu spät → so viel überspringen (auch über mehrere Pakete)
                            else { writeSilence(t, frames); written += frames }
                            try { t.playbackRate = rate } catch (e: Exception) { }
                        } else {
                            // Nachlauf langsam abbauen, solange genug im Puffer liegt (→ err wird positiv → etwas schneller)
                            if (slack > 0 && bufferedMs() > 2500) slack = maxOf(0L, slack - 5_000L)
                            // zu spät (err > 0) → etwas schneller spielen; Totzone 15 ms, damit es nicht ständig pendelt
                            val adj = if (abs(err) < 15_000) 0.0 else (err / 8_000_000.0).coerceIn(-0.005, 0.005)
                            val want = Math.round(rate * (1 + adj)).toInt()
                            try { if (t.playbackRate != want) t.playbackRate = want } catch (e: Exception) { }
                        }
                        lastFix = nowUs()
                    }
                    if (dropFrames > 0 && data.isNotEmpty()) {
                        val n = minOf(dropFrames, (data.size / frameBytes).toLong())
                        dropFrames -= n
                        data = data.copyOfRange((n * frameBytes).toInt(), data.size)
                    }
                    if (data.isNotEmpty()) { t.write(data, 0, data.size); written += data.size / frameBytes }
                    // Puffer leergelaufen? (Android zählt das selbst, ab Android 7)
                    if (Build.VERSION.SDK_INT >= 24) { val u = t.underrunCount; if (u > underrunBase) { repeat(u - underrunBase) { glitch(0) }; underrunBase = u } }
                }
            } catch (e: Exception) {
                AppLog.w(TAG, "Audio: $e")
                if (g == gen) rebuildSoon()   // Ausgabe kaputt (z. B. Ausgabeweg gewechselt) → neu aufbauen statt stumm
            }
        }

        private fun writeSilence(t: AudioTrack, frames: Long) {
            var left = (frames.coerceIn(0, rate.toLong() * 5) * frameBytes).toInt()
            val z = ByteArray(minOf(left, 8192))
            while (left > 0) { val n = minOf(left, z.size); t.write(z, 0, n); left -= n }
        }
    }
}
