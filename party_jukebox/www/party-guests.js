/* ===================== PARTY-JUKEBOX – Teilnehmer & Jukebox-Extras =====================
   - Name beim ersten Öffnen (freiwillig, "Ohne Namen" → "Gast 12"); Herzschlag alle 60 s → POST party/hb (Add-on).
   - Austreten: Browser/Tab schließen → sofortige Abmeldung; sonst nach ca. 3 Minuten raus.
   - Laufband: wer gerade dabei ist (GET party/guests.json). Antippen = Name ändern.
   - Widmung: vor jedem Wunsch optional "Für …" → erscheint auf dem TV, wenn der Song startet.
   - "Gewünscht von …" beim laufenden Song und in der Warteschlange (GET party/wishes.json).
   - Vordrängeln (⚡): erst Rückfrage ("Alle sehen, dass du es warst"), danach Buh-Ton beim Drängler,
     Hinweis-Banner bei allen anderen, "⚡ vorgedrängelt von …" in der Warteschlange und auf dem TV.
   - Münz-Look: Wünsche als Münzen, Einwurf-Animation + Klick-Geräusch beim Wünschen.
   - Abstimmung: Daumen hoch/runter für den laufenden Song; bei Mehrheit runter überspringt das Add-on.
   Alle Ereignisse (wish/boost/vote) → POST party/ev. */
(function(){
var HB='party/hb', EV='party/ev';   /* relativ zur Seite */
var LS='pj_party_';
function g(k,d){ try{ var v=localStorage.getItem(LS+k); return v==null?d:JSON.parse(v); }catch(e){ return d; } }
function s(k,v){ try{ localStorage.setItem(LS+k,JSON.stringify(v)); }catch(e){} }
function esc(x){ return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
var $=function(i){ return document.getElementById(i); };
var id=g('gid',null); if(!id){ id=Math.random().toString(36).slice(2,12)+Date.now().toString(36).slice(-4); s('gid',id); }

var css=document.createElement('style');
css.textContent=
'.ptk{display:flex;align-items:center;gap:10px;background:rgba(18,23,37,.78);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:9px 12px;margin-bottom:14px;cursor:pointer;overflow:hidden}'+
'.ptk .pc{display:flex;align-items:center;gap:6px;flex:none;font-weight:800;font-size:14px;color:var(--cyan)}'+
'.ptk .pc .ic{width:18px;height:18px}'+
'.ptk .vw{flex:1;min-width:0;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent);mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)}'+
'.ptk .rn{display:inline-flex;gap:18px;white-space:nowrap;padding-left:100%;animation:ptk var(--d,14s) linear infinite;font-size:14px;font-weight:600;color:var(--tx2)}'+
'.ptk .rn b{color:var(--tx)}.ptk .rn b.me{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}'+
'@keyframes ptk{to{transform:translateX(-100%)}}'+
'.pnm{position:fixed;inset:0;z-index:45;background:rgba(4,6,10,.78);display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .2s}'+
'.pnm.on{opacity:1;pointer-events:auto}'+
'.pnm .bx{width:100%;max-width:380px;background:#121725;border:1px solid rgba(255,255,255,.08);border-radius:22px;padding:22px 18px;text-align:center}'+
'.pnm h3{font-size:20px;font-weight:800;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}'+
'.pnm p{color:var(--tx2);font-size:14px;margin:8px 0 16px;line-height:1.5}'+
'.pnm p b{color:var(--tx)}'+
'.pnm input{width:100%;height:52px;border-radius:14px;border:1px solid var(--line);background:var(--s2);padding:0 14px;font-size:17px;outline:0;text-align:center}'+
'.pnm input:focus{border-color:var(--cyan)}'+
'.pnm .ok{width:100%;height:50px;border-radius:14px;background:var(--grad);color:#fff;font-weight:800;font-size:16px;margin-top:12px}'+
'.pnm .no{width:100%;height:42px;color:var(--tx3);font-weight:600;margin-top:6px}'+
'.pnm .hint{font-size:12px;color:var(--tx3);margin-top:8px}'+
'.pnm .warn{margin:-6px 0 12px;padding:9px 10px;border-radius:12px;background:rgba(255,120,50,.12);border:1px solid rgba(255,120,50,.35);color:#ffb37a;font-size:13px;font-weight:700;line-height:1.4}'+
/* Vordrängeln: Rückfrage + Banner */
'.pnm.bo .bx{border-color:rgba(255,120,50,.45);box-shadow:0 0 0 2px rgba(255,120,50,.25),0 0 40px rgba(255,80,40,.25)}'+
'.pnm.bo h3{background:linear-gradient(120deg,#ff8a3d,#ff3d6e);-webkit-background-clip:text;background-clip:text;color:transparent;font-size:22px}'+
'.pnm.bo .ok{background:linear-gradient(120deg,#ff8a3d,#ff3d6e)}'+
'.pnm.bo .no{color:var(--cyan);font-weight:800}'+
'.pnm .bem{font-size:44px;line-height:1;margin-bottom:6px}'+
'.pbo{position:fixed;left:12px;right:12px;top:12px;z-index:50;display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:18px;background:linear-gradient(120deg,rgba(255,138,61,.96),rgba(255,61,110,.96));color:#fff;box-shadow:0 12px 30px rgba(0,0,0,.45);transform:translateY(-140%);transition:transform .45s cubic-bezier(.2,.9,.25,1.2)}'+
'.pbo.on{transform:none;animation:pshake .5s .45s}'+
'.pbo .e{font-size:30px;flex:none}'+
'.pbo .t{min-width:0;flex:1;font-size:14px;line-height:1.35}'+
'.pbo .t b{display:block;font-size:16px;font-weight:900}'+
'.pbo .t span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.9}'+
'@keyframes pshake{0%,100%{transform:none}20%{transform:translateX(-8px) rotate(-1deg)}40%{transform:translateX(7px) rotate(1deg)}60%{transform:translateX(-5px)}80%{transform:translateX(4px)}}'+
'.nbo{margin-top:4px;font-size:13px;font-weight:800;color:#ff8a3d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
/* gewünscht von + Abstimmung */
'.nby{margin-top:6px;font-size:13px;font-weight:700;color:var(--cyan);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
'.nby i{font-style:normal;color:var(--pink)}'+
'.nvote{display:flex;align-items:center;gap:8px;margin-top:12px}'+
'.nvote button{flex:1;height:44px;border-radius:14px;background:var(--s2);border:1px solid rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;gap:8px;font-size:18px;font-weight:800;color:var(--tx2)}'+
'.nvote button b{font-size:15px;font-variant-numeric:tabular-nums}'+
'.nvote button.on.up{background:rgba(56,224,138,.16);border-color:#38e08a;color:#38e08a}'+
'.nvote button.on.dn{background:rgba(255,80,110,.16);border-color:#ff506e;color:#ff506e}'+
'.nvote button:active{transform:scale(.96)}'+
'.nvh{font-size:11px;color:var(--tx3);text-align:center;margin-top:6px}'+
/* Münzen */
'.qt.r #qtRn{display:none}'+
'.coins{display:flex;gap:3px;align-items:center;flex-wrap:wrap;min-height:18px}'+
'.coin{width:15px;height:15px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff6c2,#ffd23f 45%,#c98a00 100%);box-shadow:inset 0 0 0 1.5px rgba(120,80,0,.55),0 1px 2px rgba(0,0,0,.5);font-size:8px;font-weight:900;color:#7a5200;display:grid;place-items:center}'+
'.coin.e{background:none;box-shadow:inset 0 0 0 1.5px rgba(255,210,63,.35);color:transparent}'+
'.coin.drop{animation:cdrop .7s cubic-bezier(.3,1.6,.5,1)}'+
'@keyframes cdrop{0%{transform:translateY(-26px) rotateY(0);opacity:0}60%{opacity:1}100%{transform:none}}'+
'.flycoin{position:fixed;z-index:60;width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff6c2,#ffd23f 45%,#c98a00 100%);box-shadow:inset 0 0 0 2px rgba(120,80,0,.55),0 4px 12px rgba(0,0,0,.5);pointer-events:none;transition:transform .7s cubic-bezier(.5,-.3,.6,1),opacity .7s}';
document.head.appendChild(css);

function post(url,body){ try{ fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true}).catch(function(){}); }catch(e){} }

/* ---------- Name ---------- */
var nm=document.createElement('div'); nm.className='pnm'; nm.id='pNm';
nm.innerHTML='<div class="bx"><h3>Wie heißt du?</h3><p>Damit die anderen sehen, wer mitfeiert.<br>Freiwillig – geht auch ohne.</p>'+
  '<input id="pNmIn" maxlength="18" placeholder="Dein Name" autocomplete="off" enterkeyhint="done">'+
  '<button class="ok" id="pNmOk">Los geht’s</button><button class="no" id="pNmNo">Ohne Namen</button>'+
  '<div class="hint">Austreten: einfach den Browser schließen.</div></div>';
document.body.appendChild(nm);
var inp=$('pNmIn');
function clean(v){ return String(v||'').replace(/[^0-9A-Za-zÄÖÜäöüß .-]/g,'').replace(/\s+/g,' ').trim().slice(0,18); }
function openName(){ inp.value=g('name','')||''; if(/^Gast \d+$/.test(inp.value)) inp.value=''; nm.classList.add('on'); setTimeout(function(){ try{ inp.focus(); }catch(e){} },150); }
function setName(v){ v=clean(v); if(!v) v='Gast '+(10+Math.floor(Math.random()*90)); s('name',v); nm.classList.remove('on'); beat(); setTimeout(loadGuests,1500); }
$('pNmOk').onclick=function(){ setName(inp.value); };
$('pNmNo').onclick=function(){ setName(''); };
inp.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); setName(inp.value); } });

/* ---------- Laufband Teilnehmer ---------- */
var tk=document.createElement('div'); tk.className='ptk hide'; tk.id='pTk';
tk.innerHTML='<div class="pc"><svg class="ic" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14a6.5 6.5 0 0 1 3 6"/></svg><span id="pTkN">0</span></div><div class="vw"><div class="rn" id="pTkR"></div></div>';
tk.onclick=openName;
var appEl=$('app'), first=appEl&&appEl.firstElementChild;
if(appEl) appEl.insertBefore(tk,first);
var lastSig='', guestN=0;
function renderGuests(list){
  var me=g('name','');
  if(me && list.indexOf(me)<0) list=list.concat([me]);
  guestN=list.length;
  tk.classList.toggle('hide',!list.length);
  $('pTkN').textContent=list.length+(list.length===1?' ist dabei':' sind dabei');
  var sig=list.join('|')+'#'+me; if(sig===lastSig) return; lastSig=sig;
  var r=$('pTkR'), seenMe=false;
  r.innerHTML=list.map(function(n){ var m=(!seenMe&&n===me); if(m) seenMe=true; return '<b'+(m?' class="me"':'')+'>'+esc(n)+'</b>'; }).join('<span>·</span>');
  r.style.setProperty('--d',Math.max(10,list.join('').length*0.45+list.length*1.2)+'s');
}
function loadGuests(){
  fetch('party/guests.json?_='+Date.now(),{cache:'no-store'}).then(function(r){ return r.ok?r.json():null; })
    .then(function(j){ renderGuests((j&&Array.isArray(j.n))?j.n:[]); }).catch(function(){ renderGuests([]); });
}

/* ---------- Herzschlag + Abmelden ---------- */
function joined(){ return appEl && !appEl.classList.contains('hide'); }
function beat(){ var n=g('name',''); if(!n||!joined()) return; post(HB,{id:id,name:n}); }
var left=false;
function leave(){ if(left||!g('name','')) return; left=true; post(HB,{id:id,leave:true}); }
window.addEventListener('pagehide',leave);
window.addEventListener('pageshow',function(e){ if(e.persisted){ left=false; beat(); loadGuests(); } });
var asked=false;
setInterval(function(){ if(joined() && !g('name','') && !asked){ asked=true; openName(); } },700);
setInterval(function(){ if(!document.hidden){ left=false; beat(); } },60000);
setInterval(function(){ if(!document.hidden && joined()){ loadGuests(); loadWishes(); } },10000);
document.addEventListener('visibilitychange',function(){ if(!document.hidden){ left=false; beat(); loadGuests(); loadWishes(); } });
var w=setInterval(function(){ if(joined()){ clearInterval(w); beat(); loadGuests(); loadWishes(); } },500);

/* ---------- Wünsche / Vordrängler / Abstimmung laden ---------- */
var W={w:[],bo:[],vote:{u:'',up:0,down:0,need:2}}, boSeen=null;
function loadWishes(){
  fetch('party/wishes.json?_='+Date.now(),{cache:'no-store'}).then(function(r){ return r.ok?r.json():null; })
    .then(function(j){
      if(!j) return; W=j; W.w=W.w||[]; W.bo=W.bo||[]; W.vote=W.vote||{};
      checkBoosts(); renderBy(); renderVote(); if(window.pjParty) window.pjParty.rerenderQueue();
    }).catch(function(){});
}
function wishFor(uri){ if(!uri) return null; for(var i=W.w.length-1;i>=0;i--){ if(W.w[i].u===uri) return W.w[i]; } return null; }
function boostFor(uri){ if(!uri) return null; var now=Date.now()/1000; for(var i=W.bo.length-1;i>=0;i--){ var x=W.bo[i]; if(x.u===uri && now-x.t<3*3600) return x; } return null; }
window.pjWishBy=function(uri){ var x=wishFor(uri); return x?x.n:''; };
window.pjBoostBy=function(uri){ var x=boostFor(uri); return x?x.n:''; };

/* ---------- Läuft gerade: gewünscht von + vorgedrängelt + Abstimmung ---------- */
var by=document.createElement('div'); by.className='nby hide'; by.id='nBy';
var bo=document.createElement('div'); bo.className='nbo hide'; bo.id='nBo';
var ar=$('nAr'); if(ar){ ar.after(by); by.after(bo); }
var vt=document.createElement('div');
vt.innerHTML='<div class="nvote"><button class="up" id="vUp">👍<b id="vUpN">0</b></button><button class="dn" id="vDn">👎<b id="vDnN">0</b></button></div><div class="nvh" id="vH"></div>';
var prog=$('nProg'); if(prog) prog.after(vt);
var curUri='', curQ='';
function cur(){ var ci=window.pjParty&&window.pjParty.now(); return ci&&ci.media_item?ci.media_item.uri:''; }
function renderBy(){
  var u=cur(), x=wishFor(u), b=boostFor(u);
  by.classList.toggle('hide',!x);
  if(x) by.innerHTML='🎵 gewünscht von '+esc(x.n)+(x.d?' · <i>„Für '+esc(x.d)+'“</i>':'');
  bo.classList.toggle('hide',!b);
  if(b) bo.textContent='⚡ vorgedrängelt von '+b.n+' 😤';
}
function myVote(){ return g('vote_'+curUri,''); }
function renderVote(){
  var u=cur(); vt.style.display=u?'':'none'; if(!u) return;
  var v=W.vote||{}, same=v.u===u, up=same?(v.up||0):0, dn=same?(v.down||0):0, mine=myVote();
  /* eigene Stimme sofort zeigen, auch bevor das Add-on sie zurückmeldet */
  if(mine==='up' && !same) up=1; if(mine==='down' && !same) dn=1;
  $('vUpN').textContent=up; $('vDnN').textContent=dn;
  $('vUp').classList.toggle('on',mine==='up'); $('vDn').classList.toggle('on',mine==='down');
  var need=v.need||2;
  $('vH').textContent=dn?('Bei '+need+'× 👎 (und mehr 👎 als 👍) wird übersprungen'):'Gefällt dir der Song?';
}
function vote(kind){
  var u=cur(); if(!u) return;
  var mine=myVote(), v=mine===kind?'none':kind;
  s('vote_'+u,v==='none'?'':v); curUri=u;
  post(EV,{type:'vote',id:id,name:g('name',''),u:u,q:curQ,v:v});
  renderVote(); setTimeout(loadWishes,1500);
}
$('vUp').onclick=function(){ vote('up'); };
$('vDn').onclick=function(){ vote('down'); };
window.pjOnNow=function(ci,qid){ curQ=qid||''; var u=ci&&ci.media_item?ci.media_item.uri:''; if(u!==curUri){ curUri=u; } renderBy(); renderVote(); };

/* ---------- Münzen ---------- */
var coinBox=document.createElement('div'); coinBox.className='coins'; coinBox.id='coins';
var rn=$('qtRn'); if(rn) rn.after(coinBox);
var lastCoins='';
function renderCoins(drop){
  var t=(rn&&rn.textContent)||'', m=t.match(/(\d+)\s*\/\s*(\d+)/);
  if(!m){ coinBox.innerHTML=t==='∞'?'<span style="font-weight:800">🪙 ∞</span>':''; return; }
  var n=+m[1], lim=+m[2], key=n+'/'+lim; if(key===lastCoins && !drop) return; lastCoins=key;
  if(lim>8){ coinBox.innerHTML='<span class="coin">V</span><b style="font-size:16px">× '+n+'</b>'; return; }
  var h=''; for(var i=0;i<lim;i++) h+='<span class="coin'+(i<n?'':' e')+'">'+(i<n?'V':'')+'</span>';
  coinBox.innerHTML=h;
}
if(rn) new MutationObserver(function(){ renderCoins(false); }).observe(rn,{childList:true,characterData:true,subtree:true});
renderCoins(false);
var actx=null;
function ac(){ actx=actx||new (window.AudioContext||window.webkitAudioContext)(); return actx; }
function clink(){
  try{
    var a=ac(), t0=a.currentTime;
    [[2637,0],[3520,.07],[1975,.16]].forEach(function(p){
      var o=a.createOscillator(), gn=a.createGain();
      o.type='triangle'; o.frequency.value=p[0];
      gn.gain.setValueAtTime(0.0001,t0+p[1]); gn.gain.exponentialRampToValueAtTime(0.25,t0+p[1]+0.005); gn.gain.exponentialRampToValueAtTime(0.0001,t0+p[1]+0.22);
      o.connect(gn); gn.connect(a.destination); o.start(t0+p[1]); o.stop(t0+p[1]+0.25);
    });
  }catch(e){}
}
/* Buh-Ton (absteigende "Wah-wah-wah-waaah"-Posaune) */
function buh(){
  try{
    var a=ac(), t0=a.currentTime;
    [[392,0,.32],[370,.36,.32],[349,.72,.32],[330,1.08,.9]].forEach(function(p,i){
      var o=a.createOscillator(), gn=a.createGain(), f=a.createBiquadFilter();
      o.type='sawtooth'; o.frequency.setValueAtTime(p[0],t0+p[1]);
      if(i===3){ var l=a.createOscillator(), lg=a.createGain(); l.frequency.value=6; lg.gain.value=9; l.connect(lg); lg.connect(o.frequency); l.start(t0+p[1]); l.stop(t0+p[1]+p[2]); o.frequency.linearRampToValueAtTime(p[0]*0.94,t0+p[1]+p[2]); }
      f.type='lowpass'; f.frequency.value=900;
      gn.gain.setValueAtTime(0.0001,t0+p[1]); gn.gain.exponentialRampToValueAtTime(0.16,t0+p[1]+0.04); gn.gain.exponentialRampToValueAtTime(0.0001,t0+p[1]+p[2]);
      o.connect(f); f.connect(gn); gn.connect(a.destination); o.start(t0+p[1]); o.stop(t0+p[1]+p[2]+0.05);
    });
  }catch(e){}
  try{ navigator.vibrate&&navigator.vibrate([120,80,120,80,300]); }catch(e){}
}
function flyCoin(fromEl){
  var target=coinBox.getBoundingClientRect(), r=fromEl?fromEl.getBoundingClientRect():{left:innerWidth/2,top:innerHeight/2,width:0,height:0};
  var c=document.createElement('div'); c.className='flycoin';
  c.style.left=(r.left+r.width/2-13)+'px'; c.style.top=(r.top+r.height/2-13)+'px';
  document.body.appendChild(c);
  requestAnimationFrame(function(){ c.style.transform='translate('+(target.left+10-(r.left+r.width/2))+'px,'+(target.top+8-(r.top+r.height/2))+'px) scale(.5) rotateY(720deg)'; c.style.opacity='0'; });
  setTimeout(function(){ c.remove(); },800);
}

/* ---------- Vordrängeln: Rückfrage, Meldung, Banner bei den anderen ---------- */
var bq=document.createElement('div'); bq.className='pnm bo'; bq.id='pBq';
bq.innerHTML='<div class="bx"><div class="bem">😬</div><h3>Wirklich vordrängeln?</h3><p id="pBqS"></p>'+
  '<div class="warn">Alle sehen auf dem Fernseher, dass du dich vorgedrängelt hast – inklusive Buh-Rufe. 👎</div>'+
  '<button class="ok" id="pBqOk">⚡ Trotzdem vordrängeln</button><button class="no" id="pBqNo">😇 Lieber brav anstellen</button></div>';
document.body.appendChild(bq);
var bqRes=null;
function bqClose(v){ bq.classList.remove('on'); var r=bqRes; bqRes=null; if(r) r(v); }
$('pBqOk').onclick=function(){ bqClose(true); };
$('pBqNo').onclick=function(){ bqClose(false); };
bq.addEventListener('click',function(e){ if(e.target===bq) bqClose(false); });
window.pjBeforeBoost=function(mi){
  return new Promise(function(res){
    bqRes=res;
    $('pBqS').innerHTML='<b>'+esc((mi&&mi.name)||'Dieser Song')+'</b> soll vor allen anderen Wünschen laufen?';
    bq.classList.add('on');
  });
};
function sendBoost(mi,qid){
  var arts=window.pjParty?window.pjParty.artists(mi):'';
  post(EV,{type:'boost',id:id,name:g('name','')||'Gast',u:(mi&&mi.uri)||'',s:(mi&&mi.name)||'',a:arts,q:qid||''});
}
var shameT=null;
window.pjAfterBoost=function(mi,qid){
  sendBoost(mi,qid); buh();
  if(window.pjParty) window.pjParty.toast('😤 Vorgedrängelt! Der Fernseher verpetzt dich gerade …');
  clearTimeout(shameT); shameT=setTimeout(loadWishes,2000);
};
var ban=document.createElement('div'); ban.className='pbo'; ban.id='pBo';
ban.innerHTML='<div class="e">😤</div><div class="t"><b id="pBoN"></b><span id="pBoS"></span></div>';
document.body.appendChild(ban);
var banT=null;
function showBan(x){
  $('pBoN').textContent=x.n+' drängelt sich vor! 👎';
  $('pBoS').textContent='⚡ '+(x.s||'')+(x.a?' – '+x.a:'');
  ban.classList.remove('on'); void ban.offsetWidth; ban.classList.add('on');
  try{ navigator.vibrate&&navigator.vibrate([80,60,80]); }catch(e){}
  clearTimeout(banT); banT=setTimeout(function(){ ban.classList.remove('on'); },6000);
}
ban.onclick=function(){ ban.classList.remove('on'); };
function checkBoosts(){
  var list=W.bo||[], maxT=0; list.forEach(function(x){ if(x.t>maxT) maxT=x.t; });
  if(boSeen===null){ boSeen=maxT; return; }   /* beim ersten Laden nichts Altes zeigen */
  var fresh=list.filter(function(x){ return x.t>boSeen && x.g!==String(id).replace(/[^A-Za-z0-9]/g,'').slice(0,20); });
  boSeen=Math.max(boSeen,maxT);
  if(fresh.length) showBan(fresh[fresh.length-1]);
}

/* ---------- Widmung vor dem Wunsch ---------- */
var dd=document.createElement('div'); dd.className='pnm'; dd.id='pDd';
dd.innerHTML='<div class="bx"><h3>Widmung?</h3><p id="pDdS"></p><div class="warn" id="pDdW" style="display:none">⚡ Du drängelst dich damit vor – alle sehen auf dem Fernseher, dass du es warst. 👎</div>'+
  '<input id="pDdIn" maxlength="40" placeholder="Für … (z. B. das Geburtstagskind ❤️)" autocomplete="off" enterkeyhint="send">'+
  '<button class="ok" id="pDdOk">🪙 Wünschen</button><button class="no" id="pDdNo">Ohne Widmung wünschen</button></div>';
document.body.appendChild(dd);
var ddRes=null;
function ddClose(v){ dd.classList.remove('on'); var r=ddRes; ddRes=null; if(r) r(v); }
$('pDdOk').onclick=function(){ ddClose(String($('pDdIn').value||'').replace(/^\s*für\s+/i,'').trim().slice(0,40)); };
$('pDdNo').onclick=function(){ ddClose(''); };
$('pDdIn').addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); $('pDdOk').click(); } });
dd.addEventListener('click',function(e){ if(e.target===dd) ddClose(false); });
window.pjBeforeAdd=function(t,boost){
  return new Promise(function(res){
    ddRes=res;
    $('pDdS').innerHTML='<b>'+esc(t.name)+'</b><br>Für jemanden? Die Widmung erscheint auf dem Fernseher, wenn der Song läuft.';
    $('pDdW').style.display=boost?'':'none';
    $('pDdIn').value=''; $('pDdOk').textContent=boost?'⚡ Trotzdem vordrängeln':'🪙 Wünschen';
    dd.classList.add('on'); setTimeout(function(){ try{ $('pDdIn').focus(); }catch(e){} },150);
  });
};
window.pjAfterAdd=function(t,boost,ded,qid,btn){
  var arts=window.pjParty?window.pjParty.artists(t):'';
  post(EV,{type:'wish',id:id,name:g('name','')||'Gast',u:t.uri,s:t.name,a:arts,d:ded||'',b:!!boost,q:qid||''});
  if(boost){ setTimeout(function(){ sendBoost(t,qid); },400); buh(); }
  else{ clink(); flyCoin(btn); setTimeout(function(){ renderCoins(true); var cs=coinBox.querySelectorAll('.coin.e'); var c=cs[0]; if(c){ c.classList.add('drop'); } },650); }
  setTimeout(loadWishes,2000);
};

})();
