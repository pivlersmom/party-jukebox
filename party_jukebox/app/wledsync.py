"""
WLED im Takt der Musik – über WLEDs eigenes "Audio Sync" (ohne Mikrofon).

  Music Assistant ──Sendspin (Rolle "visualizer")──► Add-on ──Audio-Sync-Paket (UDP 11988)──► WLED

WLED hat eingebaute Musik-Effekte (die mit dem Notensymbol). Normalerweise hört ein Mikrofon am ESP32 zu.
WLED kann die Messwerte aber auch übers Netz von einem anderen Gerät bekommen ("Audio Sync", Modus "Receive").
Genau diese Pakete schickt das Add-on – gefüllt mit den Werten, die Music Assistant aus dem Ton berechnet:
Lautstärke, 16 Frequenzbänder, stärkste Frequenz und Bassschläge.

Vorteil gegenüber Art-Net: WLED bleibt im normalen Betrieb. An/Aus, Helligkeit, Palette und Effekt lassen sich
weiter in WLED oder Home Assistant wählen – nur die Musik-Effekte bekommen ihre Daten jetzt von hier.

Das Paketformat (44 Byte) und die Umrechnung stammen aus WLED (usermods/audioreactive) bzw. dem
Music-Assistant-Plugin "WLED Audio Sync".

Einstellungen (Add-on-Konfiguration):
  wled_host      IP-Adresse(n) der WLED-Geräte, mit Komma getrennt (leer = aus)
  wled_port      Port aus WLEDs AudioReactive-Sync-Einstellung (Standard 11988)
  wled_player    Lautsprecher (Name oder ID), dem das Licht folgt (leer = Party-Player)
  wled_gain_db   Empfindlichkeit (Standard 6) – höher, wenn die Effekte flau wirken
  wled_delay_ms  Feinabgleich: positiv = Licht später, negativ = früher
"""
import asyncio
import logging
import math
import socket
import struct
import time

from dmxlight import DmxLight, T_FPEAK, T_LOUD, T_PEAK, T_SPEC, us

log = logging.getLogger("jukebox")

FPS = 40
BINS = 16
NOISE_GATE = 0.02          # darunter gilt: Stille
PEAK_MIN = 100             # Bassschlag erst ab dieser Stärke (0..255) melden
FFT_MAGNITUDE_SCALE = 16000.0
# Ausgleich je Frequenzband (dB): Music Assistant gewichtet nach Gehör (A-Bewertung), WLED erwartet ungewichtete
# Werte mit seiner eigenen "Pink-Noise"-Korrektur – beides zusammen ergibt ein ausgewogenes Spektrum.
A_WEIGHT_DB = (30.0, 24.2, 19.2, 14.9, 11.1, 7.9, 5.1, 2.8, 1.1, -0.1, -0.9, -1.2, -1.2, -1.0, -0.3, 1.0)
PINK_DB = (4.61, 4.66, 4.76, 5.01, 4.51, 3.86, 3.81, 4.24, 5.06, 4.19, 5.11, 6.28, 7.85, 10.50, 16.69, 19.60)


def amplitude(value, gain_db):
    """Sendspin-Wert (0..65535, dB-linear über 60 dB) → lineare Stärke 0..1."""
    if value <= 0:
        return 0.0
    db = max(0.0, min(1.0, value / 65535.0)) * 60.0 - 60.0
    return max(0.0, min(1.0, 10.0 ** ((db + gain_db) / 20.0)))


def packet(sample, peak, fft, magnitude, major_peak):
    """WLEDs audioSyncPacket, Version "00002": Kennung, Lautstärke (roh + geglättet), Schlag, 16 Bänder, stärkste Frequenz."""
    return struct.pack("<6s2sffBB16sHff", b"00002\x00", b"\x00\x00", sample, sample, 1 if peak else 0, 0,
                       bytes(fft), 0, magnitude, major_peak)


class WledSync(DmxLight):
    client_id, name, tag = "pj-wled", "Jukebox WLED-Licht", "WLED-Licht"
    viz = {"types": ["loudness", "f_peak", "spectrum", "peak"], "rate_max": FPS,
           "spectrum": {"n_disp_bins": BINS, "scale": "log", "f_min": 43, "f_max": 9259}}

    def __init__(self, session, opt, ma_cmds, ma_host):
        super().__init__(session, opt, ma_cmds, ma_host)
        self.hosts = [h.strip() for h in str(opt.get("wled_host") or "").replace(";", ",").split(",") if h.strip()]
        self.port = int(opt.get("wled_port") or 11988)
        self.player = str(opt.get("wled_player") or opt.get("dmx_player") or opt.get("party_player") or "").strip()
        self.gain = float(opt.get("wled_gain_db") if opt.get("wled_gain_db") is not None else 6)
        self.delay_us = int(opt.get("wled_delay_ms") or 0) * 1000
        self.targets = []
        self.cur = {"loud": 0, "spec": [0] * BINS, "freq": 0, "amp": 0}
        self.peak = False

    def parse(self, kind, d):
        if kind == T_LOUD and len(d) >= 2:
            return struct.unpack(">H", d[:2])[0]
        if kind == T_FPEAK and len(d) >= 4:
            return struct.unpack(">HH", d[:4])                       # (Frequenz in Hz, Stärke)
        if kind == T_SPEC and len(d) >= 2:
            n = min(BINS, len(d) // 2)
            return struct.unpack(">%dH" % n, d[:2 * n])
        if kind == T_PEAK:
            return d[0]
        return None

    def build(self):
        c = self.cur
        a = amplitude(c["loud"], self.gain)
        sample = 0.0 if a < NOISE_GATE else math.sqrt(a) * 255.0
        fft = bytearray(BINS)
        for i, v in enumerate(c["spec"][:BINS]):
            b = amplitude(v, self.gain + A_WEIGHT_DB[i] + PINK_DB[i])
            if b >= NOISE_GATE:
                fft[i] = max(0, min(255, round(math.sqrt(b) * (0.85 + i / 4.5) * 255.0)))   # hohe Bänder etwas anheben, wie WLED
        m = amplitude(c["amp"], self.gain)
        return packet(sample, self.peak, fft, 0.0 if m < NOISE_GATE else m * FFT_MAGNITUDE_SCALE, float(c["freq"]))

    def send(self, v=None, rgb=None):
        """Ein Paket an alle WLED-Geräte. v=0.0 (vom Grundgerüst beim Beenden) heißt: Stille senden."""
        if v is not None:
            self.cur = {"loud": 0, "spec": [0] * BINS, "freq": 0, "amp": 0}
            self.peak = False
        data = self.build()
        for t in self.targets:
            try:
                self.sock.sendto(data, t)
            except OSError as e:
                if self.stat.get("err") != str(e):
                    self.stat["err"] = str(e)
                    log.info(self.tag + ": Senden an %s fehlgeschlagen: %s", t[0], e)

    async def setup(self):
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.sock.setblocking(False)
            self.sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
            loop = asyncio.get_running_loop()
            for h in self.hosts:
                self.targets.append(((await loop.getaddrinfo(h, self.port, family=socket.AF_INET))[0][4][0], self.port))
        except Exception as e:
            log.info(self.tag + ": Adresse aus wled_host nicht erreichbar: %s", e)
            return False
        return bool(self.targets)

    async def test_pattern(self):
        """Beim Start 3 Sekunden künstlicher „Bass“ – läuft in WLED ein Musik-Effekt, zuckt der Streifen sichtbar."""
        log.info(self.tag + ": Testsignal an %s (Port %d)", ", ".join(t[0] for t in self.targets), self.port)
        for i in range(3 * FPS):
            beat = i % 20 < 4                                         # zwei „Schläge“ pro Sekunde
            self.cur = {"loud": 62000 if beat else 30000, "spec": [60000 if beat else 20000] * 4 + [25000] * 12, "freq": 80, "amp": 60000 if beat else 20000}
            self.peak = i % 20 == 0
            self.send()
            await asyncio.sleep(1 / FPS)
        for _ in range(5):
            self.send(0.0)
            await asyncio.sleep(1 / FPS)

    async def render(self):
        """40-mal pro Sekunde: fällige Werte übernehmen und ein Paket senden. Bei Musikpause: kurz Stille, dann nichts."""
        dt = 1.0 / FPS
        quiet = 0
        while True:
            await asyncio.sleep(dt)
            now = time.monotonic()
            if not (self.playing and now - self.last_frame < 3):
                if quiet < 8:
                    self.send(0.0)
                quiet += 1
                continue
            quiet = 0
            self.peak = False
            if self.offset is not None:
                due = us() + self.offset - self.delay_us
                while self.events and self.events[0][0] <= due:
                    _, kind, val = self.events.popleft()
                    if kind == T_LOUD:
                        self.cur["loud"] = val
                    elif kind == T_SPEC:
                        self.cur["spec"] = list(val) + [0] * (BINS - len(val))
                    elif kind == T_FPEAK:
                        self.cur["freq"], self.cur["amp"] = val
                    elif kind == T_PEAK and val >= PEAK_MIN:
                        self.peak = True
                        self.beats += 1
            self.send()
