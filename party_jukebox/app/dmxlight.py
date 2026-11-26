"""
DMX-Licht im Takt der Musik (Art-Net) – z. B. ein Spot auf eine Discokugel.

So hängt es zusammen:

  Music Assistant ──Sendspin (Rolle "visualizer")──► Add-on ──Art-Net (UDP 6454)──► DMX-Knoten ──DMX──► Lampe

Music Assistant wertet den Ton selbst aus (Lautstärke, Bassschläge, Takt) und schickt diese Werte MIT ZEITSTEMPEL
an jedes Gerät, das sich als "Visualizer" anmeldet – und zwar etwas VOR dem hörbaren Ton. Das Add-on meldet sich
so an, hängt sich an den gewählten Lautsprecher (Gruppe) und rechnet daraus 40-mal pro Sekunde DMX-Werte.
Ein Mikrofon ist nicht nötig. Der DMX-Knoten ist irgendein Art-Net-Empfänger im Netz (z. B. ein ESP32 mit LuxDMX).

Einstellungen (Add-on-Konfiguration):
  dmx_host      Adresse des Art-Net-Knotens (leer = Funktion aus)
  dmx_universe  Art-Net-Universum (Standard 0)
  dmx_channels  Welche DMX-Kanäle die Lampe hat, z. B. "dimmer=1,r=2,g=3,b=4,w=5" – feste Werte als "6=255"
  dmx_player    Lautsprecher (Name oder ID), dem das Licht folgt (leer = Party-Player)
  dmx_effect    beat (Puls auf jeden Schlag) · smooth (folgt der Lautstärke) · color (nur Farbwechsel)
  dmx_delay_ms  Feinabgleich: positiv = Licht später, negativ = früher
"""
import asyncio
import colorsys
import json
import logging
import math
import socket
import struct
import time
from collections import deque

from aiohttp import WSMsgType

log = logging.getLogger("jukebox")

CLIENT_ID = "pj-dmx"
NAME = "Jukebox DMX-Licht"
FPS = 40
ROLES = ("dimmer", "r", "g", "b", "w", "strobe")
# Nummern der Datenpakete im Sendspin-Protokoll (Rolle visualizer@v1)
T_LOUD, T_BEAT, T_FPEAK, T_SPEC, T_PEAK = 16, 17, 18, 19, 20


def us():
    return time.monotonic_ns() // 1000


def artnet(universe, data, seq):
    """Ein Art-Net-Paket "ArtDmx": Kennung, Befehl 0x5000, Version 14, Zähler, Universum, Länge, Kanalwerte."""
    n = len(data) + (len(data) & 1)                       # Länge muss gerade sein
    return (b"Art-Net\x00" + b"\x00\x50" + b"\x00\x0e" + bytes((seq, 0, universe & 0xFF, (universe >> 8) & 0x7F))
            + bytes((n >> 8, n & 0xFF)) + bytes(data).ljust(n, b"\x00"))


def parse_channels(text):
    """"dimmer=1,r=2,g=3,b=4,7=255" → ({"dimmer": 1, "r": 2, …}, {7: 255})"""
    roles, fixed = {}, {}
    for part in str(text or "").replace(";", ",").split(","):
        if "=" not in part:
            continue
        k, v = [x.strip().lower() for x in part.split("=", 1)]
        k = {"rot": "r", "red": "r", "gruen": "g", "grün": "g", "green": "g", "blau": "b", "blue": "b",
             "weiss": "w", "weiß": "w", "white": "w", "helligkeit": "dimmer", "dim": "dimmer"}.get(k, k)
        if not v.isdigit():
            continue
        if k in ROLES and 1 <= int(v) <= 512:
            roles[k] = int(v)
        elif k.isdigit() and 1 <= int(k) <= 512:
            fixed[int(k)] = max(0, min(255, int(v)))
    return roles, fixed


class DmxLight:
    def __init__(self, session, opt, ma_cmds, ma_host):
        self.session, self.ma_cmds, self.ma_host = session, ma_cmds, ma_host
        self.host = str(opt.get("dmx_host") or "").strip()
        self.universe = int(opt.get("dmx_universe") or 0)
        self.roles, self.fixed = parse_channels(opt.get("dmx_channels") or "r=1,g=2,b=3")
        self.player = str(opt.get("dmx_player") or opt.get("party_player") or "").strip()
        self.effect = str(opt.get("dmx_effect") or "beat").strip().lower()
        self.delay_us = int(opt.get("dmx_delay_ms") or 0) * 1000
        self.sock = None
        self.seq = 0
        # Uhr: Music Assistant zählt die Zeit anders als wir → Abstand (offset) laufend messen
        self.offset = None
        self.rtts = deque(maxlen=8)
        self.events = deque()            # (Zeitstempel in MA-Zeit, Art, Wert) – kommen VOR dem Ton an
        self.playing = False
        self.last_frame = 0.0
        self.loud, self.lo, self.hi = 0.0, 1.0, 0.0
        self.env, self.hue, self.beats, self.last_beat = 0.0, 0.0, 0, 0.0
        self.smooth = 0.0
        self.stat = {}
        self.lead = []

    # ------------------------------------------------------------------ Ausgabe
    def send(self, v, rgb=None):
        """v = Helligkeit 0..1, rgb = Farbe (je 0..1). Schreibt die belegten Kanäle und schickt ein Art-Net-Paket."""
        buf = bytearray(512)
        r, g, b = rgb or (1.0, 1.0, 1.0)
        has_dim = "dimmer" in self.roles
        has_rgb = any(k in self.roles for k in "rgb")
        k = 1.0 if has_dim else v                      # ohne eigenen Helligkeits-Kanal steckt die Helligkeit in der Farbe
        val = {"dimmer": v, "r": r * k, "g": g * k, "b": b * k, "w": 0.0 if has_rgb else v, "strobe": 0.0}
        top = 0
        for role, ch in self.roles.items():
            buf[ch - 1] = max(0, min(255, int(round(val[role] * 255))))
            top = max(top, ch)
        for ch, x in self.fixed.items():
            buf[ch - 1] = x
            top = max(top, ch)
        self.seq = self.seq % 255 + 1
        try:
            self.sock.sendto(artnet(self.universe, buf[:max(top, 2)], self.seq), (self.host, 6454))
        except OSError as e:
            if self.stat.get("err") != str(e):
                self.stat["err"] = str(e)
                log.info("DMX-Licht: Senden an %s fehlgeschlagen: %s", self.host, e)

    async def test_pattern(self):
        """Beim Start einmal Rot, Grün, Blau, Weiß – so sieht man sofort, ob Knoten, Universum und Kanäle stimmen."""
        log.info("DMX-Licht: Testmuster an %s (Universum %d, Kanäle %s, fest %s)", self.host, self.universe, self.roles, self.fixed)
        for rgb in ((1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 1)):
            for _ in range(16):
                self.send(1.0, rgb)
                await asyncio.sleep(0.05)
        for _ in range(5):
            self.send(0.0)
            await asyncio.sleep(0.05)

    # ------------------------------------------------------------------ Licht berechnen
    async def render(self):
        """40-mal pro Sekunde: fällige Ereignisse abholen, Helligkeit/Farbe berechnen, senden."""
        dt = 1.0 / FPS
        dark = 0
        while True:
            await asyncio.sleep(dt)
            now = time.monotonic()
            active = self.playing and now - self.last_frame < 3
            if not active:
                if dark < 8 or int(now) % 2 == 0 and now - int(now) < dt:   # dunkel: ein paar Mal, dann nur noch selten
                    self.send(0.0)
                dark += 1
                self.env = 0.0
                continue
            dark = 0
            self.env *= math.exp(-dt / 0.18)                     # Puls klingt in ~0,2 s ab
            if self.offset is not None:
                due = us() + self.offset - self.delay_us
                while self.events and self.events[0][0] <= due:
                    _, kind, val = self.events.popleft()
                    if kind == T_LOUD:
                        self.loud = val
                    elif kind == T_BEAT:
                        self.beats += 1
                        self.last_beat = now
                        self.env = 1.0 if val else 0.8
                        if val or self.beats % 4 == 0:           # Taktanfang (oder jeder 4. Schlag): nächste Farbe
                            self.hue = (self.hue + 0.17) % 1.0
                    elif kind == T_PEAK and now - self.last_beat > 5:   # kein Takt-Raster da → Bassschläge nehmen
                        if val > 0.35:
                            self.env = max(self.env, val)
                            self.beats += 1
                            if self.beats % 8 == 0:
                                self.hue = (self.hue + 0.17) % 1.0
            # Lautstärke auf 0..1 bringen (leise und laute Titel sollen gleich wirken)
            self.hi = max(self.hi * 0.9995, self.loud)
            self.lo = min(self.lo * 1.0005 + 0.00001, self.loud)
            span = max(0.05, self.hi - self.lo)
            lv = max(0.0, min(1.0, (self.loud - self.lo) / span))
            self.smooth += (lv - self.smooth) * 0.25
            if self.effect == "smooth":
                v = 0.12 + 0.88 * self.smooth
                self.hue = (self.hue + dt / 40) % 1.0
            elif self.effect == "color":
                v = 1.0
            else:
                v = max(self.env, 0.10 + 0.25 * self.smooth)
            self.send(v, colorsys.hsv_to_rgb(self.hue, 1.0, 1.0))

    # ------------------------------------------------------------------ Verbindung zu Music Assistant
    async def keep_grouped(self):
        """Das Licht-Gerät an den gewählten Lautsprecher hängen (und wieder dranhängen, falls die Gruppe aufgelöst wurde)."""
        said, tries = None, 0
        while True:
            await asyncio.sleep(5 if said is None else min(120, 20 * max(1, tries)))   # klappt es nicht, seltener versuchen
            try:
                pl = (await self.ma_cmds(self.session, [("players/all", {})]))[0] or []
                mine = next((x for x in pl if x.get("player_id") == CLIENT_ID or x.get("name") == NAME), None)
                want = self.player.lower()
                tgt = next((x for x in pl if want and (str(x.get("player_id", "")).lower() == want or str(x.get("name", "")).lower() == want)), None)
                if not mine or not tgt:
                    msg = "Licht-Gerät in MA nicht gefunden" if not mine else "Lautsprecher „%s“ nicht gefunden (dmx_player prüfen)" % self.player
                    if said != msg:
                        said = msg
                        log.info("DMX-Licht: %s", msg)
                    continue
                leader = tgt.get("synced_to") or tgt.get("player_id")
                if mine.get("synced_to") == leader or mine.get("active_group") == leader:
                    msg = "folgt „%s“" % tgt.get("name")
                    tries = 0
                else:
                    tries += 1
                    r = await self.ma_cmds(self.session, [("players/cmd/group", {"player_id": mine["player_id"], "target_player": leader})])
                    ok = leader in (mine.get("can_group_with") or [])
                    msg = "mit „%s“ gruppiert%s" % (tgt.get("name"), "" if ok else " (MA meldet: nicht gruppierbar – Antwort %s)" % (r,))
                if said != msg:
                    said = msg
                    log.info("DMX-Licht: %s", msg)
            except Exception as e:
                if said != str(e):
                    said = str(e)
                    log.info("DMX-Licht: Gruppieren: %s", e)

    async def link(self):
        viz = {"types": ["loudness", "beat", "peak"], "rate_max": 30}
        async with self.session.ws_connect(f"ws://{self.ma_host}:8927/sendspin", max_msg_size=0, heartbeat=30) as ws:
            sup = dict(viz)
            sup["buffer_capacity"] = 600
            await ws.send_json({"type": "client/hello", "payload": {
                "client_id": CLIENT_ID, "name": NAME, "version": 1, "supported_roles": ["visualizer@v1"],
                "device_info": {"product_name": "Party-Jukebox", "manufacturer": "Party-Jukebox", "software_version": "DMX"},
                "visualizer@v1_support": sup}})
            last_sync, n_sync, last_log = 0.0, 0, time.monotonic()
            while True:
                now = time.monotonic()
                if now - last_sync > (1 if n_sync < 8 else 10):
                    last_sync = now
                    n_sync += 1
                    await ws.send_json({"type": "client/time", "payload": {"client_transmitted": us()}})
                if now - last_log > 60:
                    last_log = now
                    if self.playing and self.stat.get("n"):
                        lead = sum(self.lead) / len(self.lead) if self.lead else 0
                        log.info("DMX-Licht: läuft · Pakete/min %s · Schläge %d · Daten kommen %d ms vor dem Ton",
                                 self.stat["n"], self.beats, lead / 1000)
                    self.stat["n"] = {}
                    self.lead = []
                try:
                    m = await ws.receive(timeout=1)
                except asyncio.TimeoutError:
                    continue
                if m.type == WSMsgType.BINARY:
                    b = m.data
                    if len(b) < 10:
                        continue
                    kind = b[0]
                    ts = struct.unpack(">q", b[1:9])[0]
                    if kind == T_LOUD and len(b) >= 11:
                        val = struct.unpack(">H", b[9:11])[0] / 65535.0
                    elif kind == T_BEAT:
                        val = b[9] & 1                              # 1 = Taktanfang
                    elif kind == T_PEAK:
                        val = b[9] / 255.0
                    else:
                        continue
                    self.last_frame = now
                    self.playing = True
                    n = self.stat.setdefault("n", {})
                    n[kind] = n.get(kind, 0) + 1
                    if self.offset is not None and len(self.lead) < 200:
                        self.lead.append(ts - (us() + self.offset))
                    self.events.append((ts, kind, val))
                    while len(self.events) > 4000:
                        self.events.popleft()
                elif m.type == WSMsgType.TEXT:
                    try:
                        o = json.loads(m.data)
                    except ValueError:
                        continue
                    t, p = o.get("type"), o.get("payload") or {}
                    if t == "server/time":
                        t4 = us()
                        rtt = (t4 - p.get("client_transmitted", t4)) - (p.get("server_transmitted", 0) - p.get("server_received", 0))
                        off = ((p.get("server_received", 0) - p.get("client_transmitted", 0)) + (p.get("server_transmitted", 0) - t4)) // 2
                        self.rtts.append((rtt, off))
                        self.offset = min(self.rtts)[1]             # die Messung mit der kürzesten Laufzeit ist die genaueste
                    elif t == "server/hello":
                        log.info("DMX-Licht: bei Music Assistant angemeldet (%s)", ",".join(p.get("active_roles") or []))
                        await ws.send_json({"type": "client/state", "payload": {"available": True, "visualizer": viz}})
                    elif t == "group/update" and "playback_state" in p:
                        self.playing = p.get("playback_state") == "playing"
                    elif t in ("stream/clear", "stream/end"):
                        self.events.clear()
                        if t == "stream/end":
                            self.playing = False
                    elif t == "stream/start":
                        log.info("DMX-Licht: Datenstrom %s", json.dumps(p.get("visualizer") or p, ensure_ascii=False)[:300])
                elif m.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                    return

    async def run(self):
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.sock.setblocking(False)
            self.host = (await asyncio.get_running_loop().getaddrinfo(self.host, 6454, family=socket.AF_INET))[0][4][0]
        except Exception as e:
            log.info("DMX-Licht: Adresse „%s“ nicht erreichbar: %s", self.host, e)
            return
        if not self.roles and not self.fixed:
            log.info("DMX-Licht: dmx_channels ist leer oder ungültig – aus")
            return
        await asyncio.sleep(12)
        await self.test_pattern()
        tasks = [asyncio.create_task(self.render()), asyncio.create_task(self.keep_grouped())]
        try:
            while True:
                try:
                    await self.link()
                    log.info("DMX-Licht: Verbindung zu Music Assistant beendet – neuer Versuch in 10 s")
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    log.info("DMX-Licht: Verbindung zu Music Assistant: %s – neuer Versuch in 10 s", e)
                self.playing = False
                await asyncio.sleep(10)
        finally:
            for t in tasks:
                t.cancel()
            try:
                self.send(0.0)
            except Exception:
                pass
