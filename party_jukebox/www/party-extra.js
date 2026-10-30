/* ===================== PARTY-JUKEBOX – Extras =====================
   - Eigene Karte "Getränk leer? – Nachschub bestellen" unter den Wunsch-Zählern (zeigt das zuletzt gewählte Getränk):
     öffnet die Getränkeauswahl (Liste aus den Add-on-Optionen, window.PJ.drinks).
     Ein Tipp auf ein Getränk meldet es (POST party/ev, type "beer"): Name + Getränk erscheinen auf dem Fernseher,
     optional Benachrichtigung an den Gastgeber (Add-on-Option notify_service).
     Das letzte Getränk steht oben als "Nochmal …". Pro Gast höchstens alle 90 s (auch im Add-on geprüft).
   - Beim Melden: Einschenk-Geräusch. Liegt party-bier.mp3 neben der Seite, wird diese Datei abgespielt,
     sonst ein per Web Audio erzeugtes Gluckern + Schaum-Prickeln.
   - Lichteffekt optional über Add-on-Option script_drink.
   - Teilnehmer-Laufband: hinter jedem Namen die Zahl der bestellten Getränke (z. B. "Alex 🥤 3"). */
(function(){
var EV='party/ev', LS='pj_party_', SND='party-bier.mp3';
/* Getränke aus config.js: {k,n,e,p} (Server) – {k,name,emoji,phrase} wird ebenfalls akzeptiert */
var DRINKS=((window.PJ&&window.PJ.drinks)||[]).map(function(x,i){
  var n=String(x.n||x.name||('Getränk '+(i+1)));
  return [String(x.k||('d'+i)), n, String(x.e||x.emoji||'🍺'), String(x.p||x.phrase||('ein '+n))];
});
if(!DRINKS.length) DRINKS=[['bier','Bier','🍺','ein Bier']];
function g(k,d){ try{ var v=localStorage.getItem(LS+k); return v==null?d:JSON.parse(v); }catch(e){ return d; } }
function s(k,v){ try{ localStorage.setItem(LS+k,JSON.stringify(v)); }catch(e){} }
var $=function(i){ return document.getElementById(i); };
function esc(x){ return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
if($('pBeer')) return;   /* schon geladen (z. B. über Nachlader aus party-guests.js) */
function toast(t){ if(window.pjParty&&window.pjParty.toast) window.pjParty.toast(t); }
function post(body){ try{ fetch(EV,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true}).catch(function(){}); }catch(e){} }
function drink(k){ for(var i=0;i<DRINKS.length;i++) if(DRINKS[i][0]===k) return DRINKS[i]; return DRINKS[0]; }

/* ---------- Eigene Sounddatei (optional) ---------- */
var snd=null, sndOk=false;
try{
  snd=new Audio(); snd.preload='auto';
  snd.addEventListener('canplaythrough',function(){ sndOk=true; },{once:true});
  snd.addEventListener('error',function(){ sndOk=false; });
  snd.src=SND+'?v=1';
}catch(e){ snd=null; }

/* ---------- Erzeugtes Einschenk-Geräusch (Rückfall) ---------- */
var actx=null;
function ac(){ actx=actx||new (window.AudioContext||window.webkitAudioContext)(); if(actx.state==='suspended') actx.resume(); return actx; }
function noiseBuf(a,sec){ var n=Math.floor(a.sampleRate*sec), b=a.createBuffer(1,n,a.sampleRate), d=b.getChannelData(0); for(var i=0;i<n;i++) d[i]=Math.random()*2-1; return b; }
function synthPour(){
  try{
    var a=ac(), t0=a.currentTime+0.02, T=1.6;
    var src=a.createBufferSource(); src.buffer=noiseBuf(a,T+0.2);
    var bp=a.createBiquadFilter(); bp.type='bandpass'; bp.Q.value=6;
    bp.frequency.setValueAtTime(380,t0); bp.frequency.exponentialRampToValueAtTime(1500,t0+T);
    var gl=a.createGain(); gl.gain.value=0.55;
    var lfo=a.createOscillator(), lg=a.createGain(); lfo.type='sine';
    lfo.frequency.setValueAtTime(7,t0); lfo.frequency.linearRampToValueAtTime(13,t0+T); lg.gain.value=0.45;
    lfo.connect(lg); lg.connect(gl.gain);
    var env=a.createGain();
    env.gain.setValueAtTime(0.0001,t0); env.gain.exponentialRampToValueAtTime(0.9,t0+0.08);
    env.gain.setValueAtTime(0.9,t0+T-0.25); env.gain.exponentialRampToValueAtTime(0.0001,t0+T);
    src.connect(bp); bp.connect(gl); gl.connect(env); env.connect(a.destination);
    src.start(t0); src.stop(t0+T+0.1); lfo.start(t0); lfo.stop(t0+T+0.1);
    var f=a.createBufferSource(); f.buffer=noiseBuf(a,2.2);
    var hp=a.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=5000;
    var fe=a.createGain(), f1=t0+0.5, f2=t0+T+0.9;
    fe.gain.setValueAtTime(0.0001,f1); fe.gain.exponentialRampToValueAtTime(0.18,t0+T-0.1); fe.gain.exponentialRampToValueAtTime(0.0001,f2);
    var fl=a.createOscillator(), flg=a.createGain(); fl.type='square'; fl.frequency.value=31; flg.gain.value=0.08;
    fl.connect(flg); flg.connect(fe.gain);
    f.connect(hp); hp.connect(fe); fe.connect(a.destination);
    f.start(f1); f.stop(f2+0.05); fl.start(f1); fl.stop(f2+0.05);
    var o=a.createOscillator(), og=a.createGain(), oc=t0+T+0.05; o.type='triangle'; o.frequency.value=1760;
    og.gain.setValueAtTime(0.0001,oc); og.gain.exponentialRampToValueAtTime(0.12,oc+0.005); og.gain.exponentialRampToValueAtTime(0.0001,oc+0.35);
    o.connect(og); og.connect(a.destination); o.start(oc); o.stop(oc+0.4);
  }catch(e){}
}
function pour(){
  if(snd && sndOk){
    try{ snd.currentTime=0; var p=snd.play(); if(p&&p.catch) p.catch(synthPour); return; }catch(e){}
  }
  synthPour();
}

var css=document.createElement('style');
css.textContent=
'.pdr{display:flex;align-items:center;gap:14px;width:100%;margin-bottom:14px;padding:12px 14px;border-radius:20px;text-align:left;background:linear-gradient(120deg,rgba(255,210,63,.16),rgba(255,138,61,.12));border:1px solid rgba(255,190,60,.4);box-shadow:0 0 30px rgba(255,160,40,.08)}'+
'.pdr:active{transform:scale(.98)}'+
'.pdr .de{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;font-size:30px;flex:none;background:rgba(5,7,12,.45);box-shadow:inset 0 0 0 1.5px rgba(255,190,60,.45)}'+
'.pdr .dt{min-width:0;flex:1}'+
'.pdr .dt b{display:block;font-size:17px;font-weight:900;background:linear-gradient(120deg,#ffd23f,#ff8a3d);-webkit-background-clip:text;background-clip:text;color:transparent}'+
'.pdr .dt span{display:block;font-size:13px;font-weight:600;color:var(--tx2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
'.pdr .dc{flex:none;color:#ffb534;font-size:22px;font-weight:800}'+
'.ptk .rn b small{font-size:12px;font-weight:800;color:#ffb534;margin-left:4px;-webkit-text-fill-color:#ffb534}'+
'.pnm.bi .bx{border-color:rgba(255,210,63,.45);box-shadow:0 0 0 2px rgba(255,210,63,.2),0 0 40px rgba(255,170,40,.2);max-height:88vh;overflow:auto}'+
'.pnm.bi h3{background:linear-gradient(120deg,#ffd23f,#ff8a3d);-webkit-background-clip:text;background-clip:text;color:transparent;font-size:22px}'+
'.pnm.bi .again{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:56px;margin-top:6px;border-radius:16px;border:0;background:linear-gradient(120deg,#ffd23f,#ff8a3d);color:#2a1a00;font-size:17px;font-weight:900}'+
'.pnm.bi .again span{font-size:26px}'+
'.pnm.bi .again:active,.pnm.bi .dk:active{transform:scale(.96)}'+
'.pnm.bi .dg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0 4px}'+
'.pnm.bi .dk{display:flex;align-items:center;gap:10px;height:52px;padding:0 14px;border-radius:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:#eef2fa;font-size:15px;font-weight:700;text-align:left}'+
'.pnm.bi .dk span{font-size:24px;width:28px;text-align:center;flex:none}'+
'.pnm.bi .dk.last{border-color:rgba(255,210,63,.55);background:rgba(255,210,63,.1)}';
document.head.appendChild(css);

/* Karte unter den Wunsch-Zählern (sonst unter "Läuft gerade") */
var anchor=document.querySelector('.quota')||$('nowCard'); if(!anchor) return;
var b=document.createElement('button'); b.className='pdr'; b.id='pBeer';
b.innerHTML='<span class="de" id="pDrE">🍺</span><span class="dt"><b>Getränk leer?</b><span id="pDrS">Nachschub bestellen – der Fernseher sagt Bescheid</span></span><span class="dc">›</span>';
anchor.after(b);
function label(){
  var k=g('drink',null), d=drink(k);
  $('pDrE').textContent=d[2];
  $('pDrS').textContent=k?'Nochmal '+d[1]+' oder was anderes bestellen':'Nachschub bestellen – der Fernseher sagt Bescheid';
}
label();

/* ---------- Teilnehmer-Laufband: Anzahl Getränke hinter den Namen ---------- */
var BC={};
function loadCounts(){
  fetch('party/wishes.json?_='+Date.now(),{cache:'no-store'}).then(function(r){ return r.ok?r.json():null; }).then(function(j){
    var m={}; ((j&&j.bc)||[]).forEach(function(x){ if(x&&x.n) m[x.n]=x; });
    BC=m; mark();
  }).catch(function(){});
}
function mark(){
  var r=$('pTkR'); if(!r) return;
  Array.prototype.forEach.call(r.querySelectorAll('b'),function(el){
    var sm=el.querySelector('small'), n=sm?el.getAttribute('data-n'):el.textContent, x=BC[n];
    if(!sm) el.setAttribute('data-n',n);
    var t=x&&x.c?' '+(x.e||'🍺')+' '+x.c:'';
    if(sm){ if(!t) sm.remove(); else if(sm.textContent!==t) sm.textContent=t; }
    else if(t){ var s2=document.createElement('small'); s2.textContent=t; el.appendChild(s2); }
  });
}
var rr=$('pTkR'); if(rr) new MutationObserver(mark).observe(rr,{childList:true});
loadCounts(); setInterval(function(){ if(!document.hidden) loadCounts(); },10000);

var dlg=document.createElement('div'); dlg.className='pnm bi'; dlg.id='pBi';
dlg.innerHTML='<div class="bx"><h3>Nachschub?</h3><p>Dein Name + Getränk erscheinen auf dem Fernseher –<br><b>dann weiß jeder Bescheid!</b></p>'+
  '<button class="again" id="pBiAg"></button><div class="dg" id="pBiG"></div><button class="no" id="pBiNo">Doch nicht</button></div>';
document.body.appendChild(dlg);
function close(){ dlg.classList.remove('on'); }
function fill(){
  var last=drink(g('drink',null))[0], d=drink(last);
  $('pBiAg').innerHTML='<span>'+esc(d[2])+'</span>'+esc(g('drink',null)?'Nochmal '+d[1]:d[1]+' bitte!');
  $('pBiAg').onclick=function(){ send(d[0]); };
  $('pBiG').innerHTML=DRINKS.map(function(x){ return '<button class="dk'+(x[0]===last?' last':'')+'" data-k="'+esc(x[0])+'"><span>'+esc(x[2])+'</span>'+esc(x[1])+'</button>'; }).join('');
  Array.prototype.forEach.call($('pBiG').querySelectorAll('.dk'),function(el){ el.onclick=function(){ send(el.getAttribute('data-k')); }; });
}
function send(k){
  var d=drink(k);
  close(); s('beer_t',Date.now()); s('drink',d[0]); label();
  post({type:'beer',id:g('gid',''),name:g('name','')||'Gast',k:d[0],d:d[1],e:d[2],p:d[3]});
  setTimeout(loadCounts,2500);
  pour();
  toast(d[2]+' '+d[1]+' gemeldet! Der Fernseher sagt Bescheid.');
  try{ navigator.vibrate&&navigator.vibrate([60,40,60]); }catch(e){}
}
$('pBiNo').onclick=close;
dlg.addEventListener('click',function(e){ if(e.target===dlg) close(); });
b.addEventListener('click',function(e){
  e.stopPropagation();
  if(Date.now()-(+g('beer_t',0)||0)<90000){ toast(drink(g('drink',null))[2]+' Schon gemeldet – Nachschub kommt!'); return; }
  try{ ac(); }catch(e){}   /* Audio schon beim ersten Tippen freischalten */
  fill(); dlg.classList.add('on');
});
})();
