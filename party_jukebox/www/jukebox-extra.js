/* ===================== Jukebox: Teilnehmer + Android-Medien-Anbindung =====================
   - Teilnehmer-Laufband unter der Kopfzeile: wer gerade auf der Party-Seite dabei ist (party/guests.json).
   - Android-App-Hülle mit Medien-Schnittstelle (window.AndroidMediaSession, z. B. eigene Jukebox-APK):
     Player-Benachrichtigung / Sperrbildschirm / Uhr (Titel, Cover, Play/Pause) und Lautstärketasten.
     Ohne diese Schnittstelle (Browser, iPhone) passiert hier nichts. */
(function () {
"use strict";
const JB = window.JB; if (!JB) return;
const { S, $, esc, groupInfo, nowInfo, isPlaying, togglePlay, volSet, elapsed } = JB;

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
