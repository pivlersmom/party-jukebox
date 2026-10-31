/* Party-Jukebox TV für Samsung (Tizen): zeigt <Adresse>/tv.html im Vollbild, Bildschirmschoner aus.
   Einrichtung: Adresse eingeben → Testen → Speichern. Zurück lange drücken / 3× Zurück = Einstellungen, 2× Zurück = Beenden. */
(function () {
  'use strict';
  var KEY = 'pj_tv_addr', $ = function (id) { return document.getElementById(id); };
  var tv = $('tv'), setup = $('setup'), off = $('off'), inp = $('addr'), msg = $('msg');
  var base = '', retryT = null, backTimes = [], backDown = 0;

  function norm(a) {
    a = String(a || '').trim().replace(/\/+$/, '').replace(/\/(tv|start|jukebox|party)\.html.*$/i, '');
    if (!a) return '';
    if (!/^https?:\/\//i.test(a)) a = 'http://' + a;
    if (!/:\d+$/.test(a.split('://')[1])) a += ':8099';
    return a;
  }
  function say(t, cls) { msg.textContent = t; msg.className = cls || ''; }

  /* Erreichbar? config.js des Add-ons laden (als Skript – klappt ohne CORS) */
  function probe(a, cb) {
    var s = document.createElement('script'), done = false;
    var fin = function (ok) { if (done) return; done = true; try { s.remove(); } catch (e) {} cb(ok); };
    s.onload = function () { fin(true); }; s.onerror = function () { fin(false); };
    setTimeout(function () { fin(false); }, 8000);
    s.src = a + '/config.js?_=' + Date.now(); document.head.appendChild(s);
  }

  function screenSaver(offOn) {
    try { webapis.appcommon.setScreenSaver(offOn ? webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF : webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON); } catch (e) {}
  }

  function showSetup() {
    clearTimeout(retryT); tv.style.display = 'none'; off.style.display = 'none'; setup.style.display = 'flex';
    inp.value = base || 'http://'; say(''); setTimeout(function () { inp.focus(); }, 100);
  }
  function start() {
    setup.style.display = 'none';
    probe(base, function (ok) {
      if (!ok) { tv.style.display = 'none'; off.style.display = 'flex'; clearTimeout(retryT); retryT = setTimeout(start, 10000); return; }
      off.style.display = 'none'; tv.style.display = 'block';
      if (!tv.src || tv.src.indexOf(base) !== 0) tv.src = base + '/tv.html';
      screenSaver(true);
    });
  }

  $('test').onclick = function () {
    var a = norm(inp.value); if (!a) { say('Bitte eine Adresse eingeben.', 'err'); return; }
    say('Teste Verbindung …'); probe(a, function (ok) { say(ok ? '✔ Party-Jukebox gefunden: ' + a : '✖ Unter ' + a + ' nicht erreichbar', ok ? 'ok' : 'err'); });
  };
  $('save').onclick = function () {
    var a = norm(inp.value); if (!a) { say('Bitte eine Adresse eingeben.', 'err'); return; }
    say('Teste Verbindung …');
    probe(a, function (ok) {
      if (!ok) { say('✖ Unter ' + a + ' nicht erreichbar – trotzdem gespeichert, neuer Versuch läuft.', 'err'); }
      base = a; try { localStorage.setItem(KEY, a); } catch (e) {}
      tv.src = ''; setTimeout(start, ok ? 300 : 1500);
    });
  };

  /* Fernbedienung: Pfeile zwischen Feld und Knöpfen, Zurück-Logik */
  var order = [inp, $('test'), $('save')];
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (setup.style.display === 'flex') {
      var i = order.indexOf(document.activeElement);
      if (k === 40 && i === 0) { order[1].focus(); e.preventDefault(); }
      else if (k === 38 && i > 0) { inp.focus(); e.preventDefault(); }
      else if (k === 39 && i === 1) { order[2].focus(); e.preventDefault(); }
      else if (k === 37 && i === 2) { order[1].focus(); e.preventDefault(); }
      else if (k === 13 && i === 0) { order[2].focus(); e.preventDefault(); }
      else if (k === 10009) { e.preventDefault(); if (base) start(); else exitApp(); }
      return;
    }
    if (k === 10009) {                      /* Zurück */
      e.preventDefault();
      if (!backDown) backDown = Date.now();
      var now = Date.now(); backTimes = backTimes.filter(function (t) { return now - t < 1500; }); backTimes.push(now);
      if (backTimes.length >= 3) { backTimes = []; showSetup(); }
    }
  });
  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== 10009 || !backDown) return;
    var held = Date.now() - backDown; backDown = 0;
    if (held > 900) { backTimes = []; showSetup(); return; }
    setTimeout(function () { if (backTimes.length === 2) { backTimes = []; exitApp(); } }, 600);
  });
  function exitApp() { try { tizen.application.getCurrentApplication().exit(); } catch (e) { window.close(); } }

  /* Medientasten ans Gerät melden (sonst kommen sie nicht an) */
  try { ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaFastForward', 'MediaRewind', 'ColorF0Red'].forEach(function (n) { tizen.tvinputdevice.registerKey(n); }); } catch (e) {}

  document.addEventListener('visibilitychange', function () { if (!document.hidden && base && setup.style.display !== 'flex') start(); });

  try { base = localStorage.getItem(KEY) || ''; } catch (e) {}
  if (base) start(); else showSetup();
})();
