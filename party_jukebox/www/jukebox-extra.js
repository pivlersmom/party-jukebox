/* ===================== Jukebox: Teilnehmer + Android-Medien-Anbindung =====================
   - Teilnehmer-Laufband unter der Kopfzeile: wer gerade auf der Party-Seite dabei ist (party/guests.json).
   - Android-App-Hülle mit Medien-Schnittstelle (window.AndroidMediaSession, z. B. eigene Jukebox-APK):
     Player-Benachrichtigung / Sperrbildschirm / Uhr (Titel, Cover, Play/Pause) und Lautstärketasten.
     Ohne diese Schnittstelle (Browser, iPhone) passiert hier nichts. */
(function () {
"use strict";
const JB = window.JB; if (!JB) return;
const { S, $, esc, groupInfo, nowInfo, isPlaying, togglePlay, volSet, elapsed, cmd, toast } = JB;

/* ---------- Teilnehmer ---------- */
const bar = document.createElement("div");
bar.id = "guests"; bar.hidden = true;
bar.innerHTML = '<span class="gc"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/>' +
  '<path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14a6.5 6.5 0 0 1 3 6"/></svg><b id="gN">0</b></span><span class="vw"><span class="rn" id="gR"></span></span>';
const top = document.getElementById("top");
top.parentNode.insertBefore(bar, top.nextSibling);
let gSig = "";
function renderGuests(list) {
  bar.hidden = !list.length;
  document.getElementById("gN").textContent = list.length + " dabei";
  const sig = list.join("|"); if (sig === gSig) return; gSig = sig;
  const r = document.getElementById("gR");
  r.innerHTML = list.map(n => "<b>" + esc(n) + "</b>").join("<i>·</i>");
  r.style.setProperty("--d", Math.max(10, list.join("").length * 0.45 + list.length * 1.2) + "s");
}
function loadGuests() {
  fetch("party/guests.json?_=" + Date.now(), { cache: "no-store" }).then(r => r.ok ? r.json() : null)
    .then(j => renderGuests(j && Array.isArray(j.n) ? j.n : [])).catch(() => {});
}
loadGuests();
setInterval(() => { if (!document.hidden) loadGuests(); }, 10000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadGuests(); });

/* ---------- Favorit: Cover lange drücken (0,6 s) = zu Favoriten hinzufügen / entfernen ----------
   Favoriten haben einen Rahmen im Farbverlauf. Geprüft wird nur der laufende Titel (bei Wechsel + alle 20 s).
   Titel direkt von Tidal & Co. werden in der MA-Bibliothek nachgeschlagen (nur so lässt sich ein Favorit entfernen). */
(function () {
  const cv = $("#cover"); if (!cv) return;
  const fr = document.createElement("div"); fr.className = "favfr"; cv.appendChild(fr);
  let mi = null, lib = null, local = {}, busy = false, key = "";
  const curMi = () => { const ci = S.q && S.q.current_item; return (ci && ci.media_item) || null; };
  const isFav = () => !mi ? false : local[mi.uri] != null ? local[mi.uri] : lib ? !!lib.favorite : !!mi.favorite;
  const paint = () => cv.classList.toggle("fav", isFav());
  async function libOf(m) {
    if (!m) return null;
    if (m.provider === "library") return m;
    try { return await cmd("music/get_library_item", { media_type: m.media_type || "track", item_id: String(m.item_id), provider_instance_id_or_domain: m.provider }); }
    catch (e) { return null; }
  }
  async function load() {
    if (busy || !S.ready) return; busy = true;
    try { const m = curMi(); if (!m) { mi = null; lib = null; } else { if (!mi || mi.uri !== m.uri) delete local[m.uri]; mi = m; lib = await libOf(m); } }
    catch (e) {}
    busy = false; paint();
  }
  async function toggle() {
    const m = curMi(); if (!m) { toast("Gerade läuft kein Titel"); return; }
    if (!mi || mi.uri !== m.uri) { mi = m; lib = null; }
    const on = !isFav(); local[m.uri] = on; paint();
    if (window.pjCoverHint) window.pjCoverHint(on ? "❤️ Favorit" : "Kein Favorit mehr");
    try {
      if (on) { await cmd("music/favorites/add_item", { item: m.uri }); toast("❤️ Zu Favoriten hinzugefügt"); }
      else {
        const l = lib || await libOf(m);
        if (l && l.item_id != null) await cmd("music/favorites/remove_item", { media_type: l.media_type || m.media_type || "track", library_item_id: l.item_id });
        toast("Aus Favoriten entfernt");
      }
      setTimeout(() => { if (mi && mi.uri === m.uri) { delete local[m.uri]; lib = null; load(); } }, 2500);
    } catch (e) { local[m.uri] = !on; paint(); toast("Favorit ging nicht: " + ((e && e.message) || e)); }
  }
  let t = null, fired = false, x0 = 0, y0 = 0;
  const start = (x, y) => {
    fired = false; x0 = x; y0 = y; cv.classList.add("press"); clearTimeout(t);
    t = setTimeout(() => {
      fired = true; cv.classList.remove("press");
      try { navigator.vibrate && navigator.vibrate(30); } catch (e) {}
      toggle();
      cv.classList.remove("pop"); void cv.offsetWidth; cv.classList.add("pop");
      setTimeout(() => cv.classList.remove("pop"), 700);
    }, 600);
  };
  const stop = () => { clearTimeout(t); cv.classList.remove("press"); };
  cv.addEventListener("touchstart", e => start(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  cv.addEventListener("touchmove", e => { const p = e.touches[0]; if (Math.abs(p.clientX - x0) > 10 || Math.abs(p.clientY - y0) > 10) stop(); }, { passive: true });
  cv.addEventListener("touchend", stop); cv.addEventListener("touchcancel", stop);
  cv.addEventListener("mousedown", e => start(e.clientX, e.clientY));
  cv.addEventListener("mouseup", stop); cv.addEventListener("mouseleave", stop);
  cv.addEventListener("contextmenu", e => e.preventDefault());
  document.addEventListener("click", e => { if (fired && e.target.closest && e.target.closest("#cover")) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
  let n = 0;
  setInterval(() => {
    const m = curMi(), k = m ? m.uri : "";
    if (k !== key) { key = k; load(); } else if (++n % 20 === 0 && !document.hidden) load();
  }, 1000);
})();


/* ---------- Cover antippen: dreht sich einmal und zeigt den Songtext (wie auf dem TV) ----------
   Quellen: Music Assistant (LRC am Titel / Lyrics-Anbieter) → lrclib.net → normaler Text über die Songlänge verteilt.
   Versatz wie auf dem TV (Jukebox ⚙ → Songtext-Versatz). Nochmal antippen = zurück zum Cover. */
(function () {
  const cv = $("#cover"); if (!cv) return;
  const box = document.createElement("div"); box.className = "clyr";
  box.innerHTML = '<div class="cin"></div><div class="cmsg"></div>';
  cv.appendChild(box);
  const inner = box.querySelector(".cin"), msg = box.querySelector(".cmsg");
  let on = false, lines = null, key = "", act = -2, look = 0.5, gen = 0;
  const cache = {};
  const loadOff = () => fetch("party/tv.json?_=" + Date.now(), { cache: "no-store" }).then(r => r.ok ? r.json() : null)
    .then(j => { if (j && typeof j.lyr_offset === "number") look = j.lyr_offset; }).catch(() => {});
  loadOff();

  const isLrc = raw => /\[\d+:\d+(\.\d+)?\]/.test(String(raw || ""));
  function parseLrc(raw) {
    const out = [];
    String(raw || "").split(/\r?\n/).forEach(line => {
      const re = /\[(\d+):(\d+(?:\.\d+)?)\]/g; let m, last = 0; const ts = [];
      while ((m = re.exec(line)) && m.index === last) { ts.push(parseInt(m[1], 10) * 60 + parseFloat(m[2])); last = re.lastIndex; }
      if (!ts.length) return;
      const txt = line.slice(last).trim();
      ts.forEach(t => out.push({ t, text: txt }));
    });
    out.sort((a, b) => a.t - b.t);
    return out.length ? out : null;
  }
  const clean = t => String(t || "").replace(/\s*[\(\[][^\)\]]*(mix|remix|edit|version|remake|bootleg|extended|instrumental|live)[^\)\]]*[\)\]]/gi, "")
    .replace(/\s*-\s*(extended|radio|club|original)\s+(mix|edit|version).*$/gi, "").trim();
  const norm = x => String(x || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]/g, "");
  function hitOk(h, a, t) {
    if (!h) return false;
    const ha = norm(h.artistName), aa = norm(a), ht = norm(h.trackName), tt = norm(clean(t));
    return !!(ha && aa && ht && tt) && (ha.includes(aa) || aa.includes(ha)) && (ht.includes(tt) || tt.includes(ht));
  }
  const md = o => { const m = o && o.metadata; return (m && (m.lrc_lyrics || m.lyrics)) || ""; };
  async function maRaw(mi) {
    let r = md(mi); if (r) return r;
    if (!mi || !mi.uri) return "";
    try {
      const t = await cmd("music/item_by_uri", { uri: mi.uri }); r = md(t); if (r) return r;
      if (!t || (t.media_type && t.media_type !== "track")) return "";
      const x = await cmd("metadata/get_track_lyrics", { track: t }, 20000);
      if (typeof x === "string") return x;
      if (Array.isArray(x)) return x[1] || x[0] || "";
      return (x && (x.lrc_lyrics || x.lyrics)) || "";
    } catch (e) { return ""; }
  }
  const LRCLIB = "https://lrclib.net/api/";
  const lrcGet = (a, t) => fetch(LRCLIB + "get?artist_name=" + encodeURIComponent(a) + "&track_name=" + encodeURIComponent(t)).then(r => r.ok ? r.json() : null).catch(() => null);
  const lrcSearch = (a, t) => fetch(LRCLIB + "search?artist_name=" + encodeURIComponent(a) + "&track_name=" + encodeURIComponent(t)).then(r => r.ok ? r.json() : []).then(l => Array.isArray(l) ? l : []).catch(() => []);
  async function find(mi, n) {
    let plain = "";
    const take = raw => { if (!raw) return null; if (isLrc(raw)) { const l = parseLrc(raw); if (l) return l; } if (!plain) plain = raw; return null; };
    const a1 = String(n.artist || "").split("/")[0].split(",")[0].trim(), t = n.title || "", t2 = clean(t);
    const lr = h => { if (!hitOk(h, a1, t)) return null; if (h.syncedLyrics) { const l = parseLrc(h.syncedLyrics); if (l) return l; } if (h.plainLyrics && !plain) plain = h.plainLyrics; return null; };
    let l = take(await maRaw(mi)); if (l) return { lines: l };
    if (a1 && t) {
      l = lr(await lrcGet(a1, t)); if (l) return { lines: l };
      if (t2 && t2 !== t) { l = lr(await lrcGet(a1, t2)); if (l) return { lines: l }; }
      for (const h of await lrcSearch(a1, t2 || t)) { l = lr(h); if (l) return { lines: l }; }
    }
    return plain ? { plain } : null;
  }
  function spread(raw, dur) {
    const ls = String(raw || "").split(/\r?\n/).map(x => x.trim()).filter(x => x && !/^[\[(].*[\])]$/.test(x));
    if (ls.length < 3 || !dur) return null;
    const st = Math.min(15, dur * 0.08), step = (dur * 0.93 - st) / ls.length;
    return ls.map((x, i) => ({ t: st + i * step, text: x }));
  }
  function show(l, note) {
    lines = l && l.length ? l : null; act = -2;
    inner.innerHTML = lines ? lines.map(x => '<div class="l"><span>' + esc(x.text || "♪") + "</span></div>").join("") : "";
    inner.style.transform = "translateY(0)";
    msg.textContent = lines ? "" : (note || "");
  }
  async function load() {
    const n = nowInfo(), ci = S.q && S.q.current_item, mi = ci && ci.media_item;
    const k = n ? (n.key || "") + "|" + n.title : "";
    if (k === key) return; key = k;
    if (!n) { show(null, "Gerade läuft nichts"); return; }
    if (cache[k]) { apply(cache[k], n); return; }
    show(null, "Songtext wird gesucht …");
    const g = ++gen, res = await find(mi, n);
    cache[k] = res || { none: true };
    if (g === gen) apply(cache[k], n);
  }
  function apply(res, n) {
    if (res.lines) show(res.lines);
    else if (res.plain) show(spread(res.plain, n.dur), "Kein Songtext gefunden");
    else show(null, "Kein Songtext gefunden");
  }
  function tickL() {
    if (!on || !lines) return;
    const pos = elapsed() + look;
    let i = -1;
    for (let k = 0; k < lines.length; k++) { if (lines[k].t <= pos) i = k; else break; }
    const kids = inner.children;
    if (i !== act) {
      act = i;
      for (let k = 0; k < kids.length; k++) { kids[k].classList.remove("cur", "nx", "past"); if (k < i) kids[k].classList.add("past"); }
      if (i >= 0 && kids[i]) kids[i].classList.add("cur");
      if (kids[i + 1]) kids[i + 1].classList.add("nx");
    }
    const t = kids[Math.max(i, 0)]; if (!t || !box.clientHeight) return;
    const tr = "translateY(" + Math.round(box.clientHeight * 0.42 - (t.offsetTop + t.offsetHeight / 2)) + "px)";
    if (inner.style.transform !== tr) inner.style.transform = tr;
  }
  /* kurzer Einblender unten im Cover */
  const hint = document.createElement("div"); hint.className = "chint"; cv.appendChild(hint);
  let hintT = null;
  function say(txt, ms) {
    hint.textContent = txt; hint.classList.add("on"); clearTimeout(hintT);
    hintT = setTimeout(() => hint.classList.remove("on"), ms || 1600);
  }
  window.pjCoverHint = say;
  /* die ersten paar Male beim Öffnen zeigen, was das Cover kann */
  try {
    const n = +(localStorage.getItem("pj_cover_hint") || 0);
    if (n < 3) { localStorage.setItem("pj_cover_hint", n + 1); setTimeout(() => say("Antippen: Songtext · Halten: Favorit", 3200), 1800); }
  } catch (e) {}
  function flip() {
    say(on ? "🖼️ Cover" : "🎤 Songtext");
    cv.classList.remove("spin"); void cv.offsetWidth; cv.classList.add("spin");
    setTimeout(() => {
      on = !on; cv.classList.toggle("lyr", on);
      if (on) { loadOff(); key = ""; load(); act = -2; tickL(); }
    }, 300);
    setTimeout(() => cv.classList.remove("spin"), 650);
  }
  cv.addEventListener("click", () => { if (cv.classList.contains("press")) return; flip(); });
  setInterval(() => { if (on) { load(); tickL(); } }, 250);
  window.addEventListener("resize", () => { act = -2; });
})();


/* ---------- Zeile unter dem Titel: Übergänge · Audioqualität · AI DJ ----------
   Übergänge = Crossfade der Warteschlange (an: Kreise laufen ineinander).
   Qualität = Format des laufenden Titels (HQ / Hi-Res / MP3 …), antippen = Details mit Übertragungsrate.
   AI DJ = Moderator vom Music-Assistant-Plugin „AI Radio“ (nur sichtbar, wenn das Plugin da ist). */
(function () {
  const meta = document.querySelector("#v-now .meta"); if (!meta) return;
  const row = document.createElement("div"); row.className = "modes";
  row.innerHTML = '<span class="mside l"><button class="mbtn fade" id="mFade" aria-label="Übergänge"><i></i><i></i></button>' +
    '<button class="mbtn auto" id="mAuto" aria-label="Autoplay"><svg viewBox="0 0 32 16"><path d="M16 8c-3-4-5.5-6-8.5-6a6 6 0 0 0 0 12c3 0 5.5-2 8.5-6s5.5-6 8.5-6a6 6 0 0 1 0 12c-3 0-5.5-2-8.5-6z"/></svg></button></span>' +
    '<span class="mmid"><button class="aq" id="mAq" hidden></button></span>' +
    '<span class="mside r"><button class="mbtn dj" id="mDj" aria-label="AI DJ" hidden><b></b></button></span>';
  meta.after(row);
  const det = document.createElement("div"); det.className = "aqd"; row.after(det);
  const bF = row.querySelector("#mFade"), bQ = row.querySelector("#mAq"), bD = row.querySelector("#mDj"), bA = row.querySelector("#mAuto");
  const qid = () => S.qid || S.pid;

  /* Übergänge */
  let fadeHold = 0, fadeWant = false;
  const fadeOn = () => Date.now() < fadeHold ? fadeWant : !!(S.q && S.q.crossfade_enabled);
  bF.onclick = async () => {
    const id = qid(); if (!id || !S.ready) { toast("Music Assistant nicht verbunden"); return; }
    fadeWant = !fadeOn(); fadeHold = Date.now() + 4000; paint();
    try { await cmd("player_queues/crossfade", { queue_id: id, crossfade_enabled: fadeWant }); if (S.q) S.q.crossfade_enabled = fadeWant; toast("Übergänge " + (fadeWant ? "an" : "aus")); }
    catch (e) { fadeHold = 0; toast("Übergänge: " + ((e && e.message) || e)); }
    paint();
  };

  /* Autoplay: ist die Warteschlange zu Ende, hängt Music Assistant ähnliche Titel an (eingebaut, kein Plugin) */
  let autoHold = 0, autoWant = false;
  const autoOn = () => Date.now() < autoHold ? autoWant : !!(S.q && (S.q.autoplay_enabled || S.q.dont_stop_the_music_enabled));
  bA.onclick = async () => {
    const id = qid(); if (!id || !S.ready) { toast("Music Assistant nicht verbunden"); return; }
    autoWant = !autoOn(); autoHold = Date.now() + 4000; paint();
    try { await cmd("player_queues/autoplay", { queue_id: id, autoplay_enabled: autoWant }); if (S.q) S.q.autoplay_enabled = autoWant;
      toast(autoWant ? "Autoplay an – am Ende der Warteschlange kommen ähnliche Titel" : "Autoplay aus"); }
    catch (e) { autoHold = 0; const m = String((e && e.message) || e); toast(/repeat/i.test(m) ? "Autoplay geht nicht, solange Wiederholen an ist" : "Autoplay: " + m); }
    paint();
  };

  /* Audioqualität */
  function aq() {
    const ci = S.q && S.q.current_item, sd = ci && ci.streamdetails, af = sd && sd.audio_format;
    if (!af || !af.content_type) return null;
    const ct = String(af.content_type).toLowerCase(), lossless = /flac|wav|alac|aif|pcm/.test(ct);
    const sr = +af.sample_rate || 0, bd = +af.bit_depth || 0, ch = +af.channels || 2;
    const hires = lossless && (bd > 16 || sr > 48000);
    let br = +af.bit_rate || 0;
    if (!br && lossless && sr && bd) br = Math.round(sr * bd * ch / 1000);
    const name = ct.replace(/^pcm_.*/, "PCM").toUpperCase();
    return { short: hires ? "Hi-Res" : lossless ? "HQ" : name, lossless, hires,
      long: [name + (sr ? " " + (bd && lossless ? bd + "/" : "") + (sr / 1000).toString().replace(".", ",") + (bd && lossless ? "" : " kHz") : ""),
        br ? br + " kbit/s" : ""].filter(Boolean).join(" · ") };
  }
  let aqOpen = false, aqT = null;
  bQ.onclick = () => { aqOpen = !aqOpen; clearTimeout(aqT); if (aqOpen) aqT = setTimeout(() => { aqOpen = false; paint(); }, 6000); paint(); };

  /* AI DJ */
  let djAvail = false, djStatus = {}, hosts = [["minimal_dj", "Minimal DJ"], ["morning_show", "Morning show"], ["music_nerd", "Music nerd"], ["party_host", "Party host"]];
  const hostName = id => { const h = hosts.find(x => x[0] === id); return h ? h[1] : id; };
  async function djLoad() {
    if (!S.ready) return;
    try { djStatus = (await cmd("ai_radio/queue_dj/status")) || {}; djAvail = true; }
    catch (e) { djAvail = false; }
    paint();
  }
  async function djHosts() {
    try { const r = await cmd("ai_radio/hosts/list"); const l = (Array.isArray(r) ? r : Object.values(r || {})).map(h => [h.id || h.host_id, h.name || h.id]).filter(h => h[0]); if (l.length) hosts = l; } catch (e) {}
  }
  bD.onclick = async () => {
    const id = qid(); if (!id) { toast("Erst einen Lautsprecher wählen"); return; }
    await Promise.all([djHosts(), djLoad()]);
    const cur = djStatus[id] || null;
    const html = '<div class="shh">AI Radio DJ</div><div class="rshint" style="margin:0 6px 8px">Moderator zwischen den Titeln wählen.</div>' +
      hosts.map(([h, n]) => '<button class="act djh' + (h === cur ? " sel" : "") + '" data-h="' + esc(h) + '">' + esc(n) + (h === cur ? " ✓" : "") + "</button>").join("") +
      '<button class="act djh' + (!cur ? " sel" : "") + '" data-h="">Aus' + (!cur ? " ✓" : "") + '</button><button class="act ghost" data-x="1">Abbrechen</button>';
    JB.openSheet("dj", html, c => c.querySelectorAll(".act").forEach(b => b.onclick = async () => {
      JB.closeSheet(); if (b.dataset.x) return;
      const h = b.dataset.h || null;
      if (h) djStatus[id] = h; else delete djStatus[id];
      paint();
      try { djStatus = (await cmd("ai_radio/queue_dj/set", { queue_id: id, host_id: h })) || djStatus; toast(h ? "AI DJ: " + hostName(h) : "AI DJ aus"); }
      catch (e) { toast("AI DJ: " + ((e && e.message) || e)); djLoad(); }
      paint();
    }));
  };

  function paint() {
    bF.classList.toggle("on", fadeOn());
    bF.hidden = !S.q;
    bA.classList.toggle("on", autoOn()); bA.hidden = !S.q;
    const a = aq();
    bQ.hidden = !a;
    if (a) { bQ.textContent = a.short; bQ.classList.toggle("ll", a.lossless); bQ.classList.toggle("hr", a.hires); bQ.classList.toggle("open", aqOpen); }
    det.textContent = a && aqOpen ? a.long : ""; det.classList.toggle("on", !!(a && aqOpen));
    const id = qid(), dj = id && djStatus[id];
    bD.hidden = !djAvail; bD.classList.toggle("on", !!dj); bD.title = dj ? "AI DJ · " + hostName(dj) : "AI DJ";
    row.classList.toggle("empty", bF.hidden && bQ.hidden && bD.hidden && bA.hidden);
  }
  let lastQ = "", n = 0;
  setInterval(() => {
    const id = qid();
    if (id !== lastQ && S.ready) { lastQ = id; djLoad(); }
    if (++n % 30 === 0 && !document.hidden) djLoad();
    paint();
  }, 1000);
})();

/* ---------- Android-Medien-Anbindung ---------- */
const A = window.AndroidMediaSession;
if (!A) return;
const call = (f, ...a) => { try { if (typeof A[f] === "function") A[f](...a); } catch (e) {} };
const abs = u => { try { return u ? new URL(u, location.href).href : ""; } catch (e) { return ""; } };

function curVol() {
  const p = S.players[S.pid]; if (!p) return null;
  const v = groupInfo(p).isGroup ? (p.group_volume != null ? p.group_volume : p.volume_level) : p.volume_level;
  return v == null ? null : Math.round(v);
}

/* Befehle von Benachrichtigung, Sperrbildschirm, Uhr, Bluetooth-Tasten */
window.playerCmd = c => {
  if (c === "next") $("#bNext").click();
  else if (c === "prev" || c === "previous") $("#bPrev").click();
  else if (c === "play") { if (!isPlaying()) togglePlay(); }
  else if (c === "pause") { if (isPlaying()) togglePlay(); }
  else if (c === "play_pause" || c === "toggle") togglePlay();
  else if (String(c).startsWith("jump:")) {
    const it = qList[+String(c).slice(5)], qid = S.qid || S.pid;
    if (it && qid) cmd("player_queues/play_index", { queue_id: qid, index: it.queue_item_id }).catch(e => toast("Music Assistant: " + ((e && e.message) || e)));
  }
};

/* Warteschlange für Uhr / Sperrbildschirm (laufender Titel + die nächsten bis zu 30) */
let qList = [], qKey = "", qBusy = false;
async function syncQueue() {
  const q = S.q, qid = S.qid || S.pid;
  if (!q || !qid || qBusy || typeof A.updateQueue !== "function") return;
  const cur = q.current_item ? q.current_item.queue_item_id : "";
  const k = qid + "|" + cur + "|" + q.items + "|" + q.current_index;
  if (k === qKey) return;
  qBusy = true;
  try {
    const ci = q.current_index != null ? q.current_index : 0;
    const r = await cmd("player_queues/items", { queue_id: qid, limit: 31, offset: Math.max(0, ci) });
    let list = (r || []).filter(Boolean);
    if (cur && !(list[0] && list[0].queue_item_id === cur) && q.current_item) list = [q.current_item].concat(list.filter(x => x.queue_item_id !== cur));
    qList = list.slice(0, 31);
    const data = qList.map(x => { const m = x.media_item || {}; return { t: m.name || x.name || "", a: (m.artists || []).map(a => a && a.name).filter(Boolean).join(", ") }; });
    call("updateQueue", JSON.stringify(data), 0);
    qKey = k;
  } catch (e) {}
  qBusy = false;
}
Object.defineProperty(window, "ms", { configurable: true, get: () => ({ state: isPlaying() ? "playing" : "paused" }) });

/* Lautstärketasten des Handys bzw. Regler der Systemleiste/Uhr */
window.onVolumeKey = d => { const v = curVol(); if (v != null) volSet(v + (d > 0 ? 3 : -3)); };
window.onVolumeSet = v => { if (curVol() != null) volSet(+v); };

let mKey = null, pLast = null, vLast = null, vmLast = null, posT = 0;
function sync() {
  const n = nowInfo(), pl = isPlaying();
  const key = n ? n.title + "|" + n.artist + "|" + n.img : "";
  if (key !== mKey) {
    mKey = key; pLast = pl;
    call("updateMetadata", n ? n.title : "Jukebox", n ? n.artist : "", "", n ? abs(n.img) : "", "", pl);
    posT = 0;
  } else if (pl !== pLast) { pLast = pl; call("setPlaybackState", pl); posT = 0; }
  const now = Date.now();
  if (n && now - posT > 5000) { posT = now; call("updatePosition", Math.round(elapsed() * 1000), Math.round((n.dur || 0) * 1000), pl); }
  const v = curVol(), vm = v != null;
  if (vm !== vmLast) { vmLast = vm; call("setVolumeMode", vm); }
  if (vm && v !== vLast) { vLast = v; call("setVolume", v); }
  syncQueue();
}
setInterval(sync, 1000);
setTimeout(sync, 1500);
})();
