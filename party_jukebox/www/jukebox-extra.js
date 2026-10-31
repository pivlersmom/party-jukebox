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
};
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
}
setInterval(sync, 1000);
setTimeout(sync, 1500);
})();
