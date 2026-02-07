// LyricsPocket PWA (Minimal)
// - Audio files: import via FILES (multiple). FOLDER uses showDirectoryPicker when supported.
// - Lyrics files: import via LYRICS (txt/lrc). Auto-link by normalized base name.
// - LRC sync: highlight current line by audio.currentTime.
// - Translation: default OFF (copies to clipboard). Optional online JP via MyMemory.

const $ = (id) => document.getElementById(id);

const statusText = $("statusText");
const lyricsEmpty = $("lyricsEmpty");
const lyricsList = $("lyricsList");
const srcLine = $("srcLine");
const jpLine = $("jpLine");

const btnFolder = $("btnFolder");
const btnFiles = $("btnFiles");
const btnPlay = $("btnPlay");
const btnPrev = $("btnPrev");
const btnNext = $("btnNext");
const btnLyrics = $("btnLyrics");
const btnList = $("btnList");

const inputAudio = $("inputAudio");
const inputLyrics = $("inputLyrics");

const dlgList = $("dlgList");
const btnCloseList = $("btnCloseList");
const trackList = $("trackList");

const btnKeepAwake = $("btnKeepAwake");
const btnOnlineTranslate = $("btnOnlineTranslate");

let wakeLock = null;
let onlineTranslate = true; // default ON (show JP in-app)
let translationCache = new Map(); // key: text -> jp
let tracks = []; // {id, file, name, title, normBase}
let lyricsFiles = []; // {file, name, normBase, kind}
let trackLyrics = new Map(); // trackId -> {kind, lines[]}
let currentIndex = -1;

const audio = new Audio();
audio.preload = "metadata";
audio.playsInline = true;

// ---------- Utils ----------
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function cacheKey(text){ return "lpjp:" + text; }

function cacheGet(text){
  if (translationCache.has(text)) return translationCache.get(text);
  try{
    const v = localStorage.getItem(cacheKey(text));
    if (v) { translationCache.set(text, v); return v; }
  }catch(_){}
  return null;
}
function cacheSet(text, jp){
  translationCache.set(text, jp);
  try{ localStorage.setItem(cacheKey(text), jp); }catch(_){}
}

// JP translate queue (avoid rate limits)
const JP_QUEUE = [];
let jpQueueRunning = false;
let jpQueueToken = 0;

function queueJP(text, lineId, priority=false){
  const t = (text || "").trim();
  if (!t) return;
  const cached = cacheGet(t);
  if (cached) {
    setJPUnder(lineId, cached);
    return;
  }
  // avoid duplicates
  if (JP_QUEUE.some(it => it.t === t && it.lineId === lineId)) return;
  if (priority) JP_QUEUE.unshift({t, lineId});
  else JP_QUEUE.push({t, lineId});
  runJPQueue();
}

async function runJPQueue(){
  if (jpQueueRunning) return;
  jpQueueRunning = true;
  const token = ++jpQueueToken;

  while (JP_QUEUE.length) {
    if (token !== jpQueueToken) break;
    const {t, lineId} = JP_QUEUE.shift();
    // Skip if already filled meanwhile
    const node = lyricsList.querySelector(`.lineItem[data-id="${lineId}"] .jpUnder`);
    if (node && node.textContent && node.textContent.trim().length) continue;

    const jp = await translateLineToJP(t);
    if (token !== jpQueueToken) break;
    if (jp) {
      cacheSet(t, jp);
      setJPUnder(lineId, jp);
      // If current, also update bottom panel
      if (Number(lineId) === currentLineId) {
        jpLine.textContent = jp;
      }
      await sleep(220); // mild throttle
    } else {
      // On failure, leave empty but do not spam
      await sleep(380);
    }
  }
  jpQueueRunning = false;
}

function normalizeBase(name) {
  let x = name.toLowerCase();
  // strip extension if exists
  x = x.replace(/\.[a-z0-9]+$/i, "");
  // strip leading track numbers like "01 - "
  x = x.replace(/^\s*\d{1,3}\s*[-_.]*\s*/g, "");
  // remove (...) and [...]
  x = x.replace(/\(.*?\)/g, " ").replace(/\[.*?\]/g, " ");
  // remove non-alnum -> spaces
  x = x.replace(/[^a-z0-9\s]+/g, " ");
  // collapse spaces
  x = x.trim().replace(/\s+/g, " ");
  return x;
}

function ext(name) {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function setStatus(text) {
  statusText.textContent = text;
}

function showList(open) {
  if (open) dlgList.showModal();
  else dlgList.close();
}

function updatePlayButton() {
  btnPlay.textContent = audio.paused ? "PLAY" : "PAUSE";
}

// ---------- Lyrics parsing ----------
function parseTXT(text) {
  const lines = text.split(/\r?\n/).map(s => s.trimEnd());
  return { kind: "txt", lines: lines.map((t, i) => ({ id: i, t: null, text: t })) };
}

// LRC: supports [mm:ss] or [mm:ss.xx], multiple tags per line
function parseLRC(text) {
  const re = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,2}))?\]/g;
  const out = [];
  const rows = text.split(/\r?\n/);
  for (const row of rows) {
    if (!row.trim()) continue;
    if (/^\[(ti|ar|al|by|offset):/i.test(row)) continue;

    let m;
    const times = [];
    while ((m = re.exec(row)) !== null) {
      const mm = Number(m[1] || 0);
      const ss = Number(m[2] || 0);
      const xx = Number(m[3] || 0);
      const t = mm * 60 + ss + (xx / 100);
      times.push(t);
    }
    if (!times.length) continue;

    const lyric = row.replace(re, "").trim();
    for (const t of times) out.push({ t, text: lyric });
  }
  out.sort((a, b) => a.t - b.t);
  return { kind: "lrc", lines: out.map((o, i) => ({ id: i, t: o.t, text: o.text })) };
}

async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  // try UTF-8 first
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (_) {}
  // try Shift_JIS (supported in modern browsers; if not, it will throw)
  try {
    return new TextDecoder("shift_jis").decode(buf);
  } catch (_) {}
  // fallback
  return new TextDecoder().decode(buf);
}

// ---------- Auto link lyrics ----------
function findBestLyricsFileForTrack(track){
  if (!track) return null;
  // strict match first
  const strict = lyricsFiles.find(l => l.normBase && l.normBase === track.normBase) || null;
  if (strict) return strict;
  // fuzzy includes
  const cand = lyricsFiles.filter(l => l.normBase && track.normBase && (l.normBase.includes(track.normBase) || track.normBase.includes(l.normBase)));
  if (!cand.length) return null;
  cand.sort((a,b)=> (a.kind==="lrc"?-1:1) - (b.kind==="lrc"?-1:1));
  return cand[0] || null;
}

async function ensureLyricsForTrack(track){
  if (!track) return null;
  // already parsed & linked?
  const existing = trackLyrics.get(track.id);
  if (existing) return existing;

  const best = findBestLyricsFileForTrack(track);
  if (!best || !best.file) return null;

  try{
    const text = await readTextFile(best.file);
    const doc = (best.kind === "lrc") ? parseLRC(text) : parseTXT(text);
    trackLyrics.set(track.id, doc);
    return doc;
  }catch(_){
    return null;
  }
}


async function loadLyricsFile(file) {
  const name = file.name;
  const kind = ext(name) === "lrc" ? "lrc" : "txt";
  const normBase = normalizeBase(name);
  const text = await readTextFile(file);
  const doc = (kind === "lrc") ? parseLRC(text) : parseTXT(text);
  lyricsFiles.push({ file, name, normBase, kind });
  // store doc in memory (map by name)
  return { file, doc };
}

function tryAutoLink(track) {
  // pick best lyric file with same base: lrc > txt
  const same = lyricsFiles.filter(l => l.normBase === track.normBase);
  if (!same.length) return null;
  const best = same.sort((a, b) => (a.kind === "lrc" ? -1 : 1) - (b.kind === "lrc" ? -1 : 1))[0];
  return best;
}

// ---------- Rendering ----------
function renderLyrics(doc) {
  lyricsList.innerHTML = "";
  currentLineId = -1;
  jpQueueToken++; // cancel queue from previous song
  JP_QUEUE.length = 0;

  if (!doc || !doc.lines?.length) {
    lyricsEmpty.style.display = "flex";
    lyricsList.style.display = "none";
    return;
  }
  lyricsEmpty.style.display = "none";
  lyricsList.style.display = "flex";

  for (const line of doc.lines) {
    const item = document.createElement("div");
    item.className = "lineItem";
    item.dataset.id = String(line.id);

    const en = document.createElement("div");
    en.className = "line en";
    en.textContent = line.text || " ";
    en.addEventListener("click", () => onTapLine(line.text || "", line.id));

    const jp = document.createElement("div");
    jp.className = "jpUnder mono";
    jp.textContent = "";

    item.appendChild(en);
    item.appendChild(jp);
    lyricsList.appendChild(item);
  }

  // Prefetch: first 8 lines (lightweight) so it "feels automatic"
  if (onlineTranslate) {
    const pre = doc.lines.slice(0, 8);
    for (const l of pre) queueJP(l.text || "", l.id, false);
  }
}

function highlightCurrent(doc, timeSec) {
  if (!doc || doc.kind !== "lrc") return;
  let bestId = 0;
  for (const line of doc.lines) {
    if (line.t == null) continue;
    if (line.t <= timeSec) bestId = line.id;
    else break;
  }

  // update current marker & scroll
  const children = lyricsList.children;
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    const isCurrent = Number(el.dataset.id) === bestId;
    el.classList.toggle("current", isCurrent);
    if (isCurrent) {
      const rect = el.getBoundingClientRect();
      const containerRect = lyricsList.getBoundingClientRect();
      const topThreshold = containerRect.top + containerRect.height * 0.25;
      const bottomThreshold = containerRect.top + containerRect.height * 0.75;
      if (rect.top < topThreshold || rect.bottom > bottomThreshold) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      const enEl = el.querySelector(".line.en");
      const jpEl = el.querySelector(".jpUnder");
      if (enEl && jpEl) {
        srcLine.textContent = enEl.textContent || "";
        jpLine.textContent = jpEl.textContent || (onlineTranslate ? "TRANSLATING..." : "TAP A LINE TO TRANSLATE");
      }
    }
  }

  // Auto-translate around current line (priority)
  if (onlineTranslate && bestId !== currentLineId) {
    currentLineId = bestId;
    const cur = doc.lines.find(l => l.id === bestId);
    if (cur) queueJP(cur.text || "", cur.id, true);

    // also queue next 4 lines to make it feel continuous
    const idx = doc.lines.findIndex(l => l.id === bestId);
    if (idx >= 0) {
      for (let k = 1; k <= 4; k++) {
        const l = doc.lines[idx + k];
        if (l) queueJP(l.text || "", l.id, false);
      }
    }
  }
}

function renderTrackList() {
  trackList.innerHTML = "";
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const row = document.createElement("div");
    row.className = "track";

    const meta = document.createElement("div");
    meta.className = "track__meta";

    const title = document.createElement("div");
    title.className = "track__title";
    title.textContent = t.title;

    const sub = document.createElement("div");
    sub.className = "track__sub";
    sub.textContent = t.name;

    meta.appendChild(title);
    meta.appendChild(sub);

    const right = document.createElement("div");
    right.className = "track__right";

    const play = document.createElement("button");
    play.className = "smallbtn mono";
    play.textContent = "PLAY";
    play.addEventListener("click", () => {
      selectTrack(i);
      audio.play();
      updatePlayButton();
btnOnlineTranslate.textContent = `ONLINE JP: ${onlineTranslate ? "ON" : "OFF"}`;

      showList(false);
    });

    const link = document.createElement("button");
    link.className = "smallbtn mono";
    link.textContent = "LINK";
    link.addEventListener("click", async () => {
      // open lyrics picker and link to this track manually
      inputLyrics.onchange = async () => {
        const files = Array.from(inputLyrics.files || []);
        if (!files.length) return;
        // load selected lyrics
        for (const f of files) await importLyricsFiles([f]);
        // link the first selected to this track
        const f = files[0];
        const l = lyricsFiles.find(x => x.name === f.name);
        if (l) {
          const text = await readTextFile(l.file);
          const doc = (l.kind === "lrc") ? parseLRC(text) : parseTXT(text);
          trackLyrics.set(t.id, doc);
          if (currentIndex === i) renderLyrics(doc);
          setStatus(`${tracks.length} FILES LOADED | LYRICS LINKED`);
        }
        inputLyrics.value = "";
        inputLyrics.onchange = null;
      };
      inputLyrics.click();
    });

    right.appendChild(play);
    right.appendChild(link);

    row.appendChild(meta);
    row.appendChild(right);
    trackList.appendChild(row);
  }
}

// ---------- Per-line JP (Smart) ----------
let currentLineId = -1;

function setJPUnder(lineId, jpText){
  const item = lyricsList.querySelector(`.lineItem[data-id="${lineId}"]`);
  if (!item) return;
  const jp = item.querySelector(".jpUnder");
  if (jp) jp.textContent = jpText || "";
}

async function translateLineToJP(trimmed){
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  try{
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", trimmed);
    url.searchParams.set("langpair", "en|ja");

    const res = await fetch(url.toString(), { method: "GET", signal: ctrl.signal, cache: "no-store" });
    const data = await res.json();
    const jp = data?.responseData?.translatedText;

    if (!jp || jp.trim().length === 0) return "";
    // If MyMemory rate-limits, it may echo input. In that case, show nothing but allow OPEN via bottom panel.
    if (jp.trim().toLowerCase() === trimmed.toLowerCase()) return "";
    if (/MYMEMORY WARNING/i.test(jp)) return "";
    return jp;
  }catch(_){
    return "";
  }finally{
    clearTimeout(timeout);
  }
}

// ---------- Translation ----------
async function translateToJP(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return;

  srcLine.textContent = trimmed;

  if (!onlineTranslate) {
    // offline mode: copy and tell user to use system translate
    try {
      await navigator.clipboard.writeText(trimmed);
      jpLine.textContent = "COPIED. USE SYSTEM TRANSLATE.";
    } catch (_) {
      jpLine.textContent = "COPY FAILED. SELECT & COPY.";
    }
    return;
  }

  const cached0 = cacheGet(trimmed);
  if (cached0) {
    jpLine.textContent = cached0;
    return;
  }

  jpLine.textContent = "TRANSLATING...";
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);

  try {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", trimmed);
    url.searchParams.set("langpair", "en|ja");

    const res = await fetch(url.toString(), { method: "GET", signal: ctrl.signal, cache: "no-store" });
    const data = await res.json();

    const jp = data?.responseData?.translatedText;

    // MyMemory sometimes returns warnings or echoes input when rate-limited.
    if (!jp || jp.trim().length === 0) throw new Error("NO_TEXT");
    if (jp.trim().toLowerCase() === trimmed.toLowerCase()) throw new Error("ECHO");
    if (/MYMEMORY WARNING/i.test(jp)) throw new Error("WARNING");

    cacheSet(trimmed, jp);
    jpLine.textContent = jp;
  } catch (e) {
    // Fallback: show action buttons (open translate / copy)
    const q = encodeURIComponent(trimmed);
    jpLine.innerHTML = `
      <span class="mono faint">TRANSLATION FAILED.</span>
      <button id="btnOpenTranslate" class="chip" style="margin-left:8px;">OPEN</button>
      <button id="btnCopyLine" class="chip" style="margin-left:6px;">COPY</button>
    `;
    const btnOpen = document.getElementById("btnOpenTranslate");
    const btnCopy = document.getElementById("btnCopyLine");

    if (btnOpen) {
      btnOpen.addEventListener("click", () => {
        window.open(`https://translate.google.com/?sl=en&tl=ja&text=${q}&op=translate`, "_blank", "noopener");
      }, { once: true });
    }
    if (btnCopy) {
      btnCopy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(trimmed);
          btnCopy.textContent = "COPIED";
        } catch (_) {
          btnCopy.textContent = "FAIL";
        }
      }, { once: true });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function onTapLine(text) {
  translateToJP(text);
}

// ---------- Import audio ----------
function importAudioFiles(files) {
  const audioFiles = files.filter(f => f.type.startsWith("audio/") || ["mp3","m4a","aac","wav","flac","ogg"].includes(ext(f.name)));
  if (!audioFiles.length) return;

  for (const f of audioFiles) {
    const name = f.name;
    tracks.push({
      id: crypto.randomUUID(),
      file: f,
      name,
      title: name.replace(/\.[a-z0-9]+$/i, ""),
      normBase: normalizeBase(name),
      url: URL.createObjectURL(f)
    });
  }

  // sort by title
  tracks.sort((a, b) => a.title.localeCompare(b.title));
  setStatus(`${tracks.length} FILES LOADED`);
  renderTrackList();

  if (currentIndex === -1 && tracks.length) {
    selectTrack(0);
  }
}

async function importLyricsFiles /* AUTO_LINK_AFTER_LYRICS2 */(files) {
  const lyricFiles = files.filter(f => ["txt","lrc"].includes(ext(f.name)) || f.type === "text/plain");
  for (const f of lyricFiles) {
    await loadLyricsFile(f);
  }

  // try auto-link for all tracks
  for (const t of tracks) {
    if (trackLyrics.has(t.id)) continue;
    const best = tryAutoLink(t);
    if (best) {
      const text = await readTextFile(best.file);
      const doc = best.kind === "lrc" ? parseLRC(text) : parseTXT(text);
      trackLyrics.set(t.id, doc);
    }
  }

  // refresh current lyrics view
  if (currentIndex >= 0) {
    const t = tracks[currentIndex];
    const doc = trackLyrics.get(t.id);
    if (doc) renderLyrics(doc);
  }

  // AUTO_LINK_AFTER_LYRICS2: prime mapping so track selection is instant
  for (const t of tracks) {
    if (trackLyrics.has(t.id)) continue;
    const best = findBestLyricsFileForTrack(t);
    if (best && best.file) {
      try{
        const text = await readTextFile(best.file);
        const doc = (best.kind === "lrc") ? parseLRC(text) : parseTXT(text);
        trackLyrics.set(t.id, doc);
      }catch(_){}
    }
  }

setStatus(`${tracks.length} FILES LOADED | LYRICS UPDATED`);
}

// ---------- Folder import (progressive enhancement) ----------
async function importFromFolder() {
  // showDirectoryPicker is part of File System Access API; not supported on iOS Safari/PWA
  if (!("showDirectoryPicker" in window)) {
    alert("このブラウザはフォルダ選択に未対応です。FILESで複数ファイルを選択してください。");
    return;
  }
  try {
    const dir = await window.showDirectoryPicker();
    const audioCollected = [];
    const lyricCollected = [];

    for await (const entry of dir.values()) {
      if (entry.kind !== "file") continue;
      const file = await entry.getFile();
      const e = ext(file.name);
      if (["mp3","m4a","aac","wav","flac","ogg"].includes(e) || file.type.startsWith("audio/")) audioCollected.push(file);
      if (["txt","lrc"].includes(e) || file.type === "text/plain") lyricCollected.push(file);
    }

    importAudioFiles(audioCollected);
    await importLyricsFiles(lyricCollected);
  } catch (e) {
    // user cancelled
  }
}

// ---------- Playback ----------
function selectTrack(index) {
  if (index < 0 || index >= tracks.length) return;
  currentIndex = index;
  const t = tracks[index];
  audio.src = t.url;
  audio.currentTime = 0;
  updatePlayButton();
  setStatus(`${tracks.length} FILES LOADED | ${currentIndex+1}/${tracks.length} | ${t.title}`);

  let doc = trackLyrics.get(t.id);
  renderLyrics(doc || null);

  // Auto-select lyrics when a track is selected (based on already-imported lyrics files)
  if (!doc) {
    ensureLyricsForTrack(t).then(d => {
      if (!d) return;
      // still on the same track?
      if (currentIndex === index) {
        renderLyrics(d);
        setStatus(`${tracks.length} FILES LOADED | ${currentIndex+1}/${tracks.length} | LYRICS AUTO`);
      }
    });
  }
  srcLine.textContent = "";
  jpLine.textContent = "TAP A LINE TO TRANSLATE";
  // refresh track list UI selection
  try{ renderTrackList(); }catch(_){ }

}

btnPlay.addEventListener("click", async () => {
  if (!tracks.length) return;
  if (currentIndex === -1) selectTrack(0);
  if (audio.paused) await audio.play();
  else audio.pause();
  updatePlayButton();
});

btnPrev.addEventListener("click", () => {
  if (!tracks.length) return;
  if (tracks.length < 2) { setStatus("ONLY 1 TRACK LOADED"); audio.currentTime = 0; audio.play().catch(()=>{}); return; }
  let pi;
  if (currentIndex < 0) pi = 0;
  else if (currentIndex <= 0) pi = tracks.length - 1; // wrap
  else pi = currentIndex - 1;

  selectTrack(pi);
  audio.play().catch(()=>{});
  updatePlayButton();
});

btnNext.addEventListener("click", () => {
  if (!tracks.length) return;
  if (tracks.length < 2) { setStatus("ONLY 1 TRACK LOADED"); audio.currentTime = 0; audio.play().catch(()=>{}); return; }
  let ni;
  if (currentIndex < 0) ni = 0;
  else if (currentIndex >= tracks.length - 1) ni = 0; // wrap
  else ni = currentIndex + 1;

  selectTrack(ni);
  audio.play().catch(()=>{});
  updatePlayButton();
});

btnFiles.addEventListener("click", () => inputAudio.click());
btnLyrics.addEventListener("click", () => inputLyrics.click());
btnFolder.addEventListener("click", () => importFromFolder());

btnList.addEventListener("click", () => {
  if (!tracks.length) return;
  renderTrackList();
  showList(true);
});
btnCloseList.addEventListener("click", () => showList(false));

inputAudio.addEventListener("change", async () => {
  const files = Array.from(inputAudio.files || []);
  importAudioFiles(files);
  inputAudio.value = "";
});

inputLyrics.addEventListener("change", async () => {
  const files = Array.from(inputLyrics.files || []);
  await importLyricsFiles(files);
  inputLyrics.value = "";
});

// LRC sync
audio.addEventListener("timeupdate", () => {
  if (currentIndex < 0) return;
  const t = tracks[currentIndex];
  const doc = trackLyrics.get(t.id);
  highlightCurrent(doc, audio.currentTime);
});

audio.addEventListener("play", updatePlayButton);
audio.addEventListener("pause", updatePlayButton);
audio.addEventListener("ended", () => {
  // auto-next
  if (currentIndex >= 0 && currentIndex < tracks.length - 1) {
    selectTrack(currentIndex + 1);
    audio.play().catch(()=>{});
  } else {
    updatePlayButton();
  }
});

// ---------- Keep Awake ----------
async function enableWakeLock(on) {
  if (!("wakeLock" in navigator)) {
    alert("Wake Lock未対応です（iOS 16.4+ 等で対応）。");
    return;
  }
  try {
    if (on) {
      wakeLock = await navigator.wakeLock.request("screen");
      btnKeepAwake.textContent = "KEEP AWAKE: ON";
      setStatus(`${tracks.length} FILES LOADED | WAKE LOCK ON`);
      wakeLock.addEventListener("release", () => {
        btnKeepAwake.textContent = "KEEP AWAKE: OFF";
      });
    } else {
      if (wakeLock) await wakeLock.release();
      wakeLock = null;
      btnKeepAwake.textContent = "KEEP AWAKE: OFF";
    }
  } catch (e) {
    alert("Wake Lockの取得に失敗しました。");
  }
}
btnKeepAwake.addEventListener("click", async () => {
  await enableWakeLock(!wakeLock);
});

// ---------- Online Translate toggle ----------
btnOnlineTranslate.addEventListener("click", () => {
  onlineTranslate = !onlineTranslate;
  btnOnlineTranslate.textContent = `ONLINE JP: ${onlineTranslate ? "ON" : "OFF"}`;
  if (!onlineTranslate) {
    jpLine.textContent = "TAP A LINE TO TRANSLATE";
  }
});



// ---------- Service Worker (safe) ----------
(function(){
  try{
    const params = new URLSearchParams(location.search);
    if (params.get("nosw") === "1") return;
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", async () => {
      try{
        const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
        try{ await reg.update(); }catch(_){}
      }catch(e){
        // do nothing; app still works without SW
      }
    });
  }catch(_){}
})();
