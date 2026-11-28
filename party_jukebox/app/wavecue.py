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
import base64
import bisect
import json
import logging
import os
import sqlite3
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


def find_drops(d, duration, bars=4):
    """Aufbauten vor einem Bass-Einsatz suchen – aus den Band-Kurven der Analyse → Liste (Start, Ende) in Sekunden.
    Lernkarte: Die Wellenform allein findet nur Aufbauten, bei denen es insgesamt lauter wird. In elektronischer Musik
    läuft es meist anders: Der Bass setzt aus, oben wirbelt und zischt es weiter (Trommelwirbel, Riser) – und dann
    knallt der Bass auf der Eins wieder rein. Die Gesamt-Lautstärke macht dabei nur einen Sprung, keine Rampe.
    Darum suchen wir hier genau dieses Muster in der Bass-Kurve:
      1. Bass mindestens 4 s lang weg (unter 35 % von „voll“)
      2. dann schlagartig wieder da (über 70 %)
      3. in den Takten davor ist oben herum etwas los (keine Stille)
    Geblitzt wird die letzten `bars` Takte vor dem Einsatz (bei kürzerer Pause: die ganze Pause), Ende genau auf dem Einsatz."""
    low, high = d.get("low"), d.get("high") or d.get("mid")
    if not low or not duration or len(low) < 100:
        return []
    n = len(low)
    bin_s = duration / n
    k = max(1, int(round(0.5 / bin_s)))
    sm = lambda c: [sum(c[max(0, i - k):i + k + 1]) / len(c[max(0, i - k):i + k + 1]) for i in range(n)]
    L = sm(low)
    full = sorted(L)[int(n * 0.9)]
    if full < 12:                                                    # Titel fast ohne Bass: nichts zu erkennen
        return []
    H = sm(high) if high else None
    h_mid = sorted(H)[n // 2] if H else 0
    beats, ones = d.get("beats") or [], d.get("downbeats") or []
    bar_s = (ones[len(ones) // 2] - ones[len(ones) // 2 - 1]) if len(ones) > 4 else (4 * (beats[len(beats) // 2] - beats[len(beats) // 2 - 1]) if len(beats) > 4 else 2.0)
    bar_s = min(4.0, max(1.2, bar_s))
    out, i, gone = [], 0, None
    while i < n:
        if L[i] < 0.35 * full:
            gone = i if gone is None else gone
        elif L[i] > 0.7 * full:
            if gone is not None and (i - gone) * bin_s >= 4.0:
                # schlagartig? Von „weg“ bis „da“ höchstens 1,5 s
                j = i
                while j > gone and L[j] >= 0.35 * full:
                    j -= 1
                if (i - j) * bin_s <= 1.5:
                    t = (j + 1) * bin_s
                    if ones:                                         # der Einsatz liegt auf einer Eins: dorthin rücken
                        near = min(ones, key=lambda x: abs(x - t))
                        if abs(near - t) < bar_s / 2:
                            t = near
                    a = max(gone * bin_s, t - bars * bar_s)
                    lo_i, hi_i = int(a / bin_s), max(int(a / bin_s) + 1, int(t / bin_s))
                    busy = (sum(H[lo_i:hi_i]) / (hi_i - lo_i)) if H else 255
                    # Lernkarte: Bei „Catch Me“ blitzte es vor einer Stelle, an der der Bass nur dünner war (ein Drittel),
                    # nicht weg. Vor einem echten Einsatz ist der Bass kurz davor wirklich abgeschaltet – das verlangen
                    # wir jetzt: in den letzten 4 s vor dem Einsatz muss er einmal unter 18 % fallen.
                    tail = L[max(gone, j - int(4.0 / bin_s)):j + 1]
                    cut = min(tail) <= 0.18 * full if tail else False
                    if t - a >= 2.0 and busy >= 0.4 * h_mid and t > 8.0 and cut:
                        out.append((round(a, 2), round(t, 2)))
            gone = None
        i += 1
    return out


def merge_spans(spans, gap=1.0):
    out = []
    for a, b in sorted(spans):
        if out and a - out[-1][1] < gap:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


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
    if not text and any(w in title for w in GENRE_WORDS[3][1] + ("malle", "saufen", "bier", "playa")):
        return "party", "keine Richtung bekannt, Titel klingt nach Party"
    if not text and bpm:
        if bpm >= 118:
            return "elektro", "keine Richtung bekannt, Tempo %d" % bpm
        if bpm < 90:
            return "ruhig", "keine Richtung bekannt, Tempo %d" % bpm
    return "standard", text or "keine Richtung bekannt"


# ---------------------------------------------------------------------------------------------------------------------
# Die fertige Klang-Analyse von Music Assistant
#
# Music Assistant hat jeden Titel schon gründlich untersucht (Schläge, Taktanfänge, Gesangs-Kurve, Bass-/Mitten-/
# Höhen-Kurven, Stimmungs-Werte), gibt das aber über seine Schnittstelle nicht heraus. Ein kleines eigenes Helfer-Add-on
# ("Vanpis MA-Analyse") holt die Daten ab und legt sie in /share/ma_analyse/analyse.db. Wir lesen hier NUR diese Datei.
# Gibt es sie nicht (z. B. bei anderen Nutzern), läuft alles wie bisher mit Mithören und Schätzen.
ANALYSIS_DB = "/share/ma_analyse/analyse.db"
CURVES = ("wave", "vocal", "low", "low_mid", "mid", "high")


def load_analysis(provider, item_id, path=None):
    """Analyse eines Titels aus der abgelegten Datei lesen → dict oder None.
    Kurven werden zu Bytes (0..255, 1800 Punkte über die Titellänge), beats/downbeats zu Sekunden-Listen."""
    path = path or ANALYSIS_DB
    if not provider or not item_id or not os.path.exists(path):
        return None
    try:
        con = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=3)
        try:
            row = None
            for key in dict.fromkeys((str(provider), str(provider).split("--")[0])):   # erst das Konto, dann nur der Anbieter
                row = con.execute("SELECT data FROM tracks WHERE provider=? AND item_id=?", (key, str(item_id))).fetchone()
                if row:
                    break
        finally:
            con.close()
        if not row:
            return None
        d = json.loads(row[0])
        for k in CURVES:
            if isinstance(d.get(k), str):
                d[k] = base64.b64decode(d[k])
        d["beats"] = [float(x) for x in d.get("beats") or []]
        d["downbeats"] = [float(x) for x in d.get("downbeats") or []]
        d["ones"] = {round(x, 3) for x in d["downbeats"]}
        return d
    except (sqlite3.Error, ValueError, TypeError, OSError) as e:
        log.info("Analyse-Datei: %s", e)
        return None


def match_beats(stamps, beats, guess, span=6.0):
    """Welche Stelle im Titel läuft gerade – auf die Millisekunde?
    Lernkarte: Music Assistant meldet die Stelle im Titel nur alle paar Sekunden und ungefähr. Für „welcher Schlag ist
    die Eins“ reicht das nicht. Aber: Die Schläge, die im Licht-Datenstrom ankommen, sind genau die Schläge aus der
    Analyse – mit denselben winzigen Unregelmäßigkeiten in den Abständen. Wir legen die letzten empfangenen Schläge
    wie einen Fingerabdruck an die Analyse an und suchen (in der Nähe der ungefähren Stelle) die Position, an der die
    Abstände am besten passen.
      stamps  Zeitstempel der zuletzt empfangenen Schläge (Sekunden, Server-Uhr), lückenlos aufeinander folgend
      beats   Schläge laut Analyse (Sekunden im Titel)
      guess   ungefähre Stelle des letzten Schlags im Titel
    → (Index des letzten Schlags in beats, Abweichung in s, eindeutig?) oder None."""
    m = len(stamps)
    if m < 8 or len(beats) < m + 2:
        return None
    lo = max(m - 1, bisect.bisect_left(beats, guess - span))
    hi = min(len(beats) - 1, bisect.bisect_right(beats, guess + span))
    rel = [stamps[-1] - x for x in stamps[:-1]]
    found = []
    for k in range(lo, hi + 1):
        err = sum(abs(rel[i] - (beats[k] - beats[k - (m - 1) + i])) for i in range(m - 1)) / (m - 1)
        found.append((err, k))
    if not found:
        return None
    found.sort()
    err, k = found[0]
    if err > 0.02:
        return None
    # eindeutig, wenn die zweitbeste Stelle deutlich schlechter passt; sonst (völlig gleichmäßiges Raster) die nächstgelegene
    clear = len(found) == 1 or found[1][0] > 2.5 * err + 0.003
    if not clear:
        near = [f for f in found if f[0] <= err + 0.003]
        err, k = min(near, key=lambda f: abs(beats[f[1]] - guess))
    return k, err, clear


def mmss(t):
    return "%d:%02d" % (int(t) // 60, int(t) % 60)


class WaveCues:
    """Je Lautsprecher einmal: verfolgt den laufenden Titel und kennt dessen Aufbauten."""
    all = {}
    on_missing = None               # vom Add-on gesetzt: melden, wenn für einen Titel die Analyse fehlt (→ Helfer starten)

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
        self.data = None            # fertige Analyse von Music Assistant für den laufenden Titel (oder None)
        self.dur = 0.0              # Länge des laufenden Titels
        self.stamps = []            # Zeitstempel der zuletzt empfangenen Schläge (Sekunden, Server-Uhr)
        self.anchor = None          # Server-Uhrzeit (s), zu der der Titel bei 0:00 war – daraus folgt die genaue Stelle
        self.anchor_note = ""
        self.beat_no, self.off = 0, 0   # Schlag-Zähler; wie oft hintereinander die Stelle nicht zur Meldung passte
        self.missing_at = 0.0

    # ------------------------------------------------------------------ genaue Stelle im Titel (über die Schläge)
    def beat(self, ts_us):
        """Von den Lampen: ein Schlag mit Server-Zeitstempel kam an. Daraus die genaue Stelle im Titel bestimmen."""
        d = self.data
        if not d or len(d["beats"]) < 24:
            return
        t = ts_us / 1e6
        if self.stamps and t - self.stamps[-1] < 0.05:               # derselbe Schlag von einer zweiten Lampe
            return
        if self.stamps and (t < self.stamps[-1] or t - self.stamps[-1] > 1.6):
            self.stamps = []                                         # Lücke oder Sprung: Kette neu beginnen
        self.stamps = (self.stamps + [t])[-20:]
        self.beat_no += 1
        guess = self.position()
        if guess is None:
            return
        # Lernkarte: Nach dem Zurückspulen stimmte nichts mehr – der Abgleich galt noch für die alte Stelle und wurde nie
        # erneuert. Darum prüfen wir bei jedem Schlag: Liegt unsere genaue Stelle mehr als 3 s neben dem, was Music
        # Assistant meldet (zweimal hintereinander), wurde gespult → Abgleich verwerfen und neu einrasten lassen.
        if self.anchor is not None:
            self.off = self.off + 1 if abs((t - self.anchor) - guess) > 3.0 else 0
            if self.off >= 2:
                log.info("Takt-Abgleich: Stelle hat sich geändert (gespult) – raste neu ein")
                self.anchor, self.stamps, self.off, self.anchor_note = None, [t], 0, ""
                return
        if len(self.stamps) < 12 or (self.anchor is not None and self.beat_no % 8):
            return
        hit = match_beats(self.stamps, d["beats"], guess)
        if not hit:
            return
        k, err, clear = hit
        anchor = t - d["beats"][k]
        if self.anchor is None or abs(anchor - self.anchor) > 0.05:
            note = "Stelle im Titel %s · passt auf %.0f ms · %s · Music Assistant meldete %+.1f s daneben" % (
                mmss(d["beats"][k]), err * 1000, "eindeutig" if clear else "Raster gleichmäßig, nächstgelegene Stelle genommen", guess - d["beats"][k])
            if note != self.anchor_note:
                self.anchor_note = note
                log.info("Takt-Abgleich: %s", note)
        self.anchor = anchor

    def track_time(self, srv_us):
        """Genaue Stelle im Titel (s) zu einem Server-Zeitstempel – None, solange der Abgleich fehlt."""
        return None if self.anchor is None else srv_us / 1e6 - self.anchor

    def is_one(self, ts_us):
        """Ist der Schlag mit diesem Zeitstempel ein Taktanfang? True/False laut Analyse, None = unbekannt."""
        d, t = self.data, self.track_time(ts_us)
        if not d or t is None or not d["ones"]:
            return None
        b = d["beats"]
        i = bisect.bisect_left(b, t)
        k = min((j for j in (i - 1, i) if 0 <= j < len(b)), key=lambda j: abs(b[j] - t), default=None)
        if k is None or abs(b[k] - t) > 0.09:
            return None
        return round(b[k], 3) in d["ones"]

    def curve(self, name, srv_us):
        """Wert einer Kurve (vocal, low, mid, high, wave) an der Stelle, die gerade gezeigt wird: 0..1 oder None."""
        d, t = self.data, self.track_time(srv_us)
        c = d.get(name) if d else None
        if not c or t is None or self.dur <= 0:
            return None
        return c[max(0, min(len(c) - 1, int(t / self.dur * len(c))))] / 255.0

    def position(self):
        """Aktuelle Stelle im Titel in Sekunden (hochgerechnet seit der letzten Meldung), None wenn nichts läuft."""
        if not self.playing:
            return None
        return self.pos + min(30.0, max(0.0, time.time() - self.pos_at))

    def strobe(self, ahead_s=0.0, srv_us=None):
        """Läuft gerade ein Aufbau? Mit Takt-Abgleich an der genauen Stelle (srv_us), sonst an der ungefähren
        (ahead_s Sekunden vorgezogen, weil die Meldung von Music Assistant nachhinkt)."""
        t = self.track_time(srv_us) if srv_us is not None else None
        if t is None:
            t = self.position()
            if t is None:
                return False
            t += ahead_s
        elif not self.playing:
            return False
        return any(a <= t < b for a, b in self.builds)

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
                    self.data, self.stamps, self.anchor, self.anchor_note, self.off = None, [], None, "", 0
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
        self.dur = dur
        d = self.data = await asyncio.get_running_loop().run_in_executor(None, load_analysis, prov, item_id)
        if d:
            if d.get("duration"):
                self.dur = float(d["duration"])
            feel = ", ".join("%s %.2f" % (n, d[k]) for n, k in (("tanzbar", "danceability"), ("Stimmung", "valence"), ("aufgedreht", "arousal"),
                                                                ("instrumental", "instrumentalness"), ("akustisch", "acousticness")) if d.get(k) is not None)
            log.info("Analyse „%s“: %d Schläge, %d Taktanfänge%s, Kurven: %s%s", ci.get("name"), len(d["beats"]), len(d["downbeats"]),
                     " (%d/4-Takt)" % d["beats_per_bar"] if d.get("beats_per_bar") else "",
                     ", ".join(k for k in CURVES if d.get(k)) or "keine", " · " + feel if feel else "")
            # Stimmungs-Werte schlagen die grobe Richtungs-Angabe: sehr akustisch und ruhig → Profil „Ruhig“
            if self.forced not in PROFILES and (d.get("acousticness") or 0) > 0.75 and (d.get("arousal") if d.get("arousal") is not None else 1) < 0.35:
                self.profile = PROFILES["ruhig"]
                log.info("Licht-Profil „Ruhig“ (laut Analyse akustisch und ruhig)")
        elif os.path.exists(ANALYSIS_DB) and time.time() - self.missing_at > 600:
            self.missing_at = time.time()
            log.info("Analyse: für „%s“ liegt noch nichts vor – Helfer wird angefragt", ci.get("name"))
            if WaveCues.on_missing:
                WaveCues.on_missing({"name": ci.get("name"), "item_id": str(item_id), "provider": prov})
        wave = (await self.ma_cmds(self.session, [("audio_analysis/wave_form", {"item_id": str(item_id), "provider_instance_id_or_domain": prov})]))[0]
        wave = [float(x) for x in wave or [] if isinstance(x, (int, float))]
        if len(wave) < 50:
            log.info("Wellenform: für „%s“ liegt (noch) keine vor – Strobe über Mithören", ci.get("name"))
            return
        ramps = find_builds(wave, dur)
        drops = find_drops(self.data, self.dur) if self.data else []
        self.builds = merge_spans(ramps + drops)
        self.have = True
        txt = lambda sp: ", ".join("%s–%s" % (mmss(a), mmss(b)) for a, b in sp) or "–"
        log.info("Strobe-Stellen „%s“ (%s): %s · lauter werdend: %s · vor Bass-Einsatz: %s", ci.get("name"), mmss(dur),
                 txt(self.builds) if self.builds else "keine", txt(ramps), txt(drops) if self.data else "keine Analyse")
        if self.data and self.data.get("low"):
            log.info("Bass-Kurve  (je Zeichen 3 s, 0 weg … 9 voll): %s", sketch([x / 255.0 for x in self.data["low"]], self.dur))
        log.info("Wellenform (je Zeichen 3 s, 0 still … 9 voll): %s", sketch(wave, dur))
