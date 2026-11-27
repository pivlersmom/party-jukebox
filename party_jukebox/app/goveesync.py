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
                  puls     = wie der DMX-Spot: ganze Lampe blitzt auf jeden Schlag, Farbe wechselt im Takt
  govee_break     Effekt, solange der Bass aussetzt: ampel, balken oder spektrum.
                  Der Balken folgt dann dem, was noch läuft (Mitten: Gesang, Melodie). Leer = immer der normale Effekt. Beispiel: govee_effect puls + govee_break ampel.
  govee_strobe    Beim Drop (Bass fällt weg und kommt zurück) ein paar Sekunden weißes Strobe (Standard: an).
                  Erkennung und Dauer wie beim DMX-Licht (dmx_drop_build, dmx_drop_sensitivity, dmx_drop_cooldown, dmx_drop_seconds).
  govee_reverse   Balken von oben nach unten (falls er verkehrt herum läuft)
  govee_entity    Dieselbe(n) Lampe(n) in Home Assistant (z. B. light.stehleuchte). Dann merkt sich das Add-on vor dem
                  Start, ob/wie die Lampe leuchtete, und stellt das danach wieder her (war sie aus, geht sie wieder aus).
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
RISE_MIN = 0.05            # so viel müssen Lautstärke oder Höhen im Aufbau steigen (0,05 ≈ 3 dB), sonst kein Strobe
KEEP_S = 2.0               # so oft „Echtzeit-Modus an“ wiederholen
SCENE = "party_jukebox_govee_vorher"


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
        self.effect = eff if eff in ("balken", "ampel", "spektrum", "puls") else "balken"
        self.strobe = opt.get("govee_strobe") is not False          # Strobe beim Drop (Standard: an)
        self.flip = False
        self.build = []                     # (Lautstärke, Höhen) während der Bass weg ist – daraus: baut sich etwas auf?
        brk = str(opt.get("govee_break") or "").strip().lower()
        self.break_effect = brk if brk in ("balken", "ampel", "spektrum", "puls") else ""
        self.low, self.low_hi, self.mel = 0.0, 0.0, 0.0   # Bass geglättet, sein gewohnter Pegel, Mitte (Stimme) geglättet
        self.voc, self.voc_since = False, None            # läuft gerade nur Gesang?
        self.low_min, self.low_max, self.voc_s = 1.0, 0.0, 0.0   # fürs Protokoll
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
        self.entities = [e.strip().lower() for e in str(opt.get("govee_entity") or "").replace(";", ",").split(",") if e.strip().lower().startswith("light.")]
        self.token = ""                     # vom Add-on gesetzt: Zugang zu Home Assistant (für „Zustand vorher“)
        self.on_at = 0.0                    # wann zuletzt „Echtzeit-Modus an“ geschickt wurde
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
        if self.entities:                                            # Zustand vorher merken (aus bleibt später aus)
            await self.ha("scene", "create", {"scene_id": SCENE, "snapshot_entities": self.entities})
        self.push(json.dumps({"msg": {"cmd": "turn", "data": {"value": 1}}}).encode())
        await asyncio.sleep(0.2)
        self.push(wrap(ON))
        await asyncio.sleep(0.5)
        self.push(wrap(ON))
        self.on_at = time.monotonic()
        log.info(self.tag + ": Echtzeit-Modus an (%s, %d Segmente, Effekt %s)", ", ".join(t[0] for t in self.targets), self.n, self.effect)

    async def give_back(self, why):
        self.taken = False
        self.show([(0, 0, 0)] * self.n)
        await asyncio.sleep(0.1)
        for _ in range(2):
            self.push(wrap(OFF))
            await asyncio.sleep(0.3)
        if self.entities:
            await self.ha("scene", "turn_on", {"entity_id": "scene." + SCENE})
        log.info(self.tag + ": %s – Echtzeit-Modus aus, Lampe wieder %s", why, "wie vorher" if self.entities else "frei")

    async def ha(self, domain, service, data):
        if not self.token:
            return
        try:
            async with self.session.post(f"http://supervisor/core/api/services/{domain}/{service}", json=data,
                                         headers={"Authorization": f"Bearer {self.token}"}, timeout=8) as r:
                if r.status >= 400:
                    log.info(self.tag + ": %s.%s → %s", domain, service, r.status)
        except Exception as e:
            log.info(self.tag + ": %s.%s fehlgeschlagen: %s", domain, service, e)

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
        """Paket ist da (noch VOR dem Ton): Drop-Erkennung wie beim DMX-Licht – der Bass fällt eine Weile weg und kommt zurück."""
        if kind == T_LOUD:
            self.loud_in = val
        elif kind == T_SPEC and self.strobe and val:
            self.bass = (val[0] + (val[1] if len(val) > 1 else val[0])) / 2
            hit = self.detector.feed(ts, self.bass, self.loud_in)
            if self.detector.low_since is not None:                  # Bass ist gerade weg: Spannung mitschreiben
                highs = sum(val[-2:]) / 2 if len(val) >= 4 else self.loud_in
                self.build.append((self.loud_in, highs))
                if len(self.build) > 2400:
                    del self.build[:1200]
            if hit:
                rise = self.build_rise()
                self.build = []
                if rise >= RISE_MIN:
                    self.events.append((ts, "drop", hit))           # wird im Bild genau zum Ton ausgelöst
                    log.info(self.tag + ": Drop erkannt · Aufbau %s s · Bass %s → %s (gewohnt %s) · Spannung stieg um %.2f"
                             % (hit["build_s"], hit["bass_before"], hit["bass"], hit["level"], rise))
                else:
                    log.info(self.tag + ": Bass kam zurück, aber ohne Aufbau (Spannung %+.2f, nötig %.2f) – kein Strobe · Pause %s s"
                             % (rise, RISE_MIN, hit["build_s"]))
            elif self.detector.low_since is None and self.build:
                self.build = []
        return False                                                 # alles normal einreihen (das Spektrum brauchen wir auch fürs Bild)

    def status_extra(self):
        n, self.sent = self.sent, 0
        lit, self.lit_sum = self.lit_sum / max(1, n), 0
        lo, hi, self.e_min, self.e_max = self.e_min, self.e_max, 1.0, 0.0
        txt = " · %d Bilder an die Lampe · im Schnitt %.1f von %d Segmenten an · Bass %.2f–%.2f" % (n, lit, self.n, lo, hi)
        if self.break_effect:
            txt += " · Bass geglättet %.2f–%.2f (gewohnt %.2f) · %d s ohne Bass" % (self.low_min, self.low_max, self.low_hi, self.voc_s)
            self.low_min, self.low_max, self.voc_s = 1.0, 0.0, 0.0
        return txt

    def vocals_only(self, dt, now):
        """Setzt der Bass aus? Die zwei untersten Bänder liegen dann deutlich unter ihrem gewohnten Pegel –
        egal, was sonst noch läuft (Gesang, Melodie, Fläche).
        Erst nach 0,6 s umschalten und erst zurück, wenn der Bass klar wieder da ist – sonst flackert es zwischen den Effekten."""
        bass = max(self.spec[0], self.spec[1] if self.n > 1 else 0.0)
        self.low += (bass - self.low) * (1 - math.exp(-dt / 0.3))
        k = math.exp(-dt / 20.0)                                     # gewohnter Pegel: über ca. 20 s
        self.low_hi = max(self.low, self.low_hi * k + self.low * (1 - k))
        self.mel += (self.mids() - self.mel) * (1 - math.exp(-dt / 0.3))
        self.low_min, self.low_max = min(self.low_min, self.low), max(self.low_max, self.low)
        gap = max(0.12, 0.3 * self.low_hi)
        if not self.voc:
            if self.low < self.low_hi - gap:
                self.voc_since = self.voc_since or now
                if now - self.voc_since > 0.6:
                    self.voc = True
                    log.info(self.tag + ": Bass weg (%.2f, gewohnt %.2f) → %s", self.low, self.low_hi, self.break_effect)
            else:
                self.voc_since = None
        elif self.low > self.low_hi - gap * 0.5:
            self.voc, self.voc_since = False, None
            log.info(self.tag + ": Bass wieder da → %s", self.effect)
        if self.voc:
            self.voc_s += dt
        return self.voc

    def mids(self):
        """Mittlere Bänder (bei 7 Segmenten: Band 3–5, ca. 220–2000 Hz) – dort liegt die Stimme."""
        a, b = (2, 5) if self.n >= 5 else (min(1, self.n - 1), self.n)
        return sum(self.spec[a:b]) / max(1, b - a)

    def build_rise(self):
        """Hat sich der Drop aufgebaut? Lernkarte: Erst blitzte es nach jeder Bass-Pause (auch nach einer ruhigen Strophe).
        Ein echter Aufbau wird aber lauter und heller (Trommelwirbel, Rauschen, das hochzieht). Darum vergleichen wir
        das letzte Viertel der Pause mit dem ersten: um wie viel sind Lautstärke oder Höhen gestiegen? (0,05 ≈ 3 dB)"""
        b = self.build
        if len(b) < 8:
            return 0.0
        q = max(2, len(b) // 4)
        avg = lambda part, i: sum(x[i] for x in part) / len(part)
        return max(avg(b[-q:], 0) - avg(b[:q], 0), avg(b[-q:], 1) - avg(b[:q], 1))

    def test_drop(self):
        """Von der Jukebox (Licht-Knopf lange drücken): Strobe von Hand auslösen."""
        self.drop_at = time.monotonic()
        log.info(self.tag + ": Drop-Test → Strobe")
        self.fire_drop({"bass": round(self.bass, 2), "bass_before": round(self.bass, 2)}, manual=True)
        return "Strobe an der Govee-Lampe (%d s)" % int(self.drop_s)

    def strobe_frame(self, now):
        """Weißes Strobe über die ganze Lampe: jedes zweite Bild hell (bei 20 Bildern/s = 10 Blitze pro Sekunde)."""
        self.flip = not self.flip
        return [(255, 255, 255) if self.flip else (0, 0, 0)] * self.n

    def pulse(self, dt):
        """Wie der DMX-Spot: ganze Lampe in der Takt-Farbe, blitzt auf jeden Schlag auf und klingt in ca. 0,2 s ab."""
        self.env *= math.exp(-dt / 0.18)
        self.hi = max(self.hi * 0.9995, self.loud)
        self.lo = min(self.lo * 1.0005 + 0.00001, self.loud)
        lv = max(0.0, min(1.0, (self.loud - self.lo) / max(0.05, self.hi - self.lo)))
        self.smooth += (lv - self.smooth) * 0.25
        return [colorsys_rgb(self.hue, max(self.env, 0.10 + 0.25 * self.smooth))] * self.n

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
            if on and now - self.drop_at < self.drop_s and not active:   # Drop-Test ohne Musik: Strobe trotzdem zeigen
                if not self.taken:
                    await self.take()
                self.show(self.strobe_frame(now))
                idle = 0.0
                continue
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
                    elif kind == "drop":
                        self.drop_at = now
                        log.info(self.tag + ": Drop ausgelöst → Strobe")
                        self.fire_drop(val, manual=False)          # Ereignis „party_jukebox_drop“ an Home Assistant, wie beim DMX-Licht
                    elif kind == T_BEAT:
                        self.beats += 1
                        self.last_beat = now
                        self.env = 1.0 if val else 0.8
                        if val or self.beats % 4 == 0:               # Taktanfang (oder jeder 4. Schlag): nächste Farbe
                            self.hue = (self.hue + 0.17) % 1.0
                    elif kind == T_PEAK and now - self.last_beat > 5 and val > 0.35:   # kein Takt-Raster → Bassschläge zählen
                        self.beats += 1
                        self.env = max(self.env, val)
                        if self.beats % 8 == 0:
                            self.hue = (self.hue + 0.17) % 1.0
            if not self.taken:
                await self.take()
            elif now - self.on_at > KEEP_S:
                # Lernkarte: Die Stehleuchte (H6076) fiel nach einigen Sekunden von selbst aus dem Echtzeit-Modus zurück
                # in ihr eigenes Programm – unsere Bilder kamen an, wurden aber nicht mehr gezeigt. Darum den Modus
                # regelmäßig neu anfordern.
                self.on_at = now
                self.push(wrap(ON))
            if now - self.drop_at < self.drop_s:                     # Drop: ein paar Sekunden weißes Strobe, dann weiter wie vorher
                self.show(self.strobe_frame(now))
            else:
                voc = bool(self.break_effect) and self.vocals_only(dt, now)
                eff = self.break_effect if voc else self.effect
                # Bass weg: der Balken folgt dann den Mitten (Gesang, Melodie) statt dem Bass, der ja gerade fehlt
                self.show(self.spectrum(dt) if eff == "spektrum" else self.pulse(dt) if eff == "puls" else self.bar(dt, eff, voc))

    def bar(self, dt, eff=None, voice=False):
        """Pegel aus dem Bass (die zwei untersten Bänder) – jeder Bassschlag lässt den Balken hochspringen.
        Lernkarte: Erst hing der Balken an der Gesamt-Lautstärke mit sehr trägem Abgleich (Minuten). Nach einem leisen
        Intro stand er dann dauernd auf Anschlag – alle Segmente an, eine Farbe. Darum jetzt: Bass statt Lautstärke
        und ein Abgleich über wenige Sekunden (was gerade leise/laut ist, zählt – nicht was vor zwei Minuten war)."""
        e = self.mids() if voice else max(self.spec[0], self.spec[1] if self.n > 1 else 0.0)
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
            hue = 0.33 * (1 - i / max(1, self.n - 1)) if (eff or self.effect) == "ampel" else self.hue
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
