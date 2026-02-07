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
let onlineTranslate = false; // default OFF
let translationCache = new Map(); // key: text -> jp
let tracks = []; // {id, file, name, title, normBase}
let lyricsFiles = []; // {file, name, normBase, kind}
let trackLyrics = new Map(); // trackId -> {kind, lines[]}
let currentIndex = -1;

const audio = new Audio();
audio.preload = "metadata";
audio.playsInline = true;

// ---------- Utils ----------
function normalizeBase(name) {
  let x = name.toLowerCase();
  // strip extension if exists
  x = x.replace(/\.[a-z0-9]+$/i, "");
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
  if (!doc || !doc.lines?.length) {
    lyricsEmpty.style.display = "flex";
    lyricsList.style.display = "none";
    return;
  }
  lyricsEmpty.style.display = "none";
  lyricsList.style.display = "flex";

  for (const line of doc.lines) {
    const div = document.createElement("div");
    div.className = "line";
    div.dataset.id = String(line.id);
    div.textContent = line.text || " ";
    div.addEventListener("click", () => onTapLine(line.text || ""));
    lyricsList.appendChild(div);
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
  const children = lyricsList.children;
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    if (!el.classList) continue;
    const isCurrent = Number(el.dataset.id) === bestId;
    el.classList.toggle("current", isCurrent);
    if (isCurrent) {
      // gentle autoscroll: keep near center
      const rect = el.getBoundingClientRect();
      const containerRect = lyricsList.getBoundingClientRect();
      const topThreshold = containerRect.top + containerRect.height * 0.25;
      const bottomThreshold = containerRect.top + containerRect.height * 0.75;
      if (rect.top < topThreshold || rect.bottom > bottomThreshold) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
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

// ---------- Translation ----------
async function translateToJP(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return;

  srcLine.textContent = trimmed;

  if (!onlineTranslate) {
    // offline mode: copy and tell user to use system translate
    try {
      await navigator.clipboard.writeText(trimmed);
      jpLine.textContent = "COPIED. USE iOS/ANDROID TRANSLATE.";
    } catch (_) {
      jpLine.textContent = "COPY FAILED. SELECT & COPY MANUALLY.";
    }
    return;
  }

  if (translationCache.has(trimmed)) {
    jpLine.textContent = translationCache.get(trimmed);
    return;
  }

  jpLine.textContent = "TRANSLATING...";
  try {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", trimmed);
    url.searchParams.set("langpair", "en|ja");
    const res = await fetch(url.toString(), { method: "GET" });
    const data = await res.json();
    const jp = data?.responseData?.translatedText || "TRANSLATION FAILED";
    translationCache.set(trimmed, jp);
    jpLine.textContent = jp;
  } catch (e) {
    jpLine.textContent = "TRANSLATION FAILED";
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

async function importLyricsFiles(files) {
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
  setStatus(`${tracks.length} FILES LOADED | ${t.title}`);

  const doc = trackLyrics.get(t.id);
  renderLyrics(doc || null);
  srcLine.textContent = "";
  jpLine.textContent = "TAP A LINE TO TRANSLATE";
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
  const ni = Math.max(0, currentIndex - 1);
  selectTrack(ni);
  audio.play().catch(()=>{});
  updatePlayButton();
});

btnNext.addEventListener("click", () => {
  if (!tracks.length) return;
  const ni = Math.min(tracks.length - 1, currentIndex + 1);
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

// ---------- Service Worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// Initial
updatePlayButton();
