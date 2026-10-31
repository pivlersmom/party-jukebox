/* ===================== PARTY-JUKEBOX – Gästeseite (Logik) =====================
   Prinzip wie Music-Assistant-Party: QR-Code vom TV enthält den Join-Code (party.html?join=…).
   Der Code wird bei MA gegen ein Gast-Token getauscht (nur Gast-Rechte). Verbindung läuft über den
   WebSocket-Proxy des Add-ons (ma/ws) – nie mit dem Add-on-Token, nur über den Join-Code.
   Ohne ?join= wird optional party/join.json gefragt (Add-on-Endpunkt, falls vorhanden).
   Grenzen (Wünsche/Boosts, Nachfüllzeit, Duplikate) kommen aus der MA-Party-Konfiguration.
   Suche: erst sofort aus der eigenen Bibliothek, Streaming-Treffer werden unten nachgeladen;
   kurze Tipp-Pause, Zwischenspeicher für die letzten Suchen.
   Erweiterungen (party-guests.js) hängen sich über window.pjParty / pjBeforeAdd / pjAfterAdd /
   pjBeforeBoost / pjAfterBoost / pjOnNow / pjWishBy / pjBoostBy ein. */
(function(){
/* Adressen relativ zur Seite (funktioniert direkt auf Port 8099 und hinter einem Pfad-Präfix) */
var PJ=window.PJ||{};
var BASE=new URL('.',location.href);
var MA_EP={ws:BASE.href.replace(/^http/,'ws')+'ma/ws',http:BASE.href+'ma'};
var EPS=[MA_EP];
var epI=0, MA_WS=EPS[0].ws, MA_HTTP=EPS[0].http;
var LS='pj_party_';
var NOTE='<svg class="ic" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
var I_ADD='<svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
var I_BST='<svg class="ic" viewBox="0 0 24 24"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
var I_OK='<svg class="ic" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>';
var $=function(i){ return document.getElementById(i); };
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function lsGet(k,d){ try{ var v=localStorage.getItem(LS+k); return v==null?d:JSON.parse(v); }catch(e){ return d; } }
function lsSet(k,v){ try{ localStorage.setItem(LS+k,JSON.stringify(v)); }catch(e){} }
var tT=null; function toast(m){ var t=$('toast'); t.textContent=m; t.classList.add('on'); clearTimeout(tT); tT=setTimeout(function(){ t.classList.remove('on'); },2600); }
function fmt(s){ s=Math.max(0,Math.floor(s||0)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }

/* ---------- Join-Code aus URL ---------- */
var qs=new URLSearchParams(location.search), join=qs.get('join');
if(join){ if(join!==lsGet('join',null)) lsSet('tok',null); lsSet('join',join); qs.delete('join'); history.replaceState(null,'',location.pathname+(qs.toString()?'?'+qs:'')+location.hash); }
join=join||lsGet('join',null);
/* Join-Code vom Add-on holen (optionaler Endpunkt; 404 → null) */
function fetchJoin(){
  return fetch('party/join.json?_='+Date.now(),{cache:'no-store'}).then(function(r){ return r.ok?r.json():null; })
    .then(function(j){ var c=j&&j.code?String(j.code):null; if(c){ if(c!==join) lsSet('tok',null); join=c; lsSet('join',c); } return c; })
    .catch(function(){ return null; });
}

/* ---------- MA-Verbindung ---------- */
var ws=null, mid=1, pend={}, ready=false, cfg=null, qid=null, queue=null, items=[], tries=0, fails=0, everOk=false;
function send(command,args){ return new Promise(function(res,rej){
  if(!ws||ws.readyState!==1) return rej('offline');
  var id=String(mid++); pend[id]={res:res,rej:rej,acc:null};
  ws.send(JSON.stringify({message_id:id,command:command,args:args||{}}));
  setTimeout(function(){ if(pend[id]){ delete pend[id]; rej('timeout'); } },15000);
}); }
function gate(html){ $('gate').innerHTML=html; $('gate').classList.remove('hide'); $('app').classList.add('hide'); }
function connect(){
  var ep=EPS[epI%EPS.length], got=false; MA_WS=ep.ws; MA_HTTP=ep.http;
  try{ ws=new WebSocket(MA_WS); }catch(e){ ws=null; }
  if(!ws){ epI++; fails++; setTimeout(connect,1000); return; }
  ws.onmessage=function(ev){
    var m; try{ m=JSON.parse(ev.data); }catch(e){ return; }
    if(m.server_version && m.message_id==null){ got=true; fails=0; start(); return; }
    if(m.message_id!=null && pend[m.message_id]){
      var p=pend[m.message_id];
      if(m.error_code){ delete pend[m.message_id]; p.rej(m.details||m.error_code); return; }
      if(m.partial){ p.acc=(p.acc||[]).concat(m.result||[]); return; }
      delete pend[m.message_id]; p.res(p.acc?p.acc.concat(m.result||[]):m.result); return;
    }
    if(m.event) onEvent(m);
  };
  ws.onclose=function(){
    ready=false; $('dot').classList.remove('ok');
    if(!got){ epI++; fails++; }
    if(fails>=EPS.length*2 && !everOk)
      gate('<b>📡 Party nicht erreichbar</b><span>Bitte verbindet euch mit dem WLAN<br>und scannt den QR-Code erneut.</span><div class="spin"></div>');
    setTimeout(connect,got?Math.min(15000,2000+tries++*1500):800);
  };
}
async function start(){
  var tok=lsGet('tok',null);
  if(tok && tok.exp && tok.exp<Date.now()) tok=null;
  try{
    if(!tok){ tok=await exchange(); }
    try{ await send('auth',{token:tok.t}); }
    catch(e){ lsSet('tok',null); tok=await exchange(); await send('auth',{token:tok.t}); }
  }catch(e){
    gate('<b>🎟️ Bitte QR-Code scannen</b><span>Der Party-Zugang ist abgelaufen oder ungültig.<br>Scannt den QR-Code auf dem Fernseher erneut.</span>');
    try{ ws.onclose=null; ws.close(); }catch(x){} return;
  }
  ready=true; everOk=true; tries=0; $('dot').classList.add('ok');
  $('gate').classList.add('hide'); $('app').classList.remove('hide');
  try{ cfg=await send('party/config'); }catch(e){ cfg={}; }
  applyCfg();
  await loadQueue();
}
async function exchange(){
  if(!join) await fetchJoin();
  if(!join) throw 'nojoin';
  var r=null;
  try{ r=await send('auth/join_code/exchange',{code:join}); }catch(e){ r=null; }
  /* Code abgelaufen? Einmal frischen Code vom Add-on holen */
  if((!r||!r.access_token)){ var old=join; await fetchJoin(); if(join && join!==old) r=await send('auth/join_code/exchange',{code:join}); }
  if(!r||!r.access_token) throw 'invalid';
  var t={t:r.access_token,exp:Date.now()+23*3600e3};
  lsSet('tok',t); return t;
}

/* ---------- Konfiguration & Kontingente (wie MA-Party, im Browser gespeichert) ---------- */
function applyCfg(){
  var c=cfg||{};
  if(c.party_name) $('pName').textContent=c.party_name;
  if(c.request_badge_color) document.documentElement.style.setProperty('--req',c.request_badge_color);
  if(c.boost_badge_color) document.documentElement.style.setProperty('--boost',c.boost_badge_color);
  $('nProg').classList.toggle('hide',c.show_progress_bar===false);
  $('qtB').classList.toggle('off',c.enable_boost===false);
  renderQuota();
}
var BUCKET={add:['add_queue_limit','add_queue_refill_minutes','enable_add_queue'],boost:['boost_limit','boost_refill_minutes','enable_boost']};
function bucket(kind){
  var c=cfg||{}, k=BUCKET[kind], lim=+c[k[0]]||(kind==='add'?10:1), ref=(+c[k[1]]||(kind==='add'?2:20))*60e3;
  var b=lsGet('b_'+kind,null)||{n:lim,t:Date.now()};
  var now=Date.now(), gain=Math.floor((now-b.t)/ref);
  if(gain>0){ b.n=Math.min(lim,b.n+gain); b.t=b.n>=lim?now:b.t+gain*ref; }
  if(b.n>=lim) b.t=now;
  b.n=Math.min(b.n,lim);
  return {n:b.n,lim:lim,next:b.n>=lim?0:Math.max(0,b.t+ref-now),use:function(){ if(b.n>=lim) b.t=Date.now(); b.n--; lsSet('b_'+kind,{n:b.n,t:b.t}); }};
}
function limited(){ return !cfg || cfg.enable_rate_limiting!==false; }
function canDo(kind){ var c=cfg||{}; if(c[BUCKET[kind][2]]===false) return false; return !limited() || bucket(kind).n>0; }
function renderQuota(){
  ['add','boost'].forEach(function(k){
    var el=k==='add'?'R':'B', b=bucket(k);
    if(!limited()){ $('qt'+el+'n').textContent='∞'; $('qt'+el+'s').textContent=k==='add'?'Wünsche':'Als Nächstes'; return; }
    $('qt'+el+'n').textContent=b.n+'/'+b.lim;
    $('qt'+el+'s').textContent=b.n<b.lim?('+1 in '+fmt(b.next/1000)):(k==='add'?'Wünsche frei':'Als Nächstes frei');
  });
  document.querySelectorAll('.btn.add').forEach(function(x){ if(!x.classList.contains('done')) x.disabled=!canDo('add'); });
  document.querySelectorAll('.btn.bst').forEach(function(x){ if(!x.classList.contains('done')) x.disabled=!canDo('boost'); });
}
setInterval(function(){ if(ready) renderQuota(); },1000);

/* ---------- Bilder ---------- */
function img(it){
  if(!it) return '';
  var mi=it.media_item||it, im=it.image||mi.image||(mi.metadata&&mi.metadata.images&&mi.metadata.images[0])||(mi.album&&(mi.album.image||(mi.album.metadata&&mi.album.metadata.images&&mi.album.metadata.images[0])))||null;
  if(!im) return '';
  if(typeof im!=='string'&&im.proxy_id) return MA_HTTP+'/imageproxy/'+encodeURIComponent(im.proxy_id)+'?size=256';
  var p=typeof im==='string'?im:im.path; if(!p) return '';
  if(/^https:/.test(p)) return p;
  return MA_HTTP+'/imageproxy?size=256&path='+encodeURIComponent(p)+'&provider='+encodeURIComponent(im.provider||'');
}
function bg(u){ return u?' style="background-image:url(\''+esc(u).replace(/'/g,'%27')+'\')"':''; }
function artists(mi){ return ((mi&&mi.artists)||[]).map(function(a){ return a.name; }).join(', '); }

/* ---------- Läuft gerade + Warteschlange ---------- */
var clock={p:0,t:0,play:false,dur:0};
async function loadQueue(){
  if(!ready) return;
  try{
    if(!qid) qid=await send('party/player');
    if(!qid){ $('qList').innerHTML='<div class="empty">Gerade läuft keine Musik.</div>'; return; }
    queue=await send('player_queues/get',{queue_id:qid});
    var off=Math.max(0,(queue&&queue.current_index)||0);
    items=await send('player_queues/items',{queue_id:qid,limit:16,offset:off});
  }catch(e){ return; }
  renderNow(); renderQueue();
}
function renderNow(){
  var q=queue||{}, ci=q.current_item, mi=ci&&ci.media_item;
  $('nTi').textContent=ci?((mi&&mi.name)||ci.name||'–'):'Gerade läuft nichts';
  $('nAr').textContent=mi?artists(mi):'';
  var u=img(ci); $('nCv').style.backgroundImage=u?'url("'+u+'")':'';
  $('nowCard').classList.toggle('playing',q.state==='playing');
  clock.dur=(ci&&ci.duration)||0;
  var e=(q.elapsed_time!=null?q.elapsed_time:0);
  if(q.elapsed_time_last_updated && q.state==='playing') e+=Math.max(0,Math.min(30,Date.now()/1000-q.elapsed_time_last_updated));
  clock.p=e; clock.t=Date.now(); clock.play=q.state==='playing';
  if(window.pjOnNow){ try{ window.pjOnNow(ci,qid,q); }catch(x){} }
}
setInterval(function(){
  var p=clock.p+(clock.play?(Date.now()-clock.t)/1000:0); if(clock.dur) p=Math.min(p,clock.dur);
  $('nFill').style.width=(clock.dur?p/clock.dur*100:0)+'%'; $('nPos').textContent=fmt(p); $('nDur').textContent=fmt(clock.dur);
},500);
function renderQueue(){
  var list=items.slice(1, 13), b=(cfg||{}).enable_boost!==false;
  $('qCnt').textContent=queue&&queue.items!=null?Math.max(0,queue.items-(queue.current_index||0)-1)+' Titel':'';
  if(!list.length){ $('qList').innerHTML='<div class="empty">Noch nichts in der Warteschlange.<br>Sucht euch oben einen Song aus!</div>'; return; }
  $('qList').innerHTML=list.map(function(it){
    var mi=it.media_item||{}, x=it.extra_attributes||{}, u=img(it);
    var tag=x.party_boosted?'<span class="tag b">Boost</span>':(x.party_guest?'<span class="tag">Wunsch</span>':'');
    var by=window.pjWishBy?window.pjWishBy(mi.uri):'';
    var bo=window.pjBoostBy?window.pjBoostBy(mi.uri):'';
    return '<div class="row"><div class="cv"'+bg(u)+'>'+(u?'':NOTE)+'</div><div class="m"><div class="it1">'+tag+esc(mi.name||it.name)+'</div><div class="it2">'+esc(artists(mi))+
      (by?' · <span style="color:var(--cyan)">von '+esc(by)+'</span>':'')+
      (bo?' · <span style="color:#ff8a3d">⚡ vorgedrängelt von '+esc(bo)+'</span>':'')+'</div></div>'+
      (b&&!x.party_boosted?'<div class="acts"><button class="btn bst" data-qi="'+esc(it.queue_item_id)+'" title="Vordrängeln">'+I_BST+'</button></div>':'')+'</div>';
  }).join('');
  renderQuota();
}
var qT=null; function scheduleQ(){ clearTimeout(qT); qT=setTimeout(loadQueue,400); }
function onEvent(m){
  if(!qid || m.object_id!==qid) return;
  if(m.event==='queue_updated'){ if(m.data) { queue=Object.assign(queue||{},m.data); renderNow(); } scheduleQ(); }
  else if(m.event==='queue_items_updated') scheduleQ();
  else if(m.event==='queue_time_updated' && typeof m.data==='number'){ clock.p=m.data; clock.t=Date.now(); }
}
setInterval(function(){ if(ready && !document.hidden) loadQueue(); },15000);
document.addEventListener('visibilitychange',function(){ if(!document.hidden && ready) loadQueue(); });

/* ---------- Suche: Bibliothek sofort, Streaming-Treffer nachladen ---------- */
var sT=null, sGen=0, results=[], sCache={}, sOrder=[];
$('q').addEventListener('input',function(){ var v=this.value.trim(); $('sbox').classList.toggle('has',!!v); clearTimeout(sT);
  if(!v){ sGen++; if(sOpen) sHint(); else $('resCard').classList.add('hide'); return; } if(v.length<2) return; sT=setTimeout(function(){ search(v); },250); });
$('q').addEventListener('keydown',function(e){ if(e.key==='Enter'){ clearTimeout(sT); var v=this.value.trim(); if(v) search(v); this.blur(); } });
$('qx').onclick=function(){ sGen++; $('q').value=''; $('sbox').classList.remove('has'); if(sOpen) sHint(); else $('resCard').classList.add('hide'); $('q').focus(); };
/* Such-Popup: beim Antippen des Suchfelds Vollbild, Treffer direkt unter dem Feld – kein Scrollen */
var sOpen=false;
function sHint(){ if(!$('q').value.trim()) $('res').innerHTML='<div class="shint">Tippe einen Song oder Interpreten ein …</div>'; }
function srchOpen(){ if(sOpen) return; sOpen=true; document.body.classList.add('srch'); sHint();
  try{ history.pushState({pjs:1},''); }catch(e){} }
function srchClose(fromPop){ if(!sOpen) return; sOpen=false; document.body.classList.remove('srch'); $('q').blur();
  $('resCard').classList.add('hide');
  if(!fromPop){ try{ if(history.state&&history.state.pjs) history.back(); }catch(e){} } }
$('q').addEventListener('focus',srchOpen);
$('sClose').onclick=function(){ srchClose(false); };
window.addEventListener('popstate',function(){ srchClose(true); });
document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&sOpen) srchClose(false); });
function rowHtml(t,i,b){
  var u=img(t), ver=t.version?' <span style="color:var(--tx3);font-weight:600">('+esc(t.version)+')</span>':'';
  return '<div class="row"><div class="cv"'+bg(u)+'>'+(u?'':NOTE)+'</div><div class="m"><div class="it1">'+esc(t.name)+ver+'</div><div class="it2">'+esc(artists(t))+(t.duration?' · '+fmt(t.duration):'')+'</div></div>'+
    '<div class="acts">'+(b?'<button class="btn bst" data-i="'+i+'" title="Vordrängeln">'+I_BST+'</button>':'')+'<button class="btn add" data-i="'+i+'" title="Wünschen">'+I_ADD+'</button></div></div>';
}
function tkey(t){ return (String(t.name||'')+'|'+artists(t)+'|'+(t.version||'')).toLowerCase(); }
async function search(v){
  if(!ready) return; var g=++sGen, key=v.toLowerCase(), b=(cfg||{}).enable_boost!==false;
  $('resCard').classList.remove('hide');
  if(sCache[key]){ results=sCache[key].slice(); $('res').innerHTML=results.map(function(t,i){ return rowHtml(t,i,b); }).join(''); renderQuota(); return; }
  results=[]; var seen={}, open=2, ok=0, fullOk=false;
  $('res').innerHTML='<div class="spin" id="resSpin"></div>';
  function got(list){
    if(g!==sGen) return;
    var add=(list||[]).filter(function(t){ if(!t||!t.uri) return false; var k=tkey(t); if(seen[t.uri]||seen[k]) return false; seen[t.uri]=seen[k]=1; return true; });
    if(!add.length) return;
    var start=results.length; results=results.concat(add);
    var sp=$('resSpin'); if(sp&&!start){ sp.remove(); }
    var html=add.map(function(t,j){ return rowHtml(t,start+j,b); }).join('');
    var sp2=$('resSpin'); if(sp2) sp2.insertAdjacentHTML('beforebegin',html); else $('res').insertAdjacentHTML('beforeend',html);
    if(open>0 && !$('resSpin')) $('res').insertAdjacentHTML('beforeend','<div class="spin" id="resSpin" style="margin:10px auto;width:22px;height:22px"></div>');
    renderQuota();
  }
  function fin(){
    if(g!==sGen) return; if(--open>0) return;
    var sp=$('resSpin'); if(sp) sp.remove();
    if(!results.length) $('res').innerHTML=ok?'<div class="empty">Nichts gefunden.</div>':'<div class="empty">Suche gerade nicht möglich.</div>';
    else if(fullOk){ sCache[key]=results.slice(); sOrder.push(key); if(sOrder.length>20) delete sCache[sOrder.shift()]; }
  }
  send('music/search',{search_query:v,media_types:['track'],limit:10,library_only:true})
    .then(function(r){ ok++; got(r&&r.tracks); },function(){}).then(fin);
  send('music/search',{search_query:v,media_types:['track'],limit:20})
    .then(function(r){ ok++; fullOk=true; got(r&&r.tracks); },function(){}).then(fin);
}

/* ---------- Wünschen / Vordrängeln ---------- */
document.addEventListener('click',async function(e){
  var btn=e.target.closest('.btn'); if(!btn||btn.disabled||btn.classList.contains('done')) return;
  var boost=btn.classList.contains('bst'), kind=boost?'boost':'add';
  if(!canDo(kind)){ toast(boost?'Vordrängeln gerade nicht möglich – gleich wieder!':'Kein Wunsch mehr frei – gleich wieder!'); return; }
  btn.disabled=true;
  try{
    if(btn.dataset.qi!=null){
      /* Song aus der Warteschlange nach vorne holen */
      var qi=null; items.forEach(function(it){ if(String(it.queue_item_id)===btn.dataset.qi) qi=it; });
      var mi=(qi&&qi.media_item)||{name:qi&&qi.name};
      if(window.pjBeforeBoost){ var ok0=await window.pjBeforeBoost(mi); if(!ok0){ btn.disabled=false; return; } }
      await send('party/boost_queue_item',{queue_item_id:btn.dataset.qi});
      if(window.pjAfterBoost){ try{ window.pjAfterBoost(mi,qid,btn); }catch(x){} } else toast('⚡ Kommt als Nächstes!');
    }
    else{
      var t=results[+btn.dataset.i]; if(!t) return;
      var dup=(cfg||{}).prevent_duplicate_tracks!==false && items.some(function(it){ return it.media_item&&it.media_item.uri===t.uri; });
      if(dup){ toast('Der Song ist schon in der Warteschlange'); btn.disabled=false; return; }
      var ded='';
      if(window.pjBeforeAdd){ var r0=await window.pjBeforeAdd(t,boost); if(r0===false){ btn.disabled=false; return; } ded=r0||''; }
      var res=await send('party/add_to_queue',{uri:t.uri,boost:boost});
      if(res&&res.success===false) throw (res.message||res.error||'fehlgeschlagen');
      toast(boost?'⚡ '+t.name+' – vorgedrängelt!':'🎵 '+t.name+' ist gewünscht!');
      if(window.pjAfterAdd){ try{ window.pjAfterAdd(t,boost,ded,qid,btn); }catch(x){} }
    }
    if(limited()) bucket(kind).use();
    btn.classList.add('done'); btn.innerHTML=I_OK; btn.disabled=false;
    scheduleQ();
  }catch(err){ btn.disabled=false; toast(/duplic|already/i.test(String(err))?'Der Song ist schon in der Warteschlange':'Hat nicht geklappt: '+err); }
  renderQuota();
});

/* ---------- Schnittstelle für Erweiterungen ---------- */
window.pjParty={
  now:function(){ return queue&&queue.current_item; },
  qid:function(){ return qid; },
  artists:artists, img:img, toast:toast,
  rerenderQueue:function(){ renderQueue(); }
};

/* ---------- Start: ohne MA-Einrichtung freundlicher Hinweis statt Fehler ---------- */
if(window.PJ && PJ.maToken===false){
  gate('<b>🎶 Musik noch nicht eingerichtet</b><span>Die Party-Seite ist gleich startklar.<br>Der Gastgeber muss im Add-on noch Music Assistant verbinden.</span>');
}else connect();
})();
