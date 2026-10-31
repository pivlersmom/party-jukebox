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
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  nextup: '<svg viewBox="0 0 24 24"><path d="M4 6h10M4 11h10M4 16h6"/><path d="M18 8v11M15 16l3 3 3-3"/></svg>',
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
const artistsOf = m => (m && ((m.artists || []).map(a => a && a.name).filter(Boolean).join(", ") || m.artist_str)) || "";

/* ---------- Zustand ---------- */
const S = {
  ws: null, ready: false, ever: false, id: 1, pend: {}, conn: "init", retry: 0, authFail: false,
  players: {}, pid: null, q: null, qid: null,
  tBase: 0, tAt: 0, seekHold: 0, ppHold: 0, ppWant: false, vHold: 0, lastRq: 0,
  items: [], itemsOk: false, iSeq: 0,
  tab: "now", filter: "all", sSeq: 0, sRes: null, sItems: []
};

/* ---------- MA-WebSocket ---------- */
function cmd(command, args, timeout) {
  return new Promise((res, rej) => {
    if (!S.ready || !S.ws) return rej(new Error("Nicht verbunden"));
    const id = String(S.id++);
    const t = setTimeout(() => { if (S.pend[id]) { delete S.pend[id]; rej(new Error("Zeitüberschreitung")); } }, timeout || 15000);
    S.pend[id] = { res, rej, t, acc: null };
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
      if (m.partial) { p.acc = (p.acc || []).concat(m.result || []); return; }
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
function usable(p) {
  return !!p && p.available !== false && p.enabled !== false && !p.hide_in_ui && !p.private &&
    !HIDE_TYPES.includes(p.type) && !p.synced_to;
}
function playerList() { return Object.values(S.players).filter(usable).sort((a, b) => pname(a).localeCompare(pname(b), "de")); }
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
function nowInfo() {
  const q = S.q, ci = q && q.current_item, mi = ci && ci.media_item, p = S.players[S.pid];
  if (ci) return { title: (mi && mi.name) || ci.name || "", artist: artistsOf(mi), img: imgUrl(ci, 600), small: imgUrl(ci, 120),
    dur: +ci.duration || +(mi && mi.duration) || 0, key: ci.queue_item_id };
  const cm = p && p.current_media;
  if (cm && (cm.title || cm.uri)) return { title: cm.title || cm.uri, artist: cm.artist || "", img: cm.image_url || "",
    small: cm.image_url || "", dur: +cm.duration || 0, key: cm.uri };
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
  setText($("#vGrp"), v == null ? "Lautstärke nicht regelbar" : (g.isGroup ? "Gruppe · " + g.n + " Lautsprecher" : ""));
  box.classList.toggle("off", v == null);
  if (v == null) { setText($("#vVal"), "–"); return; }
  if (!volSl.active && Date.now() > S.vHold) { volSl.set(v / 100); setText($("#vVal"), Math.round(v)); }
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
function showTab(t) {
  S.tab = t; document.body.dataset.tab = t;
  ["now", "search", "queue"].forEach(x => {
    $("#v-" + x).classList.toggle("on", x === t);
    document.querySelector('#nav [data-t="' + x + '"]').classList.toggle("on", x === t);
  });
  if (t === "queue") { renderItems(); if (!S.itemsOk) loadItems(); }
  if (t === "search" && !$("#q").value) setTimeout(() => $("#q").focus(), 60);
  if (t === "now") tick();
}
document.querySelectorAll("#nav button").forEach(b => { b.onclick = () => showTab(b.dataset.t); });

/* ---------- Unteres Fenster ---------- */
let sheetKind = "";
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
  let html = '<div class="shh">Lautsprecher</div>';
  if (!S.ready) html += '<div class="empty">Keine Verbindung zu Music Assistant</div>';
  else if (!list.length) html += '<div class="empty">Keine Lautsprecher verfügbar</div>';
  html += list.map(p => {
    const g = groupInfo(p), st = pstate(p);
    const sub = [st === "playing" ? "spielt" : st === "paused" ? "pausiert" : "bereit", g.isGroup ? "Gruppe · " + g.n + " Lautsprecher" : ""].filter(Boolean).join(" · ");
    return '<button class="row prow' + (p.player_id === S.pid ? " on" : "") + '" data-id="' + esc(p.player_id) + '"><span class="pic">' + ICON.speaker +
      '</span><span class="rm"><span class="r1">' + esc(pname(p)) + '</span><span class="r2">' + esc(sub) + '</span></span><span class="chk">' + ICON.check + "</span></button>";
  }).join("");
  openSheet("players", html, c => c.querySelectorAll(".prow").forEach(b => {
    b.onclick = () => { const id = b.dataset.id; closeSheet(); selectPlayer(id); toast("Lautsprecher: " + pname(S.players[id])); };
  }));
}
$("#plBtn").onclick = openPlayers;

/* ---------- Suche ---------- */
const TYPES = { all: ["track", "artist", "album", "playlist"], track: ["track"], artist: ["artist"], album: ["album"], playlist: ["playlist"] };
const LABEL = { track: "Titel", artist: "Künstler", album: "Alben", playlist: "Playlists" };
const RKEY = { track: "tracks", artist: "artists", album: "albums", playlist: "playlists" };
function subOf(it) {
  const t = it.media_type;
  if (t === "track") return [artistsOf(it), it.album && it.album.name].filter(Boolean).join(" · ");
  if (t === "album") return [artistsOf(it), it.year].filter(Boolean).join(" · ") || "Album";
  if (t === "artist") return "Künstler";
  if (t === "playlist") return it.owner ? "Playlist · " + it.owner : "Playlist";
  return "";
}
async function doSearch() {
  const term = $("#q").value.trim(), box = $("#sRes");
  $("#qClr").hidden = !term;
  const seq = ++S.sSeq;
  if (term.length < 2) { S.sRes = null; box.innerHTML = '<div class="empty">Wonach suchst du?</div>'; return; }
  if (!S.ready) { box.innerHTML = '<div class="empty">Keine Verbindung zu Music Assistant</div>'; return; }
  box.innerHTML = '<div class="spin"></div>';
  try {
    const r = await cmd("music/search", { search_query: term, media_types: TYPES[S.filter], limit: S.filter === "all" ? 10 : 40 }, 25000);
    if (seq !== S.sSeq) return;
    S.sRes = r || {}; renderResults();
  } catch (e) {
    if (seq !== S.sSeq) return;
    box.innerHTML = '<div class="empty">Suche fehlgeschlagen: ' + esc(errText(e)) + "</div>";
  }
}
function renderResults() {
  const r = S.sRes, box = $("#sRes"); S.sItems = [];
  if (!r) return;
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
        '<span class="rm"><span class="r1">' + esc(it.name) + '</span><span class="r2">' + esc(subOf(it)) + '</span></span><span class="go">' + ICON.dots + "</span></button>";
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
$("#q").addEventListener("input", () => later(doSearch, 380, "search"));
$("#q").addEventListener("keydown", e => { if (e.key === "Enter") { clearTimeout(timers.search); doSearch(); $("#q").blur(); } });
$("#qClr").onclick = () => { $("#q").value = ""; doSearch(); $("#q").focus(); };
$("#chips").onclick = e => { const c = e.target.closest(".chip"); if (c) setFilter(c.dataset.f); };
$("#sRes").onclick = e => {
  const more = e.target.closest(".more"); if (more) { setFilter(more.dataset.f); return; }
  const row = e.target.closest(".row"); if (!row) return;
  const it = S.sItems[+row.dataset.i]; if (it) openItem(it);
};
function openItem(it) {
  const html = '<div class="ihead">' + thumb(imgUrl(it, 240), "lg" + (it.media_type === "artist" ? " round" : "")) +
    '<span class="rm"><span class="r1">' + esc(it.name) + '</span><span class="r2">' + esc(subOf(it)) + "</span></span></div>" +
    '<button class="act pri" data-o="play">' + ICON.play + "Jetzt spielen</button>" +
    '<button class="act" data-o="next">' + ICON.nextup + "Als Nächstes</button>" +
    '<button class="act" data-o="add">' + ICON.plus + "Hinten anstellen</button>" +
    '<button class="act ghost" data-o="">Abbrechen</button>';
  openSheet("item", html, c => c.querySelectorAll(".act").forEach(b => {
    b.onclick = () => { closeSheet(); if (b.dataset.o) enqueue(it, b.dataset.o); };
  }));
}
async function enqueue(it, opt) {
  const ok = await qc("play_media", { media: it.uri, option: opt });
  if (!ok) return;
  toast(opt === "play" ? "Spielt jetzt: " + it.name : opt === "next" ? "Kommt als Nächstes: " + it.name : "Hinten angestellt: " + it.name);
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
  const box = $("#qList"), n = nowInfo(), q = S.q;
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
      '<button class="ib" data-a="up" aria-label="Nach oben"' + (canMoveUp(i) ? "" : " disabled") + ">" + ICON.up + "</button>" +
      '<button class="ib" data-a="del" aria-label="Entfernen">' + ICON.x + "</button></div>";
  }).join("");
  box.innerHTML = html;
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
renderAll();
connect();
})();
