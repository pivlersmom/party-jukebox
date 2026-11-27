"""
Govee-Lampen mit Segmenten als Pegel-Balken / Spektrum – direkt im Heimnetz, in Echtzeit.

  Music Assistant ──Sendspin (Rolle "visualizer")──► Add-on ──Govee-LAN, Echtzeit-Modus (UDP 4003)──► Lampe

Govees normale LAN-Steuerung kann nur die ganze Lampe (an/aus, Farbe, Helligkeit). Einzelne Segmente gehen sonst
nur über die Govee-Cloud – und die lässt nur wenige Befehle pro Minute zu (darum blieb der Balken über Home
Assistant stehen). Für PC-Sync/DreamView gibt es aber einen Echtzeit-Modus im LAN (Befehl "razer"): ein Paket
setzt alle Segmente auf einmal, viele Male pro Sekunde, ohne Cloud. Den benutzen wir hier.

Voraussetzung: In der Govee-App ist für die Lampe „LAN-Steuerung“ eingeschaltet.

Paket (vor der base64-Verpackung):  BB  Länge(2 Byte)  B0  Verlauf(0/1)  Anzahl  (R G B)×Anzahl  Prüfbyte(XOR über alles davor)
Echtzeit-Modus an:  BB 00 01 B1 01 0A      aus:  BB 00 01 B1 00 0B
Verschickt als JSON:  {"msg": {"cmd": "razer", "data": {"pt": "<base64>"}}}

Einstellungen (Add-on-Konfiguration):
  govee_host      IP-Adresse(n) der Govee-Lampen, mit Komma getrennt (leer = aus)
  govee_segments  Anzahl der Segmente (Standard 7)
  govee_effect    balken   = je lauter, desto mehr Segmente; Farbe wechselt im Takt (Standard)
                  ampel    = Balken mit festem Verlauf grün → rot
                  spektrum = jedes Segment ein Frequenzband (unten Bass, oben Höhen)
  govee_reverse   Balken von oben nach unten (falls er verkehrt herum läuft)
  govee_player    Lautsprecher (Name oder ID), dem das Licht folgt (leer = Party-Player)
  govee_delay_ms  Feinabgleich: positiv = Licht später, negativ = früher
"""
import asyncio
import base64
import colorsys
import json
import logging
import math
import socket
import struct
import time

from dmxlight import DmxLight, T_BEAT, T_LOUD, T_PEAK, T_SPEC, us

log = logging.getLogger("jukebox")

PORT = 4003
FPS = 20
ON = bytes.fromhex("bb0001b1010a")
OFF = bytes.fromhex("bb0001b1000b")


def wrap(raw):
    return json.dumps({"msg": {"cmd": "razer", "data": {"pt": base64.b64encode(raw).decode()}}}).encode()


def frame(colors, gradient=False):
    """Alle Segmente auf einmal: colors = [(r, g, b), …] mit Werten 0..255."""
    body = bytes([0xB0, 1 if gradient else 0, len(colors)]) + bytes(max(0, min(255, int(c))) for rgb in colors for c in rgb)
    raw = b"\xbb" + struct.pack(">H", len(body) - 1) + body
    x = 0
    for b in raw:
        x ^= b
    return raw + bytes([x])


class GoveeSync(DmxLight):
    client_id, name, tag = "pj-govee", "Jukebox Govee-Licht", "Govee-Licht"

    def __init__(self, session, opt, ma_cmds, ma_host):
        super().__init__(session, opt, ma_cmds, ma_host)
        self.hosts = [h.strip() for h in str(opt.get("govee_host") or "").replace(";", ",").split(",") if h.strip()]
        try:
            self.n = max(1, min(60, int(opt.get("govee_segments") or 7)))
        except (TypeError, ValueError):
            self.n = 7
        eff = str(opt.get("govee_effect") or "balken").strip().lower()
        self.effect = eff if eff in ("balken", "ampel", "spektrum") else "balken"
        self.reverse = bool(opt.get("govee_reverse"))
        self.player = str(opt.get("govee_player") or opt.get("wled_player") or opt.get("dmx_player") or opt.get("party_player") or "").strip()
        self.delay_us = int(opt.get("govee_delay_ms") or 0) * 1000
        self.viz = {"types": ["loudness", "beat", "peak", "spectrum"], "rate_max": FPS,
                    "spectrum": {"n_disp_bins": max(4, self.n), "scale": "log", "f_min": 50, "f_max": 9000}}
        self.targets = []
        self.spec = [0.0] * self.n          # zuletzt fällige Bänder (0..1)
        self.bands = [0.0] * self.n         # geglättet für die Anzeige
        self.band_hi = 0.3                  # gewohntes Maximum der Bänder (leise/laute Titel gleich hoch)
        self.bar_hi, self.bar_lo = 0.0, 1.0  # was in den letzten Sekunden laut/leise war
        self.level = 0.0                    # Pegel des Balkens: springt sofort hoch, fällt in ca. 0,3 s ab
        self.taken = False
        self.sent = 0
        self.lit_sum, self.e_min, self.e_max = 0, 1.0, 0.0   # fürs Protokoll: wie viele Segmente an, Bass von–bis

    # ------------------------------------------------------------------ Senden
    def push(self, data):
        for t in self.targets:
            try:
                self.sock.sendto(data, t)
            except OSError as e:
                if self.stat.get("err") != str(e):
                    self.stat["err"] = str(e)
                    log.info(self.tag + ": Senden an %s fehlgeschlagen: %s", t[0], e)

    def show(self, colors):
        if self.reverse:
            colors = colors[::-1]
        self.push(wrap(frame(colors)))
        self.sent += 1
        self.lit_sum += sum(1 for c in colors if max(c) > 40)

    async def take(self):
        """Lampe einschalten und in den Echtzeit-Modus bringen (zweimal – direkt nach dem Einschalten geht das erste oft unter)."""
        self.taken = True
        self.push(json.dumps({"msg": {"cmd": "turn", "data": {"value": 1}}}).encode())
        await asyncio.sleep(0.2)
        self.push(wrap(ON))
        await asyncio.sleep(0.5)
        self.push(wrap(ON))
        log.info(self.tag + ": Echtzeit-Modus an (%s, %d Segmente, Effekt %s)", ", ".join(t[0] for t in self.targets), self.n, self.effect)

    async def give_back(self, why):
        self.taken = False
        self.show([(0, 0, 0)] * self.n)
        await asyncio.sleep(0.1)
        for _ in range(2):
            self.push(wrap(OFF))
            await asyncio.sleep(0.3)
        log.info(self.tag + ": %s – Echtzeit-Modus aus, Lampe wieder frei", why)

    # ------------------------------------------------------------------ Grundgerüst anpassen
    async def setup(self):
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.sock.setblocking(False)
            loop = asyncio.get_running_loop()
            for h in self.hosts:
                self.targets.append(((await loop.getaddrinfo(h, PORT, family=socket.AF_INET))[0][4][0], PORT))
        except Exception as e:
            log.info(self.tag + ": Adresse aus govee_host nicht erreichbar: %s", e)
            return False
        return bool(self.targets)

    async def test_pattern(self):
        """Beim Start: Lauflicht einmal hoch und wieder runter – zeigt, ob die Lampe den Echtzeit-Modus versteht."""
        log.info(self.tag + ": Testmuster an %s (Port %d)", ", ".join(t[0] for t in self.targets), PORT)
        await self.take()
        for i in list(range(1, self.n + 1)) + list(range(self.n - 1, -1, -1)):
            self.show([colorsys_rgb(0.33 * (1 - k / max(1, self.n - 1))) if k < i else (0, 0, 0) for k in range(self.n)])
            await asyncio.sleep(0.12)
        await self.give_back("Testmuster fertig")

    def send(self, v=None, rgb=None):
        return                                                       # das Grundgerüst sendet DMX – hier nichts zu tun

    def arrived(self, ts, kind, val):
        return False                                                 # keine Drop-Erkennung, alles normal einreihen

    def status_extra(self):
        n, self.sent = self.sent, 0
        lit, self.lit_sum = self.lit_sum / max(1, n), 0
        lo, hi, self.e_min, self.e_max = self.e_min, self.e_max, 1.0, 0.0
        return " · %d Bilder an die Lampe · im Schnitt %.1f von %d Segmenten an · Bass %.2f–%.2f" % (n, lit, self.n, lo, hi)

    def test_drop(self):
        return "Govee-Licht hat keinen Drop-Effekt"

    def parse(self, kind, d):
        if kind == T_SPEC and len(d) >= 2:
            n = min(self.n, len(d) // 2)
            return [v / 65535.0 for v in struct.unpack(">%dH" % n, d[:2 * n])]
        return super().parse(kind, d)

    # ------------------------------------------------------------------ Licht berechnen
    async def render(self):
        dt = 1.0 / FPS
        idle = 0.0
        while True:
            await asyncio.sleep(dt)
            now = time.monotonic()
            on = self.enabled()
            active = on and self.playing and now - self.last_frame < 3
            if not active:
                idle += dt
                # Schalter aus: sofort freigeben. Musikpause: erst nach 5 s (Titelwechsel soll nicht flackern).
                if self.taken and (not on or idle > 5):
                    await self.give_back("Licht-Schalter aus" if not on else "Musik aus")
                continue
            idle = 0.0
            if self.offset is not None:
                due = us() + self.offset - self.delay_us
                while self.events and self.events[0][0] <= due:
                    _, kind, val = self.events.popleft()
                    if kind == T_LOUD:
                        self.loud = val
                    elif kind == T_SPEC:
                        self.spec = list(val) + [0.0] * (self.n - len(val))
                    elif kind == T_BEAT:
                        self.beats += 1
                        self.last_beat = now
                        if val or self.beats % 4 == 0:               # Taktanfang (oder jeder 4. Schlag): nächste Farbe
                            self.hue = (self.hue + 0.17) % 1.0
                    elif kind == T_PEAK and now - self.last_beat > 5 and val > 0.35:   # kein Takt-Raster → Bassschläge zählen
                        self.beats += 1
                        if self.beats % 8 == 0:
                            self.hue = (self.hue + 0.17) % 1.0
            if not self.taken:
                await self.take()
            self.show(self.spectrum(dt) if self.effect == "spektrum" else self.bar(dt))

    def bar(self, dt):
        """Pegel aus dem Bass (die zwei untersten Bänder) – jeder Bassschlag lässt den Balken hochspringen.
        Lernkarte: Erst hing der Balken an der Gesamt-Lautstärke mit sehr trägem Abgleich (Minuten). Nach einem leisen
        Intro stand er dann dauernd auf Anschlag – alle Segmente an, eine Farbe. Darum jetzt: Bass statt Lautstärke
        und ein Abgleich über wenige Sekunden (was gerade leise/laut ist, zählt – nicht was vor zwei Minuten war)."""
        e = max(self.spec[0], self.spec[1] if self.n > 1 else 0.0)
        if e <= 0.0:
            e = self.loud                                            # kein Spektrum da → Lautstärke nehmen
        self.e_min, self.e_max = min(self.e_min, e), max(self.e_max, e)
        k = math.exp(-dt / 6.0)                                      # Abgleich über ca. 6 s
        self.bar_hi = max(e, self.bar_hi * k + e * (1 - k))
        self.bar_lo = min(e, self.bar_lo * k + e * (1 - k))
        lv = max(0.0, min(1.0, (e - self.bar_lo) / max(0.08, self.bar_hi - self.bar_lo)))
        lv = lv ** 1.5                                               # Ausschläge deutlicher: nur echte Spitzen füllen den Balken
        self.level = max(lv, self.level * math.exp(-dt / 0.25))
        pos = self.level * self.n                                    # z. B. 4,6 → 4 Segmente voll, das 5. zu 60 %
        out = []
        for i in range(self.n):
            part = max(0.0, min(1.0, pos - i))
            if i == 0:
                part = max(part, 0.25)                               # unterstes Segment glimmt immer (Lampe wirkt nicht "aus")
            hue = 0.33 * (1 - i / max(1, self.n - 1)) if self.effect == "ampel" else self.hue
            out.append(colorsys_rgb(hue, part))
        return out

    def spectrum(self, dt):
        self.band_hi = max(self.band_hi * 0.9995, max(self.spec) if self.spec else 0.0, 0.05)
        out = []
        for i in range(self.n):
            v = max(0.0, min(1.0, self.spec[i] / self.band_hi))
            v = v * v                                                # Ausschläge deutlicher machen
            self.bands[i] = max(v, self.bands[i] * math.exp(-dt / 0.25))
            out.append(colorsys_rgb(0.0 + 0.75 * i / max(1, self.n - 1), max(0.04, self.bands[i])))   # Bass rot … Höhen violett
        return out


def colorsys_rgb(hue, v=1.0):
    return tuple(int(round(x * 255)) for x in colorsys.hsv_to_rgb(hue % 1.0, 1.0, max(0.0, min(1.0, v))))
