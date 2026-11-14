/* Party-Jukebox · Handy-Fernbedienung für Music Assistant
   Läuft nur über den Add-on-Proxy: ma/ws (WebSocket, echten Token setzt der Server ein) und ma/imageproxy (Cover).
   Kein Zugriff auf Home Assistant. Befehle wie MA 2.x Server-API (music-assistant-client 1.7). */
(function () {
"use strict";

const PJ = window.PJ || {};
const BASE = new URL(".", location.href);
const WS_URL = BASE.href.replace(/^http/, "ws") + "ma/ws";
const MA_HTTP = BASE.href + "ma";
const LS_PLAYER = "pj_jukebox_player";
const HIDE_TYPES = ["protocol", "display", "visualizer", "light", "source"];

/* ---------- Hilfen ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};
const errText = e => String((e && (e.message || e)) || "Fehler");
function setText(el, v) { v = v == null ? "" : String(v); if (el.textContent !== v) el.textContent = v; }
const timers = {};
function later(fn, ms, key) { clearTimeout(timers[key]); timers[key] = setTimeout(fn, ms); }
let toastT = null;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600); }

const ICON = {
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><rect x="5" y="2.5" width="14" height="19" rx="3"/><circle cx="12" cy="14.5" r="3.5"/><circle cx="12" cy="7" r="1"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M3 7h3.5c2.5 0 4 1.2 5.5 3.5l1 1.5c1.5 2.3 3 3.5 5.5 3.5H21"/><path d="M3 17h3.5c1.6 0 2.8-.5 3.8-1.5M14.2 8.5c1-1 2.2-1.5 3.8-1.5H21"/><path d="m18 4 3 3-3 3M18 14l3 3-3 3"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M6 5v14"/><path d="M19 5 9 12l10 7z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M18 5v14"/><path d="M5 5l10 7-10 7z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/></svg>',
  vlo: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/></svg>',
  vhi: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M4 6h12M4 12h12M4 18h8"/><path d="M16 15.5v5l4.5-2.5z"/></svg>',
  disc: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  grip: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9.2-8.6C1.3 8.4 3 5 6.4 5c2 0 3.3 1.1 4.1 2.3h3C14.3 6.1 15.6 5 17.6 5 21 5 22.7 8.4 21.2 11.4 19 15.6 12 20 12 20z"/></svg>',
  nextup: '<svg viewBox="0 0 24 24"><path d="M4 6h10M4 11h10M4 16h6"/><path d="M18 8v11M15 16l3 3 3-3"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
  dots: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  wifi: '<svg viewBox="0 0 24 24"><path d="M2 8.8a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16.2a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1"/><path d="M3 3l18 18"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/></svg>'
};
document.querySelectorAll("[data-ic]").forEach(el => { el.innerHTML = ICON[el.dataset.ic] || ""; });
document.body.insertAdjacentHTML("afterbegin", '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="pjGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e040fb"/><stop offset="1" stop-color="#29b6f6"/></linearGradient></defs></svg>');
if (PJ.name) { setText($("#appName"), PJ.name); }

/* ---------- Bilder (MA-Imageproxy über das Add-on) ---------- */
function pickImg(x) {
  if (!x) return null;
  if (x.image) return x.image;
  const imgs = x.metadata && x.metadata.images;
  if (imgs && imgs.length) return imgs.find(i => i.type === "thumb") || imgs[0];
  return null;
}
/* MA-Imageproxy akzeptiert nur diese Größen */
const imgSize = n => [80, 160, 256, 512, 1024].find(x => x >= n) || 1024;
function imgUrl(item, size) {
  if (!item) return "";
  size = imgSize(size);
  const mi = item.media_item;
  const im = pickImg(item) || pickImg(mi) || pickImg(item.album) || pickImg(mi && mi.album);
  if (!im) return "";
  if (typeof im === "string") return /^(https?:|data:)/.test(im) ? im : "";
  if (im.proxy_id) return MA_HTTP + "/imageproxy/" + encodeURIComponent(im.proxy_id) + "?size=" + size;
  if (!im.path) return "";
  if (im.remotely_accessible && /^https?:/.test(im.path)) return im.path;
  /* altes Format: Pfad doppelt kodiert (wie im offiziellen MA-Client) */
  return MA_HTTP + "/imageproxy?path=" + encodeURIComponent(encodeURIComponent(im.path)) +
    "&provider=" + encodeURIComponent(im.provider || "") + "&size=" + size;
}
/* Bild-URL vom Player (zeigt auf MA im Heimnetz) → über das Add-on laden, damit es auch unterwegs geht */
function maImg(u) {
  if (!u) return "";
  const m = /^https?:\/\/[^/]+(\/imageproxy.*)$/.exec(u);
  if (m) return MA_HTTP + m[1];
  return /^https:|^data:/.test(u) || location.protocol === "http:" ? u : "";
}
const artistsOf = m => (m && ((m.artists || []).map(a => a && a.name).filter(Boolean).join(", ") || m.artist_str)) || "";

/* ---------- Zustand ---------- */
const S = {
  ws: null, ready: false, ever: false, id: 1, pend: {}, conn: "init", retry: 0, authFail: false,
  players: {}, pid: null, q: null, qid: null,
  tBase: 0, tAt: 0, seekHold: 0, ppHold: 0, ppWant: false, vHold: 0, lastRq: 0,
  items: [], itemsOk: false, iSeq: 0,
  tab: "home", favMode: true, filter: "all", sSeq: 0, sRes: null, sItems: []
};

/* ---------- MA-WebSocket ---------- */
function cmd(command, args, timeout) {
  return new Promise((res, rej) => {
    if (!S.ready || !S.ws) return rej(new Error("Nicht verbunden"));
    const id = String(S.id++);
    const ms = timeout || 15000, out = () => { if (S.pend[id]) { delete S.pend[id]; rej(new Error("Zeitüberschreitung")); } };
    const t = setTimeout(out, ms);
    S.pend[id] = { res, rej, t, acc: null, ms, out };
    try { S.ws.send(JSON.stringify({ message_id: id, command, args: args || {} })); }
    catch (e) { clearTimeout(t); delete S.pend[id]; rej(e); }
  });
}
function failAll() {
  Object.keys(S.pend).forEach(id => { const p = S.pend[id]; clearTimeout(p.t); p.rej(new Error("Verbindung getrennt")); });
  S.pend = {};
}

let retryT = null, openT = null;
function connect() {
  clearTimeout(retryT); clearTimeout(openT);
  if (PJ.maToken === false) { setConn("notoken"); return; }
  const old = S.ws; S.ws = null;
  if (old) { try { old.onclose = null; old.onmessage = null; old.close(); } catch (e) {} }
  S.ready = false; failAll();
  setConn("connecting");
  let ws;
  try { ws = new WebSocket(WS_URL); } catch (e) { retry(); return; }
  S.ws = ws;
  openT = setTimeout(() => { if (ws === S.ws && !S.ready) { try { ws.close(); } catch (e) {} } }, 12000);
  ws.onmessage = ev => {
    if (ws !== S.ws) return;
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    /* 1. server_info → anmelden ("addon" ersetzt der Add-on-Server durch den echten Token) */
    if (m.message_id == null && m.server_version && !m.event) {
      if ((m.schema_version || 0) >= 28) ws.send(JSON.stringify({ message_id: "auth", command: "auth", args: { token: "addon" } }));
      else onReady();
      return;
    }
    if (m.message_id === "auth") {
      if (m.error_code || !m.result) { S.authFail = true; try { ws.close(); } catch (e) {} return; }
      S.authFail = false; onReady(); return;
    }
    /* 2. Antworten (auch in Teilen) */
    if (m.message_id != null && S.pend[m.message_id]) {
      const p = S.pend[m.message_id];
      if (m.error_code) { clearTimeout(p.t); delete S.pend[m.message_id]; p.rej(new Error(m.details || ("Fehler " + m.error_code))); return; }
      if (m.partial) {   // Teil-Antwort (z. B. große Playlist): sammeln und die Wartezeit neu starten
        p.acc = (p.acc || []).concat(m.result || []);
        if (p.out) { clearTimeout(p.t); p.t = setTimeout(p.out, p.ms); }
        return;
      }
      clearTimeout(p.t); delete S.pend[m.message_id];
      p.res(p.acc ? p.acc.concat(m.result || []) : m.result);
      return;
    }
    /* 3. Ereignisse (MA schickt sie nach der Anmeldung von selbst) */
    if (m.event) onEvent(m);
  };
  ws.onclose = () => {
    if (ws !== S.ws) return;
    clearTimeout(openT); S.ready = false; S.ws = null; failAll(); retry();
  };
}
function retry() {
  S.retry++;
  const wait = S.authFail ? 30000 : [1000, 2000, 4000, 8000, 15000][Math.min(S.retry - 1, 4)];
  setConn(S.authFail ? "auth" : "offline", wait);
  clearTimeout(retryT); retryT = setTimeout(connect, wait);
}
async function onReady() {
  clearTimeout(openT);
  S.ready = true; S.ever = true; S.retry = 0;
  setConn("ok");
  await loadPlayers();
  pickPlayer();
  await loadQueue();
  loadProfiles();
}
async function loadPlayers() {
  try {
    const list = await cmd("players/all");
    S.players = {};
    (list || []).forEach(p => { if (p && p.player_id) S.players[p.player_id] = p; });
  } catch (e) { toast("Lautsprecher konnten nicht geladen werden"); }
}

/* Health-Check nach Rückkehr in den Vordergrund (iOS lässt tote Sockets offen) */
function wake() {
  if (document.hidden) return;
  if (!S.ws) { if (S.conn !== "notoken") connect(); return; }
  if (!S.ready) return;
  cmd("players/all", {}, 5000).then(list => {
    (list || []).forEach(p => { if (p && p.player_id) S.players[p.player_id] = p; });
    refreshQueue(true); itemsDirty(); renderAll();
  }).catch(() => connect());
}
document.addEventListener("visibilitychange", wake);
window.addEventListener("pageshow", wake);
window.addEventListener("online", () => { if (!S.ready) connect(); });
setInterval(() => { if (!document.hidden && S.ready) refreshQueue(true); }, 15000);

/* ---------- Ereignisse ---------- */
function onEvent(m) {
  const id = m.object_id, d = m.data;
  switch (m.event) {
    case "player_added":
    case "player_updated": {
      if (!d || !d.player_id) return;
      const old = S.players[d.player_id];
      S.players[d.player_id] = d;
      if (!S.pid) { later(() => { pickPlayer(); loadQueue(); }, 300, "pick"); return; }
      if (d.player_id === S.pid) {
        if (d.synced_to && S.players[d.synced_to]) { selectPlayer(d.synced_to, true); return; }
        if (old && old.active_source !== d.active_source) later(loadQueue, 300, "lq");
      }
      later(renderAll, 80, "ra");
      if (sheetKind === "players") later(openPlayers, 150, "pl");
      return;
    }
    case "player_removed":
      delete S.players[id];
      if (id === S.pid) { S.pid = null; pickPlayer(); loadQueue(); }
      later(renderAll, 80, "ra");
      return;
    case "queue_updated":
      if (id === (S.qid || S.pid) && d) { if (!S.qid) S.qid = id; setQueue(d); }
      return;
    case "queue_items_updated":
      if (id === (S.qid || S.pid)) itemsDirty();
      return;
    case "queue_time_updated":
      if (id === (S.qid || S.pid)) timeUpdate(d);
      return;
  }
}

/* ---------- Lautsprecher ---------- */
const pname = p => (p && (p.display_name || p.name)) || "";
const pstate = p => (p ? (p.playback_state || p.state || "idle") : "idle");
/** im Profil ausgeblendete Lautsprecher (Einstellungen → Persönlich → Lautsprecher) */
function hiddenPlayers() { return (S.myFav && S.myFav.prefs && S.myFav.prefs.hidePlayers) || []; }
function usable(p, all) {
  // private Player (z. B. Handy mit der Music-Assistant-App) auch zeigen – sonst fehlt das eigene Handy
  return !!p && p.available !== false && p.enabled !== false && !p.hide_in_ui &&
    !HIDE_TYPES.includes(p.type) && !p.synced_to &&
    (all || p.player_id === S.pid || !hiddenPlayers().includes(p.player_id));   // gewählter bleibt immer sichtbar
}
function playerList() { return Object.values(S.players).filter(p => usable(p)).sort((a, b) => pname(a).localeCompare(pname(b), "de")); }
function leaderOf(id) { const p = S.players[id]; return p && p.synced_to && S.players[p.synced_to] ? p.synced_to : id; }
const slug = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
function groupInfo(p) {
  if (!p) return { isGroup: false, n: 1 };
  const others = (p.group_members || []).filter(x => x !== p.player_id);
  const isGroup = others.length > 0 || p.type === "group";
  return { isGroup, n: p.type === "group" ? others.length : others.length + 1 };
}
/* Reihenfolge: eigene Wahl (localStorage) → PJ.player → spielender → erster */
function pickPlayer() {
  const list = playerList(), ok = id => !!id && list.some(p => p.player_id === id);
  let pick = null;
  for (const c of [S.pid, ls.get(LS_PLAYER)]) { if (c && ok(leaderOf(c))) { pick = leaderOf(c); break; } }
  if (!pick && PJ.player) {
    const w = String(PJ.player).trim().toLowerCase(), ws = slug(w.replace(/^media_player\./, ""));
    const m = list.find(p => p.player_id.toLowerCase() === w || pname(p).toLowerCase() === w || slug(pname(p)) === ws);
    if (m) pick = m.player_id;
  }
  if (!pick) { const pl = list.find(p => pstate(p) === "playing"); pick = pl ? pl.player_id : (list[0] ? list[0].player_id : null); }
  S.pid = pick;
  renderAll();
}
function selectPlayer(id, auto) {
  if (!id || id === S.pid) return;
  S.pid = id; if (!auto) ls.set(LS_PLAYER, id);
  S.q = null; S.qid = null; S.items = []; S.itemsOk = false; S.vHold = 0; S.ppHold = 0;
  renderAll(); renderItems(); loadQueue();
}

/* ---------- Warteschlange (Kopf) ---------- */
async function loadQueue() {
  const pid = S.pid;
  if (!S.ready || !pid) { S.q = null; S.qid = null; renderAll(); return; }
  let q = null;
  try { q = await cmd("player_queues/get_active_queue", { player_id: pid }); } catch (e) {}
  if (!q) { try { q = await cmd("player_queues/get", { queue_id: pid }); } catch (e) {} }
  if (pid !== S.pid) return;
  S.qid = (q && q.queue_id) || pid;
  S.q = null; setQueue(q);
}
async function refreshQueue(force) {
  if (!S.ready || !S.qid) return;
  if (!force && Date.now() - S.lastRq < 5000) return;
  S.lastRq = Date.now();
  const qid = S.qid;
  try { const q = await cmd("player_queues/get", { queue_id: qid }); if (q && qid === S.qid) setQueue(q); } catch (e) {}
}
function setQueue(q) {
  const prev = S.q;
  S.q = q || null;
  if (q && Date.now() > S.seekHold) {
    let t = +q.elapsed_time || 0;
    const skew = Date.now() / 1000 - (+q.elapsed_time_last_updated || 0);
    if (q.state === "playing" && skew > 0 && skew < 15) t += skew * (q.playback_speed || 1);
    S.tBase = t; S.tAt = performance.now();
  }
  const ci = q && q.current_item ? q.current_item.queue_item_id : "";
  const pci = prev && prev.current_item ? prev.current_item.queue_item_id : "";
  if (!prev || !q || ci !== pci || prev.items !== q.items || prev.current_index !== q.current_index) itemsDirty();
  if (ci !== pci) { skipFx(false); S.ppHold = 0; }
  renderAll();
}
function curDur() { const n = nowInfo(); return n ? n.dur : 0; }
function elapsed() {
  const q = S.q; if (!q) return 0;
  let t = S.tBase;
  if (q.state === "playing" && S.ready) t += (performance.now() - S.tAt) / 1000 * (q.playback_speed || 1);
  const d = curDur(); return d ? clamp(t, 0, d) : Math.max(0, t);
}
/* queue_time_updated ist nicht immer plausibel → nur kleine Abweichungen übernehmen, sonst frisch holen */
function timeUpdate(v) {
  if (typeof v !== "number" || !S.q || Date.now() < S.seekHold) return;
  if (Math.abs(v - elapsed()) < 4) { S.tBase = v; S.tAt = performance.now(); }
  else refreshQueue(false);
}
function isPlaying() {
  if (Date.now() < S.ppHold) return S.ppWant;
  return ((S.q && S.q.state) || pstate(S.players[S.pid])) === "playing";
}
/* TV-Ton (z. B. Soundbar am Fernseher): Sender, Sendung bzw. App vom Add-on (/party/tvnow) statt alter Warteschlange */
function isTvSource(p) {
  const cm = p && p.current_media;
  return !!p && (p.active_source === "tv" || (cm && (cm.source_id === "tv" || cm.uri === "homeTheater-input")));
}
S.tv = null; S.tvAt = 0; S.tvBusy = false;
function tvFetch() {
  if (S.tvBusy || Date.now() - S.tvAt < 10000) return;
  S.tvBusy = true;
  fetch("party/tvnow", { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null).then(j => {
    S.tvBusy = false; S.tvAt = Date.now();
    const k = JSON.stringify(j || {});
    if (k !== JSON.stringify(S.tv || {})) { S.tv = j && Object.keys(j).length ? j : null; renderNow(); }
  });
}
setInterval(() => { const p = S.players[S.pid]; if (isTvSource(p) && !document.hidden) tvFetch(); }, 3000);
function nowInfo() {
  const q = S.q, ci = q && q.current_item, mi = ci && ci.media_item, p = S.players[S.pid];
  if (isTvSource(p)) {
    tvFetch();
    const t = S.tv;
    if (t) return { title: t.title || t.app || "TV", artist: [t.sub && t.sub !== t.title ? t.sub : "", t.app && t.app !== t.title && t.app !== t.sub ? t.app : "", "TV-Ton"].filter(Boolean).join(" · "),
      img: t.logo || t.img || "", small: t.logo || t.img || "", dur: 0, key: "tv|" + t.title, tv: true, logo: !!t.logo, dark: !!t.dark };
    return { title: "TV-Ton", artist: pname(p), img: "", small: "", dur: 0, key: "tv", tv: true };
  }
  if (ci) {
    /* Radio: laufender Song aus den Stream-Daten (Titel, Interpret, Cover), Sender darunter */
    const sd = ci.streamdetails, sm = sd && sd.stream_metadata;
    if ((mi && mi.media_type === "radio") || (sd && sd.media_type === "radio")) {
      let t = sm && sm.title, a = sm && sm.artist;
      if (!t && sd && sd.stream_title) { const m = String(sd.stream_title).split(" - "); if (m.length > 1) { a = m.shift(); t = m.join(" - "); } else t = sd.stream_title; }
      const station = (mi && mi.name) || ci.name || "";
      const cov = (sm && sm.image_url) || "";
      if (t) return { title: t, artist: [a, station].filter(Boolean).join(" · "), img: cov || imgUrl(ci, 600), small: cov || imgUrl(ci, 120),
        dur: 0, key: ci.queue_item_id + "|" + t, radio: true };
      return { title: station, artist: "Radio", img: imgUrl(ci, 600), small: imgUrl(ci, 120), dur: 0, key: ci.queue_item_id, radio: true };
    }
    return { title: (mi && mi.name) || ci.name || "", artist: artistsOf(mi) || (mi && ((mi.podcast && mi.podcast.name) || (mi.audiobook && mi.audiobook.name))) || "", img: imgUrl(ci, 600), small: imgUrl(ci, 120),
      dur: +ci.duration || +(mi && mi.duration) || 0, key: ci.queue_item_id };
  }
  const cm = p && p.current_media;
  if (cm && (cm.title || cm.uri)) { const u = maImg(cm.image_url);
    return { title: cm.title || cm.uri, artist: cm.artist || cm.album || "", img: u, small: u, dur: +cm.duration || 0, key: cm.uri }; }
  return null;
}

/* ---------- Anzeige ---------- */
function renderAll() { renderPlayer(); renderNow(); renderVol(); renderBadge(); renderMini(); }

function renderPlayer() {
  const p = S.players[S.pid];
  const btn = $("#plBtn");
  if (!S.ready && !S.ever) { setText($("#plName"), "Lautsprecher …"); return; }
  if (!p) { setText($("#plName"), "Lautsprecher wählen"); btn.classList.add("warn"); return; }
  setText($("#plName"), pname(p) + (usable(p) ? "" : " · offline"));
  btn.classList.toggle("warn", !usable(p));
}

let coverUrl = null;
function setCover(url) {
  if (url === coverUrl) return; coverUrl = url;
  const img = $("#coverImg"), box = $("#cover"), glow = $("#glow");
  box.classList.remove("ok");
  if (!url) { img.removeAttribute("src"); glow.style.backgroundImage = ""; return; }
  img.onload = () => { if (coverUrl !== url) return; box.classList.add("ok"); glow.style.backgroundImage = 'url("' + url.replace(/"/g, "%22") + '")'; };
  img.onerror = () => { if (coverUrl === url) { box.classList.remove("ok"); glow.style.backgroundImage = ""; } };
  img.src = url;
}
let skipT = null;
function skipFx(on) {
  if (on === undefined) on = true;
  $("#cover").classList.toggle("skip", on); clearTimeout(skipT);
  if (on) skipT = setTimeout(() => $("#cover").classList.remove("skip"), 6000);
}
function renderNow() {
  const n = nowInfo(), q = S.q;
  setText($("#npTitle"), n ? n.title : (S.pid ? "Gerade läuft nichts" : (S.ready ? "Kein Lautsprecher gefunden" : "")));
  setText($("#npArtist"), n ? n.artist : (S.pid ? "Über die Suche Musik auswählen" : ""));
  setCover(n ? n.img : "");
  $("#cover").classList.toggle("tvlogo", !!(n && n.logo));
  $("#cover").classList.toggle("tvdark", !!(n && n.logo && n.dark));
  const pl = isPlaying();
  $("#bPp").classList.toggle("playing", pl);
  $("#bPp").setAttribute("aria-label", pl ? "Pause" : "Abspielen");
  $("#bSh").classList.toggle("on", !!(q && q.shuffle_enabled));
  const rp = (q && q.repeat_mode) || "off";
  $("#bRp").classList.toggle("on", rp === "all" || rp === "one");
  $("#bRp").classList.toggle("one", rp === "one");
  $("#seek").classList.toggle("off", !(n && n.dur));
  tick();
}
function renderVol() {
  const p = S.players[S.pid], box = $("#volBox");
  if (!p) { box.classList.add("off"); setText($("#vVal"), "–"); setText($("#vGrp"), ""); volSl.set(0); return; }
  const g = groupInfo(p);
  const v = g.isGroup ? (p.group_volume != null ? p.group_volume : p.volume_level) : p.volume_level;
  const vg = $("#vGrp");
  if (v == null) setText(vg, "Lautstärke nicht regelbar");
  else if (g.isGroup) { const t = "Gruppe · " + g.n + " Lautsprecher"; if (vg.dataset.t !== t) { vg.dataset.t = t; vg.innerHTML = "<span>" + esc(t) + '</span><span class="vgc">' + ICON.chev + "</span>"; } }
  else setText(vg, "");
  if (v == null || !g.isGroup) vg.dataset.t = "";
  vg.classList.toggle("open", !!S.memOpen);
  $("#vGrp").classList.toggle("tap", g.isGroup && v != null);
  renderMembers(p, g);
  box.classList.toggle("off", v == null);
  if (v == null) { setText($("#vVal"), "–"); return; }
  if (!volSl.active && Date.now() > S.vHold) { volSl.set(v / 100); setText($("#vVal"), Math.round(v)); }
}
/* Gruppe aufklappen: jede Box einzeln regeln */
const memSl = {}, memPend = {}, memHold = {};
let memKey = "";
$("#vGrp").onclick = () => {
  const p = S.players[S.pid]; if (!p || !groupInfo(p).isGroup) return;
  S.memOpen = !S.memOpen; memKey = ""; renderVol();
};
function memSend(id) {
  const v = memPend[id]; if (v == null) return; memPend[id] = null;
  cmd("players/cmd/volume_set", { player_id: id, volume_level: Math.round(v) }).catch(e => toast("Music Assistant: " + errText(e)));
}
function renderMembers(p, g) {
  const box = $("#vMem");
  const ids = g.isGroup ? [p.player_id].concat((p.group_members || []).filter(x => x !== p.player_id)) : [];
  const open = S.memOpen && ids.length > 1;
  box.hidden = !open; $("#vGrp").setAttribute("aria-expanded", open ? "true" : "false");
  if (!open) { memKey = ""; return; }
  const key = ids.join("|");
  if (key !== memKey) {
    memKey = key;
    box.innerHTML = ids.map(id => '<div class="vm" data-id="' + esc(id) + '"><span class="vmn">' + esc(pname(S.players[id]) || id) +
      '</span><div class="sl vms"><div class="tr"><div class="fill"></div></div><div class="knob"></div></div><b class="vmv">–</b></div>').join("");
    box.querySelectorAll(".vm").forEach(row => {
      const id = row.dataset.id, val = row.querySelector(".vmv");
      memSl[id] = slider(row.querySelector(".sl"), {
        input: f => { setText(val, Math.round(f * 100)); memPend[id] = f * 100; memHold[id] = Date.now() + 2500;
          later(() => memSend(id), 200, "mv" + id); },
        commit: f => { memPend[id] = f * 100; memHold[id] = Date.now() + 2500; memSend(id); },
        cancel: () => { memHold[id] = Date.now() + 2500; }
      });
    });
  }
  box.querySelectorAll(".vm").forEach(row => {
    const id = row.dataset.id, m = S.players[id], sl = memSl[id];
    const v = m ? m.volume_level : null;
    row.querySelector(".sl").classList.toggle("off", v == null);
    if (v == null) { setText(row.querySelector(".vmv"), "–"); return; }
    if (sl && !sl.active && Date.now() > (memHold[id] || 0)) { sl.set(v / 100); setText(row.querySelector(".vmv"), Math.round(v)); }
  });
}
function renderBadge() {
  const q = S.q, b = $("#qBadge");
  const n = q && typeof q.items === "number" ? Math.max(0, q.items - ((q.current_index == null ? -1 : q.current_index) + 1)) : 0;
  b.hidden = !n; setText(b, n > 99 ? "99+" : n);
}
let miniUrl = null;
function renderMini() {
  const n = nowInfo(), mini = $("#mini");
  mini.classList.toggle("empty", !n);
  if (!n) return;
  setText($("#miniT"), n.title); setText($("#miniA"), n.artist);
  if (n.small !== miniUrl) { miniUrl = n.small; const im = $("#miniImg"); if (n.small) im.src = n.small; else im.removeAttribute("src"); }
  $("#miniPp").classList.toggle("playing", isPlaying());
  { const lg = document.querySelector(".brand .logo"); if (lg) lg.classList.toggle("live", isPlaying()); }
}
function tick() {
  if (document.hidden) return;
  const n = nowInfo(), d = n ? n.dur : 0, t = elapsed();
  if (!seekSl.active) { setText($("#tCur"), n ? fmt(t) : "0:00"); seekSl.set(d ? t / d : 0); }
  setText($("#tDur"), d ? fmt(d) : (n ? "Live" : ""));
  $("#mini").style.setProperty("--f", d ? (t / d).toFixed(4) : 0);
}
setInterval(tick, 500);

/* ---------- Regler (Pointer-Events, Antippen springt) ---------- */
function slider(el, o) {
  const api = { active: false, set(f) { el.style.setProperty("--f", clamp(f, 0, 1).toFixed(4)); } };
  const frac = x => { const r = el.getBoundingClientRect(); return r.width ? clamp((x - r.left) / r.width, 0, 1) : 0; };
  el.addEventListener("pointerdown", e => {
    if (el.classList.contains("off")) return;
    api.active = true; el.classList.add("drag");
    try { el.setPointerCapture(e.pointerId); } catch (x) {}
    const f = frac(e.clientX); api.set(f); o.input && o.input(f);
  });
  el.addEventListener("pointermove", e => { if (!api.active) return; const f = frac(e.clientX); api.set(f); o.input && o.input(f); });
  const end = (e, ok) => {
    if (!api.active) return;
    api.active = false; el.classList.remove("drag");
    const f = frac(e.clientX); if (ok) { api.set(f); o.commit && o.commit(f); } else if (o.cancel) o.cancel();
  };
  el.addEventListener("pointerup", e => end(e, true));
  el.addEventListener("pointercancel", e => end(e, false));
  return api;
}
const seekSl = slider($("#seek"), {
  input: f => { const d = curDur(); if (d) setText($("#tCur"), fmt(f * d)); },
  commit: f => {
    const d = curDur(); if (!d || !S.qid) return;
    const pos = Math.round(f * d);
    S.tBase = pos; S.tAt = performance.now(); S.seekHold = Date.now() + 2000;
    qc("seek", { position: pos });
  },
  cancel: () => tick()
});

/* Lautstärke: gedrosselt (~200 ms), Anzeige ruht während/kurz nach dem Ziehen */
let vPending = null, vTimer = null, vLast = 0;
function volFlush() {
  vTimer = null; if (vPending == null || !S.pid) return;
  const v = vPending; vPending = null; vLast = Date.now();
  const g = groupInfo(S.players[S.pid]);
  cmd(g.isGroup ? "players/cmd/group_volume" : "players/cmd/volume_set", { player_id: S.pid, volume_level: v })
    .catch(e => toast("Lautstärke: " + errText(e)));
}
function volSet(v) {
  v = clamp(Math.round(v), 0, 100);
  volSl.set(v / 100); setText($("#vVal"), v);
  S.vHold = Date.now() + 2500; vPending = v;
  if (!vTimer) vTimer = setTimeout(volFlush, Math.max(0, 200 - (Date.now() - vLast)));
}
const volSl = slider($("#vol"), {
  input: f => volSet(f * 100),
  commit: f => { volSet(f * 100); S.vHold = Date.now() + 2500; },
  cancel: () => { S.vHold = Date.now() + 2500; }
});
function volStep(d) { const cur = parseInt($("#vVal").textContent, 10); if (isNaN(cur)) return; volSet(cur + d); }
$("#vDn").onclick = () => volStep(-3);
$("#vUp").onclick = () => volStep(3);

/* ---------- Steuerung ---------- */
function qc(c, args) {
  // Queue noch nicht geladen (z. B. direkt nach dem Verbinden) → Player-ID als Queue-ID nehmen, Queue nachladen
  const qid = S.qid || S.pid;
  if (!qid) { toast("Erst einen Lautsprecher wählen"); return Promise.resolve(false); }
  if (!S.qid) later(loadQueue, 50, "lq");
  return cmd("player_queues/" + c, Object.assign({ queue_id: qid }, args || {}))
    .then(() => true, e => { toast("Music Assistant: " + errText(e)); return false; });
}
function togglePlay() {
  S.ppWant = !isPlaying(); S.ppHold = Date.now() + 2500; renderNow(); renderMini();
  qc("play_pause").then(ok => { if (!ok) { S.ppHold = 0; renderNow(); renderMini(); } });
}
$("#bPp").onclick = togglePlay;
$("#bNext").onclick = () => { skipFx(); qc("next").then(ok => { if (!ok) skipFx(false); }); };
$("#bPrev").onclick = () => { skipFx(); qc("previous").then(ok => { if (!ok) skipFx(false); }); };
$("#bSh").onclick = () => {
  const q = S.q; if (!q) return;
  const on = !q.shuffle_enabled; q.shuffle_enabled = on; renderNow();
  qc("shuffle", { shuffle_enabled: on }).then(ok => { if (ok) toast(on ? "Zufall an" : "Zufall aus"); else { q.shuffle_enabled = !on; renderNow(); } });
};
$("#bRp").onclick = () => {
  const q = S.q; if (!q) return;
  const cur = q.repeat_mode || "off", nx = cur === "off" ? "all" : cur === "all" ? "one" : "off";
  q.repeat_mode = nx; renderNow();
  qc("repeat", { repeat_mode: nx }).then(ok => {
    if (ok) toast(nx === "all" ? "Wiederholen: alle" : nx === "one" ? "Wiederholen: dieser Titel" : "Wiederholen aus");
    else { q.repeat_mode = cur; renderNow(); }
  });
};
$("#mini").onclick = e => { if (e.target.closest("#miniPp")) { togglePlay(); return; } showTab("now"); };

/* ---------- Ansichten ---------- */
/*
 * Ansichten: Start · Suche · Warteschlange (untere Leiste).
 * „now“ ist der aufgeklappte Player – er legt sich über alles (Mini-Leiste antippen) und klappt wieder zu.
 * Start nutzt die Ansicht der Suche (gleiche Listen, Öffnen, Abspiel-Menü) – ohne Suchfeld.
 */
function showTab(t) {
  if (t === "now") { openPlayer(); return; }
  if (S.playerOpen) closePlayer(true);
  const wasHome = S.favMode;
  S.tab = t; document.body.dataset.tab = t;
  S.favMode = t === "home";
  ["home", "search", "queue"].forEach(x => { const nb = document.querySelector('#nav [data-t="' + x + '"]'); if (nb) nb.classList.toggle("on", x === t); });
  $("#v-search").classList.toggle("on", t === "search" || t === "home");
  $("#v-queue").classList.toggle("on", t === "queue");
  if (S.favMode !== wasHome && S.nav && S.nav.length) { S.nav = []; S.navSeq = (S.navSeq || 0) + 1; }
  if (t === "home") { S.favCat = null; renderFav(); $("#v-search").scrollTop = 0; }
  if (t === "search" && wasHome) { if (S.sRes) renderResults(); else renderHome(); }
  if (t === "queue") { renderItems(); if (!S.itemsOk) loadItems(); }
  if (t === "search" && !$("#q").value) {
    if (!S.sRes && !(S.nav && S.nav.length)) renderHome();
    if (S.users.length < 2) setTimeout(() => $("#q").focus(), 60);
  }
}
/* Player auf-/zuklappen. Zurück-Taste (Android) klappt zu.
   Der Player hängt direkt am <body>, damit er über Kopfzeile und unterer Leiste liegt. */
document.body.appendChild($("#v-now"));
/* Player auf-/zuklappen. Zurück-Taste (Android) klappt zu. */
function openPlayer() {
  if (S.playerOpen) return;
  S.playerOpen = true; document.body.classList.add("npopen");
  $("#v-now").classList.add("on"); $("#v-now").scrollTop = 0;
  try { history.pushState({ jbPlayer: 1 }, ""); } catch (e) {}
  tick();
}
function closePlayer(silent) {
  if (!S.playerOpen) return;
  S.playerOpen = false; document.body.classList.remove("npopen");
  const v = $("#v-now"); v.classList.remove("on"); v.style.transform = "";
  if (!silent && history.state && history.state.jbPlayer) { S.skipPop = true; history.back(); }
}
$("#npClose").onclick = () => closePlayer();
$("#npSpk").onclick = () => $("#plBtn").click();
(function () {   // Lautsprecher-Name auch im Player-Kopf
  const src = $("#plName"), dst = $("#npSpkN");
  const cp = () => { dst.textContent = src.textContent; };
  cp(); new MutationObserver(cp).observe(src, { childList: true, characterData: true, subtree: true });
})();
(function () {   // nach unten wischen = zuklappen (nur wenn ganz oben, nicht auf Reglern)
  const v = $("#v-now"); let y0 = null, dy = 0;
  v.addEventListener("touchstart", e => {
    if (v.scrollTop > 0 || e.target.closest(".sl,.vol,.modes,.ctl")) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; v.style.transition = "none";
  }, { passive: true });
  v.addEventListener("touchmove", e => {
    if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0);
    v.style.transform = dy ? "translateY(" + dy + "px)" : "";
  }, { passive: true });
  v.addEventListener("touchend", () => {
    if (y0 == null) return; v.style.transition = "";
    if (dy > 110) closePlayer(); else v.style.transform = "";
    y0 = null;
  });
})();
document.querySelectorAll("#nav button").forEach(b => { b.onclick = () => showTab(b.dataset.t); });

/* ---------- Unteres Fenster ---------- */
let sheetKind = "";
/* ---------- Meldungen der App: Fern-Log des Handys, übersetzt ----------
   Jede Regel: Muster → [Stufe, Text]. Stufe: e = Fehler, w = Hinweis/Störung, o = gut, i = Info, null = ausblenden */
const secDE = ms => (ms / 1000).toFixed(1).replace(".", ",");
const LOG_RULES = [
  [/^⚠ ?Absturz/, () => ["e", "Die App ist abgestürzt und wurde neu gestartet"]],
  [/Keine Musik mehr angekommen/, () => ["e", "Es kam keine Musik mehr an – Verbindung wird neu aufgebaut"]],
  [/MA spielt, aber kein Stream/, () => ["w", "Music Assistant spielte, aber es kam kein Ton – Wiedergabe neu angestoßen"]],
  [/Nach Verbindungsabbruch: Wiedergabe neu anstoßen \(Versuch (\d+)/, m => ["w", "Nach dem Abbruch weitergespielt (Versuch " + m[1] + ")"]],
  [/Verbindung weg \((.*?)\)/, m => ["w", "Verbindung unterbrochen" + ({ stall: " (keine Daten mehr)", net: " (Netz weg)" }[m[1]] || "") + " – der Vorrat spielt weiter"]],
  [/Netz der Verbindung weg/, () => ["w", "Netz weg (z. B. Funkloch oder WLAN aus) – verbinde neu"]],
  [/Netz wieder da/, () => ["o", "Netz wieder da"]],
  [/WebRTC klappt nicht, nehme Nabu Casa/, () => ["w", "Direktverbindung ging nicht – nutze den Umweg über Nabu Casa"]],
  [/Verbinde direkt/, () => ["i", "Verbinde im Heimnetz"]],
  [/Verbinde (per WebRTC|über Nabu Casa)/, () => ["i", "Verbinde von unterwegs"]],
  [/angemeldet bei/, () => ["o", "Mit Music Assistant verbunden"]],
  [/Ausgabe hängt \(Verspätung (-?\d+)/, m => ["e", "Ton-Ausgabe hing (" + secDE(m[1]) + " s) – neu gestartet"]],
  [/AudioTrack neu|^⚠ Audio:/, () => ["e", "Ton-Ausgabe hatte einen Fehler – neu gestartet"]],
  [/FLAC-Decoder voll|Paket zu alt verworfen/, () => ["w", "Ein kleines Stück Musik ging verloren (kurzer Aussetzer)"]],
  [/FLAC-Decoder:|^⚠ FLAC:|Format nicht unterstützt/, () => ["e", "Musik konnte nicht entpackt werden"]],
  [/Sprung: zu (spät|früh) (\d+)/, m => ["w", "Ton war " + (m[1] === "spät" ? "zu spät" : "zu früh") + " (" + secDE(m[2]) + " s) – zurechtgerückt"]],
  [/Nachlauf \+(\d+)/, m => ["i", "Kurzen Hänger ohne Lücke ausgeglichen (+" + secDE(m[1]) + " s)"]],
  [/Uhr neu abgeglichen/, () => ["w", "Handy war im Tiefschlaf – Takt neu abgeglichen"]],
  [/Doppelte Pakete/, () => ["i", "Nach dem Neuverbinden doppelte Musik übersprungen"]],
  [/Ausgabe getrennt/, () => ["w", "Ausgabe getrennt (z. B. Kopfhörer/Auto weg) – pausiert"]],
  [/Ausgabeweg gewechselt/, () => ["i", "Ton läuft jetzt über ein anderes Gerät"]],
  [/Audio-Fokus selbst zurückgeholt/, () => ["w", "Eine andere App hat den Ton nicht zurückgegeben – selbst zurückgeholt"]],
  [/Audio-Fokus: (-?\d+)/, m => ({ "-1": ["w", "Eine andere App hat den Ton übernommen"], "-2": ["i", "Kurz unterbrochen (Navi, Anruf, Sprachassistent)"], "-3": ["i", "Leiser gestellt für eine Ansage"] }[m[1]] || [null])],
  [/Fortsetzen: (.*)/, m => ["e", "Weiterspielen ging nicht: " + m[1]]],
  [/Lautsprecher-Liste: (.*)/, () => ["e", "Lautsprecher-Liste konnte nicht geladen werden"]],
  [/Update laden: /, () => ["e", "App-Update konnte nicht geladen werden"]],
  [/Signaling|Remote-ID|Nachricht: |Netz beobachten|Wach-Sperre:/, () => ["e", "Interner Fehler beim Verbinden"]],
  [/Leerlauf 10 min/, () => ["i", "10 min keine Musik – Handy-Lautsprecher schläft (Akku)"]],
  [/Aufgeweckt: (.*)/, m => ["i", "Aufgewacht (" + m[1] + ")"]],
  [/Lange Pause/, () => ["i", "Lange Pause – Energiesparen an"]],
  [/Weiterspielen angefragt/, () => ["i", "Weiterspielen über Medientaste/Auto"]],
  [/Stream: (\w+) (\d+) Hz/, m => ["i", "Musik startet (" + m[1].toUpperCase() + " " + (m[2] / 1000).toString().replace(".", ",") + " kHz)"]],
  [/gestartet als/, () => ["i", "App gestartet"]],
  [/Status: (\S+).*?(?:Aussetzer: (\d+)[^·]*· )?Puffer (\d+) ms/, m => [m[1] === "verbunden" ? "i" : "w",
    (m[1] === "verbunden" ? "Läuft" : "Getrennt") + " · Vorrat " + secDE(m[3]) + " s" + (m[2] ? " · " + m[2] + " Aussetzer bisher" : "")]],
  [/Benachrichtigung:|Medienkarte:|MA-Player:|Zustand:|Datenkanal|ICE-Server|Medien-Dienst|Ende: |Pause – Ausgabe/, () => [null]],
  [/^⚠ (.*)/, m => ["w", m[1]]],
];
function logLine(raw) {
  const m0 = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d):\d\d (.*)$/.exec(raw); if (!m0) return null;
  const msg = m0[3];
  for (const [re, f] of LOG_RULES) { const m = re.exec(msg); if (m) { const [lv, t] = f(m); return lv ? { d: m0[1], t: m0[2], lv, txt: t } : null; } }
  return { d: m0[1], t: m0[2], lv: "i", txt: msg };
}
function openAppLog(onlyProblems) {
  let lines = [];
  try { lines = JSON.parse(window.AndroidMediaSession.getAppLog() || "[]"); } catch (e) {}
  const all = lines.map(logLine).filter(Boolean).reverse();
  const shown = onlyProblems ? all.filter(x => x.lv === "e" || x.lv === "w") : all;
  const ico = { e: "⛔", w: "⚠️", o: "✅", i: "·" };
  const today = new Date().toISOString().slice(0, 10), yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  let html = '<div class="shh">Meldungen der App</div>' +
    '<div class="chips" style="margin:4px 0 10px"><button class="chip' + (onlyProblems ? " on" : "") + '" id="lgP">Nur Probleme</button>' +
    '<button class="chip' + (onlyProblems ? "" : " on") + '" id="lgA">Alles</button></div>';
  if (!shown.length) html += '<div class="rshint">' + (onlyProblems ? "Keine Probleme in letzter Zeit 👍" : "Noch keine Meldungen") + '</div>';
  let lastD = "";
  shown.slice(0, 250).forEach(x => {
    if (x.d !== lastD) { lastD = x.d; html += '<div class="shh gsh">' + (x.d === today ? "Heute" : x.d === yest ? "Gestern" : x.d.split("-").reverse().join(".")) + '</div>'; }
    html += '<div class="lgrow lg' + x.lv + '"><span class="lgt">' + x.t + '</span><span class="lgi">' + ico[x.lv] + '</span><span class="lgx">' + esc(x.txt) + '</span></div>';
  });
  openSheet("applog", html, c => {
    c.querySelector("#lgP").onclick = () => openAppLog(true);
    c.querySelector("#lgA").onclick = () => openAppLog(false);
  });
}

function openSheet(kind, html, bind) {
  const sh = $("#sheet"), c = $("#sheetCard");
  sheetKind = kind; c.innerHTML = html;
  if (sh.hidden) { sh.hidden = false; void sh.offsetWidth; }
  sh.classList.add("on");
  if (bind) bind(c);
}
function closeSheet() {
  const sh = $("#sheet"); sheetKind = ""; sh.classList.remove("on");
  setTimeout(() => { if (!sh.classList.contains("on")) sh.hidden = true; }, 230);
}
$("#sheetBg").onclick = closeSheet;
document.addEventListener("keydown", e => { if (e.key === "Escape" && sheetKind) closeSheet(); });

function thumb(url, cls) {
  return '<span class="th' + (cls ? " " + cls : "") + '">' + ICON.note + (url ? '<img loading="lazy" alt="" src="' + esc(url) + '">' : "") + "</span>";
}
/* kaputte Bilder ausblenden (Platzhalter bleibt) */
document.addEventListener("error", e => { const t = e.target; if (t && t.tagName === "IMG" && t.closest(".th")) t.remove(); }, true);

function openPlayers() {
  const list = playerList();
  /* Läuft gerade etwas (auf dem gewählten oder einem anderen Lautsprecher)? Dann kann jede Zeile die Musik übernehmen */
  const srcP = [S.players[S.pid]].concat(list).find(p => p && ["playing", "paused"].includes(pstate(p)));
  const src = srcP ? srcP.player_id : null;
  let html = '<div class="shh">Lautsprecher</div>' +
    (src ? '<div class="rshint" style="margin:-4px 2px 8px">⇄ holt die Musik von ' + esc(pname(srcP)) + ' samt Warteschlange auf diesen Lautsprecher</div>' : "");
  if (!S.ready) html += '<div class="empty">Keine Verbindung zu Music Assistant</div>';
  else if (!list.length) html += '<div class="empty">Keine Lautsprecher verfügbar</div>';
  html += list.map(p => {
    const g = groupInfo(p), st = pstate(p);
    const sub = [st === "playing" ? "spielt" : st === "paused" ? "pausiert" : "bereit", g.isGroup ? "Gruppe · " + g.n + " Lautsprecher" : ""].filter(Boolean).join(" · ");
    return '<button class="row prow' + (p.player_id === S.pid ? " on" : "") + '" data-id="' + esc(p.player_id) + '"><span class="pic">' + ICON.speaker +
      '</span><span class="rm"><span class="r1">' + esc(pname(p)) + '</span><span class="r2">' + esc(sub) + '</span></span>' +
      (src && p.player_id !== src ? '<span class="xfer" data-id="' + esc(p.player_id) + '" title="Musik hierher übergeben">⇄</span>' : "") +
      '<span class="chk">' + ICON.check + "</span></button>";
  }).join("");
  /* Gruppieren: weitere Lautsprecher mit dem gewählten mitspielen lassen */
  const lead = S.players[S.pid];
  if (S.ready && lead) {
    const can = Array.isArray(lead.can_group_with) ? lead.can_group_with : null;
    const mem = lead.group_members || [];
    const cand = Object.values(S.players).filter(p => p.player_id !== S.pid && p.available !== false && p.enabled !== false &&
      !p.hide_in_ui && !HIDE_TYPES.includes(p.type) && p.type !== "group" &&
      (p.synced_to === S.pid || mem.includes(p.player_id) || !can || can.includes(p.player_id)))
      .sort((a, b) => pname(a).localeCompare(pname(b), "de"));
    if (cand.length) {
      html += '<div class="shh gsh">Mitspielen mit ' + esc(pname(lead)) + "</div>";
      html += cand.map(p => {
        const on = p.synced_to === S.pid || mem.includes(p.player_id);
        const busy = !on && p.synced_to ? "spielt mit " + pname(S.players[p.synced_to]) : (on ? "spielt mit" : "");
        return '<button class="row grow' + (on ? " on" : "") + '" data-id="' + esc(p.player_id) + '"><span class="pic">' + ICON.speaker +
          '</span><span class="rm"><span class="r1">' + esc(pname(p)) + '</span><span class="r2">' + esc(busy) + '</span></span><span class="gsw"><i></i></span></button>';
      }).join("");
    }
  }
  openSheet("players", html, c => {
    c.querySelectorAll(".prow").forEach(b => {
      b.onclick = () => { const id = b.dataset.id; closeSheet(); selectPlayer(id); toast("Lautsprecher: " + pname(S.players[id])); };
    });
    /* Musik samt Warteschlange übergeben (MA: player_queues/transfer), danach den neuen Lautsprecher wählen */
    c.querySelectorAll(".xfer").forEach(x => {
      x.onclick = async ev => {
        ev.stopPropagation();
        const to = x.dataset.id; closeSheet();
        try {
          await cmd("player_queues/transfer", { source_queue_id: src, target_queue_id: to, auto_play: true }, 20000);
          selectPlayer(to); toast("⇄ Musik läuft jetzt auf " + pname(S.players[to]));
        } catch (e) { toast("Übergeben: " + errText(e)); }
      };
    });
    c.querySelectorAll(".grow").forEach(b => {
      b.onclick = () => {
        const id = b.dataset.id, on = b.classList.contains("on"), lid = S.pid;
        b.classList.toggle("on", !on); b.disabled = true;
        const p = on ? cmd("players/cmd/ungroup", { player_id: id }) : cmd("players/cmd/group", { player_id: id, target_player: lid });
        p.then(() => toast(pname(S.players[id]) + (on ? " spielt nicht mehr mit" : " spielt jetzt mit")),
               e => { b.classList.toggle("on", on); toast("Music Assistant: " + errText(e)); })
         .finally(() => { b.disabled = false; later(() => { if (sheetKind === "players") openPlayers(); }, 1200, "pl"); });
      };
    });
  });
}
$("#plBtn").onclick = openPlayers;
/* In der Android-App kein Sprung zur Gäste-Seite (von dort führt kein Weg zurück); erreichbar bleibt sie
   über Einstellungen → Party → „Gäste-Seite öffnen“ */
if (window.AndroidMediaSession) {
  const g = $("#gstBtn"); if (g) g.remove();
  const sb = $("#setBtn"); if (sb) $("#top").appendChild(sb);   // ⚙ wandert nach rechts (frei gewordener Platz)
}

/* ---------- Party-Einstellungen (Lichteffekte, Abstimmung, Gast-Limits) ---------- */
let setData = null;
async function setFetch(body) {
  const r = await fetch("party/settings", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (r.status === 403 && j.host === false || /Gastgeber-PIN/.test(j.error || "")) { location.href = "host.html?next=jukebox.html"; }
  if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
  return j;
}
/* ---------- Schalter aus Home Assistant (z. B. "Heimkommen Musik") – auch in Android Auto ---------- */
async function loadQs(c) {
  const box = c.querySelector("#qsBox"); if (!box) return;
  let list = [];
  try { const r = await fetch("party/switches", { cache: "no-store" }); if (r.ok) list = (await r.json()).switches || []; } catch (e) {}
  box.innerHTML = list.map(x => '<button class="row qsw' + (x.state === "on" ? " on" : "") + '" data-id="' + esc(x.id) + '"><span class="rm"><span class="r1">' +
      esc(x.name) + '</span><span class="r2">' + (x.state === "on" ? "an" : x.state === "off" ? "aus" : esc(x.state || "?")) + '</span></span><span class="gsw"><i></i></span></button>').join("") +
    '<button class="row lrow" id="qsEdit"><span class="rm"><span class="r1">Schalter auswählen</span><span class="r2">' +
    (list.length ? "welche hier und im Auto erscheinen" : "z. B. Heimkommen – erscheinen hier und im Auto") + '</span></span><span class="lic">›</span></button>';
  box.querySelectorAll(".qsw").forEach(b => b.onclick = async () => {
    const on = !b.classList.contains("on"); b.classList.toggle("on", on); b.querySelector(".r2").textContent = on ? "an" : "aus";
    try { const r = await fetch("party/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_id: b.dataset.id, on }) });
      if (!r.ok) throw new Error("HTTP " + r.status); } catch (e) { b.classList.toggle("on", !on); toast("Schalter: " + errText(e)); }
  });
  box.querySelector("#qsEdit").onclick = () => editQs(list.map(x => x.id));
  // Zustand frisch halten (z. B. im Auto umgeschaltet), solange die Einstellungen offen sind
  clearTimeout(loadQs.t);
  loadQs.t = setTimeout(() => { if (box.isConnected) loadQs(c); }, 5000);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && document.getElementById("qsBox")) loadQs(document); });
async function editQs(chosen) {
  let all = [];
  try { const r = await fetch("party/ha/entities", { cache: "no-store" }); if (r.ok) all = (await r.json()).switches || []; } catch (e) {}
  const sel = new Set(chosen);
  const rows = () => all.map(x => '<button class="row qsw' + (sel.has(x.id) ? " on" : "") + '" data-id="' + esc(x.id) + '"><span class="rm"><span class="r1">' + esc(x.name) +
    '</span><span class="r2">' + esc(x.id) + '</span></span><span class="gsw"><i></i></span></button>').join("");
  // Ohne Suche nur Helfer (input_boolean) + bereits gewählte; die Suche findet auch alle switch.*
  const helper = x => x.id.startsWith("input_boolean.") || sel.has(x.id);
  all.sort((a, b) => (helper(b) - helper(a)) || a.name.localeCompare(b.name));
  openSheet("qsedit", '<div class="shh">Schalter auswählen</div><input class="fi" id="qsF" placeholder="Suchen … (findet auch alle anderen Schalter)" style="margin:0 6px 10px;width:calc(100% - 12px)"><div id="qsL">' + rows() + "</div>", c => {
    const filter = q => c.querySelectorAll("#qsL .qsw").forEach(b => {
      const x = all.find(y => y.id === b.dataset.id);
      b.hidden = q ? !b.textContent.toLowerCase().includes(q) : !(x && (x.id.startsWith("input_boolean.") || sel.has(x.id)));
    });
    filter("");
    const bind = () => c.querySelectorAll("#qsL .qsw").forEach(b => b.onclick = () => {
      const id = b.dataset.id; if (sel.has(id)) sel.delete(id); else sel.add(id); b.classList.toggle("on", sel.has(id));
      setSave({ switches: [...sel] });
    });
    bind();
    c.querySelector("#qsF").oninput = e => filter(e.target.value.trim().toLowerCase());
  });
}
function swRow(key, title, sub, on, dis) {
  return '<button class="row srow' + (on ? " on" : "") + '" data-k="' + key + '"' + (dis ? " disabled" : "") + '><span class="rm"><span class="r1">' + esc(title) +
    '</span><span class="r2">' + esc(sub) + '</span></span><span class="gsw"><i></i></span></button>';
}
function numRow(key, title, val, unit, dis) {
  return '<div class="nrow' + (dis ? " dis" : "") + '" data-k="' + key + '"><span class="r1">' + esc(title) + '</span><span class="stp">' +
    '<button data-d="-1" aria-label="weniger">−</button><b>' + (val == null ? "–" : val) + '</b><button data-d="1" aria-label="mehr">+</button></span><span class="un">' + esc(unit) + "</span></div>";
}
/*
 * Einstellungen in Reitern: Persönlich · Party · TV & Räume · Info.
 * Die Abschnitte werden anhand ihrer Überschrift einem Reiter zugeordnet; der zuletzt gewählte Reiter bleibt.
 */
const SET_TABS = [["me", "Persönlich"], ["klang", "Klang"], ["party", "Party"], ["tv", "TV & Räume"], ["info", "Info"]];
function setTabOf(head) {
  if (/^Klang/.test(head)) return "klang";
  if (/^(TV-Anzeige|Räume)/.test(head)) return "tv";
  if (/^(Profile|Handy|Startseite|Lautsprecher|Schalter|Push)/.test(head)) return "me";
  if (/^Projekt/.test(head)) return "info";
  return "party";
}
function settingsTabs(html) {
  const HEAD = '<div class="shh">Party-Einstellungen</div>';
  html = html.replace(HEAD, "");
  const parts = html.split('<div class="shh gsh">');
  let out = '<div class="stb" data-t="party">' + parts[0] + "</div>";
  const has = { party: true };
  parts.slice(1).forEach(p => {
    const t = setTabOf(p.replace(/<[^>]*>/g, "").trim()); has[t] = true;
    out += '<div class="stb" data-t="' + t + '"><div class="shh gsh">' + p + "</div>";
  });
  let cur = ls.get("jb_settab") || (has.me ? "me" : "party"); if (!has[cur]) cur = "party";
  S.setTab = cur;
  return '<div class="shh">Einstellungen</div><div class="stabs">' + SET_TABS.filter(([t]) => has[t]).map(([t, n]) =>
    '<button data-t="' + t + '"' + (t === cur ? ' class="on"' : "") + ">" + n + "</button>").join("") + "</div>" + out;
}
function bindSettingsTabs(c) {
  const show = t => {
    S.setTab = t; ls.set("jb_settab", t);
    c.querySelectorAll(".stabs button").forEach(b => b.classList.toggle("on", b.dataset.t === t));
    c.querySelectorAll(".stb").forEach(x => { x.hidden = x.dataset.t !== t; });
  };
  c.querySelectorAll(".stabs button").forEach(b => b.onclick = () => { show(b.dataset.t); c.scrollTop = 0; });
  show(S.setTab || "party");
}
function renderSettings() {
  const d = setData || {}, L = d.limits;
  let html = '<div class="shh">Party-Einstellungen</div>' +
    '<label class="fl">Party-Name <small>(TV, Party-Seite, QR-Code)</small></label><input class="fi" id="pnIn" maxlength="40" placeholder="z. B. Sommerfest" value="' + esc(d.name || "") + '">';
  html += swRow("effects", "Lichteffekte", d.scripts ? "bei Wunsch, Vordrängeln und Nachschub" : "keine Skripte in den Add-on-Optionen eingetragen", !!d.effects);
  html += swRow("skip_votes", "Abstimmung überspringt Songs", "bei Mehrheit 👎 der Gäste", !!d.skip_votes);
  html += swRow("keep_music", "Musik geht nie aus", "läuft der vorletzte Song, schaltet sich Autoplay ein (wenn keine Endlosschleife an ist)", d.keep_music !== false);
  html += swRow("no_dupes", "Doppelte Songs verhindern", "Gäste können nichts wünschen, was schon in der Liste ist oder in den letzten 3 Stunden lief", d.no_dupes !== false);
  html += swRow("box_sounds", "Party-Töne auf dem Lautsprecher", "Bier und Buh beim Vordrängeln auch über die Box, die der Fernseher zeigt", d.box_sounds !== false);
  html += '<div class="shh gsh">TV-Anzeige</div>';
  const off = typeof d.lyr_offset === "number" ? d.lyr_offset : 0.5;
  html += '<div class="nrow" data-k="lyr_offset"><span class="r1">Songtext-Versatz<small>+ = Text früher, − = später</small></span><span class="stp">' +
    '<button data-d="-0.1" aria-label="später">−</button><b>' + (off > 0 ? "+" : "") + off.toFixed(1) + '</b><button data-d="0.1" aria-label="früher">+</button></span><span class="un">Sek.</span></div>';
  const lm = d.tv_lite || "auto";
  html += '<div class="segrow"><span class="r1">Darstellung</span><span class="seg">' +
    [["auto", "Automatisch"], ["off", "Volle Optik"], ["on", "Spar-Modus"]].map(([v, t]) => '<button data-v="' + v + '"' + (lm === v ? ' class="on"' : "") + ">" + t + "</button>").join("") +
    '</span><span class="r2">Spar-Modus: ohne unscharfes Cover und Animationen – für langsame Geräte (Automatisch = nur Raspberry Pi)</span></div>';
  const P = d.plugin, maBase = d.ma_web || (location.protocol + "//" + location.hostname + ":8095");
  const maLink = maBase + "/#/settings/" + (P && P.installed ? "editprovider/" + encodeURIComponent(P.instance_id) : "providers");
  html += '<div class="shh gsh">Party zurücksetzen</div>' +
    '<div class="rsrow"><button class="act rsb" data-r="drinks">🍺 Getränke-Ranking</button><button class="act rsb" data-r="wishes">🎵 Wünsche</button></div>' +
    '<div class="rshint">Das Getränke-Ranking leert sich sonst von selbst, wenn 12 Stunden nichts bestellt wurde.</div>';
  html += '<div class="shh gsh">Räume · Auto-Beitritt</div>';
  if (!d.rooms_ok) html += '<div class="empty sm">Nur mit Home Assistant (Add-on) möglich</div>';
  else {
    (d.rooms || []).forEach((r, i) => {
      const pl = S.players[r.player], sub = r.locked ? "🔒 gesperrt" + (r.left_min != null ? " · noch " + (r.left_min >= 60 ? Math.floor(r.left_min / 60) + " h " + String(r.left_min % 60).padStart(2, "0") + " min" : r.left_min + " min") : "")
        : (r.motion ? "Bewegung · " : "") + (pl ? pname(pl) : "Lautsprecher fehlt") + (r.enabled === false ? " · aus" : "");
      html += '<div class="rmrow' + (r.locked ? " lk" : "") + '" data-i="' + i + '"><button class="rmed" data-i="' + i + '"><span class="r1">' + esc(r.name) +
        '</span><span class="r2">' + esc(sub) + '</span></button><button class="rmlk' + (r.locked ? " on" : "") + '" data-i="' + i + '" aria-label="Sperren">' + ICON.lock +
        "</button></div>";
    });
    html += '<button class="row addrow" id="rmAdd"><span class="lic">' + ICON.plus + '</span><span class="rm"><span class="r1">Raum hinzufügen</span>' +
      '<span class="r2">Bewegung im Raum → Box spielt die laufende Musik mit</span></span></button>';
  }
  html += '<div class="shh gsh">Party-Plugin (Music Assistant)</div>';
  if (!P) html += '<div class="empty">Music Assistant nicht erreichbar</div>';
  else if (!P.installed) html += '<div class="prow"><span class="rm"><span class="r1">Nicht installiert</span><span class="r2">Nötig für QR-Code, Gäste-Anmeldung und Limits</span></span>' +
    '<button class="pbtn" id="plInst">Installieren</button></div>';
  else html += swRow("plugin", "Party-Plugin", P.enabled ? "Gäste können per QR-Code mitmachen" : "ausgeschaltet – keine Gäste-Anmeldung", P.enabled);
  html += '<a class="row lrow" href="' + esc(maLink) + '" target="_blank" rel="noopener"><span class="rm"><span class="r1">In Music Assistant öffnen</span>' +
    '<span class="r2">alle Plugin-Einstellungen (Party-Name, Player, Farben …)</span></span><span class="lic">↗</span></a>';
  if ((S.allUsers || []).length > 1) {
    const sel = Array.isArray(d.profiles) ? d.profiles : null;
    html += '<div class="shh gsh">Profile in der Suche</div>' + S.allUsers.map(u =>
      '<button class="row srow pfr' + ((sel ? sel.includes(u.user_id) : profDefault(u)) ? " on" : "") + '" data-u="' + esc(u.user_id) + '"><span class="rm"><span class="r1">' +
      esc(profName(u)) + '</span><span class="r2">' + esc(u.username + " · " + (u.role || "")) + '</span></span><span class="gsw"><i></i></span></button>').join("");
  }
  const AMS = window.AndroidMediaSession;
  if (AMS && typeof AMS.phonePlayerState === "function") {  // nur in der Android-App mit Handy-Player
    let ps = {}; try { ps = JSON.parse(AMS.phonePlayerState()); } catch (e) {}
    html += '<div class="shh gsh">Handy als Lautsprecher</div>' +
      '<button class="row srow php' + (ps.on ? " on" : "") + '"><span class="rm"><span class="r1">Dieses Handy als Player</span><span class="r2">' +
      (ps.on ? (ps.pid ? (ps.fmt ? "aktiv · " + esc(ps.fmt) : "aktiv – in Android Auto unter Lautsprecher") : "startet …") : "für Musik im Auto (Android Auto)") +
      '</span></span><span class="gsw"><i></i></span></button>' +
      '<button class="row lrow" id="phpSetup"><span class="rm"><span class="r1">Name des Players</span><span class="r2">so heißt das Handy in Music Assistant</span></span><span class="lic">›</span></button>';
  }
  if (AMS && typeof AMS.getCarPrefs === "function") {  // Auto-Einstellungen dieses Handys (nur Android-App)
    html += '<div class="shh gsh">Handy im Auto</div><div id="carBox"><div class="rshint">lädt …</div></div>';
  }
  html += '<div class="shh gsh">Startseite' + (prof() ? " von " + esc(profName(prof())) : "") + '</div><div id="hoBox"></div>';
  html += '<div class="shh gsh">Lautsprecher' + (prof() ? " von " + esc(profName(prof())) : "") + '</div>' +
    '<div class="rshint" style="margin:-4px 2px 6px">ausgeschaltete erscheinen nicht mehr in der Auswahl</div><div id="hpBox"></div>';
  html += '<div class="shh gsh">Push bei neuen Podcast-Folgen' + (prof() ? " · " + esc(profName(prof())) : "") + '</div><div id="ppBox"><div class="rshint">lädt …</div></div>';
  html += '<div class="shh gsh">Schalter</div><div id="qsBox"><div class="rshint">lädt …</div></div>';
  html += '<div class="shh gsh">Gastgeber-PIN</div>' +
    '<div class="pinrow"><input class="fi" id="pinIn" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password" placeholder="' +
    (d.host_pin ? "Neue PIN (4–8 Ziffern)" : "PIN festlegen (4–8 Ziffern)") + '"><button class="act" id="pinSave">Speichern</button></div>' +
    '<div class="rshint">' + (d.host_pin ? "🔒 Aktiv: Jukebox und Einstellungen nur nach PIN. Gäste-Seite → Logo lange drücken → PIN. "
      : "Ohne PIN kann jeder im WLAN die Jukebox öffnen. ") + "Gäste-Seite und TV-Anzeige bleiben frei.</div>" +
    (d.host_pin ? '<button class="act rsb2" id="pinDel">PIN entfernen</button>' : "");
  html += '<div class="shh gsh">Klang · ' + esc(pname(S.players[S.pid]) || "Lautsprecher") + '</div><div id="dspBox"><div class="rshint">lädt …</div></div>';
  html += '<div class="shh gsh">Gäste</div>';
  html += '<a class="row lrow" href="party.html"><span class="rm"><span class="r1">Gäste-Seite öffnen</span>' +
    '<span class="r2">zurück über das Jukebox-Logo oben rechts</span></span><span class="lic">›</span></a>';
  if (!L) html += '<div class="empty">' + (P && !P.installed ? "Erst das Party-Plugin installieren" : "Party-Plugin in Music Assistant nicht gefunden") + '</div>';
  else {
    const lim = L.enable_rate_limiting !== false;
    html += swRow("enable_rate_limiting", "Begrenzen", lim ? "jeder Gast hat ein Kontingent" : "unbegrenzt wünschen und vordrängeln", lim);
    html += swRow("enable_add_queue", "Songs wünschen", "Gäste dürfen Songs in die Warteschlange einfügen", L.enable_add_queue !== false);
    html += numRow("add_queue_limit", "Wünsche pro Gast", L.add_queue_limit, "Songs", !lim || L.enable_add_queue === false);
    html += numRow("add_queue_refill_minutes", "+1 Wunsch alle", L.add_queue_refill_minutes, "Min.", !lim || L.enable_add_queue === false);
    html += swRow("enable_boost", "Vordrängeln", "Song springt an den Anfang der Warteschlange", L.enable_boost !== false);
    html += numRow("boost_limit", "Vordrängeln pro Gast", L.boost_limit, "mal", !lim || L.enable_boost === false);
    html += numRow("boost_refill_minutes", "+1 Vordrängeln alle", L.boost_refill_minutes, "Min.", !lim || L.enable_boost === false);
  }
  html += '<div class="shh gsh">Projekt</div>' +
    '<a class="row lrow" href="https://paypal.me/stephanstiefermann" target="_blank" rel="noopener"><span class="rm"><span class="r1">☕ Projekt unterstützen</span>' +
    '<span class="r2">freiwillig per PayPal – danke!</span></span><span class="lic">↗</span></a>';
  {  // Versionen ganz unten: Android-App (falls vorhanden) und Add-on
    const AMS2 = window.AndroidMediaSession; let v = "";
    try { if (AMS2 && typeof AMS2.getAppVersion === "function") v = AMS2.getAppVersion(); } catch (e) {}
    const av = String((window.PJ || {}).version || "");
    if (AMS2 && typeof AMS2.checkUpdate === "function")
      html += '<a class="row lrow" id="appUpd"><span class="rm"><span class="r1">⬇ Nach App-Update suchen</span>' +
        '<span class="r2">lädt die neue Version direkt in die App (nichts in „Downloads“)</span></span></a>';
    if (AMS2 && typeof AMS2.getAppLog === "function")
      html += '<a class="row lrow" id="appLog"><span class="rm"><span class="r1">🩺 Meldungen der App</span>' +
        '<span class="r2">Abbrüche, Aussetzer und Fehler – verständlich erklärt</span></span><span class="lic">›</span></a>';
    if (v || av) html += '<div class="rshint" style="text-align:center;margin-top:18px">' + [v ? "App " + esc(v) : "", av ? "Add-on " + esc(av) : ""].filter(Boolean).join(" · ") + '</div>';
  }
  html = settingsTabs(html);
  openSheet("settings", html, c => {
    bindSettingsTabs(c);
    loadQs(c); paintHomeOrder(c); loadPodPush(c); loadDsp(c); loadCarPrefs(c); paintHidePlayers(c);
    const upd = c.querySelector("#appUpd");
    if (upd) upd.onclick = () => { try { window.AndroidMediaSession.checkUpdate(); } catch (e) {} };
    const alog = c.querySelector("#appLog"); if (alog) alog.onclick = () => openAppLog(true);
    c.querySelectorAll(".srow.pfr").forEach(b => b.onclick = () => {
      b.classList.toggle("on");
      const ids = [...c.querySelectorAll(".srow.pfr.on")].map(x => x.dataset.u);
      PJ.profiles = ids; S.users = S.allUsers.filter(u => ids.includes(u.user_id));
      setSave({ profiles: ids });
    });
    const php = c.querySelector(".srow.php");
    if (php) php.onclick = () => { const on = !php.classList.contains("on"); php.classList.toggle("on", on);
      try { window.AndroidMediaSession.setPhonePlayer(on); } catch (e) {} toast(on ? "Handy-Player startet" : "Handy-Player aus"); };
    const phs = c.querySelector("#phpSetup");
    if (phs) phs.onclick = () => { try { window.AndroidMediaSession.openPhonePlayerSetup(); } catch (e) {} };
    c.querySelectorAll(".srow:not(.pfr):not(.php):not(.dspon):not(.carPod):not(.hpl)").forEach(b => b.onclick = () => {
      const k = b.dataset.k, on = !b.classList.contains("on");
      b.classList.toggle("on", on);
      if (k === "effects" || k === "skip_votes" || k === "box_sounds" || k === "no_dupes" || k === "keep_music") setSave({ [k]: on });
      else if (k === "plugin") { b.disabled = true; setSave({ plugin: on ? "on" : "off" }); }
      else setSave({ limits: { [k]: on } });
    });
    c.querySelectorAll(".rmlk").forEach(b => b.onclick = () => {
      const r = setData.rooms[+b.dataset.i]; if (!r) return;
      b.disabled = true; setSave({ room_lock: { id: r.id, on: !r.locked } }).then(() => toast(r.name + (r.locked ? ": Sperre aufgehoben" : ": gesperrt")));
    });
    c.querySelectorAll(".rmed").forEach(b => b.onclick = () => openRoom(setData.rooms[+b.dataset.i]));
    const pn = c.querySelector("#pnIn");
    if (pn) {
      const savePn = () => { const v = pn.value.trim(); if (v && v !== (setData.name || "")) { setData.name = v; setFetch({ party_name: v }).then(j => { setData = j; toast("Party-Name gespeichert"); }).catch(e => toast("Nicht gespeichert: " + e.message)); } };
      pn.addEventListener("change", savePn);
      pn.addEventListener("keydown", e => { if (e.key === "Enter") { pn.blur(); } });
    }
    const ra = c.querySelector("#rmAdd"); if (ra) ra.onclick = () => openRoom(null);
    const pinIn = c.querySelector("#pinIn"), pinSave = c.querySelector("#pinSave"), pinDel = c.querySelector("#pinDel");
    const pinPost = (pin) => fetch("party/host/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) })
      .then(r => r.json().then(j => { if (!r.ok || !j.ok) throw new Error(j.error || ("HTTP " + r.status)); return j; }));
    if (pinSave) pinSave.onclick = () => {
      const v = pinIn.value.trim();
      if (!/^\d{4,8}$/.test(v)) { toast("PIN: 4 bis 8 Ziffern"); pinIn.focus(); return; }
      pinSave.disabled = true;
      pinPost(v).then(() => { setData.host_pin = true; toast("🔒 Gastgeber-PIN gespeichert – andere Geräte sind abgemeldet"); renderSettings(); })
        .catch(e => toast("Nicht gespeichert: " + e.message)).finally(() => { pinSave.disabled = false; });
    };
    if (pinIn) pinIn.addEventListener("keydown", e => { if (e.key === "Enter") pinSave.click(); });
    if (pinDel) pinDel.onclick = () => {
      if (pinDel.dataset.ok !== "1") { pinDel.dataset.ok = "1"; pinDel.textContent = "Wirklich entfernen?"; pinDel.classList.add("danger");
        setTimeout(() => { if (pinDel.isConnected) { pinDel.dataset.ok = ""; pinDel.textContent = "PIN entfernen"; pinDel.classList.remove("danger"); } }, 3000); return; }
      pinPost("").then(() => { setData.host_pin = false; toast("Gastgeber-PIN entfernt"); renderSettings(); }).catch(e => toast("Fehler: " + e.message));
    };
    c.querySelectorAll(".rsb").forEach(b => b.onclick = () => {
      const k = b.dataset.r;
      if (b.dataset.ok !== "1") { b.dataset.ok = "1"; const t0 = b.textContent; b.textContent = "Wirklich löschen?"; b.classList.add("danger");
        setTimeout(() => { if (b.isConnected) { b.dataset.ok = ""; b.textContent = t0; b.classList.remove("danger"); } }, 3000); return; }
      setSave({ reset: k }).then(() => toast(k === "drinks" ? "Getränke-Ranking zurückgesetzt" : "Wünsche zurückgesetzt"));
    });
    const inst = c.querySelector("#plInst");
    if (inst) inst.onclick = () => { inst.disabled = true; inst.textContent = "Installiere …"; setSave({ plugin: "install" }); };
    c.querySelectorAll(".seg button").forEach(b => b.onclick = () => {
      c.querySelectorAll(".seg button").forEach(x => x.classList.toggle("on", x === b));
      setData.tv_lite = b.dataset.v; setSave({ tv_lite: b.dataset.v });
    });
    c.querySelectorAll(".nrow:not(.dis) .stp button").forEach(b => b.onclick = () => {
      const row = b.closest(".nrow"), k = row.dataset.k, el = row.querySelector("b");
      if (k === "lyr_offset") {
        const v = Math.max(-8, Math.min(8, Math.round(((typeof setData.lyr_offset === "number" ? setData.lyr_offset : 0.5) + (+b.dataset.d)) * 10) / 10));
        setData.lyr_offset = v; el.textContent = (v > 0 ? "+" : "") + v.toFixed(1);
        later(() => setSave({ lyr_offset: v }), 700, "setlyr");
        return;
      }
      const v = Math.max(k.endsWith("minutes") ? 1 : 0, Math.min(999, (parseInt(el.textContent, 10) || 0) + (+b.dataset.d)));
      el.textContent = v;
      setData.limits[k] = v;
      later(() => setSave({ limits: { [k]: v } }), 700, "set" + k);
    });
  });
}
/* Raum bearbeiten */
let haEnt = null;
async function openRoom(r) {
  const isNew = !r;
  r = Object.assign({ id: "r" + Date.now(), name: "", player: "", sensor: "", lock_entity: "", cond: "", leave_min: 5, lock_min: 60, enabled: true }, r || {});
  if (!haEnt) { try { haEnt = await (await fetch("party/ha/entities", { cache: "no-store" })).json(); } catch (e) { haEnt = { sensors: [], switches: [] }; } }
  const opt = (list, cur, none) => (none ? '<option value="">' + esc(none) + "</option>" : "") +
    list.map(x => '<option value="' + esc(x.id) + '"' + (x.id === cur ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") +
    (cur && !list.some(x => x.id === cur) ? '<option value="' + esc(cur) + '" selected>' + esc(cur) + "</option>" : "");
  const players = playerList().map(p => ({ id: p.player_id, name: pname(p) }));
  const html = '<div class="shh">' + (isNew ? "Raum hinzufügen" : "Raum bearbeiten") + "</div>" +
    '<label class="fl">Name</label><input class="fi" id="rName" maxlength="40" placeholder="z. B. Küche" value="' + esc(r.name) + '">' +
    '<label class="fl">Lautsprecher</label><select class="fi" id="rPl">' + opt(players, r.player, "– wählen –") + "</select>" +
    '<label class="fl">Bewegungsmelder</label><select class="fi" id="rSe">' + opt(haEnt.sensors || [], r.sensor, (haEnt.sensors || []).length ? "– wählen –" : "keine gefunden") + "</select>" +
    numRow("leave_min", "Trennen nach … ohne Bewegung", r.leave_min, "Min.") +
    numRow("lock_min", "Sperre dauert", r.lock_min, "Min.", !!r.lock_entity) +
    '<label class="fl">Sperr-Schalter in Home Assistant <small>(optional, z. B. für Alexa)</small></label><select class="fi" id="rLk">' + opt(haEnt.switches || [], r.lock_entity, "– keiner (Sperre im Add-on) –") + "</select>" +
    '<label class="fl">Nur wenn <small>(optional, z. B. sensor.ladestation=charging)</small></label><input class="fi" id="rCo" placeholder="entity=zustand" value="' + esc(r.cond) + '">' +
    swRow("enabled", "Auto-Beitritt aktiv", "aus = Raum bleibt gespeichert, macht aber nichts", r.enabled !== false) +
    '<button class="act pri" id="rSave">Speichern</button>' + (isNew ? "" : '<button class="act danger" id="rDel">Raum löschen</button>') +
    '<button class="act ghost" id="rBack">Zurück</button>';
  openSheet("room", html, c => {
    c.querySelectorAll(".nrow .stp button").forEach(b => b.onclick = () => {
      const row = b.closest(".nrow"); if (row.classList.contains("dis")) return;
      const k = row.dataset.k, el = row.querySelector("b");
      const step = k === "lock_min" ? 15 : 1, min = k === "lock_min" ? 15 : 0;
      el.textContent = Math.max(min, Math.min(k === "lock_min" ? 1440 : 240, (parseInt(el.textContent, 10) || 0) + (+b.dataset.d) * step));
    });
    c.querySelector('.srow[data-k="enabled"]').onclick = e => e.currentTarget.classList.toggle("on");
    c.querySelector("#rLk").onchange = e => c.querySelector('.nrow[data-k="lock_min"]').classList.toggle("dis", !!e.target.value);
    c.querySelector("#rBack").onclick = () => renderSettings();
    const list = () => (setData.rooms || []).map(x => ({ id: x.id, name: x.name, player: x.player, sensor: x.sensor, lock_entity: x.lock_entity, cond: x.cond,
      leave_min: x.leave_min, lock_min: x.lock_min, enabled: x.enabled }));
    c.querySelector("#rSave").onclick = () => {
      const nr = { id: r.id, name: c.querySelector("#rName").value.trim() || "Raum", player: c.querySelector("#rPl").value, sensor: c.querySelector("#rSe").value,
        lock_entity: c.querySelector("#rLk").value, cond: c.querySelector("#rCo").value.trim(),
        leave_min: parseInt(c.querySelector('.nrow[data-k="leave_min"] b').textContent, 10) || 0,
        lock_min: parseInt(c.querySelector('.nrow[data-k="lock_min"] b').textContent, 10) || 60,
        enabled: c.querySelector('.srow[data-k="enabled"]').classList.contains("on") };
      if (!nr.player || !nr.sensor) { toast("Lautsprecher und Bewegungsmelder wählen"); return; }
      const l = list(), i = l.findIndex(x => x.id === nr.id);
      if (i >= 0) l[i] = nr; else l.push(nr);
      sheetKind = "settings"; setSave({ rooms: l });
    };
    const del = c.querySelector("#rDel");
    if (del) del.onclick = () => { sheetKind = "settings"; setSave({ rooms: list().filter(x => x.id !== r.id) }); };
  });
}
async function setSave(body) {
  try { setData = await setFetch(body); toast("Gespeichert"); }
  catch (e) { toast("Nicht gespeichert: " + e.message); try { setData = await setFetch(); } catch (x) {} }
  if (sheetKind === "settings") renderSettings();
}
$("#setBtn").onclick = async () => {
  try { setData = await setFetch(); } catch (e) { setData = null; toast("Einstellungen nicht erreichbar"); return; }
  renderSettings();
};

/* ---------- Suche ---------- */
const TYPES = { all: ["track", "artist", "album", "playlist"], track: ["track"], artist: ["artist"], album: ["album"], playlist: ["playlist"],
  radio: ["radio"], podcast: ["podcast"], audiobook: ["audiobook"] };
const LABEL = { track: "Titel", artist: "Künstler", album: "Alben", playlist: "Playlists", radio: "Radio", podcast: "Podcasts", audiobook: "Hörbücher" };
const RKEY = { track: "tracks", artist: "artists", album: "albums", playlist: "playlists", radio: "radio", podcast: "podcasts", audiobook: "audiobooks" };
/* Direkt abspielbar (Antippen = Abspiel-Menü); alles andere wird geöffnet */
const PLAYABLE = ["track", "radio", "audiobook", "podcast_episode"];
const dateOf = it => { const d = it && it.metadata && it.metadata.release_date; return d ? new Date(d) : null; };
/* Anbieter liefern manchmal "&amp;" statt "&" */
const unent = t => String(t == null ? "" : t).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/*
 * Quelle anzeigen (Tidal, Spotify [Konto], TuneIn, Radio Browser …): Namen der Anbieter einmal von MA holen.
 * Bibliotheks-Einträge zeigen, bei welchen Anbietern sie liegen.
 */
S.provName = {};
function loadProviders() {
  cmd("providers", {}, 15000).then(l => {
    (l || []).forEach(p => { const id = p.instance_id || p.lookup_key; if (id) S.provName[id] = p.name || p.domain || id; });
    if (S.favMode && !(S.nav && S.nav.length)) paintFav();
  }).catch(() => {});
}
function provOf(it) {
  if (!it) return "";
  const ids = it.provider && it.provider !== "library" ? [it.provider]
    : (it.provider_mappings || []).map(m => m && (m.provider_instance || m.provider_domain)).filter(Boolean);
  const names = [...new Set(ids.map(id => S.provName[id] || (/^[a-z_]+$/.test(id) ? id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "")).filter(Boolean))];
  return names.slice(0, 2).join(" + ");
}
function subOf(it) {
  const base = subBase(it), pv = provOf(it);
  return pv && !base.includes(pv) ? (base ? base + " · " + pv : pv) : base;
}
function subBase(it) {
  const t = it.media_type;
  if (t === "track") return [artistsOf(it), it.album && it.album.name].filter(Boolean).join(" · ");
  if (t === "album") return [artistsOf(it), it.year].filter(Boolean).join(" · ") || "Album";
  if (t === "artist") return "Künstler";
  if (t === "playlist") return it.owner ? "Playlist · " + it.owner : "Playlist";
  if (t === "radio") return "Radiosender";
  if (t === "podcast") return ["Podcast", unent(it.publisher)].filter(Boolean).join(" · ");
  if (t === "audiobook") return ["Hörbuch", (it.authors || []).join(", ")].filter(Boolean).join(" · ");
  if (t === "podcast_episode") { const d = dateOf(it);
    return [d && !isNaN(d) ? d.toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" }) : "", it.duration ? fmt(it.duration) : "",
      it.fully_played ? "gehört" : ""].filter(Boolean).join(" · "); }
  return "";
}
async function doSearch() {
  navReset();
  const term = $("#q").value.trim(), box = $("#sRes");
  $("#qClr").hidden = !term;
  const seq = ++S.sSeq;
  if (term.length < 2) { S.sRes = null; renderHome(); return; }
  if (!S.ready) { box.innerHTML = '<div class="empty">Keine Verbindung zu Music Assistant</div>'; return; }
  box.innerHTML = '<div class="spin"></div>';
  try {
    // Quellen des Profils + Bibliothek: was schon in der Bibliothek liegt, liefert MA nur als Bibliotheks-Eintrag
    const pv = profProv("providers"); if (pv.providers) pv.providers = pv.providers.concat("library");
    const r = await cmdP("music/search", Object.assign({ search_query: term, media_types: TYPES[S.filter], limit: S.filter === "all" ? 10 : 40 }, pv), 25000);
    if (seq !== S.sSeq) return;
    S.sRes = r || {}; renderResults();
  } catch (e) {
    if (seq !== S.sSeq) return;
    box.innerHTML = '<div class="empty">Suche fehlgeschlagen: ' + esc(errText(e)) + "</div>";
  }
}
function renderResults() {
  if (S.nav && S.nav.length) { renderNav(); return; }
  if (S.favMode) { renderFav(); return; }
  const r = S.sRes, box = $("#sRes"); S.sItems = [];
  if (!r) { renderHome(); return; }
  const all = S.filter === "all";
  let html = "";
  TYPES[S.filter].forEach(k => {
    const arr = (r[RKEY[k]] || []).filter(x => x && x.uri);
    if (!arr.length) return;
    const max = all ? (k === "track" ? 6 : 4) : arr.length;
    html += '<div class="sec"><div class="sech"><span>' + LABEL[k] + "</span>" +
      (all && arr.length > max ? '<button class="more" data-f="' + k + '">Alle anzeigen</button>' : "") + "</div>";
    arr.slice(0, max).forEach(it => {
      const i = S.sItems.push(it) - 1;
      html += '<button class="row" data-i="' + i + '">' + thumb(imgUrl(it, 120), it.media_type === "artist" ? "round" : "") +
        '<span class="rm"><span class="r1">' + favMark(it) + esc(it.name) + '</span><span class="r2">' + esc(subOf(it)) + '</span></span><span class="go">' + ICON.dots + "</span></button>";
    });
    html += "</div>";
  });
  box.innerHTML = html || '<div class="empty">Nichts gefunden</div>';
}
function setFilter(f) {
  S.filter = f;
  document.querySelectorAll("#chips .chip").forEach(c => c.classList.toggle("on", c.dataset.f === f));
  doSearch();
  $("#v-search").scrollTop = 0;
}
$("#q").addEventListener("input", () => later(doSearch, 800, "search"));
$("#q").addEventListener("keydown", e => { if (e.key === "Enter") { clearTimeout(timers.search); doSearch(); $("#q").blur(); } });
$("#qClr").onclick = () => { $("#q").value = ""; doSearch(); $("#q").focus(); };
/*
 * Lernkarte: Sprachsuche (🎤 rechts im Suchfeld)
 * In der App: Android-Spracherkennung (Google) über die Brücke, das Ergebnis kommt per window.voiceResult zurück.
 * Im Browser (Chrome, Safari): eingebaute Web-Spracherkennung. Gibt es keins von beiden, bleibt der Knopf weg.
 */
(function () {
  const A = window.AndroidMediaSession, SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const app = !!(A && A.voiceSearch), b = $("#qMic");
  if (!b || (!app && !SR)) return;
  b.hidden = false; b.parentNode.classList.add("hasMic");
  b.onclick = () => {
    b.classList.add("on");
    if (app) { try { A.voiceSearch(); } catch (e) { b.classList.remove("on"); } return; }
    const r = new SR(); r.lang = "de-DE"; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = e => voiceResult(e.results[0][0].transcript);
    r.onerror = e => toast("🎤 " + (e.error === "not-allowed" ? "Mikrofon nicht erlaubt" : "Nichts verstanden"));
    r.onend = () => b.classList.remove("on");
    try { r.start(); } catch (e) { b.classList.remove("on"); }
  };
})();
function voiceResult(t) {
  $("#qMic").classList.remove("on");
  t = String(t || "").trim(); if (!t) return;
  $("#q").value = t; clearTimeout(timers.search); doSearch();
}
window.voiceResult = voiceResult;
$("#chips").onclick = e => { const c = e.target.closest(".chip"); if (c) setFilter(c.dataset.f); };
$("#sRes").onclick = e => {
  if (e.target.closest(".bback")) { history.back(); return; }
  if (e.target.closest(".bfav")) { const n = S.nav[S.nav.length - 1]; if (n) toggleFav(n.it); return; }
  const tch = e.target.closest(".ptarget .chip"); if (tch) { pickTarget(tch); return; }
  const ba = e.target.closest(".bact"); if (ba) { const n = S.nav[S.nav.length - 1]; if (n) enqueue(n.it, ba.dataset.o); return; }
  const tg = e.target.closest(".bmore"); if (tg) { const n = S.nav[S.nav.length - 1]; if (n) { n.all = !n.all; renderNav(); } return; }
  const more = e.target.closest(".more"); if (more) { setFilter(more.dataset.f); return; }
  const row = e.target.closest(".row"); if (!row) return;
  const it = S.sItems[+row.dataset.i]; if (!it) return;
  /* Künstler/Album/Playlist antippen = öffnen, ⋯ = Abspiel-Menü; Titel = Abspiel-Menü */
  if (PLAYABLE.includes(it.media_type) || e.target.closest(".go")) openItem(it); else navPush(it);
};

/* ---------- Favoriten ----------
   Reiter „Favoriten“: alle Favoriten aus Music Assistant, nach Art sortiert.
   Lange drücken (0,6 s) auf ein Cover in der Suche / auf das große Cover einer Playlist, eines Albums …
   = als Favorit speichern bzw. entfernen (♥ vor dem Namen). */
const FAVCATS = [["playlist", "Playlists"], ["album", "Alben"], ["artist", "Künstler"], ["track", "Titel"],
  ["podcast", "Podcasts"], ["audiobook", "Hörbücher"], ["radio", "Radio"]];
const favLocal = {};   // gerade umgeschaltet (bis MA es meldet)
/* Favoriten pro Person: das Add-on merkt sich, wer was markiert hat (Music Assistant kennt nur „für alle“) */
const favUid = () => (prof() || {}).user_id || S.me || "default";
/* alle Adressen eines Eintrags (eigene URI + je Anbieter) – so passt Bibliothek ↔ Spotify, gleichnamige Podcasts aber nicht */
const favKeys = it => {
  const ks = [it.uri];
  (it.provider_mappings || []).forEach(m => { if (m && m.provider_instance && m.item_id != null) ks.push(m.provider_instance + "://" + it.media_type + "/" + m.item_id); });
  return ks.filter(Boolean);
};
const favSet = items => { const set = new Set(); items.forEach(x => favKeys(x).forEach(k => set.add(k))); return set; };
const favHas = (set, it) => favKeys(it).some(k => set.has(k));
function favSlim(it) {   // nur was zum Anzeigen und Öffnen nötig ist
  const o = { uri: it.uri, media_type: it.media_type, name: unent(it.name), item_id: it.item_id, provider: it.provider, favorite: true };
  const im = pickImg(it); if (im) o.image = typeof im === "string" ? im : { path: im.path, provider: im.provider, remotely_accessible: im.remotely_accessible, proxy_id: im.proxy_id, type: im.type };
  if (it.artists) o.artists = (it.artists || []).map(a => ({ name: a && a.name })).slice(0, 4);
  ["owner", "publisher", "year", "artist_str"].forEach(k => { if (it[k]) o[k] = it[k]; });
  if (it.authors) o.authors = it.authors.slice(0, 4);
  if (it.album && it.album.name) o.album = { name: it.album.name };
  if (it.provider_mappings) o.provider_mappings = it.provider_mappings.map(m => ({ provider_instance: m.provider_instance, item_id: m.item_id })).slice(0, 6);
  return o;
}
async function loadMyFavs() {
  const uid = favUid();
  if (S.myFavLoading && S.myFavLoading.uid === uid) return S.myFavLoading.p;
  const p = loadMyFavs2(uid); S.myFavLoading = { uid, p };
  try { return await p; } finally { if (S.myFavLoading && S.myFavLoading.p === p) S.myFavLoading = null; }
}
async function loadMyFavs2(uid) {
  let j = null;
  try { const r = await fetch("party/favs?user=" + encodeURIComponent(uid), { cache: "no-store" }); if (r.ok) j = await r.json(); } catch (e) {}
  if (!j) return null;
  let items = j.items || [];
  if (!j.known) {
    // erstes Mal: mit den bisherigen Favoriten aus den Musikquellen dieser Person befüllen
    const pv = profProv("provider");
    const res = await Promise.all(FAVCATS.map(([t]) =>
      cmdP("music/" + (t === "radio" ? "radios" : t + "s") + "/library_items", Object.assign({ favorite: true, limit: 500, order_by: "sort_name" }, pv), 25000).catch(() => [])));
    items = [].concat(...res).filter(x => x && x.uri).map(favSlim);
    fetch("party/favs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: uid, items }) }).catch(() => {});
  }
  S.myFav = { uid, items, keys: favSet(items), prefs: j.prefs || {} };
  return S.myFav;
}
function isFavIt(it) {
  if (!it) return false;
  if (favLocal[it.uri] != null) return favLocal[it.uri];
  return S.myFav && S.myFav.uid === favUid() ? favHas(S.myFav.keys, it) : !!it.favorite;
}
function favMark(it) { return isFavIt(it) ? '<span class="favh">♥</span> ' : ""; }
let favSeq = 0;
/*
 * Startseite: Zuletzt gespielt · Favoriten (Kacheln) · Empfehlungen · Meine Playlists · Neue Podcast-Folgen.
 * Alles wird parallel geladen; was schon da ist, wird sofort gezeigt (S.home), der Rest füllt sich nach.
 */
const REC_DE = { "custom mixes": "Deine Mixe", "new tracks": "Neue Titel", "new albums": "Neue Alben", "radio stations for you": "Radio für dich",
  "the hits": "Die Hits", "recent albums": "Zuletzt gehörte Alben", "top tracks": "Top-Titel", "featured playlists": "Empfohlene Playlists",
  "new german playlists": "Neue deutsche Playlists", "made for you": "Für dich gemacht" };
const recName = n => REC_DE[(n || "").toLowerCase()] || (/^because you listened to /i.test(n || "") ? "Weil du " + n.substring(24).trim() + " gehört hast" : n);
const OKTYPES = ["track", "album", "artist", "playlist", "radio", "podcast", "audiobook", "podcast_episode"];
async function renderFav() {
  const box = $("#sRes"); if (!box || !S.favMode || (S.nav && S.nav.length)) return;
  const seq = ++favSeq;
  if (!S.ready) { box.innerHTML = '<div class="empty">Keine Verbindung zu Music Assistant</div>'; return; }
  S.home = S.home || {};
  if (!S.favData) box.innerHTML = '<div class="spin"></div>'; else paintFav();
  const done = () => { if (seq === favSeq) paintFav(); };
  const pv = profProv("provider");
  loadRecent();   // „Zuletzt gespielt“ immer frisch (kommt aus der MA-Datenbank, belastet Spotify nicht)
  /* Nicht bei jedem Antippen von „Start“ alles neu holen – schont Spotify (sonst bremst Spotify alle Anfragen aus) */
  const age = Date.now() - (S.home.at || 0);
  if (S.favData && age < 10 * 60e3) return;
  S.home.at = Date.now();
  // Favoriten (pro Person)
  loadMyFavs().then(f => {
    S.favData = {}; FAVCATS.forEach(([t]) => { S.favData[t] = []; });
    ((f && f.items) || []).forEach(x => { if (S.favData[x.media_type]) S.favData[x.media_type].push(x); });
    FAVCATS.forEach(([t]) => S.favData[t].sort((a, b) => (a.name || "").localeCompare(b.name || "", "de")));
    done(); loadPods();
  });
  // Zuletzt gespielt
  // Meine Playlists
  cmdP("music/playlists/library_items", Object.assign({ limit: 40, order_by: "sort_name" }, pv), 20000)
    .then(r => { S.home.pl = (r || []).filter(x => x && x.uri); done(); }).catch(() => {});
  // Empfehlungen (max. 4 Reihen)
  // Empfehlungen im Namen der gewählten Person (ihr Hörverhalten) und nur aus ihren Musikquellen
  cmdP("music/recommendations", {}, 30000).then(async rows => {
    const mine = pv.provider || null;
    const want = (rows || []).filter(f => f && !/^(recommendations|musicbrainz|tunein)/.test(f.provider || "") && f.enabled_by_default !== false &&
      (!mine || mine.includes(f.provider))).slice(0, 4);
    const out = await Promise.all(want.map(f => (f.items && f.items.length ? Promise.resolve(f.items) :
      cmdP("music/recommendations/items", { provider: f.provider, item_id: f.item_id }, 40000).catch(() => []))
      .then(it => ({ name: recName(f.name), items: (it || []).filter(x => x && x.uri && OKTYPES.includes(x.media_type)).slice(0, 20) }))));
    S.home.rec = out.filter(r => r.items.length); done();
  }).catch(() => {});
  // Neue Podcast-Folgen (Favoriten-Podcasts, letzte 7 Tage)
}
/* Neue Folgen der Podcasts, die DIESE Person als Favorit hat (letzte 7 Tage). Neu laden, wenn sich die Podcast-Favoriten ändern, sonst alle 30 Min. */
function loadPods(force) {
  const pods = ((S.myFav && S.myFav.items) || []).filter(x => x.media_type === "podcast").slice(0, 12);
  const sig = pods.map(p => p.uri).join("|");
  if (!force && sig === S.home.podsSig && Date.now() - (S.home.podsAt || 0) < 30 * 60e3) return;
  S.home.podsSig = sig; S.home.podsAt = Date.now();
  if (!pods.length) { S.home.pods = []; return; }
  // Folgenlisten belasten Spotify (Drosselung!) → 2 Stunden auf dem Gerät merken, auch über einen App-Neustart
  const pk = "jb_pods_" + favUid();
  if (!force) try { const c = JSON.parse(localStorage.getItem(pk) || "null"); if (c && c.sig === sig && Date.now() - c.t < 2 * 3600e3) { S.home.pods = c.l; loadPodRec(pods); return; } } catch (e) {}
  const week = Date.now() - 7 * 864e5;
  Promise.all(pods.map(p => cmd("music/podcasts/podcast_episodes",
    { item_id: String(p.item_id), provider_instance_id_or_domain: p.provider || "library" }, 30000).then(ep => (ep || []).slice(0, 10)).catch(() => [])))
    .then(lists => {
      // schon gehörte Folgen gehören nicht zu „neu“
      const all = [].concat(...lists).filter(x => x && x.uri && !x.fully_played).sort((x, y) => (dateOf(y) || 0) - (dateOf(x) || 0));
      const fresh = all.filter(x => (dateOf(x) || 0) >= week);
      // keine Folge aus den letzten 7 Tagen: dann die neueste Folge je Podcast
      const seen = new Set();
      S.home.pods = (fresh.length ? fresh : all.filter(x => { const k = (x.podcast && x.podcast.name) || ""; return !seen.has(k) && seen.add(k); })).slice(0, 20);
      if (S.home.pods.length) try { localStorage.setItem(pk, JSON.stringify({ sig, t: Date.now(), l: S.home.pods })); } catch (e) {}
      if (S.favMode && !S.favCat && !(S.nav && S.nav.length)) paintFav();
    });
  loadPodRec(pods);
}
/* Podcast-Empfehlungen: Podcasts derselben Macher/ähnlicher Namen wie die eigenen Lieblinge (ohne die, die man schon hat) */
function loadPodRec(pods) {
  if (!pods.length) { S.home.podrec = []; return; }
  // Suchen belasten Spotify (Drosselung!) → Ergebnis 12 Stunden auf dem Gerät merken
  const ck = "jb_podrec_" + favUid() + "_" + pods.map(p => p.uri).join("|").length;
  try { const c = JSON.parse(localStorage.getItem(ck) || "null"); if (c && Date.now() - c.t < 12 * 3600e3) { S.home.podrec = c.l; return; } } catch (e) {}
  const have = new Set(pods.map(p => unent(p.name).toLowerCase()));
  const terms = [...new Set(pods.slice(0, 4).map(p => unent(p.publisher || p.name)).filter(Boolean))];
  const pv = profProv("providers");
  Promise.all(terms.map(t => cmdP("music/search", Object.assign({ search_query: t, media_types: ["podcast"], limit: 10 }, pv), 25000)
    .then(r => (r && r.podcasts) || []).catch(() => []))).then(lists => {
    const seen = new Set();
    S.home.podrec = [].concat(...lists).filter(x => {
      const k = unent(x && x.name).toLowerCase(); if (!x || !x.uri || !k || have.has(k) || seen.has(k)) return false; seen.add(k); return true;
    }).slice(0, 20);
    try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), l: S.home.podrec })); } catch (e) {}
    if (S.favMode && !S.favCat && !(S.nav && S.nav.length)) paintFav();
  });
}
/* Zuletzt gespielt: nur was DIESE Person gestartet hat (Playlist/Album statt jedes einzelnen Titels) */
function loadRecent() {
  const pv = profProv("provider"), uid = (prof() || {}).user_id || S.me;
  const rp = Object.assign({ limit: 30, user_initiated_only: true, fully_played_only: false, always_include_media_types: ["podcast", "podcast_episode", "audiobook"] },
    uid ? { userid: uid } : {}, pv.provider ? { providers: pv.provider } : {});
  cmd("music/recently_played_items", rp, 20000).catch(() => cmdP("music/recently_played_items", { limit: 20 }, 20000))
    .then(r => { const seen = new Set(), old = (S.home.recent || []).map(x => x.uri).join();
      S.home.recent = (r || []).filter(x => x && x.uri && !seen.has(x.uri) && seen.add(x.uri)).slice(0, 20);
      if (S.home.recent.map(x => x.uri).join() !== old && S.favMode && !(S.nav && S.nav.length)) paintFav(); }).catch(() => {});
}
/* Startseite offen: jede Minute nachsehen, ob etwas Neues gespielt wurde */
setInterval(() => { if (S.favMode && !S.favCat && !(S.nav && S.nav.length) && !document.hidden && S.ready && S.home) loadRecent(); }, 60000);
/*
 * Reihenfolge der Startseite pro Person (Einstellungen → Startseite): ▲▼ verschieben, Schalter = ein/aus.
 * Ohne eigene Wahl: Podcast-Folgen oben, wenn jemand mind. 3 Lieblings-Podcasts hat.
 */
const HOME_SECS = [["recent", "Zuletzt gespielt"], ["fav", "Favoriten"], ["rec", "Empfehlungen"], ["pl", "Meine Playlists"], ["pods", "Neue Podcast-Folgen"], ["podrec", "Podcasts für dich"]];
function homeOrder() {
  const pr = (S.myFav && S.myFav.prefs) || {}, ids = HOME_SECS.map(x => x[0]);
  let order = Array.isArray(pr.order) ? pr.order.filter(x => ids.includes(x)) : null;
  if (!order) {
    order = ids.slice();
    const podTop = pr.podtop != null ? !!pr.podtop : ((S.favData || {}).podcast || []).length >= 3;
    if (podTop) order = ["pods", "podrec"].concat(order.filter(x => x !== "pods" && x !== "podrec"));
  }
  ids.forEach(x => { if (!order.includes(x)) order.push(x); });
  return { order, hidden: Array.isArray(pr.hidden) ? pr.hidden : [] };
}
function saveHomePrefs(p) {
  if (S.myFav) S.myFav.prefs = Object.assign(S.myFav.prefs || {}, p);
  fetch("party/favs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: favUid(), prefs: p }) }).catch(() => {});
  if (S.favMode && !S.favCat && !(S.nav && S.nav.length)) paintFav();
}
/* Lautsprecher ein-/ausblenden (pro Profil gespeichert) */
async function paintHidePlayers(c) {
  const box = c.querySelector("#hpBox"); if (!box) return;
  if (!S.myFav || S.myFav.uid !== favUid()) { box.innerHTML = '<div class="rshint">lädt …</div>'; await loadMyFavs(); }
  const hid = hiddenPlayers();
  const all = Object.values(S.players).filter(p => usable(p, true)).sort((a, b) => pname(a).localeCompare(pname(b), "de"));
  box.innerHTML = all.map(p => '<button class="row srow hpl' + (hid.includes(p.player_id) ? "" : " on") + '" data-id="' + esc(p.player_id) + '">' +
    '<span class="rm"><span class="r1">' + esc(pname(p)) + '</span></span><span class="gsw"><i></i></span></button>').join("") ||
    '<div class="rshint">keine Lautsprecher</div>';
  box.querySelectorAll(".hpl").forEach(b => b.onclick = () => {
    const on = !b.classList.contains("on"), id = b.dataset.id;
    b.classList.toggle("on", on);
    const h = hiddenPlayers().filter(x => x !== id); if (!on) h.push(id);
    saveHomePrefs({ hidePlayers: h });
    toast(pname(S.players[id]) + (on ? " wird angezeigt" : " ausgeblendet"));
  });
}
async function paintHomeOrder(c) {
  const box = c.querySelector("#hoBox"); if (!box) return;
  if (!S.myFav || S.myFav.uid !== favUid()) { box.innerHTML = '<div class="rshint">lädt …</div>'; await loadMyFavs(); }
  const { order, hidden } = homeOrder(), name = id => (HOME_SECS.find(x => x[0] === id) || [, id])[1];
  box.innerHTML = order.map((id, i) => '<div class="hord' + (hidden.includes(id) ? "" : " on") + '" data-id="' + id + '"><span class="r1">' + name(id) + "</span>" +
    '<button class="ho-up" aria-label="nach oben"' + (i ? "" : " disabled") + ">▲</button>" +
    '<button class="ho-dn" aria-label="nach unten"' + (i < order.length - 1 ? "" : " disabled") + ">▼</button>" +
    '<button class="ho-sw gsw" aria-label="ein/aus"><i></i></button></div>').join("") +
    '<div class="rshint">Gilt für die gewählte Person. Oben = zuerst.</div>';
  box.querySelectorAll(".hord").forEach(r => {
    const id = r.dataset.id;
    r.querySelector(".ho-up").onclick = () => { const o = order.slice(), i = o.indexOf(id); if (i > 0) { [o[i - 1], o[i]] = [o[i], o[i - 1]]; saveHomePrefs({ order: o }); paintHomeOrder(c); } };
    r.querySelector(".ho-dn").onclick = () => { const o = order.slice(), i = o.indexOf(id); if (i < o.length - 1) { [o[i + 1], o[i]] = [o[i], o[i + 1]]; saveHomePrefs({ order: o }); paintHomeOrder(c); } };
    r.querySelector(".ho-sw").onclick = () => { const h = hidden.includes(id) ? hidden.filter(x => x !== id) : hidden.concat(id); saveHomePrefs({ hidden: h, order }); paintHomeOrder(c); };
  });
}
/*
 * Einstellungen → Push bei neuen Podcast-Folgen (pro Person):
 * Sobald Android Auto / CarPlay aktiv wird, prüft das Add-on einmal die ♥-Podcasts dieser Person
 * und schickt bei einer neuen, ungehörten Folge eine Benachrichtigung (Cover + „Jetzt abspielen“).
 */
/*
 * Klang (DSP von Music Assistant) für den gerade gewählten Lautsprecher:
 * Bass / Mitten / Höhen und Balance. Andere Filter, die in MA eingestellt sind (z. B. Equalizer), bleiben erhalten.
 */
async function loadDsp(c) {
  const box = c.querySelector("#dspBox"); if (!box) return;
  const pid = S.pid;
  if (!pid) { box.innerHTML = '<div class="rshint">Erst oben einen Lautsprecher wählen</div>'; return; }
  let cfg, presets = [];
  try {
    [cfg, presets] = await Promise.all([cmd("config/players/dsp/get", { player_id: pid }), cmd("config/dsp_presets/get").catch(() => [])]);
  } catch (e) { box.innerHTML = '<div class="rshint">Klang nicht verfügbar: ' + esc(errText(e)) + "</div>"; return; }
  cfg = Object.assign({ enabled: false, input_gain: 0, output_gain: 0, filters: [] }, cfg || {});
  cfg.filters = cfg.filters || [];
  const flt = (type, def) => { let f = cfg.filters.find(x => x.type === type); if (!f && def) { f = Object.assign({ type, enabled: true }, def); cfg.filters.push(f); } return f; };
  const tone = flt("tone_control") || {}, bal = flt("balance") || {};
  const other = cfg.filters.filter(x => x.type !== "tone_control" && x.type !== "balance").length;
  const sl = (k, label, v, min, max, step, unit) =>
    '<div class="dsl"><span class="r1">' + label + '</span><input type="range" data-k="' + k + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + (+v || 0) + '">' +
    '<b data-v="' + k + '"></b></div>';
  box.innerHTML =
    '<button class="row srow dspon' + (cfg.enabled ? " on" : "") + '"><span class="rm"><span class="r1">Klangregelung</span><span class="r2">' +
      (cfg.enabled ? "an" : "aus – Lautsprecher spielt unverändert") + '</span></span><span class="gsw"><i></i></span></button>' +
    (presets && presets.length ? '<div class="dpre">' + presets.map(pr => '<button class="chip' + (cfg.preset_id === pr.preset_id ? " on" : "") + '" data-p="' + esc(pr.preset_id) + '">' + esc(pr.name) + "</button>").join("") + "</div>" : "") +
    sl("bass_level", "Bass", tone.bass_level, -12, 12, 1) + sl("mid_level", "Mitten", tone.mid_level, -12, 12, 1) +
    sl("treble_level", "Höhen", tone.treble_level, -12, 12, 1) + sl("balance", "Balance", bal.balance, -100, 100, 5) +
    '<button class="act rsb2" id="dspReset">Zurücksetzen</button>' +
    '<div class="rshint">Gilt für diesen Lautsprecher in Music Assistant' + (other ? " · " + other + " weitere Filter aus MA bleiben erhalten" : "") + ".</div>";
  const label = (k, v) => k === "balance" ? (v == 0 ? "Mitte" : (v < 0 ? "L " + -v : "R " + v)) : (v > 0 ? "+" : "") + v + " dB";
  const paint = () => box.querySelectorAll("input[type=range]").forEach(i => { box.querySelector('[data-v="' + i.dataset.k + '"]').textContent = label(i.dataset.k, +i.value); });
  paint();
  let t = 0;
  const save = () => { clearTimeout(t); t = setTimeout(() => {
    cmd("config/players/dsp/save", { player_id: pid, config: cfg }).then(n => { if (n) cfg.preset_id = n.preset_id; }).catch(e => toast("Klang nicht gespeichert: " + errText(e)));
  }, 400); };
  const on = box.querySelector(".dspon");
  const setOn = v => { cfg.enabled = v; on.classList.toggle("on", v); on.querySelector(".r2").textContent = v ? "an" : "aus – Lautsprecher spielt unverändert"; };
  on.onclick = () => { setOn(!cfg.enabled); save(); };
  box.querySelectorAll("input[type=range]").forEach(i => i.oninput = () => {
    const k = i.dataset.k, v = +i.value;
    if (k === "balance") flt("balance", { balance: 0 }).balance = v;
    else flt("tone_control", { bass_level: 0, mid_level: 0, treble_level: 0 })[k] = v;
    if (!cfg.enabled) setOn(true);   // Regler bewegt → Klangregelung einschalten
    box.querySelectorAll(".dpre .chip").forEach(b => b.classList.remove("on"));
    paint(); save();
  });
  box.querySelector("#dspReset").onclick = () => {
    cfg.filters = cfg.filters.filter(x => x.type !== "tone_control" && x.type !== "balance");
    box.querySelectorAll("input[type=range]").forEach(i => { i.value = 0; });
    paint(); save(); toast("Klang zurückgesetzt");
  };
  box.querySelectorAll(".dpre .chip").forEach(b => b.onclick = () => {
    cmd("config/players/dsp/apply_preset", { player_id: pid, preset_id: b.dataset.p }).then(() => { toast("Voreinstellung " + b.textContent); loadDsp(c); })
      .catch(e => toast("Nicht möglich: " + errText(e)));
  });
}
/* Handy im Auto: wer bin ich (für "Ist noch jemand zuhause?"), Podcast-Vorschlag, Adressen der App */
async function loadCarPrefs(c) {
  const box = c.querySelector("#carBox"), A = window.AndroidMediaSession; if (!box || !A) return;
  let cp = {}; try { cp = JSON.parse(A.getCarPrefs()); } catch (e) {}
  let persons = [];
  try { const r = await fetch("party/presence", { cache: "no-store" }); if (r.ok) persons = (await r.json()).persons || []; } catch (e) {}
  const opts = '<option value="">– nicht festgelegt –</option>' + persons.map(p =>
    '<option value="' + esc(p.id) + '"' + (p.id === cp.me ? " selected" : "") + ">" + esc(p.name || p.id) + "</option>").join("");
  box.innerHTML =
    '<label class="fl">Ich bin <small>(beim Aussteigen läuft die Musik zuhause weiter, wenn noch jemand anderes da ist)</small></label>' +
    '<select class="fi" id="carMe">' + opts + "</select>" +
    '<button class="row srow carPod' + (cp.podSuggest ? " on" : "") + '" style="margin-top:8px"><span class="rm"><span class="r1">Neue Podcast-Folge vorschlagen</span>' +
    '<span class="r2">im Auto, wenn gerade nichts läuft</span></span><span class="gsw"><i></i></span></button>' +
    (cp.rtc !== undefined ? '<button class="row srow carRtc' + (cp.rtc ? " on" : "") + '" style="margin-top:8px"><span class="rm"><span class="r1">Unterwegs per WebRTC verbinden</span>' +
    '<span class="r2">aus = über Nabu Casa (stabiler beim Wechsel WLAN ↔ Mobilfunk)</span></span><span class="gsw"><i></i></span></button>' : "") +
    '<button class="row lrow" id="carSetup"><span class="rm"><span class="r1">Adressen der App</span><span class="r2">zuhause / unterwegs / Token</span></span><span class="lic">›</span></button>';
  const save = o => { try { A.setCarPrefs(JSON.stringify(o)); toast("Gespeichert"); } catch (e) {} };
  box.querySelector("#carMe").onchange = e => save({ me: e.target.value });
  const pod = box.querySelector(".carPod");
  pod.onclick = () => { const on = !pod.classList.contains("on"); pod.classList.toggle("on", on); save({ podSuggest: on }); };
  const rtc = box.querySelector(".carRtc");
  if (rtc) rtc.onclick = () => { const on = !rtc.classList.contains("on"); rtc.classList.toggle("on", on); save({ rtc: on }); };
  box.querySelector("#carSetup").onclick = () => { try { A.openSetup(); } catch (e) {} };
}

async function loadPodPush(c) {
  const box = c.querySelector("#ppBox"); if (!box) return;
  let d = null;
  try { const r = await fetch("party/podpush?user=" + encodeURIComponent(favUid()), { cache: "no-store" }); if (r.ok) d = await r.json(); } catch (e) {}
  if (!d) { box.innerHTML = '<div class="rshint">Nur mit Home Assistant (Add-on) möglich</div>'; return; }
  const cfg = d.cfg || {};
  const opt = (list, cur, empty) => '<option value="">' + empty + "</option>" + list.map(x => {
    const v = typeof x === "string" ? x : x.id, n = typeof x === "string" ? x.replace("notify.mobile_app_", "") : x.name;
    return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("");
  const players = playerList().map(p => ({ id: p.player_id, name: pname(p) }));
  box.innerHTML =
    '<label class="fl">Benachrichtigung an</label><select class="fi" id="ppN">' + opt(d.notify || [], cfg.notify || "", "– aus –") + "</select>" +
    '<label class="fl">Auslöser <small>(Android Auto / CarPlay / Bluetooth des Handys)</small></label><select class="fi" id="ppE">' +
      opt(d.entities || [], cfg.entity || "", "– wählen –") + "</select>" +
    '<label class="fl">Suchtext <small>(nur bei Bluetooth/Audio-Ausgabe, z. B. „Ford Kuga“ oder „CarPlay“)</small></label>' +
      '<input class="fi" id="ppM" maxlength="80" placeholder="leer = Sensor ist „an“" value="' + esc(cfg.match || "") + '">' +
    '<label class="fl">„Jetzt abspielen“ auf</label><select class="fi" id="ppP">' + opt(players, cfg.player || "", "– kein Knopf –") + "</select>" +
    '<button class="act" id="ppT" style="margin-top:10px">Jetzt prüfen (neueste Folge testweise pushen)</button>' +
    '<div class="rshint">Geprüft wird beim Einsteigen (Auslöser wird aktiv) und während der Fahrt jede Stunde. Gepusht werden neue, noch nicht gehörte Folgen der ♥-Podcasts (letzte 7 Tage), jede nur einmal.</div>';
  const save = () => fetch("party/podpush", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: favUid(), cfg: { notify: box.querySelector("#ppN").value, entity: box.querySelector("#ppE").value,
      match: box.querySelector("#ppM").value.trim(), player: box.querySelector("#ppP").value } }) })
    .then(() => toast("Podcast-Push gespeichert")).catch(e => toast("Fehler: " + errText(e)));
  ["#ppN", "#ppE", "#ppP"].forEach(k => box.querySelector(k).onchange = save);
  box.querySelector("#ppM").onchange = save;
  box.querySelector("#ppT").onclick = async () => {
    try { const r = await fetch("party/podpush", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: favUid(), test: true }) });
      const j = await r.json(); toast(j.sent ? "📲 " + j.sent + " Benachrichtigung(en) gesendet" : "Keine ungehörte Folge gefunden (oder keine Benachrichtigung gewählt)"); }
    catch (e) { toast("Fehler: " + errText(e)); }
  };
}
/* waagerechte Reihe mit Covern */
function hrow(title, arr, opt) {
  if (!arr || !arr.length) return "";
  return '<div class="sec"><div class="sech"><span>' + esc(title) + "</span>" + (opt && opt.act || "") + '</div><div class="hs">' + arr.map(it => {
    const i = S.sItems.push(it) - 1;
    return '<button class="row" data-i="' + i + '">' + thumb(imgUrl(it, 240), it.media_type === "artist" ? "round" : "") +
      '<span class="rm"><span class="r1">' + favMark(it) + esc(it.name) + '</span><span class="r2">' + esc(opt && opt.sub ? opt.sub(it) : subOf(it)) + "</span></span></button>";
  }).join("") + "</div></div>";
}
/* Übersicht = Kacheln je Art (kein langes Scrollen); Kachel antippen = Liste dieser Art mit Suchfeld */
function paintFav() {
  const box = $("#sRes"); if (!S.favMode || (S.nav && S.nav.length)) return;
  S.sItems = [];
  const cat = S.favCat && FAVCATS.find(c => c[0] === S.favCat);
  if (!cat) {
    const H = S.home || {}, u = prof();
    // Personen-Auswahl (wie in der Suche): Startseite zeigt Favoriten, Playlists, Podcasts dieser Person
    let html = S.users.length > 1 ? '<div class="profrow">' + S.users.map(x => '<button class="profb' + (u && x.user_id === u.user_id ? " on" : "") +
      '" data-u="' + esc(x.user_id) + '">' + profAvatar(x) + "<span>" + esc(profName(x)) + "</span></button>").join("") + "</div>" : "";
    // Reihen in der Reihenfolge der Person (Einstellungen → Startseite)
    const sec = {};
    sec.pods = hrow("Neue Podcast-Folgen", H.pods, { sub: it => [it.podcast && it.podcast.name, subOf(it)].filter(Boolean).join(" · ") });
    sec.recent = hrow("Zuletzt gespielt", H.recent);
    sec.podrec = hrow("Podcasts für dich", H.podrec);
    let n = 0, tiles = "";
    FAVCATS.forEach(([t, label]) => {
      const arr = (S.favData || {})[t] || []; if (!arr.length) return; n += arr.length;
      const imgs = arr.map(x => imgUrl(x, 160)).filter(Boolean).slice(0, 4);
      tiles += '<button class="favtile" data-c="' + t + '"><span class="fcol n' + imgs.length + (t === "artist" ? " round" : "") + '">' +
        imgs.map(u => '<img loading="lazy" alt="" src="' + esc(u) + '">').join("") + '</span><span class="fl">' + label +
        '</span><span class="fn">' + arr.length + "</span></button>";
    });
    sec.fav = tiles ? '<div class="sec"><div class="sech"><span>Favoriten</span></div><div class="hs favrow">' + tiles + "</div></div>" : "";
    sec.rec = (H.rec || []).map(r => hrow(r.name, r.items)).join("");
    sec.pl = hrow("Meine Playlists", H.pl);
    const { order, hidden } = homeOrder();
    order.forEach(id => { if (!hidden.includes(id)) html += sec[id] || ""; });
    if (!html) html = S.favData ? '<div class="empty">Noch nichts da.<br>Tipp: In der Suche ein Cover lange drücken = Favorit.</div>' : '<div class="spin"></div>';
    box.innerHTML = html; return;
  }
  const [t, label] = cat, arr = S.favData[t] || [];
  let html = '<div class="favhead"><button class="bback favback" aria-label="Zurück">' + ICON.back + '</button><h2>' + label +
    '</h2><span class="fn">' + arr.length + '</span></div>' +
    (arr.length > 8 ? '<input class="fi" id="favQ" type="search" placeholder="In ' + label + ' suchen …" autocomplete="off" value="' + esc(S.favQ || "") + '">' : "") +
    '<div id="favL">';
  arr.forEach(it => {
    const i = S.sItems.push(it) - 1;
    html += '<button class="row" data-i="' + i + '" data-n="' + esc((it.name + " " + subOf(it)).toLowerCase()) + '">' + thumb(imgUrl(it, 120), t === "artist" ? "round" : "") +
      '<span class="rm"><span class="r1">' + esc(it.name) + '</span><span class="r2">' + esc(subOf(it)) + '</span></span><span class="go">' + ICON.dots + "</span></button>";
  });
  box.innerHTML = html + "</div>";
  const q = $("#favQ");
  const filt = () => { const v = (q.value || "").trim().toLowerCase(); S.favQ = q.value;
    box.querySelectorAll("#favL .row").forEach(r => { r.hidden = v && !r.dataset.n.includes(v); }); };
  if (q) { q.oninput = filt; filt(); }
}
function openFavCat(t) {
  S.favCat = t; S.favQ = "";
  try { history.pushState({ jbFav: 1 }, ""); } catch (e) {}
  paintFav(); $("#v-search").scrollTop = 0;
}
async function toggleFav(it) {
  if (!it || !it.uri) return;
  const on = !isFavIt(it); favLocal[it.uri] = on;
  try { navigator.vibrate && navigator.vibrate(30); } catch (e) {}
  if (S.nav && S.nav.length) renderNav(); else renderResults();
  try {
    // persönliche Liste (Add-on) – „others“: hat noch jemand anderes diesen Favoriten?
    let others = false;
    try {
      const r = await fetch("party/favs", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: favUid(), item: favSlim(it), on }) });
      if (r.ok) others = !!(await r.json()).others;
    } catch (e) {}
    if (S.myFav && S.myFav.uid === favUid()) {
      const ks = new Set(favKeys(it));
      S.myFav.items = S.myFav.items.filter(x => !favKeys(x).some(k => ks.has(k))); if (on) S.myFav.items.unshift(favSlim(it));
      S.myFav.keys = favSet(S.myFav.items);
    }
    if (on) { await cmd("music/favorites/add_item", { item: it.uri }).catch(() => {}); toast("❤️ " + unent(it.name) + " – Favorit"); }
    else if (others) toast(unent(it.name) + " – kein Favorit mehr (bei dir)");
    else {
      let l = it.provider === "library" ? it : null;
      if (!l) l = await cmd("music/get_library_item", { media_type: it.media_type, item_id: String(it.item_id), provider_instance_id_or_domain: it.provider }).catch(() => null);
      if (l && l.item_id != null) await cmd("music/favorites/remove_item", { media_type: l.media_type || it.media_type, library_item_id: l.item_id }).catch(() => {});
      toast(unent(it.name) + " – kein Favorit mehr");
    }
    it.favorite = on; S.favData = null;
    // MA legt den Eintrag erst kurz danach in der Bibliothek an → Startseite nach 4 s nochmal frisch laden
    setTimeout(() => { S.favData = null; if (S.favMode && !S.favCat && !(S.nav && S.nav.length)) renderFav(); }, 4000);
  } catch (e) { favLocal[it.uri] = !on; toast("Favorit ging nicht: " + errText(e)); }
  delete favLocal[it.uri];
  if (S.nav && S.nav.length) renderNav(); else renderResults();
}
/* Suchfeld in einer geöffneten Liste: filtert beim Tippen, Fokus bleibt im Feld */
$("#sRes").addEventListener("input", e => {
  const f = e.target.closest(".navq"); if (!f) return;
  const n = S.nav && S.nav[S.nav.length - 1]; if (!n) return;
  n.q = f.value;
  later(() => {
    renderNav();
    const g = document.querySelector("#sRes .navq");
    if (g) { g.focus(); const l = g.value.length; try { g.setSelectionRange(l, l); } catch (err) {} }
  }, 300, "navq");
});
/* Weitere Titel einer großen Playlist: Knopf oder automatisch kurz vor dem Ende */
function navMore() {
  const n = S.nav && S.nav[S.nav.length - 1]; if (!n || !n.data || !n.data.tracks || (n.q || "").trim()) return;
  const total = n.data.tracks.length, cur = n.shown || 200; if (cur >= total) return;
  const v = $("#v-search"), top = v.scrollTop;
  n.shown = cur + 200; renderNav(); v.scrollTop = top;
}
$("#sRes").addEventListener("click", e => { if (e.target.closest(".navmore")) { e.stopImmediatePropagation(); navMore(); } }, true);
$("#v-search").addEventListener("scroll", () => {
  const v = $("#v-search");
  if (S.nav && S.nav.length && v.scrollTop + v.clientHeight > v.scrollHeight - 600) later(navMore, 120, "navmore");
}, { passive: true });
/* Schwebender Zurück-Knopf (Playlist/Album/Künstler/Podcast geöffnet, Favoriten-Liste): bleibt beim Scrollen stehen */
(function () {
  const b = document.createElement("button"); b.id = "navBack"; b.className = "fback"; b.setAttribute("aria-label", "Zurück");
  b.innerHTML = ICON.back; b.hidden = true; document.querySelector("main").appendChild(b);
  b.onclick = () => history.back();
})();
function syncNavBack() {
  const b = $("#navBack"); if (!b) return;
  const on = !S.playerOpen && (S.tab === "search" || S.tab === "home") && ((S.nav && S.nav.length) || (S.favMode && S.favCat));
  b.hidden = !on;
  if (on) { const sb = document.querySelector("#v-search>.sbox"); b.style.top = ((sb && sb.offsetParent ? sb.offsetHeight : 0) + 8) + "px"; }
}
setInterval(syncNavBack, 400);
/*
 * Schnell-Scrollleiste rechts (Playlist, Album, Podcast-Folgen): erscheint nur beim Scrollen.
 * Ziehen springt durch die GANZE Liste – auch zu Titeln, die noch nicht nachgeladen sind; die Blase zeigt Nummer und Titel.
 */
(function () {
  const v = $("#v-search"), fs = document.createElement("div");
  fs.id = "fastScroll"; fs.innerHTML = '<div class="fs-th"></div><div class="fs-bub" hidden></div>';
  document.querySelector("main").appendChild(fs);
  const th = fs.querySelector(".fs-th"), bub = fs.querySelector(".fs-bub");
  let hideT = null, drag = false;
  const nav = () => { const n = S.nav && S.nav[S.nav.length - 1]; return n && n.data && n.data.tracks && n.it.media_type !== "artist" ? n : null; };
  const total = n => n.data.tracks.filter(x => x && x.uri).length;
  const usable = () => { const n = nav(); return n && !(n.q || "").trim() && total(n) > 40 && !S.playerOpen ? n : null; };
  function place() {
    const n = usable(); if (!n) { fs.classList.remove("on"); return; }
    const sb = document.querySelector("#v-search>.sbox"), top = (sb && sb.offsetParent ? sb.offsetHeight : 0) + 60;
    fs.style.top = top + "px";
    const H = fs.clientHeight - th.offsetHeight, max = v.scrollHeight - v.clientHeight;
    const shown = Math.min(n.shown || 200, total(n)), fr = max > 0 ? (v.scrollTop / max) * (shown / total(n)) : 0;
    th.style.transform = "translateY(" + Math.round(Math.max(0, Math.min(1, fr)) * H) + "px)";
  }
  function show() {
    if (!usable()) return;
    fs.classList.add("on"); place();
    clearTimeout(hideT); hideT = setTimeout(() => { if (!drag) { fs.classList.remove("on"); bub.hidden = true; } }, 1400);
  }
  v.addEventListener("scroll", show, { passive: true });
  function jump(y) {
    const n = usable(); if (!n) return;
    const r = fs.getBoundingClientRect(), H = r.height - th.offsetHeight;
    const fr = Math.max(0, Math.min(1, (y - r.top - th.offsetHeight / 2) / H)), tot = total(n), idx = Math.round(fr * (tot - 1));
    if (idx >= (n.shown || 200) - 20) { n.shown = Math.min(tot, idx + 120); renderNav(); }
    const row = document.querySelector('#sRes .row[data-i="' + idx + '"]');
    if (row) v.scrollTop = row.offsetTop - v.clientHeight / 3;
    th.style.transform = "translateY(" + Math.round(fr * H) + "px)";
    const t = n.data.tracks.filter(x => x && x.uri)[idx];
    bub.hidden = false; bub.style.top = Math.round(fr * H) + "px";
    bub.textContent = (idx + 1).toLocaleString("de-DE") + " / " + tot.toLocaleString("de-DE") + (t ? " · " + unent(t.name) : "");
  }
  fs.addEventListener("pointerdown", e => {
    if (!fs.classList.contains("on")) return;
    drag = true; fs.classList.add("drag"); fs.setPointerCapture(e.pointerId); jump(e.clientY); e.preventDefault();
  });
  fs.addEventListener("pointermove", e => { if (drag) jump(e.clientY); });
  const end = () => { if (!drag) return; drag = false; fs.classList.remove("drag"); bub.hidden = true; show(); };
  fs.addEventListener("pointerup", end); fs.addEventListener("pointercancel", end);
  setInterval(() => { if (!usable()) fs.classList.remove("on"); }, 500);
})();
/* Lange drücken auf ein Cover in der Liste oder auf das große Cover */
(function () {
  const box = $("#sRes"); let t = null, x0 = 0, y0 = 0, fired = false;
  const target = e => {
    const big = e.target.closest(".bhead .th"); if (big) { const n = S.nav[S.nav.length - 1]; return n && n.it; }
    const th = e.target.closest(".row .th"), row = th && th.closest(".row");
    return row ? S.sItems[+row.dataset.i] : null;
  };
  box.addEventListener("pointerdown", e => {
    const it = target(e); if (!it) return;
    fired = false; x0 = e.clientX; y0 = e.clientY; clearTimeout(t);
    const th = e.target.closest(".th"); if (th) th.classList.add("press");
    t = setTimeout(() => { fired = true; if (th) th.classList.remove("press"); toggleFav(it); }, 600);
  });
  const cancel = () => { clearTimeout(t); box.querySelectorAll(".th.press").forEach(x => x.classList.remove("press")); };
  box.addEventListener("pointermove", e => { if (Math.abs(e.clientX - x0) > 10 || Math.abs(e.clientY - y0) > 10) cancel(); });
  box.addEventListener("pointerup", cancel); box.addEventListener("pointercancel", cancel);
  box.addEventListener("contextmenu", e => { if (target(e)) e.preventDefault(); });
  // nach dem langen Drücken kein normales Antippen auslösen
  box.addEventListener("click", e => { if (fired) { fired = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  box.addEventListener("click", e => {
    const pt = e.target.closest(".podtop");
    if (pt) {
      e.stopImmediatePropagation();
      const v = !pt.textContent.includes("Nach unten");
      if (S.myFav) { S.myFav.prefs = S.myFav.prefs || {}; S.myFav.prefs.podtop = v; }
      fetch("party/favs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: favUid(), prefs: { podtop: v } }) }).catch(() => {});
      paintFav(); return;
    }
    const tile = e.target.closest(".favtile"), back = e.target.closest(".favback");
    if (!tile && !back) return;
    e.stopImmediatePropagation();
    if (tile) openFavCat(tile.dataset.c); else history.back();
  }, true);
})();

/* ---------- Profile: Musik-Konten pro Person (Benutzer aus Music Assistant) ----------
   Jedes Gerät merkt sich sein Profil. Suche, „Meine Musik“ und Abspielen laufen über die Musikquellen,
   die in Music Assistant für diesen Benutzer freigegeben sind (z. B. eigenes Spotify-Konto). */
S.users = []; S.me = null; S.noImp = false;
async function loadProfiles() {
  try {
    const [me, list] = await Promise.all([cmd("auth/me").catch(() => null), cmd("auth/users")]);
    S.me = me && (me.user_id || me.id) || null;
    S.allUsers = (list || []).filter(u => u && u.enabled !== false && u.role !== "guest");
    const sel = Array.isArray(PJ.profiles) ? PJ.profiles : null;  // Auswahl in den Einstellungen (null = alle)
    S.users = S.allUsers.filter(u => sel ? sel.includes(u.user_id) : profDefault(u));
  } catch (e) { S.users = []; }
  if (S.tab === "search" && !S.sRes && !(S.nav && S.nav.length)) renderHome();
  if (S.tab === "home") renderFav(); else loadMyFavs();
  loadProviders();
}
/* Ohne Auswahl: echte Personen, keine Technik-Konten (Dashboard-Anzeige, Gast, Kiosk …) */
function profDefault(u) {
  return (u.role === "admin" || u.role === "user") && !/dashboard|viewer|kiosk|gast|guest|homeassistant|service/i.test((u.display_name || "") + " " + (u.username || ""));
}
function prof() {
  if (S.users.length < 2) return null;
  const id = ls.get("jb_prof") || S.me;
  return S.users.find(u => u.user_id === id) || S.users.find(u => u.user_id === S.me) || null;
}
function profName(u) { return (u && (u.display_name || u.username)) || ""; }
/* Quellen-Filter des Profils (leer = alle) */
function profProv(key) {
  const u = prof(), f = u && Array.isArray(u.provider_filter) ? u.provider_filter : [];
  return f.length ? { [key]: f } : {};
}
/* Abspielen im Namen des Profils (Statistik/Konto), nur wenn es nicht der eigene Benutzer ist */
function profUser() { const u = prof(); return u && u.user_id !== S.me && !S.noImp ? { user: u.username } : {}; }
function cmdP(command, args, timeout) {
  const extra = profUser();
  if (!extra.user) return cmd(command, args, timeout);
  return cmd(command, Object.assign({}, args, extra), timeout).catch(e => {
    if (/scope|permission|impersonat|not allowed|unauthori|forbidden/i.test(errText(e))) { S.noImp = true; return cmd(command, args, timeout); }
    throw e;
  });
}
function profAvatar(u, cls) {
  const n = profName(u), url = u && u.avatar_url;
  return '<span class="pav' + (cls ? " " + cls : "") + '">' + (url ? '<img alt="" src="' + esc(url) + '">' : esc(n.slice(0, 1).toUpperCase())) + "</span>";
}
let homeSeq = 0;
async function renderHome() {
  if (S.favMode) { renderFav(); return; }
  const box = $("#sRes"); if (!box) return;
  const u = prof(), seq = ++homeSeq;
  let head = "";
  if (S.users.length > 1) {
    head = '<div class="profrow">' + S.users.map(x => '<button class="profb' + (u && x.user_id === u.user_id ? " on" : "") + '" data-u="' + esc(x.user_id) + '">' +
      profAvatar(x) + "<span>" + esc(profName(x)) + "</span></button>").join("") + "</div>";
  }
  if (!S.ready) { box.innerHTML = head + '<div class="empty">Wonach suchst du?</div>'; return; }
  box.innerHTML = head + '<div class="spin"></div>';
  const pv = profProv("provider");
  const [pl, fav] = await Promise.all([
    cmdP("music/playlists/library_items", Object.assign({ limit: 60, order_by: "sort_name" }, pv), 20000).catch(() => []),
    cmdP("music/tracks/library_items", Object.assign({ favorite: true, limit: 40, order_by: "timestamp_added_desc" }, pv), 20000)
      .catch(() => cmdP("music/tracks/library_items", Object.assign({ favorite: true, limit: 40 }, pv), 20000)).catch(() => [])
  ]);
  if (seq !== homeSeq || S.sRes || (S.nav && S.nav.length)) return;
  S.sItems = [];
  const row = it => { const i = S.sItems.push(it) - 1;
    return '<button class="row" data-i="' + i + '">' + thumb(imgUrl(it, 120)) + '<span class="rm"><span class="r1">' + esc(it.name) +
      '</span><span class="r2">' + esc(subOf(it)) + '</span></span><span class="go">' + ICON.dots + "</span></button>"; };
  let html = head;
  const p = (pl || []).filter(x => x && x.uri), f = (fav || []).filter(x => x && x.uri);
  if (p.length) html += '<div class="sec"><div class="sech"><span>' + (u ? "Playlists von " + esc(profName(u)) : "Playlists") + "</span></div>" + p.map(row).join("") + "</div>";
  if (f.length) html += '<div class="sec"><div class="sech"><span>Lieblingssongs</span></div>' + f.map(row).join("") + "</div>";
  if (!p.length && !f.length) html += '<div class="empty">Wonach suchst du?</div>';
  box.innerHTML = html;
}
document.addEventListener("click", e => {
  const b = e.target.closest(".profb"); if (!b) return;
  ls.set("jb_prof", b.dataset.u); S.sRes = null; S.favData = null; S.home = {}; S.myFav = null;
  const u = prof(); toast("Musik von " + profName(u));
  if (S.favMode) renderFav(); else if ($("#q").value.trim().length >= 2) doSearch(); else renderHome();
});

/* ---------- Durchklicken: Künstler → Titel/Alben, Album/Playlist → Titel ---------- */
S.nav = [];
function navReset() { if (!S.nav.length) return; S.nav = []; S.navSeq = (S.navSeq || 0) + 1; }
function navPush(it) {
  S.nav.push({ it, data: null, all: false });
  try { history.pushState({ jbNav: S.nav.length }, ""); } catch (e) {}
  renderNav(); loadNav(S.nav[S.nav.length - 1]);
  $("#v-search").scrollTop = 0;
}
window.addEventListener("popstate", () => {
  if (S.skipPop) { S.skipPop = false; return; }
  if (S.playerOpen) { closePlayer(true); return; }
  if (!S.nav.length) { if (S.favMode && S.favCat) { S.favCat = null; paintFav(); $("#v-search").scrollTop = 0; } return; }
  S.nav.pop(); S.navSeq = (S.navSeq || 0) + 1;
  if (S.nav.length) renderNav(); else renderResults();
  $("#v-search").scrollTop = 0;
});
async function loadNav(n) {
  const it = n.it, a = { item_id: String(it.item_id), provider_instance_id_or_domain: it.provider }, seq = S.navSeq = (S.navSeq || 0) + 1;
  try {
    let d;
    if (it.media_type === "artist") {
      const [tr, al] = await Promise.all([cmd("music/artists/artist_tracks", a, 25000).catch(() => []), cmd("music/artists/artist_albums", a, 25000).catch(() => [])]);
      d = { tracks: tr || [], albums: al || [] };
    } else if (it.media_type === "album") d = { tracks: await cmd("music/albums/album_tracks", a, 25000) || [] };
    else if (it.media_type === "podcast") {
      // Folgen: neueste zuerst
      const ep = await cmd("music/podcasts/podcast_episodes", a, 40000) || [];
      ep.sort((x, y) => ((dateOf(y) || 0) - (dateOf(x) || 0)) || ((y.position || 0) - (x.position || 0)));
      d = { tracks: ep };
    }
    else d = { tracks: await cmd("music/playlists/playlist_tracks", a, 40000) || [] };
    n.data = d;
  } catch (e) { n.data = { err: errText(e) }; }
  if (seq === S.navSeq && S.nav[S.nav.length - 1] === n) renderNav();
}
function renderNav() {
  const n = S.nav[S.nav.length - 1], box = $("#sRes"); if (!n) return;
  const it = n.it, d = n.data, art = it.media_type === "artist";
  S.sItems = [];
  let html = '<div class="bhead"><button class="bback" aria-label="Zurück">' + ICON.back + '</button>' +
    '<button class="bfav' + (isFavIt(it) ? " on" : "") + '" aria-label="Favorit">' + ICON.heart + "</button>" + thumb(imgUrl(it, 480), "lg favable" + (art ? " round" : "")) +
    '<span class="rm"><span class="r1">' + favMark(it) + esc(it.name) + '</span><span class="r2">' + esc(subOf(it)) + '</span></span></div>' +
    '<div class="bacts"><button class="bact pri" data-o="play">' + ICON.play + 'Abspielen</button><button class="bact" data-o="next">' + ICON.nextup +
    'Als Nächstes</button><button class="bact" data-o="add">' + ICON.plus + 'Anstellen</button></div>' + targetRow();
  if (!d) html += '<div class="spin"></div>';
  else if (d.err) html += '<div class="empty">Nicht ladbar: ' + esc(d.err) + "</div>";
  else {
    // große Playlists: erst 200 Titel, beim Runterscrollen je 200 weitere
    const all = (d.tracks || []).filter(x => x && x.uri), q = (n.q || "").trim().toLowerCase();
    // Suchfeld in langen Listen: findet z. B. „Folge 12“ in einer Playlist mit allen Folgen
    if (!art && all.length > 40) html += '<input class="fi navq" type="search" placeholder="In der Liste suchen … (z. B. Folge 12)" autocomplete="off" value="' + esc(n.q || "") + '">';
    const tr = q ? all.filter(t => (unent(t.name) + " " + artistsOf(t)).toLowerCase().includes(q)) : all;
    const max = art && !n.all ? 10 : (q ? 300 : (n.shown || 200));
    if (q && !tr.length) html += '<div class="empty">Nichts gefunden</div>';
    if (tr.length) {
      html += '<div class="sec"><div class="sech"><span>' + (art ? "Titel" : tr.length + (it.media_type === "podcast" ? " Folgen" : " Titel")) + "</span>" +
        (art && tr.length > 10 ? '<button class="bmore">' + (n.all ? "Weniger" : "Alle " + tr.length) + "</button>" : "") + "</div>";
      tr.slice(0, max).forEach((t, k) => {
        const i = S.sItems.push(t) - 1, no = it.media_type === "album" ? (t.track_number || k + 1) : null;
        html += '<button class="row" data-i="' + i + '">' + (no != null ? '<span class="tno">' + no + "</span>" : thumb(imgUrl(t, 120))) +
          '<span class="rm"><span class="r1">' + esc(t.name) + '</span><span class="r2">' + esc(it.media_type === "album" ? (artistsOf(t) || fmt(t.duration)) : subOf(t)) +
          '</span></span><span class="go">' + ICON.dots + "</span></button>";
      });
      if (!art && tr.length > max) html += '<button class="more navmore">Weitere laden (' + max + " von " + tr.length + ")</button>";
      html += "</div>";
    }
    const al = (d.albums || []).filter(x => x && x.uri);
    if (al.length) {
      html += '<div class="sec"><div class="sech"><span>Alben</span></div>';
      al.sort((x, y) => (+y.year || 0) - (+x.year || 0)).forEach(x => {
        const i = S.sItems.push(x) - 1;
        html += '<button class="row" data-i="' + i + '">' + thumb(imgUrl(x, 120)) + '<span class="rm"><span class="r1">' + esc(x.name) +
          '</span><span class="r2">' + esc([x.year, x.album_type && x.album_type !== "unknown" ? ({ album: "Album", single: "Single", ep: "EP", compilation: "Sampler" }[x.album_type] || "") : ""].filter(Boolean).join(" · ") || "Album") +
          '</span></span><span class="go">' + ICON.dots + "</span></button>";
      });
      html += "</div>";
    }
    if (!tr.length && !al.length) html += '<div class="empty">Keine Titel gefunden</div>';
  }
  box.innerHTML = html;
  fillArt(n);
}
/* Playlist-Titel kommen von MA oft ohne Cover → einzeln nachschlagen (music/item_by_uri), gemerkt pro URI */
const artCache = {};
async function fillArt(n) {
  const box = $("#sRes"), seq = S.navSeq, todo = [];
  box.querySelectorAll(".row[data-i]").forEach(row => {
    const it = S.sItems[+row.dataset.i];
    if (!it || it.media_type !== "track" || imgUrl(it, 120) || row.querySelector(".tno")) return;
    todo.push([row, it]);
  });
  const head = box.querySelector(".bhead .th");
  let headDone = !!(head && head.querySelector("img"));
  const put = (row, it, url) => {
    const th = row.querySelector(".th"); if (!th || !url) return;
    if (!th.querySelector("img")) th.insertAdjacentHTML("beforeend", '<img loading="lazy" alt="" src="' + esc(url) + '">');
    if (!headDone && head) { head.insertAdjacentHTML("beforeend", '<img alt="" src="' + esc(url.replace(/size=\d+/, "size=256")) + '">'); headDone = true; }
  };
  // Kopf ohne Bild: erstes Titel-Cover nehmen, das schon da ist
  if (!headDone) { const r = box.querySelector(".row[data-i] .th img"); if (r && head) { head.insertAdjacentHTML("beforeend", '<img alt="" src="' + esc(r.getAttribute("src").replace(/size=\d+/, "size=256")) + '">'); headDone = true; } }
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      if (seq !== S.navSeq || S.nav[S.nav.length - 1] !== n) return;
      const [row, it] = todo[i++];
      let url = artCache[it.uri];
      if (url === undefined) {
        try { const full = await cmd("music/item_by_uri", { uri: it.uri }, 15000); url = imgUrl(full, 120) || ""; if (full && url) it.image = pickImg(full) || pickImg(full.album); }
        catch (e) { url = ""; }
        artCache[it.uri] = url;
      }
      if (row.isConnected) put(row, it, url);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}
/* Wo soll es laufen? Gewählter Lautsprecher vorn und hervorgehoben, dann die spielenden, dann alle anderen –
   antippen wechselt das Ziel direkt (nicht mehr aus Versehen auf dem falschen Gerät starten) */
function targetRow() {
  const cur = S.pid, pl = playerList();
  const order = [cur].concat(pl.filter(p => p.player_id !== cur && pstate(p) === "playing").map(p => p.player_id),
                             pl.filter(p => p.player_id !== cur && pstate(p) !== "playing").map(p => p.player_id)).filter(Boolean);
  return '<div class="ptl">Abspielen auf</div><div class="chips ptarget">' + order.map(id => {
    const p = S.players[id]; if (!p) return "";
    return '<button class="chip' + (id === cur ? " on" : "") + '" data-p="' + esc(id) + '">' + (pstate(p) === "playing" ? '<span class="eq on"><i></i><i></i><i></i></span>' : "") + esc(pname(p)) + "</button>";
  }).join("") + "</div>";
}
/** Klick auf einen Ziel-Knopf (in Menü oder Detailseite) */
function pickTarget(ch) {
  ch.parentNode.querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === ch));
  selectPlayer(ch.dataset.p);
}
function openItem(it) {
  // Titel aus einer geöffneten Playlist/Album/Podcast: ganze Liste ab diesem Titel abspielen
  const n = S.nav && S.nav[S.nav.length - 1], box = n && ["playlist", "album", "podcast"].includes(n.it.media_type) &&
    n.data && (n.data.tracks || []).some(x => x && x.uri === it.uri) ? n.it : null;
  const target = targetRow();
  const html = '<div class="ihead">' + thumb(imgUrl(it, 240), "lg" + (it.media_type === "artist" ? " round" : "")) +
    '<span class="rm"><span class="r1">' + esc(it.name) + '</span><span class="r2">' + esc(subOf(it)) + "</span></span></div>" + target +
    (box ? '<button class="act pri" data-o="from">' + ICON.play + (box.media_type === "podcast" ? "Podcast ab dieser Folge" : box.media_type === "album" ? "Album ab hier" : "Playlist ab hier") + "</button>" : "") +
    '<button class="act' + (box ? "" : " pri") + '" data-o="play">' + ICON.play + (box ? "Nur diesen Titel spielen" : "Jetzt spielen") + "</button>" +
    '<button class="act" data-o="next">' + ICON.nextup + "Als Nächstes</button>" +
    '<button class="act" data-o="add">' + ICON.plus + "Hinten anstellen</button>" +
    '<button class="act ghost" data-o="">Abbrechen</button>';
  openSheet("item", html, c => {
    c.querySelectorAll(".ptarget .chip").forEach(ch => ch.onclick = () => pickTarget(ch));
    c.querySelectorAll(".act").forEach(b => {
      b.onclick = () => { closeSheet(); if (b.dataset.o === "from") playFrom(box, it); else if (b.dataset.o) enqueue(it, b.dataset.o); };
    });
  });
}
/** Name des gewählten Lautsprechers (für die Bestätigung „… · Wohnzimmer“) */
function whereName() { const p = S.players[S.pid]; return p ? "🔈 " + pname(p) : ""; }
/* Playlist/Album/Podcast ab einem bestimmten Titel – der Rest der Liste folgt */
async function playFrom(list, it) {
  const ok = await qc("play_media", Object.assign({ media: list.uri, option: "replace", start_item: it.uri }, profUser()));
  if (!ok) return;
  toast("▶ " + unent(list.name) + " ab „" + unent(it.name) + "“ · " + whereName()); skipFx();
}
/* Ganze Listen (Playlist, Album, Künstler, Podcast, Hörbuch) ersetzen beim Abspielen die Warteschlange,
   einzelne Titel werden nur eingeschoben */
const LIST_TYPES = ["playlist", "album", "artist", "podcast", "audiobook"];
async function enqueue(it, opt) {
  const o = opt === "play" && LIST_TYPES.includes(it.media_type) ? "replace" : opt;
  const ok = await qc("play_media", Object.assign({ media: it.uri, option: o }, profUser()));
  if (!ok) return;
  toast((opt === "play" ? "Spielt jetzt: " + it.name : opt === "next" ? "Kommt als Nächstes: " + it.name : "Hinten angestellt: " + it.name) + " · " + whereName());
  if (opt === "play") skipFx();
}

/* ---------- Warteschlange (Liste) ---------- */
function itemsDirty() { S.itemsOk = false; if (S.tab === "queue") later(loadItems, 250, "items"); }
async function loadItems() {
  const box = $("#qList");
  if (!S.ready || !S.qid) { S.items = []; renderItems(); return; }
  const q = S.q, ci = q && q.current_index != null ? q.current_index : -1;
  const cur = q && q.current_item ? q.current_item.queue_item_id : null;
  const seq = ++S.iSeq;
  if (!S.items.length && !box.children.length) box.innerHTML = '<div class="spin"></div>';
  try {
    /* ab dem aktuellen Titel holen und ihn herausfiltern – klappt, egal ob MA ihn mitliefert */
    const r = await cmd("player_queues/items", { queue_id: S.qid, limit: 100, offset: Math.max(0, ci) });
    if (seq !== S.iSeq) return;
    S.items = (r || []).filter(x => x && x.queue_item_id !== cur);
    S.itemsOk = true;
  } catch (e) {
    if (seq !== S.iSeq) return;
    toast("Warteschlange: " + errText(e));
  }
  renderItems();
}
/* Titel bis index_in_buffer sind schon geladen und lassen sich nicht mehr verschieben */
function canMoveUp(i) {
  const q = S.q; if (!q || i < 1) return false;
  const ci = q.current_index == null ? -1 : q.current_index;
  const buf = q.index_in_buffer == null ? ci : q.index_in_buffer;
  return ci + i > buf;
}
function renderItems() {
  if (drag) return;   // während des Ziehens nicht neu zeichnen
  const box = $("#qList"), n = nowInfo(), q = S.q;
  $("#qClear").hidden = true;
  const left = q && typeof q.items === "number" ? Math.max(0, q.items - ((q.current_index == null ? -1 : q.current_index) + 1)) : S.items.length;
  setText($("#qCount"), left ? left + " Titel danach" : "");
  if (!S.ready) { box.innerHTML = '<div class="empty">Keine Verbindung zu Music Assistant</div>'; return; }
  if (!S.pid) { box.innerHTML = '<div class="empty">Kein Lautsprecher gewählt</div>'; return; }
  let html = "";
  if (n) html += '<div class="qnow"><div class="lbl">Läuft gerade</div><div class="row" style="pointer-events:none">' + thumb(n.small) +
    '<span class="rm"><span class="r1">' + esc(n.title) + '</span><span class="r2">' + esc(n.artist) + '</span></span><span class="eq' + (isPlaying() ? " on" : "") +
    '"><i></i><i></i><i></i></span></div></div>';
  if (!S.items.length) {
    html += S.itemsOk ? '<div class="empty">Keine weiteren Titel.<br>Über die Suche kannst du Songs anstellen.</div>' : '<div class="spin"></div>';
  }
  html += S.items.map((it, i) => {
    const m = it.media_item || {};
    return '<div class="qi" data-i="' + i + '"><button class="row" data-a="play">' + thumb(imgUrl(it, 120)) +
      '<span class="rm"><span class="r1">' + esc(m.name || it.name) + '</span><span class="r2">' + esc(artistsOf(m)) + "</span></span></button>" +
      '<button class="ib" data-a="del" aria-label="Entfernen">' + ICON.x + "</button>" +
      '<span class="ib grip' + (i >= minDragIdx() ? "" : " off") + '" aria-label="Ziehen zum Verschieben">' + ICON.grip + "</span></div>";
  }).join("");
  box.innerHTML = html;
  $("#qClear").hidden = !S.items.length && !(window.PJtv && PJtv.avail());
}
/* Liste leeren: nur kommende Titel (laufender spielt weiter) oder alles (Musik stoppt) */
$("#qClear").onclick = () => {
  const tv = window.PJtv && PJtv.avail(), tvOn = tv && PJtv.on();
  openSheet("qclear", (tv ? '<div class="shh">Fernseher</div><button class="row lrow tvo"><span class="rm"><span class="r1">' +
      (tvOn ? "🎵 Zurück zur Musik" : "📺 TV-Ton") + '</span><span class="r2">' + (tvOn ? "Warteschlange spielt weiter" : "Box spielt den Ton vom Fernseher") + "</span></span></button>" : "") +
    (S.items.length ? '<div class="shh">Liste leeren</div>' +
    '<button class="row lrow act" data-o="next"><span class="rm"><span class="r1">Kommende Titel entfernen</span><span class="r2">Der laufende Titel spielt weiter</span></span></button>' +
    '<button class="row lrow act" data-o="all"><span class="rm"><span class="r1">Alles leeren</span><span class="r2">Warteschlange komplett leer, Musik stoppt</span></span></button>' : ""),
    c => { c.querySelectorAll(".act").forEach(b => { b.onclick = () => { closeSheet(); clearQueue(b.dataset.o === "all"); }; });
      const t = c.querySelector(".tvo"); if (t) t.onclick = () => { closeSheet(); PJtv.toggle(); }; });
};
async function clearQueue(all) {
  if (all) { if (await qc("clear")) { S.items = []; renderItems(); toast("Warteschlange geleert"); } return; }
  const q = S.q, ci = q && q.current_index != null ? q.current_index : -1;
  const buf = q && q.index_in_buffer != null ? q.index_in_buffer : ci;
  toast("Entferne kommende Titel …");
  try {
    const r = await cmd("player_queues/items", { queue_id: S.qid, limit: 2000, offset: Math.max(0, buf + 1) });
    const ids = (r || []).map(x => x && x.queue_item_id).filter(Boolean);
    S.items = S.items.filter((it, i) => ci + 1 + i <= buf); renderItems();
    for (const id of ids) await cmd("player_queues/delete_item", { queue_id: S.qid, item_id_or_index: id }).catch(() => {});
    toast(ids.length + " Titel entfernt");
  } catch (e) { toast("Warteschlange: " + errText(e)); }
  loadItems();
}
$("#qList").onclick = async e => {
  const b = e.target.closest("[data-a]"), row = e.target.closest(".qi");
  if (!b || !row || b.disabled) return;
  const i = +row.dataset.i, it = S.items[i]; if (!it) return;
  const name = (it.media_item && it.media_item.name) || it.name;
  if (b.dataset.a === "play") {
    if (await qc("play_index", { index: it.queue_item_id })) { toast("Spielt jetzt: " + name); skipFx(); }
  } else if (b.dataset.a === "del") {
    S.items.splice(i, 1); renderItems();
    if (!(await qc("delete_item", { item_id_or_index: it.queue_item_id }))) loadItems();
  } else if (b.dataset.a === "up") {
    moveUp(i);
  }
};
/* ---------- Ziehen zum Verschieben (Griff ≡) ---------- */
/* Titel, die MA schon in den Puffer geladen hat, lassen sich nicht mehr verschieben */
function minDragIdx() {
  const q = S.q; if (!q) return 0;
  const ci = q.current_index == null ? -1 : q.current_index;
  const buf = q.index_in_buffer == null ? ci : q.index_in_buffer;
  return Math.max(0, buf - ci);
}
var drag = null;   // var: wird schon vor dieser Zeile von renderItems gelesen
$("#qList").addEventListener("pointerdown", e => {
  const g = e.target.closest(".grip"); if (!g || g.classList.contains("off")) return;
  const row = g.closest(".qi"), list = $("#qList"); if (!row) return;
  e.preventDefault();
  const rows = [...list.querySelectorAll(".qi")];
  const from = +row.dataset.i, h = row.getBoundingClientRect().height;
  drag = { row, rows, from, to: from, y0: e.clientY, h, view: list.closest(".view"), sy0: 0, id: e.pointerId, min: minDragIdx() };
  drag.sy0 = drag.view ? drag.view.scrollTop : 0;
  try { g.setPointerCapture(e.pointerId); } catch (x) {}
  row.classList.add("dragging"); document.body.classList.add("dragq");
});
function dragMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const v = drag.view;
  if (v) {  // am Rand automatisch scrollen
    const r = v.getBoundingClientRect();
    if (e.clientY < r.top + 70) v.scrollTop -= 12; else if (e.clientY > r.bottom - 90) v.scrollTop += 12;
  }
  const dy = e.clientY - drag.y0 + (v ? v.scrollTop - drag.sy0 : 0);
  drag.row.style.transform = "translateY(" + dy + "px)";
  const n = drag.rows.length;
  const to = Math.max(drag.min, Math.min(n - 1, drag.from + Math.round(dy / drag.h)));
  if (to !== drag.to) {
    drag.to = to;
    drag.rows.forEach((r, k) => {
      if (r === drag.row) return;
      let sh = 0;
      if (to > drag.from && k > drag.from && k <= to) sh = -drag.h;
      else if (to < drag.from && k < drag.from && k >= to) sh = drag.h;
      r.style.transform = sh ? "translateY(" + sh + "px)" : "";
    });
  }
}
async function dragEnd(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  document.body.classList.remove("dragq");
  d.rows.forEach(r => { r.style.transform = ""; r.classList.remove("dragging"); });
  const shift = d.to - d.from; if (!shift) { renderItems(); return; }
  const it = S.items[d.from]; if (!it) return;
  S.items.splice(d.from, 1); S.items.splice(d.to, 0, it); renderItems();   // sofort zeigen
  const ok = await qc("move_item", { queue_item_id: it.queue_item_id, pos_shift: shift });
  await loadItems();
  if (ok && S.items.findIndex(x => x.queue_item_id === it.queue_item_id) === d.from) toast("Verschieben nicht möglich (Titel schon geladen)");
}
document.addEventListener("pointermove", dragMove);
document.addEventListener("pointerup", dragEnd);
document.addEventListener("pointercancel", dragEnd);

async function moveUp(i) {
  const it = S.items[i]; if (!it || !canMoveUp(i)) return;
  const id = it.queue_item_id;
  S.items.splice(i, 1); S.items.splice(i - 1, 0, it); renderItems();   // sofort zeigen
  const ok = await qc("move_item", { queue_item_id: id, pos_shift: -1 });
  await loadItems();
  if (ok && S.items.findIndex(x => x.queue_item_id === id) === i) toast("Verschieben nicht möglich (Titel schon geladen)");
}

/* ---------- Verbindungsanzeige ---------- */
function setConn(c, wait) {
  S.conn = c;
  const box = $("#stateBox"), ban = $("#banner"), ok = c === "ok";
  document.body.classList.toggle("noconn", !ok);
  if (ok) { box.hidden = true; ban.hidden = true; document.body.classList.remove("blocked"); renderAll(); return; }
  const sec = Math.round((wait || 0) / 1000);
  /* nach erfolgreicher Verbindung nur ein Hinweisband, damit die Seite nicht springt */
  if (S.ever && (c === "connecting" || c === "offline")) {
    box.hidden = true; ban.hidden = false; document.body.classList.remove("blocked");
    setText(ban, c === "connecting" ? "Verbindung unterbrochen – verbinde neu …" : "Keine Verbindung zu Music Assistant – neuer Versuch in " + sec + " s");
    return;
  }
  const M = {
    connecting: ["", "Verbinde mit Music Assistant …", "", false],
    notoken: ["key", "Music Assistant ist noch nicht eingerichtet",
      "In Home Assistant beim Add-on <b>Party-Jukebox</b> unter <b>Konfiguration</b> den Token von Music Assistant eintragen " +
      "(Music Assistant → Einstellungen → Profil → Token erstellen) und das Add-on neu starten.", false],
    auth: ["key", "Anmeldung bei Music Assistant fehlgeschlagen",
      "Der Token in den Add-on-Optionen ist ungültig oder abgelaufen. Neuen Token in Music Assistant erstellen, im Add-on eintragen und das Add-on neu starten.", true],
    offline: ["wifi", "Keine Verbindung zu Music Assistant",
      "Läuft Music Assistant? Neuer Versuch in " + sec + " s …", true]
  }[c] || ["wifi", "Keine Verbindung", "", true];
  ban.hidden = true; box.hidden = false; document.body.classList.add("blocked");
  box.innerHTML = '<div class="stc">' + (M[0] ? '<div class="sti">' + ICON[M[0]] + "</div>" : '<div class="spin"></div>') +
    "<h2>" + esc(M[1]) + "</h2>" + (M[2] ? "<p>" + M[2] + "</p>" : "") +
    (M[3] ? '<button class="act pri" id="reconn" style="margin-top:16px">Jetzt neu verbinden</button>' : "") + "</div>";
  const rb = $("#reconn"); if (rb) rb.onclick = () => { S.authFail = false; S.retry = 0; connect(); };
  renderPlayer();
}

/* ---------- Start ---------- */
/* für jukebox-extra.js (Teilnehmer, Android-Medien) */
window.JB = { S, $, esc, groupInfo, nowInfo, isPlaying, togglePlay, volSet, elapsed, cmd, toast, openSheet, closeSheet,
  selectPlayer, profUser, profProv, favUid: () => favUid(), toggleFav, isFavIt };
renderAll();
try { localStorage.setItem("pj_host", "1"); } catch (e) {}
connect();
})();

/* Logo oben links: in einer App, die ihr eigenes Symbol liefert (Vanpis Jukebox), das App-Symbol zeigen */
(function () {
  const A = window.AndroidMediaSession, el = document.querySelector(".brand .logo");
  if (!el || !A || typeof A.appIcon !== "function") return;
  let u = ""; try { u = A.appIcon(); } catch (e) {}
  if (u && u.startsWith("data:image/")) { el.innerHTML = '<img alt="" src="' + u + '">'; el.classList.add("app"); }
})();
