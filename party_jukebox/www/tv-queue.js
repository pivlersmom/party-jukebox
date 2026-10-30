/* ===================== Party-Jukebox TV: Warteschlange & Co. =====================
   - Warteschlange "Als Nächstes" mit Anbieterlogo (MA providers/icon), Wunsch- (🎵 von …), Vordrängel- (⚡) und Autoplay-Markierung (✨).
   - QR-Feld: weicher Wechsel QR-Code ↔ nächster Song (25 s / 15 s; letzte 30 s eines Songs: immer "Als Nächstes").
   - "Zuletzt gespielt" (3 Titel) statt Songtext, wenn der Song keinen Text hat.
   - Getränke-Ranking im Wechsel mit der Warteschlange (20 s / 10 s), solange in den letzten 12 h bestellt wurde.
   - Autoplay-Erkennung: wächst die Warteschlange kurz vor dem Ende um mehrere Titel, hat MA sie angehängt
     (nur im Browser gemerkt, localStorage).
   - Anzeige "Übergänge" (Crossfade), falls MA das an der Warteschlange meldet. */
(function(){
'use strict';
var TV=window.TV; if(!TV) return;
var $=TV.$, esc=TV.esc, NOTE=TV.NOTE, body=document.body;
var qCard=document.querySelector('.card.queue'), pCard=document.querySelector('.card.party');
function bg(u){ return u?' style="background-image:'+esc(TV.cssUrl(u))+'"':''; }

/* ---------- Anbieterlogos ---------- */
var PICON={}, piconWait={};
var FALLBACK={
  spotify:'<svg viewBox="0 0 24 24" fill="#1db954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>',
  tidal:'<svg viewBox="0 0 24 24" fill="#fff"><path d="M12.012 3.992L8.008 7.996 4.004 3.992 0 7.996l4.004 4.004 4.004-4.004 4.004 4.004 4.004-4.004zM8.008 16.004l-4.004-4.004L0 16.004 4.004 20l4.004-4.004L12.012 20l4.004-3.996-4.004-4.004z"/></svg>',
  youtube:'<svg viewBox="0 0 24 24" fill="#ff0000"><path d="M23.495 6.205a3.007 3.007 0 0 0-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 0 0 .527 6.205a31.247 31.247 0 0 0-.522 5.805 31.247 31.247 0 0 0 .522 5.783 3.007 3.007 0 0 0 2.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 0 0 2.088-2.088 31.247 31.247 0 0 0 .5-5.783 31.247 31.247 0 0 0-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/></svg>'
};
function loadIcon(p){
  if(!p||PICON[p]!==undefined||piconWait[p]||!TV.ok) return;
  piconWait[p]=1;
  TV.send('providers/icon',{provider:p,variant:'dark'}).then(function(d){ return d||TV.send('providers/icon',{provider:p}); })
    .then(function(d){
      d=d?String(d):'';
      if(d && d.indexOf('<svg')>=0 && d.indexOf('data:')!==0) d='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(d);
      PICON[p]=d; delete piconWait[p]; render();
    },function(){ PICON[p]=''; delete piconWait[p]; });
}
function provIcon(it){
  var p=it.prov;
  if(p){ if(PICON[p]) return '<img class="plogo" src="'+esc(PICON[p])+'" alt="">'; loadIcon(p); }
  var u=String(p||it.uri||'').toLowerCase();
  for(var k in FALLBACK) if(u.indexOf(k)>=0) return FALLBACK[k];
  return '';
}

/* ---------- Autoplay-Erkennung ---------- */
var AUTO={q:'',u:[]};
try{ var s0=JSON.parse(localStorage.getItem('tv_autoplay')||'null'); if(s0&&s0.u) AUTO=s0; }catch(e){}
function isAuto(uri){ return !!uri && AUTO.u.indexOf(uri)>=0; }
function saveAuto(){ try{ localStorage.setItem('tv_autoplay',JSON.stringify(AUTO)); }catch(e){} }
var prevQ=null;
TV.on('qstate',function(q){
  var id=q.queue_id, n=q.items, cur=q.current_index;
  /* Übergänge (nur wenn MA das Feld liefert) */
  var mf=$('mFade');
  if(typeof q.crossfade_enabled==='boolean'){ mf.style.display=''; mf.classList.toggle('on',q.crossfade_enabled); } else mf.style.display='none';
  if(typeof n!=='number'||cur==null) return;
  if(prevQ && prevQ.id===id){
    var left=prevQ.n-prevQ.cur, added=n-prevQ.n;
    if(added>=3 && left<=6 && TV.ok){
      TV.send('player_queues/items',{queue_id:id,limit:added,offset:prevQ.n}).then(function(r){
        var u=(Array.isArray(r)?r:((r&&r.items)||[])).map(function(it){ return (it&&((it.media_item&&it.media_item.uri)||it.uri))||''; }).filter(Boolean);
        if(!u.length) return;
        if(AUTO.q!==id) AUTO={q:id,u:[]};
        u.forEach(function(x){ if(AUTO.u.indexOf(x)<0) AUTO.u.push(x); });
        AUTO.u=AUTO.u.slice(-120); saveAuto(); render(); paintUp(); recPaintKey=''; paintRecent();
      }).catch(function(){});
    }
    /* neue Warteschlange geladen (deutlich kürzer / von vorn) → Markierungen verwerfen */
    if(AUTO.q===id && AUTO.u.length && (n<prevQ.n-2 || (cur<prevQ.cur-3 && n!==prevQ.n))){ AUTO={q:id,u:[]}; saveAuto(); render(); }
  }
  prevQ={id:id,n:n,cur:cur};
});

/* ---------- Warteschlange ---------- */
var lastHtml='';
function tagsOf(it){
  var x=TV.wishOf(it), b=TV.boostOf(it);
  if(b) return {cls:' boost',html:'<div class="q-wish bo">⚡ vorgedrängelt von '+esc(b.n)+' 😤</div>'};
  if(x) return {cls:' wish',html:'<div class="q-wish">🎵 von '+esc(x.n)+(x.d?' · <i>Für '+esc(x.d)+'</i>':'')+'</div>'};
  if(isAuto(it.uri)) return {cls:'',html:'<div class="qtagl"><span class="qtag au">✨ Autoplay</span></div>'};
  return {cls:'',html:''};
}
function render(){
  var list=$('q-list'), next=TV.items||[], html;
  if(!next.length) html='<div class="qempty">Warteschlange leer<br>Scannt den QR-Code und wünscht euch was!</div>';
  else html=next.slice(0,8).map(function(it,n){
    var tg=tagsOf(it), pv=provIcon(it);
    return '<div class="qrow'+tg.cls+'"><span class="qn">'+(n+1)+'</span>'+
      '<div class="cover"'+bg(it.image)+'>'+(it.image?'':NOTE)+'</div>'+
      '<div class="meta"><div class="it1">'+esc(it.title)+'</div><div class="it2">'+esc(it.artist)+'</div>'+tg.html+'</div>'+
      (pv?'<div class="prov">'+pv+'</div>':'')+'</div>';
  }).join('');
  if(html!==lastHtml){ lastHtml=html; list.innerHTML=html; }
}

/* ---------- Als Nächstes im QR-Feld ---------- */
var upKey='';
function placeAbs(card,el){ var h=card&&card.querySelector('.h'); if(h&&el) el.style.top=(h.offsetTop+h.offsetHeight+8)+'px'; }
function placeAll(){ placeAbs(pCard,$('upNext')); placeAbs(qCard,$('beerBoard')); }
placeAll(); window.addEventListener('resize',placeAll);
function paintUp(){
  var it=(TV.items||[])[0], up=$('upNext'); if(!up||!it) return;
  var x=TV.wishOf(it), b=TV.boostOf(it), au=!x&&!b&&isAuto(it.uri);
  up.classList.toggle('wish',!!x&&!b); up.classList.toggle('boost',!!b);
  $('unW').className='w'+(b?' bo':(au?' au':''));
  $('unW').innerHTML=b?'⚡ vorgedrängelt von '+esc(b.n)+' 😤':(x?'🎵 von '+esc(x.n)+(x.d?' · <i>Für '+esc(x.d)+'</i>':''):(au?'✨ Autoplay':''));
  var k=it.uri+'|'+it.title+'|'+it.image; if(k===upKey) return; upKey=k;
  $('unCv').style.backgroundImage=TV.cssUrl(it.image);
  $('unCv').innerHTML=it.image?'':NOTE;
  $('unT').textContent=it.title||'';
  $('unA').textContent=it.artist||'';
}
var QR_S=25, NX_S=15, END_S=30;
function tickUp(){
  if(!pCard) return;
  var it=(TV.items||[])[0], rem=TV.dur>0?TV.dur-TV.pos:-1;
  $('unIn').textContent=rem>0?'in '+TV.fmt(rem):'';
  var show=false;
  if(it && it.title && TV.cur){
    if(rem>0 && rem<=END_S) show=true;
    else show=(Math.floor(Date.now()/1000)%(QR_S+NX_S))>=QR_S;
  }
  pCard.classList.toggle('shownext',show);
}

/* ---------- Zuletzt gespielt ---------- */
var rc=$('recentCard'), recPaintKey='', endedAt={}, lastUri='';
TV.on('track',function(cur){
  if(lastUri) endedAt[lastUri]=Date.now();
  lastUri=(cur&&cur.uri)||'';
});
function ago(u){ var t=endedAt[u]; if(!t) return ''; var m=Math.floor((Date.now()-t)/60000); return m<1?'gerade':'vor '+m+' Min'; }
function paintRecent(){
  var g=$('rcGrid'), rec=TV.prev||[];
  var pk=rec.map(function(x){ return x.uri+x.title; }).join('|');
  if(pk!==recPaintKey){
    recPaintKey=pk;
    g.innerHTML=rec.map(function(x,i){
      return '<div class="rct" style="animation-delay:'+(i*0.12)+'s"><div class="cv"'+bg(x.image)+'>'+(x.image?'':NOTE)+
        '<span class="ago"></span></div><div class="t">'+esc(x.title)+'</div><div class="a">'+esc(x.artist)+'</div><div class="g"></div></div>';
    }).join('');
  }
  var tiles=g.querySelectorAll('.rct');
  for(var i=0;i<tiles.length;i++){
    var x=rec[i]; if(!x) continue;
    var w=TV.wishOf(x), tg=w?'<span class="qtag wi">🎵 '+esc(w.n)+'</span>':(isAuto(x.uri)?'<span class="qtag au">✨ Autoplay</span>':'');
    var gg=tiles[i].querySelector('.g'); if(gg.innerHTML!==tg) gg.innerHTML=tg;
    tiles[i].querySelector('.ago').textContent=ago(x.uri);
  }
}
/* nur ohne Songtext; beim Songwechsel bleibt der vorige Zustand, bis klar ist, ob ein Text kommt (kein Aufblinken) */
var tKey='', waitUntil=0, visAtChange=false;
function vis(){
  var c=TV.cur, k=c?c.uri+'|'+c.title:'';
  if(k!==tKey){ tKey=k; waitUntil=Date.now()+6000; visAtChange=rc.classList.contains('show'); }
  var show=(TV.prev||[]).length>0 && !body.classList.contains('haslyr') && (Date.now()>=waitUntil || visAtChange);
  if(show!==rc.classList.contains('show')) rc.classList.toggle('show',show);
}

/* ---------- Getränke-Ranking ---------- */
var MED=['🥇','🥈','🥉'], beerKey='';
function beerActive(){
  var W=TV.W; if(!W.bc.length||!W.bt) return false;
  var newest=0; W.bc.forEach(function(x){ if(x.t>newest) newest=x.t; });
  return Date.now()/1000-newest<12*3600;
}
function paintBeer(){
  var W=TV.W, k=JSON.stringify(W.bc)+W.bt; if(k===beerKey) return; beerKey=k;
  $('bbTot').textContent=W.bt;
  var last=W.bi.length?W.bi[W.bi.length-1]:null;
  $('bbLast').innerHTML=last?'zuletzt<b>'+(last.e?esc(last.e)+' ':'')+esc(last.n)+'</b>'+(function(){ var m=Math.floor((Date.now()/1000-last.t)/60); return m<1?'gerade eben':'vor '+m+' Min'; })():'';
  var max=0; W.bc.forEach(function(x){ if(x.c>max) max=x.c; });
  $('bbList').innerHTML=W.bc.slice(0,6).map(function(x,i){
    return '<div class="bbr"><span class="rk">'+(MED[i]||(i+1)+'.')+'</span><span class="nm">'+(x.e?esc(x.e)+' ':'')+esc(x.n)+'</span>'+
      '<span class="bar"><i data-w="'+Math.round(x.c/Math.max(1,max)*100)+'" style="transition-delay:'+(0.15+i*0.12)+'s"></i></span><span class="ct">'+(+x.c||0)+'</span></div>';
  }).join('');
  if(qCard.classList.contains('showbeer')) grow(true);
}
function grow(on){
  var bars=$('beerBoard').querySelectorAll('.bar i');
  for(var i=0;i<bars.length;i++) bars[i].style.width=on?bars[i].getAttribute('data-w')+'%':'0';
}
var Q_S=20, B_S=10;
function tickBeer(){
  if(!qCard) return;
  var show=beerActive() && (Math.floor(Date.now()/1000)%(Q_S+B_S))>=Q_S;
  if(show===qCard.classList.contains('showbeer')) return;
  qCard.classList.toggle('showbeer',show);
  if(show) setTimeout(function(){ grow(true); },250); else setTimeout(function(){ grow(false); },700);
}

/* ---------- Ereignisse / Takt ---------- */
TV.on('queue',function(){ render(); paintUp(); paintRecent(); });
TV.on('wishes',function(){ render(); paintUp(); paintRecent(); paintBeer(); });
render();
setInterval(function(){ try{ tickUp(); }catch(e){} try{ tickBeer(); }catch(e){} try{ vis(); }catch(e){} },1000);
setInterval(function(){ try{ paintRecent(); }catch(e){} },15000);
})();
