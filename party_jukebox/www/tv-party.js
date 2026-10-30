/* ===================== Party-Jukebox TV: Party =====================
   Daten vom Add-on: party/wishes.json (Wünsche w, Vordrängler bo, Nachschub bi, Getränke-Zähler bc/bt, Abstimmung vote)
   und party/guests.json (Teilnehmer). Kein Home Assistant nötig.
   - QR-Code (lokal erzeugt) zur Party-Seite: <Adresse dieses TVs>/party.html?join=<MA-Join-Code>.
     Join-Code von MA (party/url), sonst optional vom Add-on (party/join.json), sonst ohne Code.
   - Gäste-Banner in der Kopfzeile (~30 s im Wechsel, wieder bei Neuzugängen und alle 10 Min) + "x dabei".
   - "Gewünscht von …" / "vorgedrängelt von …" beim laufenden Song, Abstimmung 👍/👎.
   - Widmung groß mit Konfetti, Vordrängler-Pranger, NACHSCHUB! mit Getränk (2× Aufblitzen).
   - Plattenwechsler: Vinyl dreht sich beim Abspielen, beim Songwechsel gleitet sie in die Hülle. */
(function(){
'use strict';
var TV=window.TV; if(!TV) return;
var $=TV.$, esc=TV.esc, PJ=TV.cfg;
function noop(){}
var COLORS=['#ff2ec8','#8b5cff','#00f0e0','#ffd23f','#ffffff'];
/* Text mit Farbverlauf, Emojis getrennt (sonst färbt background-clip:text sie zu Klecksen) */
var EMO=null; try{ EMO=new RegExp('((?:\\p{Extended_Pictographic}|\\p{Regional_Indicator}|[\\u{1F3FB}-\\u{1F3FF}\\u200D\\uFE0F])+)','u'); }catch(e){}
function gradHtml(s){
  var parts=EMO?String(s).split(EMO):[String(s)];
  return parts.map(function(p,i){ return !p?'':(i%2?'<span class="em">'+esc(p)+'</span>':'<span class="gt">'+esc(p)+'</span>'); }).join('');
}
function getJson(u){ return fetch(u+'?_='+Date.now(),{cache:'no-store'}).then(function(r){ return r.ok?r.json():null; }); }

/* ---------- QR-Feld ---------- */
if(!(PJ.drinks&&PJ.drinks.length) && PJ.drinks){ $('step3').innerHTML='<b>3</b>Abstimmen 👍 👎'; $('heySub').textContent='Wünscht euch euren Song'; }
var join='', lastQr='';
function target(){ return location.origin+'/party.html'+(join?'?join='+encodeURIComponent(join):''); }
function qrSvg(data){
  var q=qrcode(0,'M'); q.addData(data); q.make();
  var n=q.getModuleCount(), m=2, s=n+m*2, d='';
  for(var r=0;r<n;r++) for(var c=0;c<n;c++) if(q.isDark(r,c)) d+='M'+(c+m)+' '+(r+m)+'h1v1h-1z';
  var svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+s+' '+s+'" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#eef1f7"/><path d="'+d+'" fill="#0a0d14"/></svg>';
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
function renderQr(){
  var t=target(); if(t===lastQr) return;
  try{ $('qr-img').src=qrSvg(t); lastQr=t; $('qr-label').textContent='SCANNEN & WÜNSCHEN'; }
  catch(e){ $('qr-label').textContent=location.host+'/party.html'; }
}
function setJoin(c){ c=String(c||'').trim(); if(c && c!==join){ join=c; renderQr(); } }
function joinFromAddon(){ return getJson('party/join.json').then(function(j){ if(j&&j.code) setJoin(j.code); }).catch(noop); }
function refreshJoin(){
  if(!TV.ok){ joinFromAddon(); return; }
  TV.send('party/url',{}).then(function(res){
    var u=typeof res==='string'?res:((res&&(res.url||res.party_url))||'');
    var m=String(u).match(/[?&#]join=([^&#]+)/);
    if(m) setJoin(decodeURIComponent(m[1])); else joinFromAddon();
  }).catch(joinFromAddon);
}
renderQr();
TV.on('ma',function(on){ if(on) setTimeout(refreshJoin,1000); });
setTimeout(function(){ if(!join) refreshJoin(); },4000);
setInterval(refreshJoin,300000);

/* ---------- Plattenwechsler ---------- */
var rec=$('recWrap'), lbl=$('recLbl'), firstTrack=true;
function syncLabel(){ var im=$('art-img'); var src=im&&im.style.display!=='none'?im.getAttribute('src'):''; lbl.style.backgroundImage=src?TV.cssUrl(src):''; }

/* ---------- gewünscht von / Abstimmung ---------- */
var by=$('wBy'), vt=$('wVt'), voteBase='';
function renderBy(){
  var c=TV.cur, x=TV.wishOf(c), b=TV.boostOf(c);
  if(!c||(!x&&!b)){ by.classList.remove('on'); return; }
  var h=(x?'🎵 Gewünscht von '+esc(x.n)+(x.d?' · <i>Für '+esc(x.d)+'</i>':''):'')+(b?'<span class="bo">⚡ vorgedrängelt von '+esc(b.n)+' 😤</span>':'');
  if(by.innerHTML!==h) by.innerHTML=h;
  by.classList.add('on');
}
function renderVote(){
  var v=TV.W.vote||{}, uri=(TV.cur&&TV.cur.uri)||'';
  var show=TV.cur && v.u && (v.u===uri || v.u!==voteBase) && ((v.up||0)+(v.down||0))>0;
  vt.classList.toggle('on',!!show); if(!show) return;
  $('wUp').textContent='👍 '+(v.up||0);
  $('wDn').textContent='👎 '+(v.down||0)+(v.need?' / '+v.need:'');
  $('wDn').classList.toggle('hot',(v.down||0)>=Math.max(1,(v.need||2)-1));
}

/* ---------- Overlays nacheinander (Widmung / Vordrängler) ---------- */
var ovQ=[], ovBusy=false;
function queueOv(fn,ms){ ovQ.push([fn,ms]); if(!ovBusy) nextOv(); }
function nextOv(){
  var it=ovQ.shift(); if(!it){ ovBusy=false; return; }
  ovBusy=true; var hide=it[0]();
  setTimeout(function(){ hide(); setTimeout(nextOv,700); },it[1]);
}
function dedicate(x){
  queueOv(function(){
    var c=TV.cur||{};
    $('dedF').innerHTML=gradHtml('Für '+x.d);
    $('dedV').innerHTML='von <b>'+esc(x.n)+'</b>';
    $('dedS').textContent='🎵 '+(c.title||'')+(c.artist?' – '+c.artist:'');
    $('dedOv').classList.add('on');
    var bx=$('dedBx'), N=TV.lite?20:40;
    for(var i=0;i<N;i++){
      var p=document.createElement('i'); p.className='cf';
      var a=Math.random()*Math.PI*2, d=25+Math.random()*35;
      p.style.background=COLORS[i%COLORS.length];
      p.style.setProperty('--x',Math.cos(a)*d+'vw'); p.style.setProperty('--y',Math.sin(a)*d*.8+'vh'); p.style.setProperty('--r',(Math.random()*900-450)+'deg');
      p.style.animationDelay=(Math.random()*.3)+'s';
      bx.appendChild(p); setTimeout(function(q){ return function(){ q.remove(); }; }(p),2300);
    }
    return function(){ $('dedOv').classList.remove('on'); };
  },12000);
}
function shame(x){
  queueOv(function(){
    var bov=$('boOv');
    $('boF').innerHTML=gradHtml(x.n||'Gast');
    $('boS').textContent='⚡ '+(x.s||'')+(x.a?' – '+x.a:'');
    bov.classList.add('on');
    var N=TV.lite?8:16;
    for(var i=0;i<N;i++){
      var p=document.createElement('span'); p.className='td'; p.textContent='👎';
      p.style.left=(4+Math.random()*92)+'vw'; p.style.setProperty('--r',(Math.random()*120-60)+'deg');
      p.style.animationDelay=(0.3+Math.random()*2.5)+'s';
      bov.appendChild(p); setTimeout(function(q){ return function(){ q.remove(); }; }(p),5500);
    }
    return function(){ bov.classList.remove('on'); };
  },8000);
}

/* ---------- Nachschub (Getränk leer) ---------- */
var bq=[], beerBusy=false, fl=$('biFl'), biOv=$('biOv');
function showBeer(x){ bq.push(x); if(!beerBusy) nextBeer(); }
function nextBeer(){
  var x=bq.shift(); if(!x){ beerBusy=false; return; } beerBusy=true;
  $('biF').innerHTML=esc(x.n||'Gast');
  $('biM').textContent=x.e||'🍺';
  $('biV').innerHTML=x.p?'möchte <b>'+esc(x.p)+'</b> '+esc(x.e||''):'braucht Nachschub 🍻';
  fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
  setTimeout(function(){ biOv.classList.add('on'); },1300);
  setTimeout(function(){ biOv.classList.remove('on'); setTimeout(nextBeer,600); },6300);
}

/* ---------- Songwechsel ---------- */
var shown={};
TV.on('track',function(){
  var first=firstTrack; firstTrack=false;
  voteBase=(TV.W.vote&&TV.W.vote.u)||'';
  if(!first){ rec.classList.add('swap'); setTimeout(function(){ syncLabel(); rec.classList.remove('swap'); },650); } else syncLabel();
  setTimeout(function(){
    renderBy(); renderVote();
    var x=TV.wishOf(TV.cur);
    if(x && x.d && !shown[x.t+'|'+x.g]){ shown[x.t+'|'+x.g]=1; if(!first) dedicate(x); }
  },900);
});
var im=$('art-img'); if(im && window.MutationObserver) new MutationObserver(syncLabel).observe(im,{attributes:true,attributeFilter:['src','style']});

/* ---------- Wünsche laden ---------- */
var boSeen=null, biSeen=null;
function maxT(l){ var m=0; l.forEach(function(x){ if(x&&x.t>m) m=x.t; }); return m; }
function loadW(){
  getJson('party/wishes.json').then(function(j){
    if(!j) return;
    var W=TV.W={w:j.w||[],bo:j.bo||[],bi:j.bi||[],bc:j.bc||[],bt:+j.bt||0,vote:j.vote||{}};
    TV.emit('wishes',W);
    renderBy(); renderVote();
    /* neue Vordrängler / Nachschub sofort zeigen (beim ersten Laden nichts Altes) */
    var mb=maxT(W.bo), mi=maxT(W.bi);
    if(boSeen===null) boSeen=mb; else { W.bo.filter(function(b){ return b.t>boSeen; }).forEach(shame); boSeen=Math.max(boSeen,mb); }
    if(biSeen===null) biSeen=mi; else { W.bi.filter(function(b){ return b.t>biSeen; }).forEach(showBeer); biSeen=Math.max(biSeen,mi); }
    /* Wunsch kam erst nach Songstart an → Widmung trotzdem zeigen */
    var x=TV.wishOf(TV.cur);
    if(x && x.d && !shown[x.t+'|'+x.g] && Date.now()/1000-x.t<600 && !firstTrack){ shown[x.t+'|'+x.g]=1; dedicate(x); }
  }).catch(noop);
}
loadW(); setInterval(loadW,4000);

/* ---------- Gäste ---------- */
var gCard=$('gCard'), hd=$('gHd'), SHOW_MS=30000, REPEAT_MS=600000;
var names=[], seen=null, fresh=[], idx=0, timer=null, until=0, lastShow=0;
function confetti(big){
  var n=big?26:12, r=gCard.getBoundingClientRect(), gi=gCard.querySelector('.gi').getBoundingClientRect();
  var ox=gi.left-r.left+gi.width/2, oy=gi.top-r.top+gi.height/2;
  if(TV.lite) n=Math.round(n/2);
  for(var i=0;i<n;i++){
    var p=document.createElement('i'); p.className='cf';
    var a=Math.random()*Math.PI*2, d=(big?18:10)+Math.random()*(big?22:12);
    p.style.left=ox+'px'; p.style.top=oy+'px'; p.style.background=COLORS[i%COLORS.length];
    p.style.setProperty('--x',Math.cos(a)*d+'vh'); p.style.setProperty('--y',Math.sin(a)*d*.4+'vh'); p.style.setProperty('--r',(Math.random()*720-360)+'deg');
    gCard.appendChild(p); setTimeout(function(x){ return function(){ x.remove(); }; }(p),1200);
  }
}
function line(name,isNew){
  var t=$('gT'), old=t.querySelector('.gl');
  if(old){ old.classList.remove('in'); old.classList.add('out'); setTimeout(function(){ old.remove(); },450); }
  var l=document.createElement('div'); l.className='gl in';
  l.innerHTML='<b>'+esc(name)+'</b>'+(isNew?'ist jetzt dabei! 🎉':'nimmt teil');
  t.appendChild(l);
  gCard.classList.toggle('new',!!isNew);
  setTimeout(function(){ confetti(isNew); },120);
}
function hideBanner(){ gCard.classList.remove('on','new'); clearTimeout(timer); timer=null; }
function step(){
  clearTimeout(timer);
  if(!names.length){ hideBanner(); return; }
  if(!fresh.length && Date.now()>until){ hideBanner(); return; }
  gCard.classList.add('on');
  var name, isNew=false;
  if(fresh.length){ name=fresh.shift(); isNew=true; until=Math.max(until,Date.now()+SHOW_MS); }
  else{ idx=idx%names.length; name=names[idx++]; }
  line(name,isNew);
  timer=setTimeout(step,isNew?6000:4500);
}
function startRound(){ until=Date.now()+SHOW_MS; lastShow=Date.now(); idx=0; if(!timer) step(); }
function loadG(){
  getJson('party/guests.json').then(function(j){
    var list=(j&&Array.isArray(j.n))?j.n:[], cur={}, added=false, prev=names.length;
    list.forEach(function(n){ cur[n]=1; });
    if(seen===null){ seen=cur; prev=list.length; names=list; if(list.length) startRound(); }
    else{ list.forEach(function(n){ if(!seen[n]){ fresh.push(n); added=true; } }); seen=cur; }
    var cnt=list.length; names=list;
    $('gHn').textContent=cnt;
    hd.classList.toggle('hide',!cnt);
    if(cnt!==prev && cnt){ hd.classList.remove('pop'); void hd.offsetWidth; hd.classList.add('pop'); }
    if(added){ lastShow=Date.now(); if(!timer) step(); }
    else if(cnt && !timer && Date.now()-lastShow>REPEAT_MS) startRound();
    if(!cnt) hideBanner();
  }).catch(noop);
}
loadG(); setInterval(loadG,15000);
})();
