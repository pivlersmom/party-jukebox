"""
Lampen aus Home Assistant im Takt der Musik (Shelly RGBW, Govee, Hue … – alles, was in HA eine Farb-Lampe ist).

  Music Assistant ──Sendspin (Rolle "visualizer")──► Add-on ──light.turn_on (Farbe + Helligkeit)──► Home Assistant ──► Lampe

Anders als DMX oder WLED laufen diese Lampen über WLAN/Cloud und vertragen nur wenige Befehle pro Sekunde.
Darum gibt es hier kein Blitzen auf jeden Schlag, sondern:
  - Farbe:      wechselt im Takt (jeder Taktanfang bzw. jeder 4. Schlag) – alle Lampen leicht versetzt im Farbkreis
  - Helligkeit: folgt der Lautstärke (ruhige Stelle = dunkler, volle Stelle = hell)
Jede Lampe bekommt höchstens alle `ha_lights_ms` Millisekunden einen Befehl, und nur, wenn sich etwas geändert hat.

Vor dem ersten Befehl merkt sich das Add-on den Zustand der Lampen (Szene „party_jukebox_vorher“) und stellt ihn
wieder her, wenn die Musik aufhört oder der Licht-Schalter ausgeht.

Einstellungen (Add-on-Konfiguration):
  ha_lights         Lampen aus Home Assistant, mit Komma getrennt, z. B. "light.stehleuchte, light.sofa"
                    Eigener Takt je Lampe: "light.lampions=1000" (für Cloud-Lampen, z. B. Govee ohne LAN-Steuerung)
                    Pegel-Balken für Lampen mit Segmenten (z. B. Govee-Stehleuchte): "light.stehleuchte=balken"
                    (Farbe im Takt) oder "=ampel" (unten grün, oben rot). Je lauter, desto mehr Segmente leuchten.
                    Die Segmente müssen in HA als light.<name>_segment_001 … vorhanden sein.
  ha_lights_player  Lautsprecher (Name oder ID), dem das Licht folgt (leer = Party-Player)
  ha_lights_ms      Abstand zwischen zwei Befehlen je Lampe (Standard 500)
"""
import asyncio
import colorsys
import logging
import math
import os
import time

from dmxlight import DmxLight, T_BEAT, T_LOUD, T_PEAK, us

log = logging.getLogger("jukebox")

HA_HTTP = "http://supervisor/core/api"
SCENE = "party_jukebox_vorher"
FPS = 20
MIN_PCT = 25               # so dunkel wird es an ruhigen Stellen höchstens


def parse_lamps(text, default_ms):
    """ "light.a, light.b=1000" → [{"id": "light.a", "ms": 500}, {"id": "light.b", "ms": 1000}] """
    out = []
    for part in str(text or "").replace(";", ",").replace("\n", ",").split(","):
        part = part.strip()
        if not part:
            continue
        bits = [b.strip().lower() for b in part.split("=")]
        ent = bits[0]
        if not ent.startswith("light."):
            continue
        kind, gap = "lamp", None
        for b in bits[1:]:
            if b in ("balken", "bar"):
                kind = "bar"
            elif b in ("ampel", "vu"):
                kind = "ampel"
            elif b.isdigit():
                gap = max(200, int(b))
        if gap is None:
            gap = min(default_ms, 300) if kind != "lamp" else default_ms   # Balken wirkt nur mit kurzen Schritten
        out.append({"id": ent, "ms": gap, "kind": kind, "segs": []})
    return out


class HaLights(DmxLight):
    client_id, name, tag = "pj-ha", "Jukebox HA-Lampen", "HA-Lampen"
    viz = {"types": ["loudness", "beat", "peak"], "rate_max": FPS}

    def __init__(self, session, opt, ma_cmds, ma_host):
        super().__init__(session, opt, ma_cmds, ma_host)
        try:
            default_ms = max(200, int(opt.get("ha_lights_ms") or 500))
        except (TypeError, ValueError):
            default_ms = 500
        self.lamps = parse_lamps(opt.get("ha_lights"), default_ms)
        for i, l in enumerate(self.lamps):
            l.update({"at": -1e9, "busy": False, "said": None, "shift": i / max(1, len(self.lamps)) * 0.5})
        self.player = str(opt.get("ha_lights_player") or opt.get("wled_player") or opt.get("dmx_player") or opt.get("party_player") or "").strip()
        self.token = os.environ.get("SUPERVISOR_TOKEN") or os.environ.get("HASSIO_TOKEN") or ""
        self.level = 0.0                 # Pegel für den Balken: springt sofort hoch, fällt in ca. 0,4 s ab
        self.taken = False               # haben wir die Lampen gerade übernommen? (dann beim Ende zurückgeben)
        self.sent = 0

    # ------------------------------------------------------------------ Home Assistant
    async def call(self, domain, service, data):
        try:
            async with self.session.post(f"{HA_HTTP}/services/{domain}/{service}", json=data,
                                         headers={"Authorization": f"Bearer {self.token}"}, timeout=8) as r:
                if r.status >= 400 and self.stat.get("err") != r.status:
                    self.stat["err"] = r.status
                    log.info(self.tag + ": %s.%s → %s %s", domain, service, r.status, (await r.text())[:200])
                return r.status < 400
        except Exception as e:
            if self.stat.get("err") != str(e):
                self.stat["err"] = str(e)
                log.info(self.tag + ": %s.%s fehlgeschlagen: %s", domain, service, e)
            return False

    async def lamp(self, l, rgb, pct):
        """Einen Befehl an eine Lampe – läuft für diese Lampe noch einer, wird dieser ausgelassen (kein Stau)."""
        l["busy"] = True
        try:
            await self.call("light", "turn_on", {"entity_id": l["id"], "rgb_color": rgb, "brightness_pct": pct,
                                                 "transition": round(min(1.0, l["ms"] / 1000.0) * 0.6, 2)})
            self.sent += 1
        finally:
            l["busy"] = False

    async def take(self):
        """Zustand der Lampen merken, bevor wir sie verändern."""
        self.taken = True
        ents = [l["id"] for l in self.lamps] + [e for l in self.lamps for e in l["segs"]]
        await self.call("scene", "create", {"scene_id": SCENE, "snapshot_entities": ents})
        for l in self.lamps:
            l["seg_said"] = [None] * len(l["segs"])
            if l["segs"]:                                            # Balken: Lampe an, die Segmente übernehmen dann
                await self.call("light", "turn_on", {"entity_id": l["id"], "brightness_pct": 100})
        log.info(self.tag + ": übernehme %s (Zustand vorher gemerkt)", ", ".join(l["id"] for l in self.lamps))

    async def give_back(self, why):
        self.taken = False
        for l in self.lamps:
            l["said"] = None
            l["seg_said"] = [None] * len(l["segs"])
        await asyncio.sleep(0.6)                                    # laufende Befehle erst ankommen lassen
        await self.call("scene", "turn_on", {"entity_id": "scene." + SCENE, "transition": 1})
        log.info(self.tag + ": %s – Lampen wieder wie vorher", why)

    # ------------------------------------------------------------------ Grundgerüst anpassen
    async def setup(self):
        if not self.lamps:
            log.info(self.tag + ": in ha_lights steht keine gültige Lampe (erwartet: light.xyz, mit Komma getrennt)")
            return False
        if not self.token:
            log.info(self.tag + ": kein Zugriff auf Home Assistant (Supervisor-Token fehlt)")
            return False
        await self.find_segments()
        log.info(self.tag + ": %s", ", ".join("%s (%salle %d ms)" % (l["id"], "Balken mit %d Segmenten, " % len(l["segs"]) if l["segs"] else "", l["ms"])
                                              for l in self.lamps))
        return True

    async def find_segments(self):
        """Für Balken-Lampen die Segmente in Home Assistant suchen: light.<name>_segment_001, _002 …"""
        want = [l for l in self.lamps if l["kind"] != "lamp"]
        if not want:
            return
        try:
            async with self.session.get(f"{HA_HTTP}/states", headers={"Authorization": f"Bearer {self.token}"}, timeout=15) as r:
                ids = [x.get("entity_id", "") for x in await r.json()] if r.status < 400 else []
        except Exception as e:
            log.info(self.tag + ": Segmente nicht abfragbar: %s", e)
            ids = []
        for l in want:
            pre = l["id"] + "_segment_"
            l["segs"] = sorted((i for i in ids if i.startswith(pre) and i[len(pre):].isdigit()), key=lambda i: int(i[len(pre):]))
            if not l["segs"]:
                log.info(self.tag + ": %s hat in Home Assistant keine Segmente (%s001 …) – läuft als normale Lampe", l["id"], pre)
                l["kind"] = "lamp"

    async def bar(self, l, groups, off):
        """Balken-Schritt: Segmente mit gleicher Farbe in einem Befehl einschalten, den Rest in einem ausschalten."""
        l["busy"] = True
        try:
            for rgb, ents in groups.items():
                await self.call("light", "turn_on", {"entity_id": ents, "rgb_color": list(rgb), "brightness_pct": 100})
                self.sent += 1
            if off:
                await self.call("light", "turn_off", {"entity_id": off})
                self.sent += 1
        finally:
            l["busy"] = False

    def bar_step(self, l):
        """Was muss sich an den Segmenten ändern? → ({Farbe: [Segmente]}, [Segmente aus])"""
        n = len(l["segs"])
        lit = max(1, min(n, int(math.ceil(self.level * n - 0.001))))
        groups, off = {}, []
        for i, ent in enumerate(l["segs"]):
            if i < lit:
                # Ampel: fester Verlauf grün (unten) → rot (oben); sonst die Takt-Farbe
                hue = (0.33 * (1 - i / max(1, n - 1))) if l["kind"] == "ampel" else (self.hue + l["shift"]) % 1.0
                want = round(hue, 3)
            else:
                want = "off"
            if l["seg_said"][i] == want:
                continue
            l["seg_said"][i] = want
            if want == "off":
                off.append(ent)
            else:
                groups.setdefault(tuple(int(round(x * 255)) for x in colorsys.hsv_to_rgb(hue, 1.0, 1.0)), []).append(ent)
        return groups, off

    async def test_pattern(self):
        return                                                       # kein Testmuster: Wohnraumlampen sollen nicht ungefragt aufleuchten

    def send(self, v=None, rgb=None):
        return                                                       # das Grundgerüst sendet DMX – hier nichts zu tun

    def arrived(self, ts, kind, val):
        return False                                                 # keine Drop-Erkennung, alles normal einreihen

    def status_extra(self):
        n, self.sent = self.sent, 0
        return " · %d Lampen-Befehle" % n

    def test_drop(self):
        return "HA-Lampen haben keinen Drop-Effekt"

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
                # Schalter aus: sofort zurückgeben. Musikpause: erst nach 5 s (Titelwechsel soll nicht flackern).
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
                    elif kind == T_BEAT:
                        self.beats += 1
                        self.last_beat = now
                        if val or self.beats % 4 == 0:               # Taktanfang (oder jeder 4. Schlag): nächste Farbe
                            self.hue = (self.hue + 0.17) % 1.0
                    elif kind == T_PEAK and now - self.last_beat > 5 and val > 0.35:   # kein Takt-Raster → Bassschläge zählen
                        self.beats += 1
                        if self.beats % 8 == 0:
                            self.hue = (self.hue + 0.17) % 1.0
            # Lautstärke auf 0..1 bringen (leise und laute Titel sollen gleich wirken), über ca. 0,7 s geglättet
            self.hi = max(self.hi * 0.9998, self.loud)
            self.lo = min(self.lo * 1.0002 + 0.00001, self.loud)
            lv = max(0.0, min(1.0, (self.loud - self.lo) / max(0.05, self.hi - self.lo)))
            self.smooth += (lv - self.smooth) * (1 - math.exp(-dt / 0.7))
            pct = int(round(MIN_PCT + (100 - MIN_PCT) * self.smooth))
            self.level = max(lv, self.level * math.exp(-dt / 0.4))
            if not self.taken:
                await self.take()
            for l in self.lamps:
                if l["busy"] or (now - l["at"]) * 1000 < l["ms"]:
                    continue
                if l["segs"]:                                        # Pegel-Balken
                    groups, off = self.bar_step(l)
                    if groups or off:
                        l["at"] = now
                        asyncio.create_task(self.bar(l, groups, off))
                    continue
                hue = (self.hue + l["shift"]) % 1.0
                said = l["said"]
                # nur senden, wenn sich etwas sichtbar geändert hat (neue Farbe oder Helligkeit um mindestens 8 Punkte)
                if said and said[0] == hue and abs(said[1] - pct) < 8:
                    continue
                l["at"], l["said"] = now, (hue, pct)
                rgb = [int(round(x * 255)) for x in colorsys.hsv_to_rgb(hue, 1.0, 1.0)]
                asyncio.create_task(self.lamp(l, rgb, pct))
