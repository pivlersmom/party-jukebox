"""Party-Jukebox – Webserver für das Home-Assistant-Add-on.

Liefert Jukebox, Party-Seite und TV-Anzeige aus (Port 8099) und vermittelt zu
Home Assistant und Music Assistant, damit im Browser keine Tokens nötig sind:

  /api/websocket, /api/*  -> Home Assistant Core (Supervisor-Token wird hier eingesetzt)
  /ma/ws                  -> Music Assistant (Token aus den Add-on-Optionen, wenn der Browser "addon" schickt;
                             Gäste der Party-Seite melden sich weiter mit Join-Code + Gast-Token an)
  /ma/imageproxy          -> Bilder aus Music Assistant
  /party/*                -> Party-Logik (Teilnehmer, Wünsche, Vordrängeln, Abstimmung, Nachschub)
  /config.js              -> Einstellungen für die Seiten
"""
import asyncio
import hashlib
import hmac
import json
import secrets
from urllib.parse import parse_qs, urlparse
import logging
import os
import re
import time
from pathlib import Path

import aiohttp
from aiohttp import web, WSMsgType

log = logging.getLogger("party-jukebox")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

OPTIONS_FILE = Path("/data/options.json")
STATE_FILE = Path("/data/party.json")
WWW = Path(__file__).parent / "www"
def _sup_token():
    """Supervisor-Token: Umgebung, sonst s6-Container-Umgebung (CMD läuft unter s6 ohne with-contenv)."""
    t = os.environ.get("SUPERVISOR_TOKEN") or os.environ.get("HASSIO_TOKEN") or ""
    if not t:
        for f in ("/run/s6/container_environment/SUPERVISOR_TOKEN", "/var/run/s6/container_environment/SUPERVISOR_TOKEN"):
            try:
                t = Path(f).read_text().strip()
                if t:
                    break
            except Exception:
                pass
    return t


SUP_TOKEN = _sup_token()
HA_HTTP = "http://supervisor/core/api"
PORT = 8099

DEFAULT_DRINKS = ["Bier|🍺|ein Bier"]


def load_options():
    try:
        return json.loads(OPTIONS_FILE.read_text())
    except Exception:  # lokal ohne Supervisor testen
        return {}


OPT = load_options()

# Einstellungen, die in der Jukebox geändert werden (überschreiben die Add-on-Optionen)
SETTINGS_FILE = STATE_FILE.with_name("settings.json")


def load_settings():
    try:
        d = json.loads(SETTINGS_FILE.read_text())
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


SETTINGS = load_settings()


def setting(key, default):
    return SETTINGS[key] if key in SETTINGS else default


def save_settings():
    try:
        SETTINGS_FILE.write_text(json.dumps(SETTINGS))
    except Exception as e:
        log.warning("Einstellungen nicht gespeichert: %s", e)


# ---------------------------------------------------------------- Gastgeber-PIN
# Ist eine PIN gesetzt, sind Jukebox, Einstellungen und Vollzugriff auf Music Assistant nur für
# angemeldete Geräte (Cookie) erlaubt. Gäste-Seite und TV-Anzeige bleiben frei.
HOST_COOKIE = "pj_host"
HOST_FAILS = {}  # IP -> [Anzahl, Sperre bis]


def _pin_hash(pin, salt):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), 120000).hex()


def host_pin_set():
    hp = SETTINGS.get("host_pin")
    return isinstance(hp, dict) and bool(hp.get("hash"))


def via_ingress(request):
    """Aufruf über Home Assistant (Ingress, z. B. Seitenleiste oder Nabu Casa): HA hat den Benutzer schon angemeldet."""
    return bool(request.headers.get("X-Ingress-Path")) and (request.remote or "") == "172.30.32.2"


def ingress_prefix(request):
    return (request.headers.get("X-Ingress-Path") or "").rstrip("/") if via_ingress(request) else ""


def is_host(request):
    if not host_pin_set() or via_ingress(request):
        return True
    tok = request.cookies.get(HOST_COOKIE) or ""
    return bool(tok) and any(hmac.compare_digest(tok, t) for t in SETTINGS.get("host_tokens") or [])


def _host_cookie(resp, tok):
    resp.set_cookie(HOST_COOKIE, tok, max_age=2 * 365 * 86400, httponly=True, samesite="Lax", path="/")


def _new_host_token():
    tok = secrets.token_urlsafe(24)
    SETTINGS["host_tokens"] = ((SETTINGS.get("host_tokens") or []) + [tok])[-30:]
    return tok


async def host_get(request):
    return web.json_response({"pin": host_pin_set(), "host": is_host(request)}, headers={"Cache-Control": "no-store"})


async def host_login(request):
    ip = request.remote or "?"
    n, until = HOST_FAILS.get(ip, [0, 0])
    if until > time.time():
        return web.json_response({"ok": False, "error": f"Zu viele Versuche – in {int(until - time.time()) + 1} s nochmal"}, status=429)
    try:
        pin = str((await request.json()).get("pin") or "").strip()
    except Exception:
        pin = ""
    if not host_pin_set():
        return web.json_response({"ok": True, "pin": False})
    hp = SETTINGS["host_pin"]
    if not pin or not hmac.compare_digest(_pin_hash(pin, hp["salt"]), hp["hash"]):
        n += 1
        HOST_FAILS[ip] = [n, time.time() + (60 if n >= 5 else 0)]
        log.info("Gastgeber-PIN falsch (%s, %d. Versuch)", ip, n)
        return web.json_response({"ok": False, "error": "Falsche PIN"}, status=403)
    HOST_FAILS.pop(ip, None)
    tok = _new_host_token()
    save_settings()
    resp = web.json_response({"ok": True})
    _host_cookie(resp, tok)
    log.info("Gastgeber angemeldet (%s)", ip)
    return resp


async def host_pin_post(request):
    if not is_host(request):
        return web.json_response({"ok": False, "error": "Gastgeber-PIN nötig"}, status=403)
    try:
        pin = str((await request.json()).get("pin") or "").strip()
    except Exception:
        return web.json_response({"ok": False}, status=400)
    if not pin:
        SETTINGS.pop("host_pin", None)
        SETTINGS.pop("host_tokens", None)
        save_settings()
        log.info("Gastgeber-PIN entfernt")
        return web.json_response({"ok": True, "pin": False})
    if not re.fullmatch(r"\d{4,8}", pin):
        return web.json_response({"ok": False, "error": "PIN: 4 bis 8 Ziffern"}, status=400)
    salt = secrets.token_hex(16)
    SETTINGS["host_pin"] = {"salt": salt, "hash": _pin_hash(pin, salt)}
    SETTINGS["host_tokens"] = []  # alle anderen Geräte abmelden
    tok = _new_host_token()
    save_settings()
    resp = web.json_response({"ok": True, "pin": True})
    _host_cookie(resp, tok)
    log.info("Gastgeber-PIN gesetzt")
    return resp


# Ohne Gastgeber-Anmeldung erlaubte MA-Befehle mit Token "addon" (TV-Anzeige: nur lesen)
GUEST_MA_CMDS = {"auth", "players/all", "players/get", "player_queues/all", "player_queues/get", "player_queues/get_active_queue",
                 "player_queues/items", "metadata/get_track_lyrics", "music/item_by_uri", "party/url", "party/config",
                 "providers/icon", "subscribe_events", "info"}


def drinks():
    out = []
    for i, line in enumerate(OPT.get("drinks") or DEFAULT_DRINKS):
        parts = [p.strip() for p in str(line).split("|")]
        name = parts[0] if parts and parts[0] else f"Getränk {i + 1}"
        emoji = parts[1] if len(parts) > 1 and parts[1] else "🍺"
        phrase = parts[2] if len(parts) > 2 and parts[2] else f"ein {name}"
        key = re.sub(r"[^a-z0-9]", "", name.lower()) or f"d{i}"
        out.append({"k": key, "n": name, "e": emoji, "p": phrase})
    return out


# ---------------------------------------------------------------- Hilfen
def clean(v, n):
    s = "" if v is None else str(v)
    s = s.replace("'", "’")
    s = re.sub(r"[\x00-\x1f<>\\]", "", s).strip()
    return s[:n].strip()


def clean_name(v, n=18):
    s = re.sub(r"[^0-9A-Za-zÄÖÜäöüß .-]", "", str(v or ""))
    s = re.sub(r"\s+", " ", s).strip()
    return s[:n].strip()


def gid_of(v):
    return re.sub(r"[^A-Za-z0-9]", "", str(v or ""))[:20]


def now():
    return int(time.time())


# ---------------------------------------------------------------- Party-Zustand
class Party:
    """Party-Zustand: Gäste, Wünsche, Vordrängler, Abstimmung, Getränke."""

    def __init__(self):
        self.guests = {}   # gid -> {n, t}
        self.w = []        # Wünsche
        self.bo = []       # Vordrängler
        self.bi = []       # Nachschub-Meldungen
        self.bc = {}       # Getränke-Zähler je Gast
        self.vu = ""       # Song der Abstimmung
        self.vq = ""       # Queue der Abstimmung
        self.up = []
        self.down = []
        self._dirty = False
        self.load()

    # --- speichern/laden
    def load(self):
        try:
            d = json.loads(STATE_FILE.read_text())
            for k in ("w", "bo", "bi", "up", "down"):
                setattr(self, k, list(d.get(k) or []))
            self.bc = dict(d.get("bc") or {})
            self.guests = dict(d.get("guests") or {})
            self.vu = d.get("vu") or ""
            self.vq = d.get("vq") or ""
        except Exception:
            pass

    def save(self):
        try:
            STATE_FILE.write_text(json.dumps({
                "guests": self.guests, "w": self.w, "bo": self.bo, "bi": self.bi, "bc": self.bc,
                "vu": self.vu, "vq": self.vq, "up": self.up, "down": self.down,
            }, ensure_ascii=False))
        except Exception as e:
            log.warning("Speichern fehlgeschlagen: %s", e)

    # --- Teilnehmer
    def expire(self):
        t = now()
        before = len(self.guests)
        self.guests = {k: v for k, v in self.guests.items() if t - int(v.get("t", 0)) < 180}
        return len(self.guests) != before

    def heartbeat(self, data):
        gid = gid_of(data.get("id"))
        if not gid:
            return
        self.expire()
        leave = str(data.get("leave", "")).lower() in ("true", "1")
        if leave:
            self.guests.pop(gid, None)
            return
        name = clean_name(data.get("name")) or "Gast"
        if len(self.guests) < 60 or gid in self.guests:
            self.guests[gid] = {"n": name, "t": now()}

    def guest_names(self):
        return [v["n"] for v in sorted(self.guests.values(), key=lambda x: x.get("t", 0))]

    # --- Ereignisse
    def event(self, data):
        """Gibt den Typ des verarbeiteten Ereignisses zurück (oder None)."""
        gid = gid_of(data.get("id"))
        typ = data.get("type") or ""
        if not gid:
            return None
        t = now()
        if typ == "wish" and data.get("u"):
            self.w = (self.w + [{
                "u": clean(data.get("u"), 160), "s": clean(data.get("s"), 70), "a": clean(data.get("a"), 50),
                "n": clean(data.get("name"), 18) or "Gast", "d": clean(data.get("d"), 50),
                "b": bool(data.get("b")), "t": t, "g": gid}])[-60:]
            return "wish"
        if typ == "boost" and data.get("u"):
            self.bo = (self.bo + [{
                "u": clean(data.get("u"), 160), "s": clean(data.get("s"), 70), "a": clean(data.get("a"), 50),
                "n": clean(data.get("name"), 18) or "Gast", "t": t, "g": gid}])[-30:]
            return "boost"
        if typ == "beer":
            newest = max([x.get("t", 0) for x in self.bi] + [0])
            if t - newest > 43200:
                self.bc = {}
            last = max([x.get("t", 0) for x in self.bi if x.get("g") == gid] + [0])
            if t - last < 90:
                return None
            nm = clean(data.get("name"), 18) or "Gast"
            dr = clean(data.get("d"), 20) or "Bier"
            em = clean(data.get("e"), 8) or "🍺"
            ph = clean(data.get("p"), 30) or ("ein " + dr)
            self.bi = (self.bi + [{"n": nm, "t": t, "g": gid, "d": dr, "e": em, "p": ph}])[-30:]
            prev = self.bc.get(gid, {})
            self.bc[gid] = {"n": nm, "c": int(prev.get("c", 0)) + 1, "t": t, "e": em}
            return "beer"
        if typ == "vote" and data.get("u"):
            u = clean(data.get("u"), 160)
            if u != self.vu:
                self.vu, self.up, self.down = u, [], []
            self.vq = clean(data.get("q"), 60)
            self.up = [x for x in self.up if x != gid]
            self.down = [x for x in self.down if x != gid]
            if data.get("v") == "up":
                self.up.append(gid)
            elif data.get("v") == "down":
                self.down.append(gid)
            return "vote"
        return None

    def need(self):
        return max(2, -(-len(self.guests) // 2))

    def drinks_stale(self):
        """Letzte Bestellung länger als 12 h her → Ranking gilt als neue Party (leer)."""
        newest = max([x.get("t", 0) for x in self.bi] + [0])
        return bool(self.bi) and now() - newest > 43200

    def reset(self, what):
        if what == "drinks":
            self.bi, self.bc = [], {}
        elif what == "wishes":
            self.w, self.bo, self.vu, self.vq, self.up, self.down = [], [], "", "", [], []

    def wishes_json(self):
        if self.drinks_stale():
            self.reset("drinks")
        bc = sorted(self.bc.values(), key=lambda x: x.get("c", 0), reverse=True)
        return {
            "w": self.w[-30:], "bo": self.bo[-15:], "bi": self.bi[-10:],
            "bc": bc[:8], "bt": sum(int(x.get("c", 0)) for x in bc),
            "vote": {"u": self.vu, "up": len(self.up), "down": len(self.down), "need": self.need()},
        }

    def guests_json(self):
        n = self.guest_names()
        return {"c": len(n), "n": n}


PARTY = Party()


# ---------------------------------------------------------------- Home Assistant
async def ha_call(session, domain, service, data):
    if not SUP_TOKEN:
        log.warning("Kein Supervisor-Token – %s.%s nicht möglich", domain, service)
        return
    try:
        async with session.post(f"{HA_HTTP}/services/{domain}/{service}", json=data,
                                headers={"Authorization": f"Bearer {SUP_TOKEN}"}, timeout=15) as r:
            if r.status >= 400:
                log.warning("HA %s.%s -> %s %s", domain, service, r.status, await r.text())
            else:
                log.info("HA %s.%s ausgeführt", domain, service)
    except Exception as e:
        log.warning("HA %s.%s fehlgeschlagen: %s", domain, service, e)


async def run_script(session, entity):
    if not setting("effects", True):
        return
    entity = (entity or "").strip()
    if entity.startswith("script."):
        await ha_call(session, "script", "turn_on", {"entity_id": entity})


async def notify_drink(session, x):
    """Nachschub-Meldung an einen oder mehrere notify-Dienste (durch Komma getrennt), Android und iPhone."""
    for svc in [v.strip() for v in (OPT.get("notify_service") or "").split(",")]:
        if not svc.startswith("notify."):
            continue
        await ha_call(session, "notify", svc.split(".", 1)[1], {
            "title": f"{x.get('e', '🍺')} Nachschub",
            "message": f"{x.get('n')} möchte {x.get('p')}",
            "data": {
                "tag": f"party_nachschub_{x.get('g')}",          # Android + iPhone: ersetzt die vorige Meldung desselben Gastes
                "channel": "Party", "color": "#ffb020",          # nur Android
                "push": {"sound": "default", "interruption-level": "time-sensitive"},  # nur iPhone/Apple Watch
            },
        })


# ---------------------------------------------------------------- Räume: Auto-Beitritt per Bewegungsmelder
NON_MUSIC = ("tv", "hdmi", "line_in", "linein", "line-in", "optical", "spdif", "aux", "toslink")
ROOM_RT = {}  # Laufzeit je Raum: last, on_since, off_since, joined, left, lock_set


def rooms():
    return [r for r in (SETTINGS.get("rooms") or []) if isinstance(r, dict) and r.get("id")]


def clean_room(r):
    try:
        return {
            "id": str(r.get("id") or "r%d" % int(time.time() * 1000))[:40],
            "name": str(r.get("name") or "Raum")[:40],
            "player": str(r.get("player") or "")[:120],
            "sensor": str(r.get("sensor") or "")[:120],
            "lock_entity": str(r.get("lock_entity") or "")[:120],
            "cond": str(r.get("cond") or "")[:160],
            "leave_min": max(0, min(240, int(r.get("leave_min", 5)))),
            "lock_min": max(5, min(1440, int(r.get("lock_min", 60)))),
            "enabled": r.get("enabled", True) is not False,
        }
    except Exception:
        return None


async def ha_states(session, ids):
    out = {}
    if not SUP_TOKEN:
        return out

    async def one(eid):
        try:
            async with session.get(f"{HA_HTTP}/states/{eid}", headers={"Authorization": f"Bearer {SUP_TOKEN}"}, timeout=8) as r:
                if r.status == 200:
                    out[eid] = await r.json()
        except Exception:
            pass
    await asyncio.gather(*[one(e) for e in set(ids) if e])
    return out


def cond_ok(cond, st):
    """'sensor.x=wert' bzw. 'sensor.x!=wert' – leer = immer erfüllt."""
    c = (cond or "").strip()
    if not c:
        return True
    neg = "!=" in c
    ent, _, val = c.partition("!=" if neg else "=")
    cur = (st.get(ent.strip()) or {}).get("state")
    if cur is None:
        return False
    hit = str(cur).lower() in [v.strip().lower() for v in val.split(",")]
    return not hit if neg else hit


def room_locked(r, st):
    if r.get("lock_entity"):
        return (st.get(r["lock_entity"]) or {}).get("state") == "on"
    return (SETTINGS.get("room_locks") or {}).get(r["id"], 0) > time.time()


def lock_left(r, st):
    if r.get("lock_entity"):
        a = (st.get(r["lock_entity"]) or {})
        if a.get("state") != "on":
            return None
        tm = "timer." + r["lock_entity"].split(".", 1)[1]
        t = st.get(tm) or {}
        fa = (t.get("attributes") or {}).get("finishes_at")
        if fa:
            try:
                from datetime import datetime
                return max(0, int((datetime.fromisoformat(fa).timestamp() - time.time()) / 60 + 0.5))
            except Exception:
                return None
        return None
    u = (SETTINGS.get("room_locks") or {}).get(r["id"], 0)
    return max(0, int((u - time.time()) / 60 + 0.5)) if u > time.time() else None


def is_music(p):
    src = str(p.get("active_source") or "")
    return not src or src == p.get("player_id") or not any(x in src.lower() for x in NON_MUSIC)


def pstate(p):
    return (p or {}).get("playback_state") or (p or {}).get("state") or "idle"


async def pick_leader(session, players, room_pid):
    want = await resolve_player(session)
    cand = [p for p in players if p.get("player_id") != room_pid and not p.get("synced_to")
            and p.get("available", True) and pstate(p) == "playing" and is_music(p)]
    for p in cand:
        if want and p.get("player_id") == want:
            return p
    cand.sort(key=lambda p: -len(p.get("group_members") or []))
    return cand[0] if cand else None


async def room_join(session, r):
    players = await MAC.cmd(session, "players/all") or []
    by = {p.get("player_id"): p for p in players}
    me = by.get(r["player"])
    if not me or me.get("available") is False:
        return
    if me.get("synced_to"):
        return  # schon in einer Gruppe
    if pstate(me) in ("playing", "paused") and is_music(me) and len(me.get("group_members") or []) <= 1:
        return  # im Raum läuft eigene Musik
    lead = await pick_leader(session, players, r["player"])
    if not lead:
        return
    await MAC.cmd(session, "players/cmd/group", {"player_id": r["player"], "target_player": lead["player_id"]})
    ROOM_RT.setdefault(r["id"], {})["joined"] = time.time()
    log.info("Auto-Beitritt: %s → %s", r["name"], lead.get("display_name") or lead.get("name") or lead["player_id"])


async def room_leave(session, r, why):
    players = await MAC.cmd(session, "players/all") or []
    by = {p.get("player_id"): p for p in players}
    me = by.get(r["player"])
    if not me or not me.get("synced_to"):
        return
    lead = by.get(me["synced_to"]) or {}
    if lead and not is_music(lead):
        return  # z. B. TV-Ton an der Soundbar – nicht anfassen
    await MAC.cmd(session, "players/cmd/ungroup", {"player_id": r["player"]})
    log.info("Auto-Beitritt: %s verlässt die Gruppe (%s)", r["name"], why)


async def set_room_lock(session, r, on):
    rt = ROOM_RT.setdefault(r["id"], {})
    rt["lock_set"] = time.time()
    if r.get("lock_entity"):
        dom = r["lock_entity"].split(".", 1)[0]
        await ha_call(session, dom if dom in ("switch", "input_boolean") else "homeassistant",
                      "turn_on" if on else "turn_off", {"entity_id": r["lock_entity"]})
    else:
        locks = SETTINGS.setdefault("room_locks", {})
        locks[r["id"]] = time.time() + r["lock_min"] * 60 if on else 0
        save_settings()
    if on:
        try:
            await room_leave(session, r, "gesperrt")
        except Exception as e:
            log.info("Raum %s trennen: %s", r["name"], e)


async def rooms_loop(app):
    session = app["session"]
    n = 0
    while True:
        await asyncio.sleep(2)
        rs = [r for r in rooms() if r.get("enabled") and r.get("player") and r.get("sensor")]
        if not rs or not SUP_TOKEN or not OPT.get("ma_token"):
            continue
        n += 1
        ids = []
        for r in rs:
            ids += [r["sensor"], r.get("lock_entity"), (r.get("cond") or "").split("!=")[0].split("=")[0].strip()]
        try:
            st = await ha_states(session, ids)
        except Exception:
            continue
        now = time.time()
        for r in rs:
            rt = ROOM_RT.setdefault(r["id"], {})
            s_on = (st.get(r["sensor"]) or {}).get("state") == "on"
            if rt.get("last") is None:  # erster Blick nach dem Start: nur merken, nichts auslösen
                rt["last"], rt["handled"], rt["left"] = s_on, True, True
            elif s_on != rt.get("last"):
                rt["last"] = s_on
                if s_on:
                    rt["on_since"], rt["handled"] = now, False
                else:
                    rt["off_since"], rt["left"] = now, False
            lk = room_locked(r, st)
            lk_edge = lk and rt.get("locked_last") is False  # None beim Start → kein Auslösen
            rt["locked_last"] = lk
            try:
                if lk_edge and r.get("lock_entity"):  # Sperre kam von außen (z. B. Alexa, Taster) → Box trennen
                    rt["lock_set"] = now
                    await room_leave(session, r, "gesperrt")
                if s_on and not rt.get("handled") and now - rt.get("on_since", now) >= 2:
                    rt["handled"] = True
                    if not lk and cond_ok(r.get("cond"), st):
                        await room_join(session, r)
                if not s_on and r["leave_min"] > 0 and not rt.get("left") and rt.get("off_since") \
                        and now - rt["off_since"] >= r["leave_min"] * 60:
                    rt["left"] = True
                    await room_leave(session, r, "keine Bewegung")
                # von Hand dazugeholt, obwohl gesperrt → Sperre aufheben (nur eigene Sperre)
                if not r.get("lock_entity") and n % 5 == 0 and lk and now - rt.get("lock_set", 0) > 20:
                    by = {p.get("player_id"): p for p in (await MAC.cmd(session, "players/all") or [])}
                    if (by.get(r["player"]) or {}).get("synced_to") and now - rt.get("joined", 0) > 20:
                        SETTINGS.setdefault("room_locks", {})[r["id"]] = 0
                        save_settings()
                        log.info("Raum %s von Hand verbunden – Sperre aufgehoben", r["name"])
            except Exception as e:
                log.info("Auto-Beitritt %s: %s", r["name"], e)


async def rooms_info(session):
    rs = rooms()
    ids = []
    for r in rs:
        ids += [r.get("sensor"), r.get("lock_entity")]
        if r.get("lock_entity"):
            ids.append("timer." + r["lock_entity"].split(".", 1)[1])
    st = await ha_states(session, ids) if rs else {}
    out = []
    for r in rs:
        x = dict(r)
        x["locked"] = room_locked(r, st)
        x["left_min"] = lock_left(r, st)
        x["motion"] = (st.get(r.get("sensor")) or {}).get("state") == "on"
        out.append(x)
    return out


async def party_ha_entities(request):
    """Auswahl-Listen für die Raum-Einstellungen: Bewegungsmelder und Schalter (nur Namen, keine Steuerung)."""
    if not is_host(request):
        return web.json_response({"ok": False, "error": "Gastgeber-PIN nötig"}, status=403)
    if not SUP_TOKEN:
        return web.json_response({"sensors": [], "switches": []})
    try:
        async with request.app["session"].get(f"{HA_HTTP}/states", headers={"Authorization": f"Bearer {SUP_TOKEN}"}, timeout=15) as r:
            allst = await r.json()
    except Exception as e:
        return web.json_response({"error": str(e)}, status=502)
    sens, sw = [], []
    for e in allst:
        eid = e.get("entity_id", "")
        a = e.get("attributes") or {}
        nm = a.get("friendly_name") or eid
        if eid.startswith("binary_sensor."):
            dc = a.get("device_class") or ""
            if dc in ("motion", "occupancy", "presence"):
                sens.append({"id": eid, "name": nm, "dc": dc})
        elif eid.startswith(("switch.", "input_boolean.")):
            sw.append({"id": eid, "name": nm})
    sens.sort(key=lambda x: x["name"].lower())
    sw.sort(key=lambda x: x["name"].lower())
    return web.json_response({"sensors": sens, "switches": sw}, headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- Music Assistant
async def discover_ma(session):
    """MA-Adresse: Option, sonst MA-Add-on über den Supervisor finden, sonst Host:8095."""
    u = (OPT.get("ma_url") or "").strip().rstrip("/")
    if u and not re.fullmatch(r"(https?://)?[A-Za-z0-9.\-]+(:\d+)?", u):
        # z. B. vom Browser automatisch eingetragener Benutzername ("Admin")
        log.warning("Music-Assistant-Adresse '%s' ist keine gültige Adresse – wird ignoriert, suche automatisch", u)
        u = ""
    if u and "." not in u and "://" not in u and u.lower() not in ("localhost",):
        log.warning("Music-Assistant-Adresse '%s' sieht nicht nach Host/IP aus – wird ignoriert, suche automatisch", u)
        u = ""
    if u:
        # Nachsichtig: "192.168.1.10" → "http://192.168.1.10:8095"
        if "://" not in u:
            u = "http://" + u
        if not re.search(r":\d+$", u.split("://", 1)[1]):
            u += ":8095"
        return u
    if SUP_TOKEN:
        try:
            async with session.get("http://supervisor/addons", headers={"Authorization": f"Bearer {SUP_TOKEN}"},
                                   timeout=10) as r:
                d = await r.json()
                for a in (d.get("data") or {}).get("addons", []):
                    if a.get("slug", "").endswith("music_assistant") and a.get("state") == "started":
                        return "http://172.30.32.1:8095"  # MA läuft im Host-Netz
        except Exception as e:
            log.info("Supervisor-Abfrage der Add-ons nicht möglich: %s", e)
    return "http://172.30.32.1:8095"


class MA:
    """Kleiner MA-Client für serverseitige Befehle (z. B. Song überspringen)."""

    def __init__(self):
        self.base = None

    async def cmd(self, session, command, args=None):
        token = OPT.get("ma_token") or ""
        if not token:
            raise RuntimeError("kein MA-Token")
        ws_url = self.base.replace("http", "ws", 1) + "/ws"
        async with session.ws_connect(ws_url, timeout=15) as ws:
            await ws.receive_json(timeout=10)  # server_info
            await ws.send_json({"message_id": "a", "command": "auth", "args": {"token": token}})
            await ws.send_json({"message_id": "c", "command": command, "args": args or {}})
            while True:
                m = await ws.receive_json(timeout=15)
                if m.get("message_id") == "a" and m.get("error_code"):
                    raise RuntimeError("MA-Anmeldung fehlgeschlagen")
                if m.get("message_id") == "c":
                    if m.get("error_code"):
                        raise RuntimeError(m.get("details") or m.get("error_code"))
                    return m.get("result")


MAC = MA()


# ---------------------------------------------------------------- Party-HTTP
async def party_hb(request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    PARTY.heartbeat(data if isinstance(data, dict) else {})
    PARTY.save()
    return web.json_response({"ok": True, "c": len(PARTY.guests)})


_last_skip = {"u": "", "t": 0}


async def party_ev(request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        return web.json_response({"ok": False}, status=400)
    typ = PARTY.event(data)
    PARTY.save()
    session = request.app["session"]
    if typ == "wish":
        asyncio.create_task(run_script(session, OPT.get("script_wish")))
    elif typ == "boost":
        asyncio.create_task(run_script(session, OPT.get("script_boost")))
    elif typ == "beer":
        x = PARTY.bi[-1]
        asyncio.create_task(run_script(session, OPT.get("script_drink")))
        asyncio.create_task(notify_drink(session, x))
    elif typ == "vote" and setting("skip_votes", OPT.get("skip_votes", True)):
        down, up, need = len(PARTY.down), len(PARTY.up), PARTY.need()
        if down >= need and down > up and PARTY.vq and _last_skip["u"] != PARTY.vu:
            _last_skip.update(u=PARTY.vu, t=now())
            asyncio.create_task(skip(session, PARTY.vq, PARTY.vu))
    return web.json_response({"ok": typ is not None, "type": typ})


async def resolve_player(session):
    """Option party_player (ID oder Anzeigename) → MA-Player-ID; None, wenn leer oder nicht gefunden."""
    want = (OPT.get("party_player") or "").strip()
    if not want:
        return None
    try:
        for p in await MAC.cmd(session, "players/all") or []:
            if want in (p.get("player_id"), p.get("display_name"), p.get("name")) or \
                    want.lower() == str(p.get("display_name") or p.get("name") or "").lower():
                return p.get("player_id")
        log.warning("Party-Player '%s' nicht in Music Assistant gefunden – nehme den Player der Abstimmung", want)
    except Exception as e:
        log.info("Player-Liste nicht abrufbar: %s", e)
    return None


async def skip(session, queue_id, uri):
    """Überspringt nur, wenn in der Queue wirklich noch der abgestimmte Song läuft (Gäste geben die Queue-ID vor)."""
    try:
        qid = await resolve_player(session) or queue_id
        q = await MAC.cmd(session, "player_queues/get", {"queue_id": qid}) or {}
        cur = ((q.get("current_item") or {}).get("media_item") or {}).get("uri") or ""
        if not cur or cur != uri:
            log.info("Kein Skip: laufender Song (%s) ist nicht der abgestimmte (%s)", cur, uri)
            return
        await MAC.cmd(session, "player_queues/next", {"queue_id": qid})
        log.info("Song übersprungen (Mehrheit 👎) in %s", qid)
    except Exception as e:
        log.warning("Überspringen fehlgeschlagen: %s", e)


_join = {"code": None, "url": None, "t": 0}


async def party_join(request):
    """Liefert den aktuellen MA-Party-Join-Code (für Gäste ohne QR-Parameter), 60 s zwischengespeichert."""
    if not _join["code"] or now() - _join["t"] > 60:
        try:
            url = await MAC.cmd(request.app["session"], "party/url")
            url = url if isinstance(url, str) else (url or {}).get("url", "")
            code = parse_qs(urlparse(url).query).get("join", [None])[0]
            _join.update(code=code, url=url, t=now())
        except Exception as e:
            log.info("Join-Code nicht abrufbar: %s", e)
            return web.json_response({"code": None}, status=503, headers={"Cache-Control": "no-store"})
    if not _join["code"]:
        return web.json_response({"code": None}, status=503, headers={"Cache-Control": "no-store"})
    return web.json_response({"code": _join["code"], "url": _join["url"]}, headers={"Cache-Control": "no-store"})


async def party_wishes(request):
    return web.json_response(PARTY.wishes_json(), headers={"Cache-Control": "no-store"})


async def party_guests(request):
    if PARTY.expire():
        PARTY.save()
    return web.json_response(PARTY.guests_json(), headers={"Cache-Control": "no-store"})


async def config_js(request):
    cfg = {
        "name": party_name(),
        "player": OPT.get("party_player") or "",
        "drinks": drinks(),
        "maToken": bool(OPT.get("ma_token")),
        "profiles": SETTINGS.get("profiles"),  # in der Jukebox angezeigte MA-Benutzer (None = alle)
    }
    body = "window.PJ=" + json.dumps(cfg, ensure_ascii=False) + ";"
    return web.Response(text=body, content_type="application/javascript", headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- Einstellungen (Jukebox)
LIMIT_KEYS = {  # Gast-Limits im Party-Plugin von Music Assistant
    "enable_rate_limiting": bool, "enable_add_queue": bool, "add_queue_limit": int, "add_queue_refill_minutes": int,
    "enable_boost": bool, "boost_limit": int, "boost_refill_minutes": int,
    "enable_skip_song": bool, "skip_song_limit": int, "skip_song_refill_minutes": int,
}


async def party_provider_conf(session):
    lst = await MAC.cmd(session, "config/providers", {"provider_domain": "party"}) or []
    for p in lst:
        if (p.get("domain") or p.get("provider_domain")) == "party" or str(p.get("instance_id", "")).startswith("party"):
            return p
    return None


async def party_provider(session):
    p = await party_provider_conf(session)
    return p.get("instance_id") if p else None


def ma_web():
    """MA-Adresse für den Browser – None, wenn nur intern erreichbar (dann nimmt die Jukebox <Host>:8095)."""
    b = getattr(MAC, "base", None) or ""
    return None if (not b or "172.30." in b or "localhost" in b or "127.0.0.1" in b) else b


def _values(cfg):
    v = (cfg or {}).get("values") or {}
    if isinstance(v, list):
        return {e.get("key"): e.get("value") for e in v if isinstance(e, dict)}
    return {k: (e.get("value") if isinstance(e, dict) else e) for k, e in v.items()}


def party_name():
    return (setting("party_name", "") or OPT.get("party_name") or "Party-Jukebox").strip()[:40]


def tv_settings():
    return {"lyr_offset": float(setting("lyr_offset", 0.5)), "tv_lite": setting("tv_lite", "auto"), "name": party_name()}


async def party_tv_get(request):
    return web.json_response(tv_settings(), headers={"Cache-Control": "no-store"})


async def party_settings_get(request):
    out = {"effects": bool(setting("effects", True)),
           **tv_settings(),
           "skip_votes": bool(setting("skip_votes", OPT.get("skip_votes", True))),
           "scripts": any((OPT.get(k) or "").startswith("script.") for k in ("script_wish", "script_boost", "script_drink")),
           "limits": None, "plugin": None, "ma_web": ma_web(), "rooms": [], "rooms_ok": bool(SUP_TOKEN),
           "host_pin": host_pin_set(), "profiles": SETTINGS.get("profiles")}
    if not is_host(request):
        return web.json_response({**out, "host": False}, status=403, headers={"Cache-Control": "no-store"})
    try:
        out["rooms"] = await rooms_info(request.app["session"])
    except Exception as e:
        log.info("Räume nicht lesbar: %s", e)
    try:
        pc = await party_provider_conf(request.app["session"])
        iid = pc.get("instance_id") if pc else None
        out["plugin"] = {"installed": bool(iid), "enabled": bool(pc.get("enabled", True)) if pc else False, "instance_id": iid}
        if iid:
            vals = _values(await MAC.cmd(request.app["session"], "config/providers/get", {"instance_id": iid}))
            out["limits"] = {k: vals.get(k) for k in LIMIT_KEYS if k in vals}
    except Exception as e:
        log.info("Party-Plugin-Einstellungen nicht lesbar: %s", e)
    return web.json_response(out, headers={"Cache-Control": "no-store"})


async def party_settings_post(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False}, status=400)
    if not is_host(request):
        # Ohne Gastgeber-Anmeldung darf nur die TV-Anzeige den Songtext-Versatz melden
        if set(data) - {"lyr_offset", "tv_only"}:
            return web.json_response({"ok": False, "error": "Gastgeber-PIN nötig"}, status=403)
    for k in ("effects", "skip_votes"):
        if isinstance(data.get(k), bool):
            SETTINGS[k] = data[k]
    if isinstance(data.get("lyr_offset"), (int, float)) and not isinstance(data.get("lyr_offset"), bool):
        SETTINGS["lyr_offset"] = round(max(-8.0, min(8.0, float(data["lyr_offset"]))), 1)
    if data.get("tv_lite") in ("auto", "on", "off"):
        SETTINGS["tv_lite"] = data["tv_lite"]
    if isinstance(data.get("profiles"), list):
        SETTINGS["profiles"] = [str(x)[:64] for x in data["profiles"][:30] if x]
    if isinstance(data.get("rooms"), list):
        SETTINGS["rooms"] = [c for c in (clean_room(r) for r in data["rooms"][:20] if isinstance(r, dict)) if c]
        log.info("Räume gespeichert: %s", ", ".join(r["name"] for r in SETTINGS["rooms"]) or "keine")
    save_settings()
    if data.get("reset") in ("drinks", "wishes"):
        PARTY.reset(data["reset"])
        PARTY.save()
        log.info("Zurückgesetzt: %s", "Getränke-Ranking" if data["reset"] == "drinks" else "Wünsche und Vordrängler")
    rl = data.get("room_lock")
    if isinstance(rl, dict):
        r = next((x for x in rooms() if x["id"] == rl.get("id")), None)
        if r:
            await set_room_lock(request.app["session"], r, bool(rl.get("on")))
            await asyncio.sleep(0.8)
    pl = data.get("plugin")
    if pl in ("install", "on", "off"):
        try:
            iid = await party_provider(request.app["session"])
            if pl == "install" and not iid:
                vals = {"party_name": OPT["party_name"]} if OPT.get("party_name") else {}
                await MAC.cmd(request.app["session"], "config/providers/save", {"provider_domain": "party", "values": vals})
                log.info("Party-Plugin in Music Assistant installiert")
                await asyncio.sleep(2)
            elif iid and pl in ("on", "off"):
                await MAC.cmd(request.app["session"], "config/providers/save",
                              {"provider_domain": "party", "instance_id": iid, "values": {"enabled": pl == "on"}})
                log.info("Party-Plugin %s", "eingeschaltet" if pl == "on" else "ausgeschaltet")
                await asyncio.sleep(1.5)
            elif not iid:
                return web.json_response({"ok": False, "error": "Party-Plugin ist nicht installiert"}, status=404)
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=502)
    if isinstance(data.get("party_name"), str):
        nm = re.sub(r"\s+", " ", data["party_name"]).strip()[:40]
        SETTINGS["party_name"] = nm
        save_settings()
        try:  # Party-Plugin von MA bekommt den gleichen Namen (Gäste-Seite / QR-Text)
            iid = await party_provider(request.app["session"])
            if iid and nm:
                await MAC.cmd(request.app["session"], "config/providers/save",
                              {"provider_domain": "party", "instance_id": iid, "values": {"party_name": nm}})
        except Exception as e:
            log.info("Party-Name im Party-Plugin nicht gesetzt: %s", e)
        log.info("Party-Name: %s", party_name())
    if data.get("tv_only"):
        return web.json_response({"ok": True, **tv_settings()}, headers={"Cache-Control": "no-store"})
    lim = data.get("limits")
    if isinstance(lim, dict):
        vals = {}
        for k, t in LIMIT_KEYS.items():
            if k in lim:
                try:
                    vals[k] = bool(lim[k]) if t is bool else max(0, min(999, int(lim[k])))
                except Exception:
                    pass
        if vals:
            try:
                iid = await party_provider(request.app["session"])
                if not iid:
                    return web.json_response({"ok": False, "error": "Party-Plugin in Music Assistant nicht gefunden"}, status=404)
                await MAC.cmd(request.app["session"], "config/providers/save",
                              {"provider_domain": "party", "instance_id": iid, "values": vals})
                log.info("Gast-Limits gespeichert: %s", vals)
            except Exception as e:
                return web.json_response({"ok": False, "error": str(e)}, status=502)
    return await party_settings_get(request)


# ---------------------------------------------------------------- Proxys
async def pump(src, dst, transform=None):
    async for msg in src:
        if msg.type == WSMsgType.TEXT:
            data = msg.data
            if transform:
                data = transform(data)
                if data is None:
                    continue
            await dst.send_str(data)
        elif msg.type == WSMsgType.BINARY:
            await dst.send_bytes(msg.data)
        elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.CLOSED, WSMsgType.ERROR):
            break


# Kein HA-API-Proxy für den Browser: Gäste im Heimnetz dürfen Home Assistant nicht steuern.
# HA wird nur serverseitig genutzt (Skripte für Lichteffekte, Benachrichtigungen).


async def ma_websocket(request):
    """MA-WebSocket: schickt der Browser {"command":"auth","args":{"token":"addon"}}, setzt das Add-on den echten Token ein."""
    client = web.WebSocketResponse(heartbeat=30, max_msg_size=0)
    await client.prepare(request)
    session = request.app["session"]
    token = OPT.get("ma_token") or ""

    host = is_host(request)
    st = {"addon": False}

    def fix_auth(s):
        if '"auth"' in s and '"addon"' in s:
            try:
                d = json.loads(s)
                if d.get("command") == "auth" and (d.get("args") or {}).get("token") == "addon":
                    d["args"]["token"] = token
                    st["addon"] = True
                    return json.dumps(d)
            except Exception:
                pass
        if st["addon"] and not host:
            # Ohne Gastgeber-PIN: mit dem Add-on-Token nur lesen (TV-Anzeige)
            try:
                d = json.loads(s)
                c = d.get("command")
            except Exception:
                return None
            if c not in GUEST_MA_CMDS:
                asyncio.ensure_future(client.send_str(json.dumps({"message_id": d.get("message_id"), "error_code": 403,
                                                                  "details": "Gastgeber-PIN nötig"})))
                return None
        return s

    try:
        async with session.ws_connect(MAC.base.replace("http", "ws", 1) + "/ws", max_msg_size=0, heartbeat=30) as up:
            await asyncio.wait([asyncio.create_task(pump(client, up, fix_auth)),
                                asyncio.create_task(pump(up, client))], return_when=asyncio.FIRST_COMPLETED)
    except Exception as e:
        log.info("MA-WebSocket beendet: %s", e)
    await client.close()
    return client


async def ma_http(request):
    path = request.match_info["path"]
    session = request.app["session"]
    params = dict(request.query)
    if path.startswith("imageproxy") and params.get("size", "0").isdigit() and params.get("size") != "0":
        # MA akzeptiert nur 0/80/160/256/512/1024
        n = int(params["size"])
        params["size"] = str(next((x for x in (80, 160, 256, 512, 1024) if x >= n), 1024))
    async with session.get(f"{MAC.base}/{path}", params=params, timeout=30) as r:
        raw = await r.read()
        return web.Response(body=raw, status=r.status, content_type=(r.content_type or "application/octet-stream"),
                            headers={"Cache-Control": "public, max-age=86400"})


# ---------------------------------------------------------------- Statische Seiten
@web.middleware
async def no_cache_html(request, handler):
    pre = ingress_prefix(request)
    if request.path == "/":
        raise web.HTTPFound(pre + ("/jukebox.html" if pre else "/start.html"))
    if request.path in ("/jukebox.html", "/jukebox") and not is_host(request):
        raise web.HTTPFound(pre + "/host.html?next=jukebox.html")
    resp = await handler(request)
    p = request.path
    if p.endswith((".html", ".js", ".css", ".json")) or p == "/":
        resp.headers["Cache-Control"] = "no-cache"
    if p.endswith(".apk"):
        resp.headers["Content-Type"] = "application/vnd.android.package-archive"
    return resp


async def index(request):
    pre = ingress_prefix(request)
    raise web.HTTPFound(pre + ("/jukebox.html" if pre else "/start.html"))


async def tick(app):
    while True:
        await asyncio.sleep(30)
        if PARTY.expire():
            PARTY.save()


async def on_startup(app):
    app["session"] = aiohttp.ClientSession()
    MAC.base = await discover_ma(app["session"])
    log.info("Music Assistant: %s (Token %s)", MAC.base, "gesetzt" if OPT.get("ma_token") else "FEHLT")
    log.info("Home Assistant: %s", "verbunden (Skripte/Benachrichtigungen möglich)" if SUP_TOKEN else "KEIN Supervisor-Token")
    if OPT.get("ma_token") and OPT.get("party_player"):
        pid = await resolve_player(app["session"])
        if pid:
            log.info("Party-Player: %s → %s", OPT.get("party_player"), pid)
    app["tick"] = asyncio.create_task(tick(app))
    app["rooms"] = asyncio.create_task(rooms_loop(app))


async def on_cleanup(app):
    app["tick"].cancel()
    app["rooms"].cancel()
    await app["session"].close()


def make_app():
    app = web.Application(middlewares=[no_cache_html], client_max_size=4 * 1024 * 1024)
    app.router.add_get("/", index)
    app.router.add_get("/config.js", config_js)
    app.router.add_post("/party/hb", party_hb)
    app.router.add_post("/party/ev", party_ev)
    app.router.add_get("/party/wishes.json", party_wishes)
    app.router.add_get("/party/guests.json", party_guests)
    app.router.add_get("/party/join.json", party_join)
    app.router.add_get("/party/settings", party_settings_get)
    app.router.add_get("/party/tv.json", party_tv_get)
    app.router.add_get("/party/ha/entities", party_ha_entities)
    app.router.add_post("/party/settings", party_settings_post)
    app.router.add_get("/party/host", host_get)
    app.router.add_post("/party/host/login", host_login)
    app.router.add_post("/party/host/pin", host_pin_post)
    app.router.add_get("/ma/ws", ma_websocket)
    app.router.add_get("/ma/{path:.*}", ma_http)
    app.router.add_static("/", WWW, show_index=False)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


if __name__ == "__main__":
    web.run_app(make_app(), host="0.0.0.0", port=PORT, access_log=None)
