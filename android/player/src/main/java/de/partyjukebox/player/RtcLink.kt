package de.partyjukebox.player

/*
 * ===== Lernkarte: Link – eine Leitung, zwei Bauarten =====
 * Der SendspinPlayer will nur "Text senden" und "Nachrichten bekommen". Wie die Leitung
 * gebaut ist, ist ihm egal. Darum gibt es ein Interface (eine Art Vertrag) mit zwei Bauarten:
 *
 *   WsLink  : WebSocket – zuhause direkt zu MA, unterwegs über Nabu Casa zum Add-on
 *   RtcLink : WebRTC    – unterwegs direkt Handy ⇄ MA (wie die offizielle MA-App)
 *
 * WebRTC in 4 Schritten:
 *   1. Signaling: Über signaling.music-assistant.io "Hallo" sagen (mit der Remote-ID von MA).
 *      Der Signaling-Server vermittelt nur – Musik läuft nie über ihn.
 *   2. Angebot (offer) und Antwort (answer) tauschen: "Ich kann Datenkanäle, so erreichst du mich."
 *   3. ICE: Beide Seiten probieren Wege durch die Router (STUN). Klappt kein direkter Weg,
 *      leitet Nabu Casa weiter (TURN) – nur mit Abo.
 *   4. Datenkanal "sendspin" öffnet sich → MA verbindet ihn intern mit seinem Sendspin-Server.
 *      Ab hier laufen genau dieselben Nachrichten wie über den WebSocket.
 */

import android.content.Context
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import java.nio.ByteBuffer
import java.util.concurrent.TimeUnit

/** Was der SendspinPlayer von einer Leitung erwartet */
interface Link {
    interface Listener {
        fun onOpen(l: Link)
        fun onText(l: Link, text: String)
        fun onBinary(l: Link, data: ByteBuffer)
        /** Leitung weg; reason = "rename" bei gewolltem Neuaufbau */
        fun onDown(l: Link, reason: String)
    }
    val route: String      // für die Anzeige: "direkt", "Nabu Casa", "WebRTC"
    /** Erst aufrufen, nachdem die Leitung gemerkt wurde – sonst könnte "offen" zu früh kommen */
    fun start(): Link
    fun send(text: String): Boolean
    fun close(reason: String)
}

/** WebSocket-Leitung (OkHttp) */
class WsLink(private val http: OkHttpClient, private val req: Request, override val route: String, private val cb: Link.Listener) : Link {
    @Volatile private var closedBy = ""
    private var ws: WebSocket? = null
    override fun start(): Link { ws = http.newWebSocket(req, lsn); return this }
    private val lsn = object : WebSocketListener() {
        override fun onOpen(w: WebSocket, r: Response) = cb.onOpen(this@WsLink)
        override fun onMessage(w: WebSocket, text: String) = cb.onText(this@WsLink, text)
        override fun onMessage(w: WebSocket, bytes: ByteString) = cb.onBinary(this@WsLink, bytes.asByteBuffer())
        override fun onFailure(w: WebSocket, t: Throwable, r: Response?) { Log.w("JukeboxSendspin", "WebSocket: $t"); cb.onDown(this@WsLink, closedBy) }
        override fun onClosed(w: WebSocket, code: Int, reason: String) = cb.onDown(this@WsLink, closedBy.ifEmpty { reason })
    }
    override fun send(text: String) = ws?.send(text) ?: false
    override fun close(reason: String) { closedBy = reason; ws?.close(1000, reason) ?: cb.onDown(this, reason) }
}

/** WebRTC-Leitung über den Signaling-Server von Music Assistant */
class RtcLink(private val app: Context, private val remoteId: String, private val cb: Link.Listener) : Link {
    override val route = "WebRTC"

    companion object {
        private const val TAG = "JukeboxRtc"
        private const val SIGNALING = "wss://signaling.music-assistant.io/ws"
        private var factory: PeerConnectionFactory? = null

        /** Die WebRTC-Bibliothek nur einmal pro App-Start laden (kostet ein paar MB Speicher) */
        @Synchronized private fun factory(c: Context): PeerConnectionFactory {
            factory?.let { return it }
            PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(c).createInitializationOptions())
            return PeerConnectionFactory.builder().createPeerConnectionFactory().also { factory = it }
        }
    }

    // Ohne OkHttp-Ping: der Signaling-Server bekommt eigene JSON-Pings (siehe ping())
    private val http = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    private var sig: WebSocket? = null
    private var pc: PeerConnection? = null
    private var dc: DataChannel? = null
    @Volatile private var down = false
    @Volatile private var open = false
    private var closedBy = ""
    private var haveAnswer = false
    private val early = ArrayList<IceCandidate>()   // Kandidaten, die vor der Antwort kommen
    private val pinger = Thread {
        try { while (!down) { Thread.sleep(25000); if (!down) sig?.send("{\"type\":\"ping\"}") } } catch (e: InterruptedException) { }
    }

    private fun onSignal(o: JSONObject) {
        when (o.optString("type")) {
            "connected" -> startPeer(o.optJSONArray("iceServers") ?: JSONArray())
            "answer" -> o.optJSONObject("data")?.let { d ->
                pc?.setRemoteDescription(Sdp("answer") {
                    synchronized(early) { haveAnswer = true; early.forEach { pc?.addIceCandidate(it) }; early.clear() }
                }, SessionDescription(SessionDescription.Type.ANSWER, d.optString("sdp")))
            }
            "ice-candidate" -> o.optJSONObject("data")?.let { d ->
                var c = d.optString("candidate").removePrefix("a=")
                if (c.isEmpty()) return
                if (!c.startsWith("candidate:")) c = "candidate:$c"
                val ic = IceCandidate(d.optString("sdpMid", "0").ifEmpty { "0" }, d.optInt("sdpMLineIndex", 0), c)
                synchronized(early) { if (haveAnswer) pc?.addIceCandidate(ic) else early.add(ic) }
            }
            "error" -> fail("MA nicht erreichbar: " + o.optString("error"))
            "peer-disconnected" -> fail("MA hat getrennt")
        }
    }

    /** ICE-Server von MA (STUN, mit Nabu-Casa-Abo auch TURN) → Verbindung + Datenkanal anlegen */
    private fun startPeer(ice: JSONArray) {
        val servers = ArrayList<PeerConnection.IceServer>()
        for (i in 0 until ice.length()) {
            val s = ice.optJSONObject(i) ?: continue
            val u = s.opt("urls")
            val urls = if (u is JSONArray) (0 until u.length()).map { u.optString(it) } else listOf(u?.toString() ?: continue)
            servers.add(PeerConnection.IceServer.builder(urls).setUsername(s.optString("username", ""))
                .setPassword(s.optString("credential", "")).createIceServer())
        }
        if (servers.isEmpty()) servers.add(PeerConnection.IceServer.builder("stun:stun.home-assistant.io:3478").createIceServer())
        AppLog.i(TAG, "Verbinde, ${servers.size} ICE-Server")
        val cfg = PeerConnection.RTCConfiguration(servers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY   // Netzwechsel WLAN ⇄ Mobilfunk
        }
        val p = factory(app).createPeerConnection(cfg, peerObs) ?: return fail("WebRTC nicht verfügbar")
        pc = p
        dc = p.createDataChannel("sendspin", DataChannel.Init().apply { ordered = true }).also { it.registerObserver(dcObs) }
        p.createOffer(Sdp("offer") { }.also { obs ->
            obs.onCreate = { sd ->
                p.setLocalDescription(Sdp("local") {
                    sig?.send(JSONObject().put("type", "offer")
                        .put("data", JSONObject().put("sdp", sd.description).put("type", "offer")).toString())
                }, sd)
            }
        }, MediaConstraints())
    }

    private val peerObs = object : PeerConnection.Observer {
        override fun onIceCandidate(c: IceCandidate) {
            sig?.send(JSONObject().put("type", "ice-candidate").put("data",
                JSONObject().put("candidate", c.sdp).put("sdpMid", c.sdpMid).put("sdpMLineIndex", c.sdpMLineIndex)).toString())
        }
        override fun onConnectionChange(s: PeerConnection.PeerConnectionState) {
            AppLog.i(TAG, "Zustand: $s")
            if (s == PeerConnection.PeerConnectionState.FAILED || s == PeerConnection.PeerConnectionState.CLOSED) fail("Verbindung $s")
        }
        override fun onSignalingChange(s: PeerConnection.SignalingState) {}
        override fun onIceConnectionChange(s: PeerConnection.IceConnectionState) {}
        override fun onIceConnectionReceivingChange(b: Boolean) {}
        override fun onIceGatheringChange(s: PeerConnection.IceGatheringState) {}
        override fun onIceCandidatesRemoved(c: Array<out IceCandidate>) {}
        override fun onAddStream(s: MediaStream) {}
        override fun onRemoveStream(s: MediaStream) {}
        override fun onDataChannel(d: DataChannel) {}
        override fun onRenegotiationNeeded() {}
        override fun onAddTrack(r: RtpReceiver, s: Array<out MediaStream>) {}
    }

    private val dcObs = object : DataChannel.Observer {
        override fun onBufferedAmountChange(prev: Long) {}
        override fun onStateChange() {
            when (dc?.state()) {
                DataChannel.State.OPEN -> if (!open) { open = true; AppLog.i(TAG, "Datenkanal offen"); cb.onOpen(this@RtcLink) }
                DataChannel.State.CLOSED -> fail("Datenkanal geschlossen")
                else -> {}
            }
        }
        override fun onMessage(b: DataChannel.Buffer) {
            // Puffer gehört WebRTC und wird danach wiederverwendet → kopieren
            val copy = ByteBuffer.allocate(b.data.remaining()); copy.put(b.data); copy.flip()
            if (b.binary) cb.onBinary(this@RtcLink, copy)
            else cb.onText(this@RtcLink, String(copy.array(), Charsets.UTF_8))
        }
    }

    override fun send(text: String): Boolean {
        val d = dc ?: return false
        if (d.state() != DataChannel.State.OPEN) return false
        return d.send(DataChannel.Buffer(ByteBuffer.wrap(text.toByteArray(Charsets.UTF_8)), false))
    }

    override fun close(reason: String) { closedBy = reason; fail("geschlossen ($reason)") }

    /** Alles abbauen, aber den Player nur einmal benachrichtigen */
    private fun fail(why: String) {
        synchronized(this) { if (down) return; down = true }
        AppLog.i(TAG, "Ende: $why")
        pinger.interrupt()
        try { sig?.close(1000, "bye") } catch (e: Exception) { }
        val d = dc; val p = pc; dc = null; pc = null
        // WebRTC darf nicht aus seinen eigenen Rückruf-Threads heraus geschlossen werden → eigener Thread
        Thread {
            try { d?.unregisterObserver(); d?.close(); d?.dispose() } catch (e: Exception) { }
            try { p?.close(); p?.dispose() } catch (e: Exception) { }
        }.start()
        cb.onDown(this, closedBy)
    }

    override fun start(): Link {
        sig = http.newWebSocket(Request.Builder().url(SIGNALING).build(), object : WebSocketListener() {
            override fun onOpen(w: WebSocket, r: Response) {
                w.send(JSONObject().put("type", "connect-request").put("remoteId", remoteId).toString())
            }
            override fun onMessage(w: WebSocket, text: String) {
                try { onSignal(JSONObject(text)) } catch (e: Exception) { AppLog.w(TAG, "Signaling: $e"); fail("Signaling-Fehler") }
            }
            override fun onFailure(w: WebSocket, t: Throwable, r: Response?) { fail("Signaling getrennt: $t") }
            override fun onClosed(w: WebSocket, code: Int, reason: String) { fail("Signaling geschlossen") }
        })
        pinger.isDaemon = true; pinger.start()
        return this
    }

    /** Hilfsklasse: WebRTC meldet Ergebnisse über Rückrufe */
    private inner class Sdp(val what: String, val ok: () -> Unit) : SdpObserver {
        var onCreate: ((SessionDescription) -> Unit)? = null
        override fun onCreateSuccess(sd: SessionDescription) { onCreate?.invoke(sd) }
        override fun onSetSuccess() = ok()
        override fun onCreateFailure(e: String?) = fail("SDP $what: $e")
        override fun onSetFailure(e: String?) = fail("SDP $what: $e")
    }
}
