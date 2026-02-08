"use strict";
// Auto-follow current lyric line (scroll). User requested OFF.
const AUTO_FOLLOW = false;


// ---------- DOM helpers ----------
function $(id){ return document.getElementById(id); }
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);
  });
}

// ---------- Silent SW cleanup (no UI) ----------
// If a broken SW is still controlling this scope, unregister it ONCE and reload once.
(function swCleanupOnce(){
  try{
    if (!("serviceWorker" in navigator)) return;
    if (!navigator.serviceWorker.controller) return;
    if (localStorage.getItem("lp_sw_cleanup_done_fix2") === "1") return;

    // mark now to avoid loops even if something fails
    localStorage.setItem("lp_sw_cleanup_done_fix2","1");

    Promise.resolve()
      .then(()=>navigator.serviceWorker.getRegistrations())
      .then((regs)=>{
        return Promise.all(regs.map(r=>r.unregister().catch(()=>false)));
      })
      .then(()=>{
        if (!("caches" in window)) return;
        return caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k).catch(()=>false))));
      })
      .then(()=>{
        // reload once to detach from old SW
        const u = new URL(location.href);
        u.searchParams.set("v","fix-" + Date.now());
        location.replace(u.toString());
      })
      .catch(()=>{ /* ignore */ });
  }catch(e){ /* ignore */ }
})();

const inAudio = $("inAudio");
const inLyrics = $("inLyrics");
const audioEl  = $("audio");

const statusEl = $("status");
const curLineEl = $("curLine");
const chipTrack = $("chipTrack");

const trackListEl = $("trackList");
const lyricListEl = $("lyricList");
const panelLists  = $("panelLists");
const panelLyrics = $("panelLyrics");

const btnPlay = $("btnPlay");
const btnPrev = $("btnPrev");
const btnNext = $("btnNext");
const btnList = $("btnList");
const btnJP   = $("btnJP");

// ---------- state ----------
let tracks = []; // {name,url,file}
let trackIndex = -1;

const lyricsMap = new Map(); // lyricKey -> {name,text,lines}
let linkMap = loadLinkMap(); // trackKey -> lyricKey

let currentLines = []; // active lyric lines
let currentLineIndex = -1;

let jpOn = true;
let listOn = true;

let syncTimer = null;

// ---------- UI helpers ----------
function setStatus(t){ statusEl.textContent = String(t); }
function setCur(en, jp){ curLineEl.textContent = "EN: " + (en||"") + "\nJP: " + (jp||""); }

// ---------- filename matching ----------
function baseName(name){
  let n = String(name||"");
  n = n.replace(/\.[^\.]+$/,"");
  return n;
}
function normalizeKey(name){
  let s = String(name||"").toLowerCase();
  s = s.replace(/\.[^\.]+$/,"");
  s = s.replace(/\(.*?\)|\[.*?\]|\{.*?\}/g," ");
  s = s.replace(/\b(remaster(ed)?|mono|stereo|live|demo|version|edit|mix|feat\.?|ft\.?|official|audio|lyrics?)\b/g," ");
  s = s.replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g," ");
  s = s.replace(/\s+/g," ").trim();
  return s;
}

// ---------- storage ----------
function loadLinkMap(){
  try{
    const raw = localStorage.getItem("lp_link_map_stable");
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    return new Map(Object.entries(obj||{}));
  }catch(e){ return new Map(); }
}
function saveLinkMap(){
  try{
    const obj = Object.fromEntries(linkMap.entries());
    localStorage.setItem("lp_link_map_stable", JSON.stringify(obj));
  }catch(e){}
}

// ---------- cleanup ----------
function clearTracks(){
  for (const t of tracks){
    try{ URL.revokeObjectURL(t.url); }catch(e){}
  }
  tracks = [];
  trackIndex = -1;
}

// ---------- LRC parser ----------
function parseLRC(text){
  // returns [{t:number|null, en:string, jp:string|null}]
  let s = String(text || "").replace(/\r/g,"");
  const lines = s.split("\n");
  const out = [];
  let hasTime = false;

  for (let i=0;i<lines.length;i++){
    const line = lines[i];
    if (!line) continue;

    if (/^\[[a-z]{1,8}:/i.test(line.trim())) continue; // metadata tags

    const tags = line.match(/\[(\d{1,3}):(\d{2})(?:[\.,](\d{1,3}))?\]/g);
    if (tags && tags.length){
      hasTime = true;
      const plain = line.replace(/\[(\d{1,3}):(\d{2})(?:[\.,](\d{1,3}))?\]/g,"").trim();
      if (!plain) continue;

      for (let j=0;j<tags.length;j++){
        const mm = /\[(\d{1,3}):(\d{2})(?:[\.,](\d{1,3}))?\]/.exec(tags[j]);
        if (!mm) continue;
        const min = parseInt(mm[1],10) || 0;
        const sec = parseInt(mm[2],10) || 0;
        const frac = mm[3] ? String(mm[3]) : "";
        let ms = 0;
        if (frac) ms = parseInt((frac + "00").slice(0,3),10) || 0;
        const t = (min*60)+sec+(ms/1000);
        out.push({t, en:plain, jp:null});
      }
    }else{
      const p = line.trim();
      if (!p) continue;
      out.push({t:null, en:p, jp:null});
    }
  }
  if (hasTime) out.sort((a,b)=>(a.t||0)-(b.t||0));
  return out;
}

// ---------- rendering ----------
function renderTrackList(){
  trackListEl.innerHTML = "";
  if (!tracks.length){
    trackListEl.innerHTML = '<div class="itemRow"><div class="t" style="opacity:.75">AUDIOを選ぶ で曲を選択してください。</div></div>';
    return;
  }
  for (let i=0;i<tracks.length;i++){
    const t = tracks[i];
    const lab = document.createElement("label");
    lab.className = "itemRow" + (i===trackIndex ? " current":"");
    lab.innerHTML =
      '<input type="radio" name="trk" value="'+i+'" '+(i===trackIndex?'checked':'')+'>' +
      '<div><div class="t">'+escapeHTML(t.name)+'</div><div class="sub">'+(i+1)+' / '+tracks.length+'</div></div>';
    trackListEl.appendChild(lab);
  }
}

function renderLyricList(){
  lyricListEl.innerHTML = "";
  const keys = Array.from(lyricsMap.keys());
  if (!keys.length){
    lyricListEl.innerHTML = '<div class="itemRow"><div class="t" style="opacity:.75">LYRICSを選ぶ で .lrc/.txt を選択してください。</div></div>';
    return;
  }
  for (const k of keys){
    const info = lyricsMap.get(k);
    const lab = document.createElement("label");
    lab.className = "itemRow";
    lab.innerHTML =
      '<input type="radio" name="lyr" value="'+escapeHTML(k)+'">' +
      '<div><div class="t">'+escapeHTML(info.name)+'</div><div class="sub">'+escapeHTML(k)+'</div></div>';
    lyricListEl.appendChild(lab);
  }
}

function renderLyricsLines(){
  panelLyrics.innerHTML = "";
  if (!currentLines.length){
    panelLyrics.innerHTML = '<div class="lyLine"><div class="en" style="opacity:.75">歌詞がありません。LYRICSを選ぶ で .lrc/.txt を読み込むか、下のLYRICSから選択してください。</div></div>';
    setCur("","");
    return;
  }
  for (let i=0;i<currentLines.length;i++){
    const ln = currentLines[i];
    const div = document.createElement("div");
    div.className = "lyLine" + (i===currentLineIndex ? " current":"");
    div.dataset.i = String(i);
    div.innerHTML =
      '<div class="en">'+escapeHTML(ln.en)+'</div>' +
      '<div class="jp">'+(jpOn ? escapeHTML(ln.jp||"") : "")+'</div>';
    panelLyrics.appendChild(div);
  }
}

// ---------- selection ----------
function selectTrack(i){
  if (!(i>=0 && i<tracks.length)) return;
  trackIndex = i;
  const tr = tracks[i];
  chipTrack.textContent = "TRACK: " + tr.name;
  chipTrack.className = "pill on";

  autoPickLyricsForTrack(tr.name);

  audioEl.src = tr.url;
  try{ audioEl.preload = "auto"; }catch(e){}
  audioEl.load();

  renderTrackList();
  setStatus("TRACK READY: " + tr.name);
}

function autoPickLyricsForTrack(trackName){
  const tkey = normalizeKey(trackName);
  const linked = linkMap.get(tkey);
  if (linked && lyricsMap.has(linked)){
    loadLyricsKey(linked);
    return;
  }
  const bkey = normalizeKey(baseName(trackName));
  let bestKey = null;
  let bestScore = -1;

  lyricsMap.forEach((val,key)=>{
    const lk = normalizeKey(val.name);
    if (lk === bkey){ bestKey = key; bestScore = 999; return; }
    let score = 0;
    if (lk && bkey){
      if (lk.includes(bkey) || bkey.includes(lk)) score = Math.min(lk.length,bkey.length);
    }
    if (score > bestScore){
      bestScore = score;
      bestKey = key;
    }
  });

  if (bestKey){
    linkMap.set(tkey, bestKey);
    saveLinkMap();
    loadLyricsKey(bestKey);
  }else{
    currentLines = [];
    currentLineIndex = -1;
    renderLyricsLines();
    setStatus("LYRICS: NO MATCH（下のLYRICSから選んでください）");
  }
}

function loadLyricsKey(key){
  const info = lyricsMap.get(key);
  if (!info) return;

  currentLines = info.lines;
  currentLineIndex = -1;
  renderLyricsLines();

  if (currentLines.length && currentLines[0].t !== null){
    setStatus("LYRICS LOADED / SYNC: ON");
    startSync();
  }else{
    setStatus("LYRICS LOADED / SYNC: OFF");
  }

  // if plain text lyrics, show first line
  if (currentLines.length && currentLines[0].t === null){
    highlightLine(0);
    maybeTranslateLine(0);
  }
}

// ---------- highlight + sync ----------
function highlightLine(i){
  currentLineIndex = i;
  const nodes = panelLyrics.querySelectorAll(".lyLine");
  for (let k=0;k<nodes.length;k++){
    nodes[k].classList.toggle("current", k===i);
    const jp = nodes[k].querySelector(".jp");
    if (jp) jp.textContent = jpOn ? (currentLines[k].jp || "") : "";
  }
  const ln = currentLines[i];
  setCur(ln.en, jpOn ? (ln.jp||"") : "");
  const cur = panelLyrics.querySelector(".lyLine.current");
  if (AUTO_FOLLOW && cur && cur.scrollIntoView){
    /* auto-follow disabled */
  }
}

function findLineIndexByTime(t){
  let last = -1;
  for (let i=0;i<currentLines.length;i++){
    const lt = currentLines[i].t;
    if (lt === null) return -1;
    if (lt <= t) last = i;
    else break;
  }
  return last;
}

function syncTick(){
  try{
    if (!currentLines.length) return;
    if (currentLines[0].t === null) return;
    if (!audioEl || audioEl.paused) return;

    const t = audioEl.currentTime || 0;
    const idx = findLineIndexByTime(t);
    if (idx >= 0 && idx !== currentLineIndex){
      highlightLine(idx);
      maybeTranslateLine(idx);
    }
  }catch(e){}
}

function startSync(){
  if (syncTimer) return;
  syncTimer = setInterval(syncTick, 180);
}
function stopSync(){
  if (!syncTimer) return;
  clearInterval(syncTimer);
  syncTimer = null;
}

// ---------- translation (MyMemory) ----------
function maybeTranslateLine(i){
  if (!jpOn) return;
  if (!(i>=0 && i<currentLines.length)) return;
  const ln = currentLines[i];
  if (!ln.en) return;
  if (ln.jp) return;

  const q = ln.en.trim();
  if (!q) return;

  setStatus("TRANSLATING...");
  const url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(q) + "&langpair=en|ja";

  fetch(url)
    .then((r)=>{
      if (!r || !r.ok) throw new Error("HTTP " + String(r && r.status ? r.status : 0));
      return r.json();
    })
    .then((j)=>{
      let txt = "";
      try{
        if (j && j.responseData && typeof j.responseData.translatedText === "string") txt = j.responseData.translatedText;
      }catch(e){}
      txt = String(txt||"").trim();
      if (!txt) txt = "（翻訳が空でした）";
      ln.jp = txt;

      const el = panelLyrics.querySelector('.lyLine[data-i="'+i+'"] .jp');
      if (el && jpOn) el.textContent = ln.jp;
      setCur(ln.en, ln.jp);
      setStatus("OK");
    })
    .catch((err)=>{
      ln.jp = "（翻訳失敗：ネット/CORS/制限の可能性）";
      const el = panelLyrics.querySelector('.lyLine[data-i="'+i+'"] .jp');
      if (el && jpOn) el.textContent = ln.jp;
      setCur(ln.en, ln.jp);
      setStatus("TRANSLATE FAILED");
    });
}

// ---------- controls ----------
function toggleJP(){
  jpOn = !jpOn;
  btnJP.textContent = "JP: " + (jpOn ? "ON" : "OFF");
  btnJP.className = "pill " + (jpOn ? "on" : "off");
  renderLyricsLines();
  if (currentLineIndex>=0 && currentLines[currentLineIndex]) highlightLine(currentLineIndex);
}
function toggleList(){
  listOn = !listOn;
  panelLists.classList.toggle("hidden", !listOn);
}

// ---------- events ----------
inAudio.addEventListener("change", ()=>{
  try{
    clearTracks();
    let files = Array.from(inAudio.files || []);
    // accept audio/* and common extensions
    files = files.filter((f)=>{
      const n = (f.name||"").toLowerCase();
      const t = (f.type||"").toLowerCase();
      if (t && t.startsWith("audio/")) return true;
      return /\.(mp3|m4a|aac|wav|flac|ogg|mp4|m4p)$/i.test(n);
    });

    for (const f of files){
      const url = URL.createObjectURL(f);
      tracks.push({name:f.name, url, file:f});
    }

    setStatus("AUDIO LOADED: " + tracks.length);
    renderTrackList();
    if (tracks.length) selectTrack(0);
  }catch(e){
    setStatus("AUDIO ERROR");
  }finally{
    inAudio.value = "";
  }
});

inLyrics.addEventListener("change", ()=>{
  const files = Array.from(inLyrics.files || []);
  if (!files.length){ inLyrics.value=""; return; }

  let left = files.length;
  setStatus("LYRICS LOADING...");
  files.forEach((f)=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const text = String(reader.result||"");
        const key = normalizeKey(f.name);
        const lines = parseLRC(text);
        lyricsMap.set(key, {name:f.name, text, lines});
      }catch(e){}
      left--;
      if (left<=0){
        setStatus("LYRICS READY: " + lyricsMap.size);
        renderLyricList();
        if (trackIndex>=0 && tracks[trackIndex]) autoPickLyricsForTrack(tracks[trackIndex].name);
      }
    };
    reader.onerror = ()=>{
      left--;
      if (left<=0){
        setStatus("LYRICS READY: " + lyricsMap.size);
        renderLyricList();
      }
    };
    reader.readAsText(f);
  });

  inLyrics.value = "";
});

trackListEl.addEventListener("change", (e)=>{
  const t = e.target;
  if (!t || t.name!=="trk") return;
  const i = parseInt(t.value,10);
  if (!isFinite(i)) return;
  selectTrack(i);
});

lyricListEl.addEventListener("change", (e)=>{
  const t = e.target;
  if (!t || t.name!=="lyr") return;
  const key = String(t.value||"");
  if (!lyricsMap.has(key)) return;

  if (trackIndex>=0 && tracks[trackIndex]){
    linkMap.set(normalizeKey(tracks[trackIndex].name), key);
    saveLinkMap();
  }
  loadLyricsKey(key);
});

panelLyrics.addEventListener("click", (e)=>{
  const el = e.target;
  const row = el && el.closest ? el.closest(".lyLine") : null;
  if (!row) return;
  const i = parseInt(row.dataset.i,10);
  if (!isFinite(i)) return;
  highlightLine(i);
  maybeTranslateLine(i);
});

btnPlay.addEventListener("click", ()=>{
  if (trackIndex<0 && tracks.length) selectTrack(0);
  if (!audioEl.src){
    setStatus("NO TRACK");
    return;
  }
  try{ audioEl.muted=false; audioEl.volume=1; }catch(e){}
  audioEl.play()
    .then(()=>{
      setStatus("PLAYING");
      startSync();
    })
    .catch((err)=>{
      const n = (err && err.name) ? err.name : String(err||"");
      if (n === "NotAllowedError") setStatus("PLAY BLOCKED（もう一度PLAY / audio▶︎を直接押す）");
      else if (n === "NotSupportedError") setStatus("PLAY FAILED（形式非対応の可能性。mp3推奨）");
      else setStatus("PLAY FAILED: " + n);
    });
});

btnPrev.addEventListener("click", ()=>{
  if (!tracks.length) return;
  const i = (trackIndex<=0) ? (tracks.length-1) : (trackIndex-1);
  selectTrack(i);
});

btnNext.addEventListener("click", ()=>{
  if (!tracks.length) return;
  const i = (trackIndex>=tracks.length-1) ? 0 : (trackIndex+1);
  selectTrack(i);
});

btnList.addEventListener("click", toggleList);
btnJP.addEventListener("click", toggleJP);

audioEl.addEventListener("play", startSync);
audioEl.addEventListener("pause", stopSync);
audioEl.addEventListener("ended", stopSync);

// ---------- init ----------
setStatus("READY");
setCur("","");
renderTrackList();
renderLyricList();
