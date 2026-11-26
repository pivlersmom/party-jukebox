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
  dmx_fixtures  Mehrere Geräte im selben Universum, je Zeile "Name | Art | Kanäle | Dauer":
                  Spot  | beat  | dimmer=1,r=2,g=3,b=4,strobe=5     folgt dem Takt; Strobe-Kanal nur beim Drop
                  Nebel | drop  | 10=255 | 3s                       beim Drop 3 s lang Kanal 10 auf 255, sonst 0
                  Laser | music | 20=255                            solange Musik läuft Kanal 20 auf 255, sonst 0
                Arten: beat · smooth · color (Licht) · drop (nur beim Drop) · music (nur bei Musik)
  dmx_drop_*    Drop-Erkennung nachstellen: build (Sekunden Aufbau), sensitivity (1–10), seconds (Dauer),
                cooldown (Pause bis zum nächsten Drop); dmx_strobe_value = Wert des Strobe-Kanals beim Drop

Was ist ein "Drop"? Im Aufbau (Build-up/Breakdown) nimmt ein Titel den Bass für einige Sekunden heraus, dann
setzt er schlagartig wieder ein. Genau das sucht DropDetector: Bass deutlich unter dem gewohnten Pegel für
mindestens `build` Sekunden – bei weiterlaufender Musik – und dann zurück auf vollen Pegel.
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


class DropDetector:
    """Sucht "Bass weg → Aufbau → Bass schlagartig zurück". Wird mit jedem Spektrum-Paket gefüttert (also VOR dem Ton)."""

    def __init__(self, build_s=6.0, sensitivity=5, cooldown_s=30.0):
        self.build_s, self.cooldown_s = float(build_s), float(cooldown_s)
        # Wie weit der Bass unter den gewohnten Pegel fallen muss (Anteil der 60-dB-Skala; 0,15 ≈ 9 dB)
        self.delta = max(0.06, 0.25 - 0.02 * max(1, min(10, int(sensitivity))))
        self.fast = None          # geglätteter Bass (ca. 0,1 s)
        self.hi = 0.0             # gewohnter voller Bass-Pegel (sinkt nur langsam)
        self.high_time = 0.0      # so lange lief schon voller Bass (nach einer Pause von vorn)
        self.low_since = None     # seit wann der Bass weg ist
        self.low_loud = [0.0, 0]  # Lautstärke während des Aufbaus (Summe, Anzahl) – Stille ist kein Aufbau
        self.quiet = 0.0
        self.block_until = 0
        self.last_drop = -10 ** 18
        self.prev = None

    def feed(self, ts, bass, loud):
        """ts in µs, bass und loud 0..1. Gibt beim Drop ein dict mit den Messwerten zurück, sonst None."""
        dt = 0.03 if self.prev is None else max(0.0, min(0.2, (ts - self.prev) / 1e6))
        self.prev = ts
        self.fast = bass if self.fast is None else self.fast + (bass - self.fast) * (1 - math.exp(-dt / 0.12))
        self.hi = max(self.fast, self.hi - dt * 0.004)
        # Stille (Titelwechsel, Pause): alles zurück – der Einsatz des nächsten Titels ist kein Drop
        self.quiet = self.quiet + dt if loud < 0.12 else 0.0
        if self.quiet > 1.0:
            self.low_since, self.high_time, self.low_loud = None, 0.0, [0.0, 0]
            self.block_until = ts + 3_000_000
            return None
        if self.fast < self.hi - self.delta:                       # Bass ist weg
            if self.low_since is None:
                self.low_since, self.low_loud = ts, [0.0, 0]
            self.low_loud[0] += loud
            self.low_loud[1] += 1
        elif self.fast >= self.hi - self.delta * 0.3:              # Bass ist (wieder) voll da
            out = None
            if self.low_since is not None:
                build = (ts - self.low_since) / 1e6
                avg = self.low_loud[0] / max(1, self.low_loud[1])
                if (build >= self.build_s and self.high_time >= 5 and avg >= 0.2 and ts > self.block_until
                        and (ts - self.last_drop) / 1e6 >= self.cooldown_s):
                    self.last_drop = ts
                    out = {"build_s": round(build, 1), "bass": round(self.fast, 2), "level": round(self.hi, 2), "loud": round(avg, 2)}
                self.low_since = None
            self.high_time += dt
            return out
        return None


KINDS = ("beat", "smooth", "color", "drop", "music")


def parse_fixtures(opt):
    """Geräteliste aus den Einstellungen. Ohne dmx_fixtures: ein Gerät aus dmx_channels + dmx_effect (wie bisher)."""
    out = []
    for line in opt.get("dmx_fixtures") or []:
        parts = [x.strip() for x in str(line).split("|")]
        if len(parts) < 3:
            continue
        kind = parts[1].lower()
        kind = {"takt": "beat", "licht": "beat", "nebel": "drop", "musik": "music"}.get(kind, kind)
        roles, fixed = parse_channels(parts[2])
        dur = None
        if len(parts) > 3:
            num = "".join(c for c in parts[3].replace(",", ".") if c.isdigit() or c == ".")
            dur = float(num) if num else None
        if kind in KINDS and (roles or fixed):
            out.append({"name": parts[0] or kind, "kind": kind, "roles": roles, "fixed": fixed, "dur": dur})
    if not out:
        roles, fixed = parse_channels(opt.get("dmx_channels") or "r=1,g=2,b=3")
        eff = str(opt.get("dmx_effect") or "beat").strip().lower()
        if roles or fixed:
            out.append({"name": "Licht", "kind": eff if eff in KINDS else "beat", "roles": roles, "fixed": fixed, "dur": None})
    return out


class DmxLight:
    # Diese vier Angaben überschreibt die WLED-Variante (wledsync.py)
    client_id, name, tag = CLIENT_ID, NAME, "DMX-Licht"
    # welche Daten wir von Music Assistant wollen (Spektrum: 16 Bänder, daraus der Bass für die Drop-Erkennung)
    viz = {"types": ["loudness", "beat", "peak", "spectrum"], "rate_max": 30,
           "spectrum": {"n_disp_bins": 16, "scale": "log", "f_min": 43, "f_max": 9259}}

    def __init__(self, session, opt, ma_cmds, ma_host):
        self.session, self.ma_cmds, self.ma_host = session, ma_cmds, ma_host
        self.host = str(opt.get("dmx_host") or "").strip()
        self.universe = int(opt.get("dmx_universe") or 0)
        self.fixtures = parse_fixtures(opt)
        num = lambda k, d: float(opt.get(k)) if opt.get(k) not in (None, "") else d
        self.drop_s = num("dmx_drop_seconds", 4.0)                  # Dauer von Strobe/Drop-Geräten
        self.strobe_val = int(num("dmx_strobe_value", 200))
        self.detector = DropDetector(num("dmx_drop_build", 6.0), num("dmx_drop_sensitivity", 5), num("dmx_drop_cooldown", 30.0))
        self.on_drop = None               # vom Add-on gesetzt: meldet den Drop an Home Assistant (Event)
        self.on_state = None              # vom Add-on gesetzt: meldet Farbe, Tempo und Energie an Home Assistant
        self.beat_times = deque(maxlen=12)
        self.said_hue, self.said_at, self.said_idle = None, 0.0, True
        self.drop_at = -1e9               # wann der letzte Drop fällig war (Uhr des Add-ons)
        self.loud_in = 0.0                # zuletzt EINGETROFFENE Lautstärke (für die Erkennung, vor dem Ton)
        self.bass = 0.0
        self.player = str(opt.get("dmx_player") or opt.get("party_player") or "").strip()
        self.delay_us = int(opt.get("dmx_delay_ms") or 0) * 1000
        self.enabled = lambda: True       # vom Add-on gesetzt: Schalter „Licht im Takt“ (aus = gar nichts senden)
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
    def frame(self, levels, rgb, drop_age, music):
        """
        Alle Geräte in EIN DMX-Bild schreiben und senden.
        levels = Helligkeit 0..1 je Licht-Art, rgb = Farbe, drop_age = Sekunden seit dem letzten Drop, music = läuft Musik?
        """
        buf = bytearray(512)
        top = 0
        for fx in self.fixtures:
            kind, roles = fx["kind"], fx["roles"]
            if kind in ("drop", "music"):
                on = (drop_age < (fx["dur"] or self.drop_s)) if kind == "drop" else music
                for ch, x in fx["fixed"].items():
                    buf[ch - 1] = x if on else 0
                    top = max(top, ch)
                continue
            v = levels.get(kind, 0.0)
            r, g, b = rgb or (1.0, 1.0, 1.0)
            strobe = 0.0
            if "strobe" in roles and self.strobe_val > 0 and drop_age < (fx["dur"] or self.drop_s):
                v, (r, g, b), strobe = 1.0, (1.0, 1.0, 1.0), self.strobe_val / 255.0      # Drop: volle Helligkeit, weiß, Strobe an
            has_rgb = any(k in roles for k in "rgb")
            k = 1.0 if "dimmer" in roles else v           # ohne eigenen Helligkeits-Kanal steckt die Helligkeit in der Farbe
            val = {"dimmer": v, "r": r * k, "g": g * k, "b": b * k, "w": 0.0 if has_rgb else v, "strobe": strobe}
            for role, ch in roles.items():
                buf[ch - 1] = max(0, min(255, int(round(val[role] * 255))))
                top = max(top, ch)
            for ch, x in fx["fixed"].items():
                buf[ch - 1] = x
                top = max(top, ch)
        self.seq = self.seq % 255 + 1
        try:
            self.sock.sendto(artnet(self.universe, buf[:max(top, 2)], self.seq), (self.host, 6454))
        except OSError as e:
            if self.stat.get("err") != str(e):
                self.stat["err"] = str(e)
                log.info(self.tag + ": Senden an %s fehlgeschlagen: %s", self.host, e)

    def send(self, v, rgb=None):
        """Einfaches Bild: alle Licht-Geräte mit Helligkeit v und Farbe rgb; Drop- und Musik-Geräte bleiben aus."""
        self.frame({"beat": v, "smooth": v, "color": v}, rgb, 1e9, False)

    async def test_pattern(self):
        """Beim Start einmal Rot, Grün, Blau, Weiß – so sieht man sofort, ob Knoten, Universum und Kanäle stimmen."""
        log.info(self.tag + ": Testmuster an %s (Universum %d) · Geräte: %s", self.host, self.universe,
                 "; ".join("%s=%s %s %s" % (f["name"], f["kind"], f["roles"] or "", f["fixed"] or "") for f in self.fixtures))
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
            if not self.enabled():           # ausgeschaltet: KEIN Paket mehr – die Lampe gehört dann z. B. Home Assistant
                dark = 99
                self.env = 0.0
                continue
            now = time.monotonic()
            active = self.playing and now - self.last_frame < 3
            if not active:
                # Musik aus: ein paar Mal "dunkel" senden, dann ganz still sein. So gibt ein Empfänger wie WLED die
                # Lampe wieder frei (Steuerung über Home Assistant/Presets), statt dauerhaft im Fernsteuer-Modus zu bleiben.
                if now - self.drop_at < self.drop_max():             # Drop-Test ohne Musik: Strobe/Nebel trotzdem zeigen
                    self.frame({}, None, now - self.drop_at, False)
                    dark = 0
                    continue
                if dark < 8:
                    self.send(0.0)
                dark += 1
                self.env = 0.0
                if not self.said_idle:                               # einmal melden: Musik aus → Energie 0
                    self.said_idle = True
                    self.report({"energy": 0, "bpm": None, "playing": False})
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
                        self.beat_times.append(now)
                        self.env = 1.0 if val else 0.8
                        if val or self.beats % 4 == 0:           # Taktanfang (oder jeder 4. Schlag): nächste Farbe
                            self.hue = (self.hue + 0.17) % 1.0
                    elif kind == "drop":
                        self.drop_at = now
                        log.info(self.tag + ": Drop ausgelöst → %s", self.drop_targets())
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
            levels = {"beat": max(self.env, 0.10 + 0.25 * self.smooth), "smooth": 0.12 + 0.88 * self.smooth, "color": 1.0}
            rgb = colorsys.hsv_to_rgb(self.hue, 1.0, 1.0)
            self.frame(levels, rgb, now - self.drop_at, True)
            # Home Assistant auf dem Laufenden halten: neue Farbe sofort, Tempo/Energie alle 5 s
            if self.on_state and (self.hue != self.said_hue or now - self.said_at > 5):
                d = {"energy": int(round(self.smooth * 100)), "bpm": self.bpm(), "playing": True}
                if self.hue != self.said_hue:
                    d["rgb"] = [int(round(x * 255)) for x in rgb]
                    d["hue"] = int(round(self.hue * 360))
                self.said_hue, self.said_at, self.said_idle = self.hue, now, False
                self.report(d)

    def drop_max(self):
        """Längste Drop-Dauer aller Geräte (so lange läuft ein Drop höchstens)."""
        return max([self.drop_s] + [f["dur"] for f in self.fixtures if f["dur"]])

    def drop_targets(self):
        """Was ein Drop schaltet – als Text fürs Protokoll (hilft bei „Drop erkannt, aber nichts passiert“)."""
        out = []
        for f in self.fixtures:
            dur = f["dur"] or self.drop_s
            if f["kind"] == "drop":
                out.append("%s: %s für %g s" % (f["name"], ", ".join("Kanal %d=%d" % kv for kv in sorted(f["fixed"].items())), dur))
            elif "strobe" in f["roles"] and self.strobe_val > 0:
                out.append("%s: Strobe Kanal %d=%d, volle Helligkeit weiß, für %g s" % (f["name"], f["roles"]["strobe"], self.strobe_val, dur))
        return "; ".join(out) or "nichts (kein Gerät mit strobe=… und kein Gerät der Art drop eingetragen)"

    def test_drop(self):
        """Drop von Hand auslösen (Jukebox: Licht-Knopf lange drücken) – zum Prüfen von Strobe, Nebel & Co."""
        if not self.enabled():
            return "Licht ist ausgeschaltet"
        self.drop_at = time.monotonic()
        t = self.drop_targets()
        log.info(self.tag + ": Drop-Test → %s", t)
        return t

    def bpm(self):
        """Tempo aus den Abständen der letzten Schläge (Median), None wenn kein Takt bekannt ist."""
        t = list(self.beat_times)
        gaps = sorted(b - a for a, b in zip(t, t[1:]) if 0.25 < b - a < 1.5)
        return int(round(60.0 / gaps[len(gaps) // 2])) if len(gaps) >= 4 else None

    def report(self, d):
        if self.on_state:
            try:
                self.on_state(d)
            except Exception:
                pass

    # ------------------------------------------------------------------ Verbindung zu Music Assistant
    async def keep_grouped(self):
        """Das Licht-Gerät an den gewählten Lautsprecher hängen (und wieder dranhängen, falls die Gruppe aufgelöst wurde)."""
        said, tries = None, 0
        while True:
            # warten – aber sofort reagieren, wenn der Schalter umgelegt wird
            wait, was = (5 if said is None else min(120, 20 * max(1, tries))), self.enabled()
            for _ in range(int(wait)):
                await asyncio.sleep(1)
                if self.enabled() != was:
                    break
            try:
                if not self.enabled():
                    # aus: das Licht-Gerät aus der Gruppe des Lautsprechers lösen (dann zählt es dort auch nicht mehr mit)
                    pl = (await self.ma_cmds(self.session, [("players/all", {})]))[0] or []
                    mine = next((x for x in pl if x.get("player_id") == self.client_id), None)
                    if mine and (mine.get("synced_to") or mine.get("active_group")):
                        await self.ma_cmds(self.session, [("players/cmd/ungroup", {"player_id": mine["player_id"]})])
                    if said != "aus":
                        said, tries = "aus", 0
                        log.info(self.tag + ": ausgeschaltet – sendet nichts, vom Lautsprecher gelöst")
                    continue
                pl = (await self.ma_cmds(self.session, [("players/all", {})]))[0] or []
                mine = next((x for x in pl if x.get("player_id") == self.client_id or x.get("name") == self.name), None)
                want = self.player.lower()
                tgt = next((x for x in pl if want and (str(x.get("player_id", "")).lower() == want or str(x.get("name", "")).lower() == want)), None)
                if not mine or not tgt:
                    msg = "Licht-Gerät in MA nicht gefunden" if not mine else "Lautsprecher „%s“ nicht gefunden – im Feld „folgt diesem Lautsprecher“ muss ein Lautsprecher aus Music Assistant stehen" % self.player
                    if said != msg:
                        said = msg
                        log.info(self.tag + ": %s", msg)
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
                    log.info(self.tag + ": %s", msg)
            except Exception as e:
                if said != str(e):
                    said = str(e)
                    log.info(self.tag + ": Gruppieren: %s", e)

    def parse(self, kind, d):
        """Nutzdaten eines Datenpakets auspacken (None = brauchen wir nicht)."""
        if kind == T_LOUD and len(d) >= 2:
            return struct.unpack(">H", d[:2])[0] / 65535.0
        if kind == T_BEAT:
            return d[0] & 1                                         # 1 = Taktanfang
        if kind == T_PEAK:
            return d[0] / 255.0
        if kind == T_SPEC and len(d) >= 8:
            lo = struct.unpack(">3H", d[2:8])                       # Bänder 2–4 (ca. 60–130 Hz): der Bass
            return sum(lo) / (3 * 65535.0)
        return None

    def status_extra(self):
        d = self.detector
        return " · Bass %.2f (gewohnt %.2f, Schwelle %.2f)" % (self.bass, d.hi, d.hi - d.delta)

    def arrived(self, ts, kind, val):
        """Ein Datenpaket ist da (noch VOR dem Ton). Hier läuft die Drop-Erkennung; True = nicht in die Warteschlange."""
        if kind == T_LOUD:
            self.loud_in = val
            return False
        if kind != T_SPEC:
            return False
        self.bass = val
        hit = self.detector.feed(ts, val, self.loud_in)
        if hit:
            self.events.append((ts, "drop", hit))                   # wird im Bild genau zum Ton ausgelöst
            log.info(self.tag + ": Drop erkannt · Aufbau %(build_s)s s · Bass zurück auf %(bass)s (gewohnt %(level)s) · Lautstärke im Aufbau %(loud)s", hit)
            if self.on_drop:
                try:
                    self.on_drop(hit)
                except Exception:
                    pass
        return True

    async def link(self):
        viz = self.viz
        async with self.session.ws_connect(f"ws://{self.ma_host}:8927/sendspin", max_msg_size=0, heartbeat=30) as ws:
            sup = dict(viz)
            sup["buffer_capacity"] = 600
            await ws.send_json({"type": "client/hello", "payload": {
                "client_id": self.client_id, "name": self.name, "version": 1, "supported_roles": ["visualizer@v1"],
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
                        log.info(self.tag + ": läuft · Pakete/min %s · Schläge %d · Daten kommen %d ms vor dem Ton%s",
                                 self.stat["n"], self.beats, lead / 1000, self.status_extra())
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
                    val = self.parse(kind, b[9:])
                    if val is None:
                        continue
                    self.last_frame = now
                    self.playing = True
                    n = self.stat.setdefault("n", {})
                    n[kind] = n.get(kind, 0) + 1
                    if self.offset is not None and len(self.lead) < 200:
                        self.lead.append(ts - (us() + self.offset))
                    if self.arrived(ts, kind, val):
                        continue
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
                        log.info(self.tag + ": bei Music Assistant angemeldet (%s)", ",".join(p.get("active_roles") or []))
                        await ws.send_json({"type": "client/state", "payload": {"available": True, "visualizer": viz}})
                    elif t == "group/update" and "playback_state" in p:
                        self.playing = p.get("playback_state") == "playing"
                    elif t in ("stream/clear", "stream/end"):
                        self.events.clear()
                        if t == "stream/end":
                            self.playing = False
                    elif t == "stream/start":
                        log.info(self.tag + ": Datenstrom %s", json.dumps(p.get("visualizer") or p, ensure_ascii=False)[:300])
                elif m.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                    return

    async def setup(self):
        """Ausgang vorbereiten. False = Einstellungen unbrauchbar, Funktion bleibt aus."""
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.sock.setblocking(False)
            self.host = (await asyncio.get_running_loop().getaddrinfo(self.host, 6454, family=socket.AF_INET))[0][4][0]
        except Exception as e:
            log.info(self.tag + ": Adresse „%s“ nicht erreichbar: %s", self.host, e)
            return False
        if not self.fixtures:
            log.info(self.tag + ": keine gültigen Kanäle in dmx_channels/dmx_fixtures – aus")
            return False
        return True

    async def run(self):
        if not await self.setup():
            return
        await asyncio.sleep(12)
        if self.enabled():                    # ausgeschaltet heißt: auch kein Testmuster
            await self.test_pattern()
        tasks = [asyncio.create_task(self.render()), asyncio.create_task(self.keep_grouped())]
        try:
            while True:
                try:
                    await self.link()
                    log.info(self.tag + ": Verbindung zu Music Assistant beendet – neuer Versuch in 10 s")
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    log.info(self.tag + ": Verbindung zu Music Assistant: %s – neuer Versuch in 10 s", e)
                self.playing = False
                await asyncio.sleep(10)
        finally:
            for t in tasks:
                t.cancel()
            try:
                self.send(0.0)
            except Exception:
                pass
