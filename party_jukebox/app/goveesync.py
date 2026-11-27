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
                  welle    = Bass-Welle + Funkeln: jeder Schlag schickt einen Lichtimpuls durch alle Segmente, Höhen lassen
                             einzelne Segmente aufblitzen (für Flächen mit vielen Segmenten)
                  puls     = wie der DMX-Spot: ganze Lampe blitzt auf jeden Schlag, Farbe wechselt im Takt
  govee_break     Effekt, solange der Bass aussetzt: ampel, balken oder spektrum.
                  Der Balken folgt dann dem, was noch läuft (Mitten: Gesang, Melodie). Leer = immer der normale Effekt. Beispiel: govee_effect puls + govee_break ampel.
  govee_strobe_early_ms  Strobe aus der Wellenform um so viele Millisekunden vorziehen – Start und Ende (Standard 2000 ≈ ein Takt).
  govee_strobe_seconds  Dauer des Strobes in Sekunden (Standard 8).
  govee_strobe    Strobe im Aufbau: Kennt Music Assistant die Wellenform des Titels, blitzt die Lampe, während die Balken
                  ansteigen, und hört genau auf dem Einsatz auf (siehe wavecue.py). Ohne Wellenform wie bisher:
                  Beim Drop (Bass fällt weg, es baut sich auf, Bass kommt zurück) weißes Strobe (Standard: an).
                  Erkennung und Dauer wie beim DMX-Licht (dmx_drop_build, dmx_drop_sensitivity, dmx_drop_cooldown, dmx_drop_seconds).
  govee_reverse   Balken von oben nach unten (falls er verkehrt herum läuft)
  govee_entity    Dieselbe(n) Lampe(n) in Home Assistant (z. B. light.stehleuchte). Dann merkt sich das Add-on vor dem
                  Start, ob/wie die Lampe leuchtete, und stellt das danach wieder her (war sie aus, geht sie wieder aus).
  govee_lamps     Weitere Lampen, jede mit eigener Rolle. Je Zeile:
                  IP | Segmente | Effekt | Lampe in Home Assistant | Feinabgleich ms | Effekt ohne Bass-Beat | umdrehen
  govee_player    Lautsprecher (Name oder ID), dem das Licht folgt (leer = Party-Player)
  govee_delay_ms  Feinabgleich: positiv = Licht später, negativ = früher
"""
import asyncio
import base64
import colorsys
import json
import logging
import math
import random
import socket
import struct
import time
from collections import deque

from wavecue import WaveCues
from dmxlight import DmxLight, T_BEAT, T_LOUD, T_PEAK, T_SPEC, us

log = logging.getLogger("jukebox")

PORT = 4003
FPS = 20
ON = bytes.fromhex("bb0001b1010a")
OFF = bytes.fromhex("bb0001b1000b")
SWING_MIN = 0.12           # so weit muss der Bass in 2 s auf- und abspringen, damit es als Bass-Beat zählt (0,12 ≈ 7 dB)
RISE_MIN = 0.05            # so viel müssen Lautstärke oder Höhen im Aufbau steigen (0,05 ≈ 3 dB), sonst kein Strobe
KEEP_S = 2.0               # so oft „Echtzeit-Modus an“ wiederholen
EFFECTS = ("balken", "ampel", "spektrum", "puls", "welle")


def lamp_options(opt):
    """Aus der Add-on-Konfiguration eine Liste von Einstellungen machen – eine je Lampe.
    Lampe 1 sind die Optionen govee_host, govee_segments … Weitere Lampen stehen in govee_lamps, je Zeile:
        IP | Segmente | Effekt | Lampe in Home Assistant | Feinabgleich ms | Effekt ohne Bass-Beat | umdrehen
    Nur die IP ist Pflicht; leere Felder übernehmen Standardwerte. Beispiel:  192.168.178.164 | 20 | welle | light.couch | -250"""
    out = []
    if str(opt.get("govee_host") or "").strip():
        out.append(dict(opt))
    for line in opt.get("govee_lamps") or []:
        f = [x.strip() for x in str(line).split("|")] + [""] * 7
        if not f[0]:
            continue
        o = dict(opt)
        o.update({"govee_host": f[0], "govee_segments": f[1] or 10, "govee_effect": f[2] or "welle", "govee_entity": f[3],
                  "govee_delay_ms": int(f[4]) if f[4].lstrip("+-").isdigit() else opt.get("govee_delay_ms") or 0,
                  "govee_break": f[5], "govee_reverse": f[6].lower() in ("1", "ja", "true", "x", "umdrehen")})
        out.append(o)
    return out


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

    def __init__(self, session, opt, ma_cmds, ma_host, idx=1):
        super().__init__(session, opt, ma_cmds, ma_host)
        # mehrere Lampen: jede meldet sich als eigenes Licht-Gerät bei Music Assistant an (eigene Rolle, eigener Effekt)
        if idx > 1:
            self.client_id, self.name, self.tag = "pj-govee%d" % idx, "Jukebox Govee-Licht %d" % idx, "Govee-Licht %d" % idx
        self.scene = "party_jukebox_govee%s_vorher" % ("" if idx == 1 else idx)
        self.hosts = [h.strip() for h in str(opt.get("govee_host") or "").replace(";", ",").split(",") if h.strip()]
        try:
            self.n = max(1, min(60, int(opt.get("govee_segments") or 7)))
        except (TypeError, ValueError):
            self.n = 7
        eff = str(opt.get("govee_effect") or "balken").strip().lower()
        self.effect = eff if eff in EFFECTS else "balken"
        self.nb = max(1, int(round(self.n * 2 / 7)))                 # so viele Bänder unten sind „Bass“ (bis ca. 220 Hz), oben „Höhen“
        self.waves = []                     # Welle: laufende Lichtimpulse [Position, Stärke]
        self.spark = [0.0] * self.n         # Funkeln: Helligkeit je Segment, klingt schnell ab
        self.hi_prev = 0.0
        self.was_calm = False               # kam gerade eine fast stille Stelle? Dann startet das Lauflicht auf dem nächsten Schlag neu
        self.voice, self.launches = 0.0, 0   # Gesang geglättet (ca. 0,25 s), gestartete Lichtimpulse (fürs Protokoll)
        self.mel_hi, self.wave_at = 0.0, -1e9   # lautester Gesang im Titel, letzter Start eines Lichtimpulses
        self.busy = 0.5                     # wie viel gerade los ist (0 = fast still, 1 = volle Stelle), geglättet
        self.strobe = opt.get("govee_strobe") is not False          # Strobe beim Drop (Standard: an)
        self.flip = False
        try:
            self.cue_early = float(opt.get("govee_strobe_early_ms") if opt.get("govee_strobe_early_ms") is not None else 2000) / 1000.0
        except (TypeError, ValueError):
            self.cue_early = 2.0                # Strobe aus der Wellenform so viel früher (Start und Ende)
        self.cues, self.cue_on = None, False   # Aufbauten aus der Wellenform des Titels (wavecue.py)
        try:
            self.drop_s = max(1.0, min(30.0, float(opt.get("govee_strobe_seconds") or 8)))   # Dauer des Strobes
        except (TypeError, ValueError):
            self.drop_s = 8.0
        self.acc, self.acc_n, self.prev_vec = [0.0] * self.n, 0, None   # Klang seit dem letzten Schlag / beim Schlag davor
        self.one_score, self.one_pos, self.one_moves = [0.0] * 4, 0, 0  # Einsätze je Schlag-Position, vermutete Eins
        self.bass_beats, self.one_set = deque(maxlen=3), -99            # Bass der letzten drei Schläge; wann die Eins zuletzt festgesetzt wurde
        self.build = []                     # (Lautstärke, Höhen) während der Bass weg ist – daraus: baut sich etwas auf?
        brk = str(opt.get("govee_break") or "").strip().lower()
        self.break_effect = brk if brk in EFFECTS else ""
        self.low, self.low_hi, self.mel = 0.0, 0.0, 0.0   # Bass geglättet, sein gewohnter Pegel, Mitte (Stimme) geglättet
        self.voc, self.voc_since, self.voc_log = False, None, -1e9   # läuft gerade KEIN Bass-Beat?
        self.win = deque([0.0], maxlen=int(1.5 * FPS))    # Bass der letzten 1,5 s
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
            await self.ha("scene", "create", {"scene_id": self.scene, "snapshot_entities": self.entities})
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
            await self.ha("scene", "turn_on", {"entity_id": "scene." + self.scene})
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
        if self.targets and self.strobe:
            self.cues = WaveCues.get(self.session, self.ma_cmds, self.player)   # je Lautsprecher einmal, alle Lampen teilen sie sich
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
            self.bass = sum(val[:self.nb]) / max(1, len(val[:self.nb]))
            hit = self.detector.feed(ts, self.bass, self.loud_in)
            if self.detector.low_since is not None:                  # Bass ist gerade weg: Spannung mitschreiben
                highs = sum(val[-self.nb:]) / self.nb if len(val) >= 4 else self.loud_in
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
        txt += " · Eins auf Position %d (Einsätze %s, %d× verschoben)" % (self.one_pos + 1, "/".join("%.1f" % x for x in self.one_score), self.one_moves)
        self.one_moves = 0
        if self.effect == "welle" or self.break_effect == "welle":
            txt += " · %d Lichtimpulse (Gesang %.0f %% da)" % (self.launches, self.busy * 100)
            self.launches = 0
        if self.break_effect:
            txt += " · Bass-Hub %.2f–%.2f (lautester Bass %.2f) · %d s ohne Bass-Beat" % (self.low_min, self.low_max, self.low_hi, self.voc_s)
            self.low_min, self.low_max, self.voc_s = 1.0, 0.0, 0.0
        return txt

    def vocals_only(self, dt, now):
        """Läuft gerade KEIN Bass-Beat? (True = ruhige Stelle / nur Gesang → Equalizer statt Blitzen)
        Lernkarte: Erst wurde der Bass mit seinem „gewohnten“ Pegel der letzten 20 s verglichen. In einer langen ruhigen
        Stelle wurde die Ruhe selbst zum Gewohnten – das Licht sprang zurück aufs Blitzen, obwohl kein Beat lief.
        Jetzt zählt, was ein Bass-Beat wirklich ist: Die Bassdrum lässt das unterste Band im Sekundentakt auf- und
        abspringen. Wir sehen uns die letzten 1,5 s an: Wie weit springt der Bass (Hub), und kommt er dabei in die Nähe
        dessen, was in diesem Titel laut ist? Nur Gesang oder eine Fläche: wenig Hub oder zu leise → kein Beat."""
        bass = self.lows()
        self.win.append(bass)
        self.low += (bass - self.low) * (1 - math.exp(-dt / 0.3))
        top, bottom = max(self.win), min(self.win)
        self.low_hi = max(top, self.low_hi * math.exp(-dt / 90.0))  # lautester Bass im Titel (verblasst über ca. 90 s)
        swing = top - bottom
        # zwei Schwellen (an bei +0,02, aus bei −0,02): genau an der Grenze sprang es sonst alle paar Sekunden hin und her
        beat = swing >= SWING_MIN + (0.02 if self.voc else -0.02) and top >= 0.6 * self.low_hi
        self.low_min, self.low_max = min(self.low_min, swing), max(self.low_max, swing)
        if beat != (not self.voc):                                   # Zustand will wechseln – aber erst, wenn es anhält
            self.voc_since = self.voc_since or now
            # Beat setzt ein: schnell reagieren (0,25 s). Beat setzt aus: erst wenn 1,5 s lang kein Schlag mehr kam, plus 0,5 s (insgesamt ca. 2 s).
            if now - self.voc_since > (0.25 if beat else 0.5):
                self.voc, self.voc_since = not beat, None
                if now - self.voc_log > 2:
                    self.voc_log = now
                    log.info(self.tag + ": %s (Hub %.2f, Spitze %.2f, lautester Bass %.2f) → %s",
                             "Bass-Beat da" if beat else "kein Bass-Beat", swing, top, self.low_hi, self.effect if beat else (self.break_effect or self.effect + " ohne Aufblitzen"))
        else:
            self.voc_since = None
        if self.voc:
            self.voc_s += dt
        return self.voc

    def lows(self):
        """Bass: das lauteste der unteren Bänder (bis ca. 220 Hz)."""
        return max(self.spec[:self.nb])

    def highs(self):
        return sum(self.spec[-self.nb:]) / self.nb

    def mids(self):
        """Mittlere Bänder (bei 7 Segmenten: Band 3–5, ca. 220–2000 Hz) – dort liegt die Stimme."""
        a, b = (self.nb, max(self.nb + 1, self.n - self.nb)) if self.n >= 5 else (min(1, self.n - 1), self.n)
        return sum(self.spec[a:b]) / max(1, b - a)

    def find_one(self):
        """Welcher der vier Schläge ist die „Eins“?
        Lernkarte: Music Assistant liefert hier nur die Schläge, nicht den Taktanfang (tracks_downbeats: false). Erst wurde
        einfach jeder 4. Schlag ab Start gezählt – die Farbe wechselte dann irgendwo im Takt. Jetzt hören wir hin:
        Neues setzt in der Musik fast immer auf der Eins ein (Bass kommt zurück, neue Spur, Akkordwechsel). Darum
        merken wir uns je Schlag-Position (1–4), wie stark der Klang dort gegenüber dem Schlag davor ZUGELEGT hat.
        Die Position mit den meisten Einsätzen gilt als Eins. Ältere Takte verblassen (ca. 30 Takte Gedächtnis).
        Gerechnet wird im 4/4-Takt (bei elektronischer Musik fast immer richtig). Dazu ein fester Anker: Setzt der Bass
        nach einer Pause wieder ein, ist das die Eins – dann wird sie sofort festgesetzt, nicht erst nach vielen Takten."""
        pos = self.beats % 4
        if self.acc_n:
            vec = [a / self.acc_n for a in self.acc]
            if self.prev_vec:
                gain = sum(max(0.0, c - p) for c, p in zip(vec, self.prev_vec))
                # der Klang seit dem letzten Schlag gehört zum Schlag davor: dort hat etwas eingesetzt
                was = (pos - 1) % 4
                self.one_score = [x * 0.992 for x in self.one_score]
                self.one_score[was] += gain
            self.prev_vec = vec
            # Stärkster Hinweis im 4/4-Takt: Nach einer Pause setzt der Bass praktisch immer auf der Eins wieder ein.
            # War der Bass in den drei Schlägen davor klar leiser und ist jetzt laut da → dieser Schlag ist die Eins (festsetzen).
            bass_now = max(vec[:self.nb])
            if (len(self.bass_beats) >= 3 and bass_now - max(self.bass_beats) >= 0.12 and bass_now >= 0.6 * self.low_hi
                    and self.beats - self.one_set > 8):
                was = (pos - 1) % 4
                self.one_score = [min(x, 2.0) for x in self.one_score]
                self.one_score[was] = 8.0
                if was != self.one_pos:
                    self.one_moves += 1
                    log.info(self.tag + ": Bass setzt ein → Eins neu gesetzt (Position %d)", was + 1)
                self.one_pos, self.one_set = was, self.beats
            self.bass_beats.append(bass_now)
        self.acc, self.acc_n = [0.0] * self.n, 0
        best = max(range(4), key=lambda i: self.one_score[i])
        rest = sorted(self.one_score)[-2]
        # nur umspringen, wenn die neue Position klar vorn liegt – sonst bleibt die bisherige Eins
        if best != self.one_pos and self.one_score[best] > 0.3 and self.one_score[best] > 1.25 * max(rest, self.one_score[self.one_pos]):
            self.one_pos = best
            self.one_moves += 1
        return pos == self.one_pos

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
        # Takt des Blitzens aus der Uhr (nicht je Lampe mitzählen): so blitzen alle Lampen gleichzeitig statt abwechselnd
        self.flip = (time.time() % 0.1) < 0.05
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
                        self.acc = [a + b for a, b in zip(self.acc, self.spec)]
                        self.acc_n += 1
                    elif kind == "drop":
                        if self.cues and self.cues.have:             # Wellenform kennt die Aufbauten schon – Mithören zählt dann nicht
                            continue
                        self.drop_at = now
                        log.info(self.tag + ": Drop ausgelöst → Strobe")
                        self.fire_drop(val, manual=False)          # Ereignis „party_jukebox_drop“ an Home Assistant, wie beim DMX-Licht
                    elif kind == T_BEAT:
                        self.beats += 1
                        self.last_beat = now
                        one = bool(val) or self.find_one()           # ist das die „Eins“ des Takts?
                        # aufblitzen nur, solange wirklich ein Bass-Beat läuft – das Takt-Raster zählt auch in ruhigen Stellen weiter
                        self.env = 0.0 if self.voc else (1.0 if one else 0.8)
                        if one:                                      # Taktanfang: nächste Farbe
                            self.hue = (self.hue + 0.17) % 1.0
                    elif kind == T_PEAK and now - self.last_beat > 5 and val > 0.35:   # kein Takt-Raster → Bassschläge zählen
                        self.beats += 1
                        if not self.voc:
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
            # Strobe: während eines Aufbaus laut Wellenform (endet genau auf dem Einsatz) – oder, ohne Wellenform, ein paar
            # Sekunden nach einem mitgehörten Drop – oder von Hand (Drop-Test)
            cue = bool(self.strobe and self.cues and self.cues.strobe(-self.delay_us / 1e6 + self.cue_early))
            if cue != self.cue_on:
                self.cue_on = cue
                if cue:
                    log.info(self.tag + ": Aufbau laut Wellenform → Strobe bis zum Einsatz")
            if cue or now - self.drop_at < self.drop_s:
                self.show(self.strobe_frame(now))
            else:
                nobeat = self.vocals_only(dt, now)                   # läuft gerade kein Bass-Beat? (steuert auch das Aufblitzen)
                voc = bool(self.break_effect) and nobeat
                eff = self.break_effect if voc else self.effect
                # Bass weg: der Balken folgt dann den Mitten (Gesang, Melodie) statt dem Bass, der ja gerade fehlt
                self.show(self.spectrum(dt) if eff == "spektrum" else self.pulse(dt) if eff == "puls"
                          else self.wave(dt) if eff == "welle" else self.bar(dt, eff, voc))

    def wave(self, dt):
        """Welle + Puls + Funkeln – für Flächen mit vielen Segmenten (z. B. 20 Dreiecke). Drei Dinge, jedes an etwas anderem:
        - Puls (Schläge): Die ganze Fläche glimmt in der Takt-Farbe und pulsiert auf jeden Schlag kurz auf.
        - Lauflicht (Gesang): Jeder Einsatz der Stimme – neue Silbe, neue Zeile – schickt einen hellen Impuls mit Schweif
          vom ersten zum letzten Segment. Kräftiger Gesang = schnell, leiser Gesang = langsam, kein Gesang = kein Lauflicht.
          Setzt der Gesang nach einer Pause wieder ein, werden langsame Reste verworfen und es startet frisch.
        - Funkeln (Höhen): Bei Hi-Hat/Becken blitzen einzelne zufällige Segmente weiß auf."""
        # Das Lauflicht hängt am Gesang (mittlere Bänder, ca. 220–2000 Hz – dort liegt die Stimme, aber auch Gitarre/Synth):
        # Wie präsent ist er? Gemessen am Lautesten des Titels in diesem Bereich: bis 6 dB darunter = voll da (1),
        # 18 dB darunter oder mehr = so gut wie weg (0).
        m = self.mids()
        self.mel_hi = max(self.mel_hi * 0.9995, m)
        lv = max(0.0, min(1.0, (m - self.mel_hi + 0.30) / 0.20))
        # leiser werden: gemächlich (0,8 s) – wieder da: sofort (0,1 s)
        self.busy += (lv - self.busy) * (1 - math.exp(-dt / (0.1 if lv > self.busy else 0.8)))
        full = self.busy
        if full < 0.4:
            self.was_calm = True
        # Einsatz der Stimme (neue Silbe/Zeile): die Mitte springt gegenüber dem Schnitt der letzten ca. 0,25 s nach oben
        now = time.monotonic()
        jump = m - self.voice
        self.voice += (m - self.voice) * (1 - math.exp(-dt / 0.25))
        if jump > 0.045 and now - self.wave_at > 0.22 and full > 0.15:
            self.wave_at = now
            if self.was_calm and full > 0.6:                         # Gesang ist zurück: langsame Reste weg, frisch starten
                self.was_calm, self.waves = False, []
            self.waves.append([0.0, min(1.0, 0.55 + jump * 4)])
            self.launches += 1
        self.env *= math.exp(-dt / 0.18)                             # zusätzlich pulsiert die ganze Fläche auf jeden Schlag
        # ohne Bass-Beat: kein Aufblitzen – dafür glimmt die Fläche heller, damit man den Farbwechsel im Takt sieht
        base = max(0.32 if self.voc else 0.10, 0.55 * self.env)
        # Tempo des Lauflichts: Gesang voll da → in ca. 0,45 s einmal durch; Gesang fast weg → nur noch ein Fünftel so schnell
        speed = self.n / 0.45 * (0.2 + 0.8 * full)
        for w in self.waves:
            w[0] += speed * dt
        self.waves = [w for w in self.waves if w[0] < self.n + 3][-6:]
        hi = self.highs()
        rise, self.hi_prev = hi - self.hi_prev, hi
        self.spark = [x * math.exp(-dt / 0.12) for x in self.spark]
        if rise > 0.04:                                              # Höhen setzen ein → 1–3 Segmente funkeln
            for _ in range(1 + min(2, int(rise / 0.06))):
                self.spark[random.randrange(self.n)] = 1.0
        out = []
        for i in range(self.n):
            glow = base
            for pos, power in self.waves:
                d = pos - i                                          # Impuls: vorn scharf, nach hinten ca. 3 Segmente Schweif
                if 0 <= d < 3.5:
                    glow = max(glow, power * (1 - d / 3.5))
            r, g_, b = colorsys_rgb(self.hue, glow)
            sp = self.spark[i]
            out.append((r + (255 - r) * sp, g_ + (255 - g_) * sp, b + (255 - b) * sp) if sp > 0.02 else (r, g_, b))
        return out

    def bar(self, dt, eff=None, voice=False):
        """Pegel aus dem Bass (die zwei untersten Bänder) – jeder Bassschlag lässt den Balken hochspringen.
        Lernkarte: Erst hing der Balken an der Gesamt-Lautstärke mit sehr trägem Abgleich (Minuten). Nach einem leisen
        Intro stand er dann dauernd auf Anschlag – alle Segmente an, eine Farbe. Darum jetzt: Bass statt Lautstärke
        und ein Abgleich über wenige Sekunden (was gerade leise/laut ist, zählt – nicht was vor zwei Minuten war)."""
        e = self.mids() if voice else self.lows()
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
