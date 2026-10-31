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
import json
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
    """Port von vanpis_party.jinja / vanpis_party_events.jinja + den Party-Automationen."""

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

    def wishes_json(self):
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
    svc = (OPT.get("notify_service") or "").strip()
    if not svc.startswith("notify."):
        return
    await ha_call(session, "notify", svc.split(".", 1)[1], {
        "title": f"{x.get('e', '🍺')} Nachschub",
        "message": f"{x.get('n')} möchte {x.get('p')}",
        "data": {"tag": f"party_nachschub_{x.get('g')}", "channel": "Party", "color": "#ffb020"},
    })


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
        "name": OPT.get("party_name") or "Party-Jukebox",
        "player": OPT.get("party_player") or "",
        "drinks": drinks(),
        "maToken": bool(OPT.get("ma_token")),
    }
    body = "window.PJ=" + json.dumps(cfg, ensure_ascii=False) + ";"
    return web.Response(text=body, content_type="application/javascript", headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- Einstellungen (Jukebox)
LIMIT_KEYS = {  # Gast-Limits im Party-Plugin von Music Assistant
    "enable_rate_limiting": bool, "enable_add_queue": bool, "add_queue_limit": int, "add_queue_refill_minutes": int,
    "enable_boost": bool, "boost_limit": int, "boost_refill_minutes": int,
    "enable_skip_song": bool, "skip_song_limit": int, "skip_song_refill_minutes": int,
}


async def party_provider(session):
    lst = await MAC.cmd(session, "config/providers", {"provider_domain": "party"}) or []
    for p in lst:
        if (p.get("domain") or p.get("provider_domain")) == "party" or str(p.get("instance_id", "")).startswith("party"):
            return p.get("instance_id")
    return None


def _values(cfg):
    v = (cfg or {}).get("values") or {}
    if isinstance(v, list):
        return {e.get("key"): e.get("value") for e in v if isinstance(e, dict)}
    return {k: (e.get("value") if isinstance(e, dict) else e) for k, e in v.items()}


async def party_settings_get(request):
    out = {"effects": bool(setting("effects", True)),
           "skip_votes": bool(setting("skip_votes", OPT.get("skip_votes", True))),
           "scripts": any((OPT.get(k) or "").startswith("script.") for k in ("script_wish", "script_boost", "script_drink")),
           "limits": None}
    try:
        iid = await party_provider(request.app["session"])
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
    for k in ("effects", "skip_votes"):
        if isinstance(data.get(k), bool):
            SETTINGS[k] = data[k]
    save_settings()
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

    def fix_auth(s):
        if '"auth"' in s and '"addon"' in s:
            try:
                d = json.loads(s)
                if d.get("command") == "auth" and (d.get("args") or {}).get("token") == "addon":
                    d["args"]["token"] = token
                    return json.dumps(d)
            except Exception:
                pass
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
    if request.path == "/":
        raise web.HTTPFound("/start.html")
    resp = await handler(request)
    p = request.path
    if p.endswith((".html", ".js", ".css", ".json")) or p == "/":
        resp.headers["Cache-Control"] = "no-cache"
    if p.endswith(".apk"):
        resp.headers["Content-Type"] = "application/vnd.android.package-archive"
    return resp


async def index(request):
    raise web.HTTPFound("/start.html")


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


async def on_cleanup(app):
    app["tick"].cancel()
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
    app.router.add_post("/party/settings", party_settings_post)
    app.router.add_get("/ma/ws", ma_websocket)
    app.router.add_get("/ma/{path:.*}", ma_http)
    app.router.add_static("/", WWW, show_index=False)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


if __name__ == "__main__":
    web.run_app(make_app(), host="0.0.0.0", port=PORT, access_log=None)
