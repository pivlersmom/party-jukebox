/* ===================== Party-Jukebox TV: Grundgerüst =====================
   - Music Assistant über den Add-on-Proxy (ma/ws). Anmeldung mit Token "addon" – den echten Token setzt der Server ein.
   - Player: PJ.player (MA-Player-ID oder Name); leer/nicht gefunden → der Player, der gerade spielt.
   - aktueller Song (Cover, Titel, Fortschritt), Warteschlange + zuletzt gespielt (player_queues/items).
   - Uhr, Party-Titel (PJ.name), Lite-Modus (Jukebox-Einstellung; Automatisch = nur Raspberry Pi; ?lite=1 / ?lite=0).
   - ohne MA-Token: Hinweis "Music Assistant im Add-on einrichten".
   - lädt die Seite neu, sobald die TV-Dateien geändert wurden (Add-on-Update).
   Andere Module hängen sich ein: TV.on('ma'|'track'|'qstate'|'queue'|'frame'|'wishes', fn). */
(function(){
'use strict';
var PJ=window.PJ||{};
var TV=window.TV={cfg:PJ,ok:false,pid:null,qid:null,q:null,cur:null,pos:0,dur:0,playing:false,items:[],prev:[],
  W:{w:[],bo:[],bi:[],bc:[],bt:0,vote:{}}};
var H={};
TV.on=function(e,f){ (H[e]=H[e]||[]).push(f); };
TV.emit=function(e,d){ var l=H[e]||[]; for(var i=0;i<l.length;i++){ try{ l[i](d); }catch(x){ if(window.console) console.error(x); } } };
var $=TV.$=function(i){ return document.getElementById(i); };
TV.esc=function(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
TV.nz=function(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9äöüß]/g,''); };
TV.fmt=function(s){ s=Math.max(0,Math.floor(+s||0)); return Math.floor(s/60)+':'+(s%60<10?'0':'')+(s%60); };
TV.cssUrl=function(u){ return u?'url("'+String(u).replace(/["\\\n\r]/g,function(c){ return encodeURIComponent(c); })+'")':''; };
TV.NOTE='<svg class="ic" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
function noop(){}

/* ---------- Lite-Modus + TV-Einstellungen aus der Jukebox ---------- */
(function(){
  var ua=navigator.userAgent+' '+(navigator.platform||''), auto=/aarch64|armv\d|arm64|\barm\b/i.test(ua)&&!/Android/i.test(ua), q=null;
  try{ q=new URLSearchParams(location.search).get('lite'); localStorage.removeItem('tv_lite'); }catch(e){}
  TV.set={lyr_offset:0.5,tv_lite:'auto'};
  function apply(){
    var m=TV.set.tv_lite, on=q==='1'?true:q==='0'?false:m==='on'?true:m==='off'?false:auto;
    TV.lite=on; document.documentElement.classList.toggle('lite',on);
  }
  apply();
  TV.loadSet=function(){
    return fetch('party/tv.json?_='+Date.now(),{cache:'no-store'}).then(function(r){ return r.ok?r.json():null; }).then(function(j){
      if(!j) return;
      var ch=j.lyr_offset!==TV.set.lyr_offset||j.tv_lite!==TV.set.tv_lite||j.name!==TV.set.name;
      TV.set=j; if(ch){ apply(); TV.emit('set',j); }
    }).catch(function(){});
  };
  TV.loadSet(); setInterval(TV.loadSet,10000);
})();

/* ---------- Party-Titel ---------- */
var NAME=String(PJ.name||'Party-Jukebox');
document.title=NAME+' · TV';
function setName(n){
  NAME=String(n||'Party-Jukebox'); document.title=NAME+' · TV';
  var b=$('brandName'); if(!b) return;
  b.textContent=NAME;
  b.style.fontSize=NAME.length>10?Math.max(2.2,Math.min(3.6,36/NAME.length))+'vh':'';
}
setName(NAME);
TV.on('set',function(j){ if(j&&j.name&&j.name!==NAME) setName(j.name); });

/* ---------- Uhr ---------- */
function clk(){
  var d=new Date();
  $('clkH').textContent=(d.getHours()<10?'0':'')+d.getHours();
  $('clkM').textContent=(d.getMinutes()<10?'0':'')+d.getMinutes();
  $('clkW').textContent=d.toLocaleDateString('de-DE',{weekday:'long'});
  $('clkDt').textContent=d.toLocaleDateString('de-DE',{day:'numeric',month:'long'});
}
clk(); setInterval(clk,5000);

/* ---------- Hinweise ---------- */
TV.note=function(t){
  var n=$('maNote'); if(!n) return;
  if(t) n.textContent=t;
  n.classList.toggle('on',!!t);
};

/* ---------- MA-Daten umwandeln ---------- */
TV.img=function(im,size){
  if(!im) return '';
  if(typeof im==='string') return im;
  var sz=[80,160,256,512,1024].filter(function(x){return x>=(size||256);})[0]||1024;
  if(im.proxy_id) return 'ma/imageproxy/'+encodeURIComponent(im.proxy_id)+'?size='+sz;
  if(!im.path) return '';
  if(/^https?:\/\//i.test(im.path) && im.remotely_accessible!==false) return im.path;
  return 'ma/imageproxy?size='+sz+'&provider='+encodeURIComponent(im.provider||'')+'&path='+encodeURIComponent(im.path);
};
function pickImg(it){
  var mi=it.media_item||{};
  if(it.image) return it.image;
  if(mi.image) return mi.image;
  var l=(mi.metadata&&mi.metadata.images)||[];
  for(var i=0;i<l.length;i++) if(l[i]&&l[i].type==='thumb') return l[i];
  if(mi.album){ if(mi.album.image) return mi.album.image; var al=(mi.album.metadata&&mi.album.metadata.images)||[]; if(al[0]) return al[0]; }
  return l[0]||null;
}
function provOf(uri){ var m=String(uri||'').match(/^([a-z0-9_]+(?:--[A-Za-z0-9]+)?):\/\//); return m&&m[1]!=='library'?m[1]:''; }
TV.conv=function(it,size){
  if(!it) return null;
  var mi=it.media_item||{};
  var ar=(mi.artists||[]).map(function(a){ return a&&a.name; }).filter(Boolean).join(', ');
  var nm=it.name||'', t=mi.name||nm, a=ar||mi.artist_str||'';
  var sd=it.streamdetails||{}, st=sd.stream_title||'';
  if((mi.media_type==='radio'||it.media_type==='radio') && st){ var p=st.split(' - '); if(p.length>1){ a=p[0]; t=p.slice(1).join(' - '); } else t=st; }
  else if(!mi.name && !a && nm.indexOf(' - ')>0){ a=nm.split(' - ')[0]; t=nm.split(' - ').slice(1).join(' - '); }
  var uri=mi.uri||it.uri||'', pm=mi.provider_mappings||[];
  return {title:t,artist:a,album:(mi.album&&mi.album.name)||'',image:TV.img(pickImg(it),size||256),uri:uri,
    dur:+(it.duration||mi.duration)||0,qi:it.queue_item_id||'',type:it.media_type||mi.media_type||'',
    prov:provOf(uri)||(pm[0]&&pm[0].provider_instance)||''};
};
function isTrack(it){ var mt=it.media_type||(it.media_item&&it.media_item.media_type); return mt?mt==='track':(+it.duration||0)>20; }

/* Gastwünsche / Vordrängler zum Song finden (Daten aus party/wishes.json, siehe tv-party.js) */
TV.match=function(list,it,maxAge){
  if(!it||!list) return null;
  var t=TV.nz(it.title), a=TV.nz(it.artist), now=Date.now()/1000;
  for(var i=list.length-1;i>=0;i--){
    var x=list[i]; if(!x) continue;
    if(maxAge && now-x.t>maxAge) continue;
    if(x.u && it.uri && x.u===it.uri) return x;
    var s=TV.nz(x.s);
    if(s && t && t.indexOf(s)===0 && (!x.a || a.indexOf(TV.nz(String(x.a).split(',')[0]))>=0)) return x;
  }
  return null;
};
TV.wishOf=function(it){ return TV.match(TV.W.w,it,0); };
TV.boostOf=function(it){ return TV.match(TV.W.bo,it,3*3600); };

/* ---------- MA-WebSocket ---------- */
var ws=null, mid=0, pend={}, retryT=null, fails=0, P={};
TV.players=P;
function wsUrl(){
  var u=new URL('ma/ws',location.href);
  u.protocol=location.protocol==='https:'?'wss:':'ws:';
  return u.href;
}
TV.send=function(cmd,args,timeout){
  return new Promise(function(res,rej){
    if(!ws||ws.readyState!==1){ rej(new Error('ws_not_ready')); return; }
    var id='tv'+(++mid);
    pend[id]={res:res,rej:rej,acc:null};
    setTimeout(function(){ if(pend[id]){ delete pend[id]; rej(new Error('timeout')); } },timeout||10000);
    ws.send(JSON.stringify({message_id:id,command:cmd,args:args||{}}));
  });
};
function connect(){
  clearTimeout(retryT);
  try{ ws=new WebSocket(wsUrl()); }catch(e){ later(); return; }
  var me=ws;
  ws.onopen=function(){
    TV.send('auth',{token:'addon'}).then(function(){
      TV.ok=true; fails=0; TV.note('');
      TV.send('subscribe_events',{}).catch(noop);   /* nur ältere MA-Versionen brauchen das */
      loadPlayers().then(poll);
      TV.emit('ma',true);
    }).catch(function(){
      TV.note('Music Assistant: Anmeldung fehlgeschlagen – Token im Add-on prüfen');
      try{ me.close(); }catch(x){}
    });
  };
  ws.onmessage=onMsg;
  ws.onerror=noop;
  ws.onclose=function(){
    if(ws!==me) return;
    var was=TV.ok; TV.ok=false; TV.playing=false; ws=null;
    for(var k in pend){ try{ pend[k].rej(new Error('closed')); }catch(e){} } pend={};
    if(was){ TV.emit('ma',false); paintNow(); }
    later();
  };
}
function later(){
  fails++;
  if(fails>2 && !/Anmeldung/.test(($('maNote')||{}).textContent||'')) TV.note('Music Assistant nicht erreichbar – neuer Versuch …');
  clearTimeout(retryT); retryT=setTimeout(connect,Math.min(30000,3000*fails));
}
function onMsg(ev){
  var m; try{ m=JSON.parse(ev.data); }catch(e){ return; }
  if(m.message_id!=null && pend[m.message_id]){
    var p=pend[m.message_id];
    if(m.partial){ p.acc=(p.acc||[]).concat(m.result||[]); return; }
    delete pend[m.message_id];
    if(m.error_code) p.rej(new Error(m.details||m.error_code));
    else p.res(p.acc?p.acc.concat(m.result||[]):m.result);
    return;
  }
  var e=m.event, d=m.data; if(!e) return;
  if(e==='player_updated'||e==='player_added'){ if(d&&d.player_id) P[d.player_id]=d; }
  else if(e==='player_removed'){ var rid=m.object_id||(d&&d.player_id); if(rid) delete P[rid]; }
  else if(e==='queue_updated'){ if(d&&d.queue_id&&d.queue_id===TV.qid) applyQueue(d); }
  else if(e==='queue_items_updated'){ if((m.object_id||(d&&d.queue_id))===TV.qid) loadItems(true); }
  else if(e==='queue_time_updated'){
    /* MA schickt die Zeit teils als nackte Zahl, teils unplausibel → nur kleine Korrekturen übernehmen */
    var qid=m.object_id||(d&&d.queue_id), el=typeof d==='number'?d:(d&&(d.elapsed_time!=null?d.elapsed_time:d.seconds));
    if(qid===TV.qid && typeof el==='number' && el>0 && (TV.pos<=0||Math.abs(el-TV.pos)<10)) TV.pos=el;
  }
}
function loadPlayers(){
  return TV.send('players/all',{}).then(function(list){
    if(!Array.isArray(list)) return;
    for(var k in P) delete P[k];
    list.forEach(function(p){ if(p&&p.player_id) P[p.player_id]=p; });
  }).catch(noop);
}

/* ---------- Player wählen ---------- */
function pst(p){ return (p&&(p.playback_state||p.state))||''; }
function pname(p){ return (p&&(p.display_name||p.name))||''; }
function pick(){
  var list=[]; for(var k in P){ var p=P[k]; if(p && p.available!==false && p.enabled!==false) list.push(p); }
  var want=String(PJ.player||'').trim().toLowerCase();
  if(want){
    for(var i=0;i<list.length;i++) if(String(list[i].player_id).toLowerCase()===want) return list[i];
    for(i=0;i<list.length;i++) if(pname(list[i]).toLowerCase()===want||String(list[i].name||'').toLowerCase()===want) return list[i];
  }
  /* sonst: spielend vor pausiert; Sync-Mitglieder und HA-Spiegel-Player nachrangig; aktueller bleibt bei Gleichstand */
  function score(p){
    var s=pst(p), v=s==='playing'?0:(s==='paused'?4:99);
    if(p.synced_to) v+=2;
    if(p.provider==='hass_players') v+=1;
    return v;
  }
  var best=null, bs=99;
  list.forEach(function(p){ var s=score(p); if(s<bs || (s===bs && p.player_id===TV.pid)){ best=p; bs=s; } });
  if(best && bs<99) return best;
  return TV.pid&&P[TV.pid]?P[TV.pid]:null;
}
function poll(){
  if(!TV.ok) return;
  var p=pick();
  if(!p){ TV.pid=null; $('player-name').textContent='–'; return; }
  if(p.player_id!==TV.pid){ TV.pid=p.player_id; }
  $('player-name').textContent=pname(p)||p.player_id;
  TV.send('player_queues/get_active_queue',{player_id:p.player_id}).then(function(q){
    if(q&&q.queue_id) return q;
    return TV.send('player_queues/get',{queue_id:p.player_id});
  },function(){ return TV.send('player_queues/get',{queue_id:p.player_id}); })
  .then(function(q){ if(q&&q.queue_id) applyQueue(q,true); }).catch(noop);
}
setInterval(poll,2000);
setInterval(function(){ if(TV.ok) loadPlayers(); },30000);

/* ---------- Warteschlangen-Zustand ---------- */
var curKey='';
function applyQueue(q,full){
  if(!full && TV.q && TV.q.queue_id===q.queue_id) q=Object.assign({},TV.q,q);   /* Teil-Updates */
  TV.q=q; TV.qid=q.queue_id;
  TV.playing=q.state==='playing';
  var ci=q.current_item||null, cur=TV.conv(ci,600);
  var key=ci?(ci.queue_item_id||'')+'|'+(cur.uri||cur.title):'';
  var el=null;
  if(q.corrected_elapsed_time!=null) el=+q.corrected_elapsed_time;
  else if(q.elapsed_time!=null){
    el=+q.elapsed_time;
    var ts=+q.elapsed_time_last_updated||0;
    if(ts && TV.playing){ var age=(Date.now()-(ts>1e12?ts:ts*1000))/1000; if(age>0&&age<30) el+=age; }
  }
  var changed=key!==curKey;
  if(changed){
    curKey=key; TV.cur=cur; TV.dur=cur?cur.dur:0; TV.pos=el!=null&&el>=0?el:0;
  }else{
    TV.cur=cur;
    if(cur&&cur.dur) TV.dur=cur.dur;
    if(el!=null && el>=0 && !(el<=0.5 && TV.playing && TV.pos>3) && (!TV.playing||Math.abs(el-TV.pos)>1.5)) TV.pos=el;
  }
  if(TV.dur>0 && TV.pos>TV.dur) TV.pos=TV.dur;
  paintNow();
  if(changed) TV.emit('track',TV.cur);
  TV.emit('qstate',q);
  loadItems(changed);
}

/* Warteschlange + zuletzt gespielt mit einer Abfrage holen.
   Der aktuelle Titel wird über queue_item_id gesucht (je nach MA-Version steht er in items oder nicht). */
var itKey='', itAt=0, itBusy=false;
function loadItems(force){
  var q=TV.q; if(!q||!TV.ok) return;
  var ci=q.current_index, cqi=q.current_item&&q.current_item.queue_item_id;
  var k=q.queue_id+'|'+ci+'|'+q.items+'|'+(cqi||'');
  if(!force && (itBusy || (k===itKey && Date.now()-itAt<20000))) return;
  itKey=k; itAt=Date.now(); itBusy=true;
  var c=(typeof ci==='number'&&ci>=0)?ci:0, start=Math.max(0,c-6), rel=c-start;
  TV.send('player_queues/items',{queue_id:q.queue_id,limit:rel+12,offset:start}).then(function(r){
    itBusy=false;
    var all=Array.isArray(r)?r:((r&&r.items)||[]), idx=-1, before, after;
    if(cqi) for(var i=0;i<all.length;i++) if(all[i]&&all[i].queue_item_id===cqi){ idx=i; break; }
    if(idx>=0){ before=all.slice(0,idx); after=all.slice(idx+1); }
    else if(!q.current_item){ before=[]; after=all.slice(rel); }
    else{
      before=all.slice(0,rel); after=all.slice(rel);
      if(after[0] && TV.cur && TV.conv(after[0]).uri===TV.cur.uri) after=after.slice(1);
    }
    TV.prev=before.filter(isTrack).reverse().slice(0,3).map(function(x){ return TV.conv(x,256); });
    TV.items=after.slice(0,10).map(function(x){ return TV.conv(x,256); });
    TV.emit('queue');
  }).catch(function(){ itBusy=false; itKey=''; });
}
TV.reloadItems=function(){ loadItems(true); };

/* ---------- Anzeige "Läuft gerade" ---------- */
var lastImg=null;
function setText(id,t){ var el=$(id); if(el && el.textContent!==t) el.textContent=t; }
function paintNow(){
  var c=TV.cur, img=$('art-img'), em=$('art-emoji'), src=(c&&c.image)||'';
  if(src!==lastImg){
    lastImg=src;
    if(src){ img.src=src; img.style.display='block'; em.style.display='none'; $('art-bg').style.backgroundImage=TV.cssUrl(src); }
    else{ img.removeAttribute('src'); img.style.display='none'; em.style.display=''; $('art-bg').style.backgroundImage='none'; }
  }
  setText('now-title',(c&&c.title)||'Juke it!');
  setText('now-artist',c?(c.artist||''):'Bereit...');
  setText('now-album',(c&&c.album)||'');
  document.body.classList.toggle('paused',!TV.playing);
  $('progWrap').classList.toggle('hide',!(TV.dur>0));
}
$('art-img').addEventListener('error',function(){ this.style.display='none'; $('art-emoji').style.display=''; });

/* Fortschritt: selbst hochzählen (Intervall statt rAF – TV-Browser drosseln rAF) */
var lastTick=Date.now();
setInterval(function(){
  var n=Date.now(), dt=(n-lastTick)/1000; lastTick=n;
  if(TV.playing && dt>0 && dt<5){ TV.pos+=dt; if(TV.dur>0 && TV.pos>TV.dur) TV.pos=TV.dur; }
  if(TV.dur>0){
    $('prog').style.width=(Math.min(TV.pos,TV.dur)/TV.dur*100)+'%';
    setText('pos-t',TV.fmt(TV.pos)); setText('dur-t',TV.fmt(TV.dur));
  }
  TV.emit('frame',TV.pos);
},250);

/* ---------- Start ---------- */
if(window.PJ && !PJ.maToken){ $('setup').classList.add('on'); }
else connect();

/* ---------- Neu laden, wenn die TV-Dateien geändert wurden ---------- */
var FILES=['tv.html','tv.css','tv-core.js','tv-lyrics.js','tv-queue.js','tv-party.js'], stamp=null;
function chk(){
  Promise.all(FILES.map(function(u){
    return fetch(u+'?_='+Date.now(),{method:'HEAD',cache:'no-store'})
      .then(function(r){ return r.ok?(r.headers.get('etag')||r.headers.get('last-modified')||''):''; })
      .catch(function(){ return ''; });
  })).then(function(a){
    if(a.some(function(x){ return !x; })) return;   /* Netz weg / Server startet → nichts tun */
    var s=a.join('|');
    if(stamp===null) stamp=s; else if(s!==stamp) location.reload();
  });
}
setTimeout(chk,5000); setInterval(chk,60000);

/* ---------- Vollbild im Browser des Fernsehers (Samsung/LG/PC) ----------
   Browser erlauben Vollbild nur nach einem Tastendruck: Hinweis zeigen, OK/Enter/Klick schaltet um.
   Nicht in den Apps (Android-TV-App = WebView, Samsung-App = iframe). */
(function(){
  var ua=navigator.userAgent||'';
  if(window.top!==window || /; wv\)|PartyJukebox/i.test(ua)) return;
  var d=document, el=d.documentElement;
  var req=el.requestFullscreen||el.webkitRequestFullscreen||el.msRequestFullscreen;
  if(!req) return;
  var isFs=function(){ return !!(d.fullscreenElement||d.webkitFullscreenElement); };
  var hint=d.createElement('div'); hint.id='fsHint'; hint.textContent='OK / Enter drücken = Vollbild';
  d.body.appendChild(hint);
  var hide=null;
  function show(){ if(isFs()) return; hint.classList.add('on'); clearTimeout(hide); hide=setTimeout(function(){ hint.classList.remove('on'); },10000); }
  function go(){ if(isFs()) return; try{ var r=req.call(el); if(r&&r.catch) r.catch(function(){}); }catch(e){} hint.classList.remove('on'); }
  d.addEventListener('keydown',function(e){ var k=e.key||'', c=e.keyCode; if(k==='Enter'||c===13||k==='f'||k==='F'){ go(); } });
  d.addEventListener('click',go);
  ['fullscreenchange','webkitfullscreenchange'].forEach(function(n){ d.addEventListener(n,function(){ if(!isFs()) show(); }); });
  setTimeout(show,2500);
})();
})();
