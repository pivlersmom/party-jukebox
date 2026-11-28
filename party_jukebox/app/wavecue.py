"""
Strobe-Stellen im Voraus aus der Wellenform des Titels lesen.

Music Assistant kennt von jedem Titel die Wellenform – die Balken, die man in der Oberfläche über der Zeitleiste sieht
(Befehl "audio_analysis/wave_form": 1800 Werte von 0 bis 1 über die ganze Länge). Einen Aufbau erkennt man darin mit
bloßem Auge: Die Balken werden über mehrere Sekunden stetig höher, dann steht alles auf Anschlag.

    ▁▁▁▁▂▂▃▃▄▅▆▇███████        ← hier soll es blitzen (während die Balken steigen), mit dem Anschlag ist Schluss
        └─ Aufbau ─┘└ voll

Vorteil gegenüber dem Mithören: Wir wissen schon beim Titelstart, wann die Aufbauten kommen – das Strobe kann
WÄHREND des Aufbaus laufen und genau auf dem Einsatz enden. (Mithören merkt den Aufbau erst, wenn er vorbei ist.)

WaveCues holt je Lautsprecher die Wellenform des laufenden Titels, sucht die Aufbauten und sagt den Lampen,
ob an der aktuellen Stelle des Titels gerade einer läuft.
"""
import asyncio
import logging
import time

log = logging.getLogger("jukebox")

MIN_RISE = 0.22            # so viel müssen die Balken im Aufbau steigen (Skala 0..1)
MIN_FIT = 0.70             # wie gleichmäßig der Anstieg sein muss (1 = schnurgerade)
MAX_STROBE_S = 12.0        # höchstens so lange blitzen, auch wenn der Aufbau länger ist


def envelope(wave, bin_s):
    """Hüllkurve: Die Rohwerte springen mit jedem Schlag auf und ab. Je Stelle den höchsten Wert im Umkreis von 0,7 s
    nehmen (= Oberkante der Balken) und über 1 s glätten."""
    n = len(wave)
    r = max(1, int(round(0.7 / bin_s)))
    top = [max(wave[max(0, i - r):i + r + 1]) for i in range(n)]
    s = max(1, int(round(0.5 / bin_s)))
    return [sum(top[max(0, i - s):i + s + 1]) / len(top[max(0, i - s):i + s + 1]) for i in range(n)]


def line_fit(y):
    """Gerade durch die Werte legen: (Anstieg über die ganze Strecke, Güte 0..1)."""
    n = len(y)
    mx, my = (n - 1) / 2, sum(y) / n
    sxx = sum((i - mx) ** 2 for i in range(n))
    sxy = sum((i - mx) * (v - my) for i, v in enumerate(y))
    syy = sum((v - my) ** 2 for v in y)
    if sxx == 0 or syy == 0:
        return 0.0, 0.0
    slope = sxy / sxx
    return slope * (n - 1), (sxy * sxy) / (sxx * syy)


def find_builds(wave, duration):
    """Aufbauten suchen → Liste (Start, Ende) in Sekunden: die Strecke, auf der geblitzt wird.
    Ein Aufbau: über 4–16 s steigen die Balken gleichmäßig um mindestens MIN_RISE, fangen dabei klar unter „voll“ an
    und enden nahe „voll“."""
    n = len(wave)
    if n < 50 or not duration or duration < 30:
        return []
    bin_s = duration / n
    env = envelope(wave, bin_s)
    full = sorted(env)[int(n * 0.9)]                                 # was in diesem Titel „voll“ ist
    sec = max(1, int(round(1.0 / bin_s)))                           # so viele Werte sind 1 s
    marks = [False] * n
    for win_s in (4, 6, 8, 12, 16):
        w = int(round(win_s / bin_s))
        if w < 6 or w >= n:
            continue
        step = max(1, w // 8)
        for a in range(0, n - w, step):
            seg = env[a:a + w]
            rise, fit = line_fit(seg)
            if not (rise >= MIN_RISE and fit >= MIN_FIT and seg[0] <= 0.7 * full and seg[-1] >= 0.75 * full):
                continue
            # Sprung statt Aufbau? Wenn fast der ganze Anstieg innerhalb einer Sekunde passiert, ist es nur ein Einsatz
            # (leise Strophe → voller Refrain) – kein Aufbau, also kein Strobe.
            jump = max(seg[k + sec] - seg[k] for k in range(len(seg) - sec))
            if jump > 0.45 * rise:
                continue
            for i in range(a, a + w):
                marks[i] = True
    shift = 0.7                                                      # die Hüllkurve „sieht“ 0,7 s voraus – wieder abziehen
    out, i = [], 0
    while i < n:
        if not marks[i]:
            i += 1
            continue
        j = i
        while j < n and marks[j]:
            j += 1
        top = max(env[i:j])
        end = next(k for k in range(i, j) if env[k] >= 0.95 * top)   # oben angekommen = Ende des Aufbaus (der Einsatz)
        low = min(env[i:end + 1])
        start = max(k for k in range(i, end + 1) if env[k] <= low + 0.12 * (top - low))   # dort beginnt der Anstieg wirklich
        a, b = start * bin_s + shift, end * bin_s + shift
        if b - a >= 3.0:
            out.append((round(max(a, b - MAX_STROBE_S), 1), round(b, 1)))
        i = j + 1
    merged = []
    for a, b in out:                                                 # Aufbauten, die fast aneinanderstoßen, zusammenlegen
        if merged and a - merged[-1][1] < 2.0:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    return merged


def sketch(wave, duration, per_s=3.0):
    """Wellenform als Ziffernzeile fürs Protokoll (0 = still, 9 = voll, ein Zeichen je 3 s) – zum Vergleichen mit der Oberfläche."""
    n = len(wave)
    if not n or not duration:
        return ""
    env = envelope(wave, duration / n)
    k = max(1, int(round(per_s / (duration / n))))
    return "".join(str(min(9, int(max(env[i:i + k]) * 10))) for i in range(0, n, k))


# ---------------------------------------------------------------------------------------------------------------------
# Licht-Profile nach Musikrichtung
#
# Music Assistant kennt zu vielen Titeln die Richtung (kommt vom Anbieter, z. B. Tidal: "Schlager", "Pop") und das Tempo.
# Daraus wählen wir ein Profil – angelehnt an das, was in der Lichttechnik üblich ist:
#   Elektro:  kräftige Neonfarben, alles hart auf den Beat, Strobe gezielt an den Höhepunkten
#   Rock:     warme Farben und Weiß, kräftige Akzente, Wechsel eher phrasenweise
#   Ruhiges:  warme, weiche Töne, langsame Wechsel, kein Strobe
# Felder:
#   colors  Farbfolge als (Farbton 0..1, Sättigung 0..1) – 0 = rot, 0,33 = grün, 0,66 = blau; Sättigung 0 = weiß
#   bars    alle wie viele Takte die Farbe wechselt
#   flash   wie stark das Aufblitzen auf den Schlag ist (0..1)
#   decay   wie lange ein Blitz nachklingt (Sekunden)
#   strobe  Strobe im Aufbau erlaubt?
PROFILES = {
    "standard": {"name": "Standard", "colors": [(h / 6.0 + 0.02, 1.0) for h in (0, 1, 2, 3, 4, 5)], "bars": 1, "flash": 1.0, "decay": 0.18, "strobe": True},
    "elektro":  {"name": "Elektro", "colors": [(0.83, 1.0), (0.55, 1.0), (0.33, 1.0), (0.97, 1.0), (0.66, 1.0), (0.14, 1.0)], "bars": 1, "flash": 1.0, "decay": 0.15, "strobe": True},
    "party":    {"name": "Schlager/Party", "colors": [(0.0, 1.0), (0.11, 1.0), (0.90, 1.0), (0.33, 1.0), (0.16, 1.0), (0.58, 1.0)], "bars": 1, "flash": 0.9, "decay": 0.2, "strobe": True},
    "pop":      {"name": "Pop", "colors": [(0.90, 0.85), (0.55, 0.85), (0.12, 0.85), (0.75, 0.85), (0.45, 0.85)], "bars": 2, "flash": 0.75, "decay": 0.22, "strobe": True},
    "rock":     {"name": "Rock", "colors": [(0.0, 1.0), (0.07, 1.0), (0.10, 0.25), (0.0, 1.0), (0.62, 1.0), (0.10, 0.25)], "bars": 2, "flash": 0.95, "decay": 0.2, "strobe": True},
    "hiphop":   {"name": "Hip-Hop", "colors": [(0.78, 1.0), (0.66, 1.0), (0.0, 1.0)], "bars": 4, "flash": 1.0, "decay": 0.32, "strobe": False},
    "ruhig":    {"name": "Ruhig", "colors": [(0.08, 0.9), (0.05, 0.8), (0.11, 0.7), (0.60, 0.6)], "bars": 4, "flash": 0.3, "decay": 0.5, "strobe": False},
}
# Stichwörter in der Richtungs-Angabe → Profil. Reihenfolge zählt: das erste passende gewinnt.
GENRE_WORDS = [
    ("ruhig", ("ballad", "acoustic", "akustik", "singer", "songwriter", "classical", "klassik", "jazz", "ambient", "chill", "lounge", "folk", "blues", "soul", "piano", "soundtrack", "meditation", "sleep")),
    ("hiphop", ("hip-hop", "hip hop", "hiphop", "rap", "trap", "r&b", "rnb", "grime", "reggaeton", "afrobeat")),
    ("rock", ("rock", "metal", "punk", "grunge", "hardcore", "alternative", "indie")),
    ("party", ("schlager", "volksmusik", "karneval", "kölsch", "koelsch", "party", "ballermann", "mallorca", "après", "apres", "fasching")),
    ("elektro", ("electro", "elektro", "dance", "house", "techno", "edm", "trance", "drum", "dubstep", "club", "hardstyle", "rave", "garage", "disco", "eurodance")),
    ("pop", ("pop", "latin", "k-pop", "charts")),
]


def pick_profile(genres, bpm=None, name=""):
    """Aus den Richtungs-Angaben (und notfalls Titel-Zusatz/Tempo) das Profil wählen → (Schlüssel, Grund)."""
    text = " | ".join(str(g).lower() for g in genres or [])
    title = str(name or "").lower()
    # Remix/Extended/Club-Mix: tanzbare Fassung – auch wenn der Anbieter „Schlager, Pop“ dazuschreibt, gelten harte Beats
    if any(w in title for w in ("extended", "club mix", "remix", "rmx", "bootleg", "festival mix")) and not any(w in text for w in GENRE_WORDS[0][1]):
        if any(w in text for w in GENRE_WORDS[3][1]):
            return "party", "Party-Remix (%s)" % text
        return "elektro", "Remix/Extended%s" % (" (%s)" % text if text else "")
    for key, words in GENRE_WORDS:
        if any(w in text for w in words):
            return key, text
    if not text and bpm:
        if bpm >= 118:
            return "elektro", "keine Richtung bekannt, Tempo %d" % bpm
        if bpm < 90:
            return "ruhig", "keine Richtung bekannt, Tempo %d" % bpm
    return "standard", text or "keine Richtung bekannt"


def mmss(t):
    return "%d:%02d" % (int(t) // 60, int(t) % 60)


class WaveCues:
    """Je Lautsprecher einmal: verfolgt den laufenden Titel und kennt dessen Aufbauten."""
    all = {}

    @classmethod
    def get(cls, session, ma_cmds, player):
        key = str(player).lower()
        if key not in cls.all:
            cls.all[key] = c = cls(session, ma_cmds, player)
            c.task = asyncio.create_task(c.run())
        return cls.all[key]

    def __init__(self, session, ma_cmds, player):
        self.session, self.ma_cmds, self.player = session, ma_cmds, str(player)
        self.queue = None           # ID des Lautsprechers (bzw. seines Gruppen-Chefs)
        self.item = None            # laufender Titel
        self.builds = []            # [(Start, Ende)] in Sekunden
        self.have = False           # Wellenform für den laufenden Titel vorhanden?
        self.profile = PROFILES["standard"]   # Licht-Profil des laufenden Titels (nach Musikrichtung)
        self.forced = None          # fest eingestelltes Profil (Option) statt Automatik
        self.playing = False
        self.pos, self.pos_at = 0.0, 0.0   # Stelle im Titel und wann (Uhrzeit) sie galt
        self.task = None

    def position(self):
        """Aktuelle Stelle im Titel in Sekunden (hochgerechnet seit der letzten Meldung), None wenn nichts läuft."""
        if not self.playing:
            return None
        return self.pos + min(30.0, max(0.0, time.time() - self.pos_at))

    def strobe(self, ahead_s=0.0):
        """Läuft an der aktuellen Stelle (ahead_s Sekunden vorgezogen, für träge Lampen) gerade ein Aufbau?"""
        p = self.position()
        if p is None:
            return False
        p += ahead_s
        return any(a <= p < b for a, b in self.builds)

    async def run(self):
        tick = 0
        while True:
            await asyncio.sleep(2)
            try:
                if not self.queue or tick % 30 == 0:
                    pl = (await self.ma_cmds(self.session, [("players/all", {})]))[0] or []
                    want = self.player.lower()
                    tgt = next((x for x in pl if want and (str(x.get("player_id", "")).lower() == want or str(x.get("name", "")).lower() == want)), None)
                    self.queue = (tgt.get("synced_to") or tgt.get("player_id")) if tgt else None
                tick += 1
                if not self.queue:
                    continue
                qu = (await self.ma_cmds(self.session, [("player_queues/get", {"queue_id": self.queue})]))[0] or {}
                self.playing = qu.get("state") == "playing"
                self.pos = float(qu.get("elapsed_time") or 0.0)
                self.pos_at = float(qu.get("elapsed_time_last_updated") or time.time())
                ci = qu.get("current_item") or {}
                key = ci.get("queue_item_id")
                if key and key != self.item:
                    self.item, self.builds, self.have = key, [], False
                    await self.load(ci)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.info("Wellenform: %s", e)

    async def load(self, ci):
        mi = ci.get("media_item") or {}
        sd = ci.get("streamdetails") or {}
        genres = (mi.get("metadata") or {}).get("genres") or []
        bpm = (mi.get("audio_metadata") or {}).get("bpm")
        key, why = pick_profile(genres, bpm, ci.get("name"))
        if self.forced in PROFILES:
            key, why = self.forced, "fest eingestellt"
        self.profile = PROFILES[key]
        log.info("Licht-Profil „%s“ für „%s“ (%s%s)", self.profile["name"], ci.get("name"), why, ", Tempo %d" % bpm if bpm else "")
        if (mi.get("media_type") or sd.get("media_type")) not in (None, "track"):
            return                                                   # Radio, Podcast …: keine Wellenform
        item_id, prov = sd.get("item_id") or mi.get("item_id"), sd.get("provider") or mi.get("provider")
        dur = float(ci.get("duration") or mi.get("duration") or 0)
        if not item_id or not prov or dur < 30:
            return
        wave = (await self.ma_cmds(self.session, [("audio_analysis/wave_form", {"item_id": str(item_id), "provider_instance_id_or_domain": prov})]))[0]
        wave = [float(x) for x in wave or [] if isinstance(x, (int, float))]
        if len(wave) < 50:
            log.info("Wellenform: für „%s“ liegt (noch) keine vor – Strobe über Mithören", ci.get("name"))
            return
        self.builds = find_builds(wave, dur)
        self.have = True
        log.info("Wellenform „%s“ (%s): %s", ci.get("name"), mmss(dur),
                 "Aufbau/Strobe bei " + ", ".join("%s–%s" % (mmss(a), mmss(b)) for a, b in self.builds) if self.builds else "kein Aufbau gefunden")
        log.info("Wellenform (je Zeichen 3 s, 0 still … 9 voll): %s", sketch(wave, dur))
