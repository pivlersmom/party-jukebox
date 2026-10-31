/* ===================== Party-Jukebox TV: Songtext =====================
   Quellen der Reihe nach: Music Assistant (LRC/Text am Titel) → lrclib.net (zeitgenau; ohne Mix-Zusatz; Suche)
   → normaler Text gleichmäßig über die Songlänge verteilt.
   Anzeige mehrzeilig, aktuelle Zeile hervorgehoben, weiches Mitscrollen. Ohne Text bleibt die Karte aus.
   Versatz: unsichtbaren Streifen unten antippen → −/+ in 0,2-s-Schritten (wird im Add-on gespeichert, auch in der Jukebox unter ⚙ einstellbar; ?lookahead=… geht auch). */
(function(){
'use strict';
var TV=window.TV; if(!TV) return;
var $=TV.$, card=$('lyrCard'), box=$('lyrBox'), inner=$('lyrIn');
var lines=null, gen=0, act=-2, cache={}, cacheN=0;

var look=0.5, qp=null;
try{ qp=new URLSearchParams(location.search).get('lookahead'); localStorage.removeItem('tv_lyr_offset'); }catch(e){}
function fromSet(){
  var v=parseFloat(qp!=null?qp:(TV.set&&TV.set.lyr_offset)); if(!isNaN(v)){ look=v; act=-2; }
}
fromSet(); TV.on('set',fromSet);

/* ---------- Anzeige ---------- */
function setOn(on){ card.classList.toggle('on',!!on); document.body.classList.toggle('haslyr',!!on); }
function reset(){ lines=null; gen++; act=-2; inner.innerHTML=''; inner.style.transform='translateY(0)'; setOn(false); }
function show(l){
  lines=l&&l.length?l:null; act=-2;
  inner.innerHTML=lines?lines.map(function(x){ return '<div class="l"><span>'+TV.esc(x.text||'♪')+'</span></div>'; }).join(''):'';
  inner.style.transform='translateY(0)';
  setOn(!!lines);
}
function update(pos){
  if(!lines) return;
  var i=-1;
  for(var k=0;k<lines.length;k++){ if(lines[k].t<=pos+look) i=k; else break; }
  if(i===act) return;
  act=i;
  var kids=inner.children;
  for(var n=0;n<kids.length;n++){ kids[n].classList.remove('cur','nx','past'); if(n<i) kids[n].classList.add('past'); }
  if(i>=0 && kids[i]) kids[i].classList.add('cur');
  if(kids[i+1]) kids[i+1].classList.add('nx');
  var t=kids[Math.max(i,0)]; if(!t) return;
  inner.style.transform='translateY('+Math.round(box.clientHeight*0.4-(t.offsetTop+t.offsetHeight/2))+'px)';
}
TV.on('frame',update);
window.addEventListener('resize',function(){ act=-2; });

/* ---------- Text holen ---------- */
function isLrc(raw){ return /\[\d+:\d+(\.\d+)?\]/.test(String(raw||'')); }
function parseLrc(raw){
  var out=[];
  String(raw||'').split(/\r?\n/).forEach(function(line){
    var re=/\[(\d+):(\d+(?:\.\d+)?)\]/g, m, ts=[], last=0;
    while((m=re.exec(line)) && m.index===last){ ts.push(parseInt(m[1],10)*60+parseFloat(m[2])); last=re.lastIndex; }
    if(!ts.length) return;
    var txt=line.slice(last).trim();
    ts.forEach(function(t){ out.push({t:t,text:txt}); });
  });
  out.sort(function(a,b){ return a.t-b.t; });
  return out.length?out:null;
}
function cleanTitle(t){
  return String(t||'')
    .replace(/\s*[\(\[][^\)\]]*(mix|remix|edit|version|remake|bootleg|extended|instrumental|live)[^\)\]]*[\)\]]/gi,'')
    .replace(/\s*-\s*(extended|radio|club|original)\s+(mix|edit|version).*$/gi,'')
    .trim();
}
function norm(x){
  return String(x||'').toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss').replace(/[^a-z0-9]/g,'');
}
/* Treffer nur, wenn Interpret UND Titel passen (sonst lieber kein Text) */
function hitOk(h,artist,title){
  if(!h) return false;
  var ha=norm(h.artistName), a=norm(artist), ht=norm(h.trackName), t=norm(cleanTitle(title));
  if(!ha||!a||!ht||!t) return false;
  return (ha.indexOf(a)>=0||a.indexOf(ha)>=0) && (ht.indexOf(t)>=0||t.indexOf(ht)>=0);
}
function mdLyr(o){ var md=o&&o.metadata; return (md&&(md.lrc_lyrics||md.lyrics))||''; }
function maRaw(cur){
  var q=TV.q, mi=q&&q.current_item&&q.current_item.media_item, r=mdLyr(mi);
  if(r) return Promise.resolve(r);
  if(!TV.ok||!cur.uri) return Promise.resolve('');
  return TV.send('music/item_by_uri',{uri:cur.uri}).then(function(t){
    var r2=mdLyr(t); if(r2) return r2;
    if(!t||(t.media_type&&t.media_type!=='track')) return '';
    return TV.send('metadata/get_track_lyrics',{track:t}).then(function(x){
      if(typeof x==='string') return x;
      if(Array.isArray(x)) return x[1]||x[0]||'';
      return (x&&(x.lrc_lyrics||x.lyrics))||'';
    });
  }).catch(function(){ return ''; });
}
var LRCLIB='https://lrclib.net/api/';
function lrcGet(a,t){
  return fetch(LRCLIB+'get?artist_name='+encodeURIComponent(a)+'&track_name='+encodeURIComponent(t))
    .then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; });
}
function lrcSearch(a,t){
  return fetch(LRCLIB+'search?artist_name='+encodeURIComponent(a)+'&track_name='+encodeURIComponent(t))
    .then(function(r){ return r.ok?r.json():null; }).then(function(l){ return Array.isArray(l)?l:[]; }).catch(function(){ return []; });
}
function find(cur){
  var a1=String(cur.artist||'').split('/')[0].split(',')[0].trim(), t=cur.title||'', t2=cleanTitle(t), plain='';
  function take(raw){ if(!raw) return null; if(isLrc(raw)){ var l=parseLrc(raw); if(l) return l; } if(!plain) plain=raw; return null; }
  function lr(h){
    if(!hitOk(h,a1,t)) return null;
    if(h.syncedLyrics){ var l=parseLrc(h.syncedLyrics); if(l) return l; }
    if(h.plainLyrics && !plain) plain=h.plainLyrics;
    return null;
  }
  return maRaw(cur).then(function(raw){
    var l=take(raw); if(l) return l;
    if(!a1||!t) return null;
    return lrcGet(a1,t).then(function(h){
      var l2=lr(h); if(l2) return l2;
      return (t2&&t2!==t?lrcGet(a1,t2):Promise.resolve(null)).then(function(h2){
        var l3=lr(h2); if(l3) return l3;
        return lrcSearch(a1,t2||t).then(function(list){
          for(var i=0;i<list.length;i++){ var l4=lr(list[i]); if(l4) return l4; }
          return null;
        });
      });
    });
  }).then(function(l){ return l?{lines:l}:(plain?{plain:plain}:null); },function(){ return plain?{plain:plain}:null; });
}

/* Notlösung: normaler Text gleichmäßig über die Songlänge verteilt */
function spread(raw){
  var ls=String(raw||'').split(/\r?\n/).map(function(s){ return s.trim(); })
    .filter(function(s){ return s && !/^[\[(].*[\])]$/.test(s); });
  if(ls.length<3) return null;
  var D=TV.dur||0; if(!D) return 'wait';
  var s=Math.min(15,D*0.08), e=D*0.93, step=(e-s)/ls.length;
  return ls.map(function(x,i){ return {t:s+i*step,text:x}; });
}
function apply(res,g,n){
  if(g!==gen||!res) return;
  if(res.lines){ show(res.lines); return; }
  var l=spread(res.plain);
  if(l==='wait'){ if((n||0)<8) setTimeout(function(){ apply(res,g,(n||0)+1); },1500); return; }
  if(l) show(l);
}

/* ---------- Songwechsel ---------- */
TV.on('track',function(cur){
  reset();
  if(!cur||!cur.title) return;
  var key=(cur.uri||'')+'|'+cur.artist+'|'+cur.title, g=gen;
  if(cache.hasOwnProperty(key)){ apply(cache[key],g); return; }
  /* kurz warten: MA hängt die Metadaten (Lyrics) oft erst nach dem Start an */
  setTimeout(function(){
    if(g!==gen) return;
    find(cur).then(function(res){
      if(cacheN++>120){ cache={}; cacheN=0; }
      cache[key]=res; apply(res,g);
    });
  },1200);
});

/* ---------- Versatz-Leiste ---------- */
var bar=$('lyr-bar'), hideT=null;
function render(){ $('lyr-val').textContent=(look>0?'+':'')+look.toFixed(1)+'s'; }
function showBar(){ bar.classList.add('on'); render(); clearTimeout(hideT); hideT=setTimeout(function(){ bar.classList.remove('on'); },6000); }
function step(d){
  look=Math.max(-8,Math.min(8,Math.round((look+d)*10)/10));
  act=-2; showBar();
  if(TV.set) TV.set.lyr_offset=look;
  clearTimeout(step.t); step.t=setTimeout(function(){
    fetch('party/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lyr_offset:look,tv_only:true})}).catch(function(){});
  },800);
}
var hit=$('lyr-hit');
hit.addEventListener('click',showBar);
hit.addEventListener('touchend',function(e){ e.preventDefault(); showBar(); });
$('lyr-minus').onclick=function(e){ e.stopPropagation(); step(-0.2); };
$('lyr-plus').onclick=function(e){ e.stopPropagation(); step(0.2); };
})();
