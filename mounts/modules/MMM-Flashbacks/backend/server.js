// server.js
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");

const app = express();

const ROOT_DIR = process.env.MEDIA_ROOT || process.env.ROOT_DIR || "/media";
const CACHE_DIR = process.env.CACHE_DIR
  || (process.env.CACHE_FILE ? path.dirname(process.env.CACHE_FILE) : "")
  || path.join(process.cwd(), "state", "flashbacks-cache");
const ROOT_EXISTS = fs.existsSync(ROOT_DIR);

const STREAM_COUNT = Number(process.env.STREAM_COUNT || 6);
const WINDOW_SIZE = STREAM_COUNT;
const ALBUM_EXPOSE_SEC = Number(process.env.ALBUM_EXPOSE_SEC || 0);
const SET_WINDOW_MS = ALBUM_EXPOSE_SEC > 0
  ? ALBUM_EXPOSE_SEC * 1000
  : Number(process.env.SET_WINDOW_MS || 2 * 60 * 1000);
const COLLAGE_GRID_ROWS = Number(process.env.COLLAGE_GRID_ROWS || 3);
const COLLAGE_GRID_COLS = Number(process.env.COLLAGE_GRID_COLS || 3);
const COLLAGE_COUNT = Number(process.env.COLLAGE_COUNT || (COLLAGE_GRID_ROWS * COLLAGE_GRID_COLS));
const COLLAGE_GAP = Number(process.env.COLLAGE_GAP || 2);
const OUTPUT_WIDTH = Number(process.env.OUTPUT_WIDTH || 1920);
const OUTPUT_HEIGHT = Number(process.env.OUTPUT_HEIGHT || 1080);
const COLLAGE_QUALITY = Number(process.env.COLLAGE_QUALITY || 82);
const AUTO_ROTATE = String(process.env.AUTO_ROTATE || "1") === "1";
const RESIZE_WIDTH = OUTPUT_WIDTH;
const RESIZE_HEIGHT = OUTPUT_HEIGHT;
const RESIZE_QUALITY = 82;
const ROOT_CACHE_TTL_MS = Number(process.env.ROOT_CACHE_TTL_MS || 30 * 24 * 60 * 60 * 1000);
const YEAR_CACHE_TTL_MS = Number(process.env.YEAR_CACHE_TTL_MS || 180 * 24 * 60 * 60 * 1000);
const EVENT_CACHE_TTL_MS = Number(process.env.EVENT_CACHE_TTL_MS || 180 * 24 * 60 * 60 * 1000);

// Atmetam tik #Recycle (ir papildomai tipines šiukšles)
const EXCLUDED_TOPLEVEL = new Set(["#Recycle"]);
const EXCLUDED_DIR_NAMES = new Set([".picasaoriginals", "@eaDir", "#recycle"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png"]);

const DEBUG = true;

let sharp = null;
try {
  sharp = require("sharp");
} catch (e) {
  console.error("[flashbacks] ERROR: sharp not available", { err: String(e) });
  process.exit(1);
}

// --- in-memory stream state ---
/**
 * activeSet = {
 *   picked: { year, event, startIndex, pickedAt },
 *   window: [absFile..],
 *   windowRel: [relFromYear..],
 *   files: [absFile..],
 *   startIndex,
 *   generatedAt,
 *   expiresAt,
 *   debug,
 *   collageEnd,
 *   collageOverview,
 *   refreshJitterMs
 * }
 */
let activeSet = null;
const excludedEvents = new Set(); // "year/event"
const EXCLUDE_FILE = path.join(CACHE_DIR, "exclude.json");

function eventKey(year, eventName) {
  return `${year}/${eventName}`;
}

function loadExcludeFile() {
  try {
    if (!fs.existsSync(EXCLUDE_FILE)) return;
    const raw = fs.readFileSync(EXCLUDE_FILE, "utf8");
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      arr.forEach((k) => excludedEvents.add(String(k)));
    }
  } catch (e) {
    console.warn("[flashbacks] WARN: failed to load exclude.json", { err: String(e) });
  }
}

function persistExcludeFile() {
  return writeCacheFile(EXCLUDE_FILE, Array.from(excludedEvents));
}

loadExcludeFile();

// --- tiny helpers ---
function nowIso() { return new Date().toISOString(); }
function rid() { return crypto.randomBytes(3).toString("hex"); }
function isHidden(name) { return name.startsWith("."); }

function relFromRoot(absPath) {
  // turi prasidėti nuo "metų folderio", pvz. 2024/2024_05_22/img.jpg
  return path.relative(ROOT_DIR, absPath).replaceAll("\\", "/");
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "X-Flashbacks-Refresh-In-Ms,X-Flashbacks-Refresh-At");
}

function log(reqId, msg, obj) {
  if (!DEBUG) return;
  const base = `[${nowIso()}] [flashbacks] [rid=${reqId}] ${msg}`;
  if (obj) console.log(base, obj);
  else console.log(base);
}

// --- cache layer (per-folder json, mirrors /media) ---
function cachePathForDir(absDir, kind) {
  const rel = relFromRoot(absDir); // "" for root
  const fileName = kind === "files" ? "_files.json" : "_dirs.json";
  return path.join(CACHE_DIR, rel, fileName);
}

async function readCacheFile(cachePath) {
  try {
    const raw = await fsp.readFile(cachePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCacheFile(cachePath, payload) {
  const tmp = `${cachePath}.tmp`;
  try {
    await fsp.mkdir(path.dirname(cachePath), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    await fsp.rename(tmp, cachePath);
  } catch (e) {
    log("cache", "writeCacheFile failed, continuing without cache", { err: String(e), cachePath });
  }
}

async function listDirs(absDir) {
  try {
    const entries = await fsp.readdir(absDir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .filter(name => !isHidden(name))
      .filter(name => !EXCLUDED_DIR_NAMES.has(name.toLowerCase()));
  } catch (e) {
    log("scan", "listDirs failed", { dir: absDir, err: String(e) });
    return [];
  }
}

async function scanAlbumFiles(absAlbumDir, maxDepth = 10) {
  // greitas rekursinis scan’as; maxDepth saugumo dėlei
  const out = [];

  async function walk(cur, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const name = e.name;
      if (isHidden(name)) continue;
      if (e.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(name.toLowerCase())) continue;
        await walk(path.join(cur, name), depth + 1);
      } else if (e.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (IMAGE_EXT.has(ext)) out.push(path.join(cur, name));
      }
    }
  }

  await walk(absAlbumDir, 0);
  out.sort(); // timeline = stabilus (alfabetinis)
  return out;
}

async function getRootDirsCached(reqId) {
  const st = Date.now();
  const cachePath = cachePathForDir(ROOT_DIR, "dirs");
  const cached = await readCacheFile(cachePath);
  if (cached && cached.expiresAt && Date.now() < cached.expiresAt && Array.isArray(cached.dirs)) {
    log(reqId, "root cache VALID", { cachedCount: cached.dirs.length, expiresAt: cached.expiresAt });
    log(reqId, "root cache HIT", { dirs: cached.dirs.length, ms: Date.now() - st });
    return { dirs: cached.dirs, cacheHit: true };
  }

  log(reqId, "root cache MISS", { cachePath, cachePresent: !!cached, now: Date.now() });
  const dirs = (await listDirs(ROOT_DIR)).filter((n) => !EXCLUDED_TOPLEVEL.has(n));
  await writeCacheFile(cachePath, { dirs, expiresAt: Date.now() + ROOT_CACHE_TTL_MS, updatedAt: nowIso() });

  log(reqId, "root cache MISS -> scanned & saved", { dirs: dirs.length, ms: Date.now() - st });
  return { dirs, cacheHit: false };
}

async function getYearDirsCached(reqId, yearAbs) {
  const st = Date.now();
  const cachePath = cachePathForDir(yearAbs, "dirs");
  const rec = await readCacheFile(cachePath);
  if (rec && rec.expiresAt && Date.now() < rec.expiresAt && Array.isArray(rec.dirs)) {
    log(reqId, "year cache VALID", { year: relFromRoot(yearAbs), cachedCount: rec.dirs.length, expiresAt: rec.expiresAt });
    log(reqId, "year cache HIT", { year: relFromRoot(yearAbs), dirs: rec.dirs.length, ms: Date.now() - st });
    return { dirs: rec.dirs, cacheHit: true };
  }

  log(reqId, "year cache MISS", { year: relFromRoot(yearAbs), cachePath, cachePresent: !!rec, now: Date.now() });
  const dirs = await listDirs(yearAbs);
  await writeCacheFile(cachePath, { dirs, expiresAt: Date.now() + YEAR_CACHE_TTL_MS, updatedAt: nowIso() });

  log(reqId, "year cache MISS -> scanned & saved", { year: relFromRoot(yearAbs), dirs: dirs.length, ms: Date.now() - st });
  return { dirs, cacheHit: false };
}

async function getAlbumFilesCached(reqId, absAlbumDir) {
  const st = Date.now();
  const cachePath = cachePathForDir(absAlbumDir, "files");
  const rec = await readCacheFile(cachePath);
  if (rec && rec.expiresAt && Date.now() < rec.expiresAt && Array.isArray(rec.files) && rec.files.length) {
    log(reqId, "event cache VALID", { album: relFromRoot(absAlbumDir), cachedCount: rec.files.length, expiresAt: rec.expiresAt });
    log(reqId, "album cache HIT", { album: relFromRoot(absAlbumDir), files: rec.files.length, ms: Date.now() - st });
    return { files: rec.files, cacheHit: true, scannedMs: Date.now() - st, sortKey: rec.sortKey || "filename" };
  }

  log(reqId, "event cache MISS", { album: relFromRoot(absAlbumDir), cachePath, cachePresent: !!rec, now: Date.now() });
  const files = await scanAlbumFiles(absAlbumDir);
  await writeCacheFile(cachePath, {
    files,
    sortKey: "filename",
    expiresAt: Date.now() + EVENT_CACHE_TTL_MS,
    updatedAt: nowIso()
  });

  log(reqId, "album cache MISS -> scanned & saved", {
    album: relFromRoot(absAlbumDir),
    files: files.length,
    ms: Date.now() - st
  });

  return { files, cacheHit: false, scannedMs: Date.now() - st, sortKey: "filename" };
}

// --- selection logic ---
function pickRandom(arr) {
  const idx = Math.floor(Math.random() * arr.length);
  return { idx, val: arr[idx] };
}

function pickWindow(files, size) {
  if (files.length === 0) return { startIndex: 0, window: [] };

  const maxStart = Math.max(0, files.length - 1);
  const startIndex = Math.floor(Math.random() * (maxStart + 1));

  // 5 iš eilės: jei trūksta gale – wrap nuo pradžios
  const window = [];
  for (let i = 0; i < size; i++) {
    window.push(files[(startIndex + i) % files.length]);
  }
  return { startIndex, window };
}

function pickCollageFiles(files, startIndex, count, offset) {
  if (!files.length) return [];
  const total = files.length;
  const want = Math.min(count, total);
  const start = Math.min(startIndex + offset, total - 1);
  const out = [];
  for (let i = 0; i < want; i++) {
    out.push(files[(start + i) % total]);
  }
  return out;
}

function pickOverviewFiles(files, count) {
  if (!files.length) return [];
  const total = files.length;
  const want = Math.min(count, total);
  if (want >= total) return files.slice();
  const out = [];
  const step = total / want;
  for (let i = 0; i < want; i++) {
    const idx = Math.floor(i * step);
    out.push(files[idx]);
  }
  return out;
}

function getCollageCount(files) {
  const maxTiles = COLLAGE_GRID_ROWS * COLLAGE_GRID_COLS;
  return Math.min(maxTiles, files.length, COLLAGE_COUNT);
}

async function buildCollage(files) {
  if (!sharp) throw new Error("sharp not available");
  const gap = Math.max(0, COLLAGE_GAP);
  const tileWidth = Math.floor((OUTPUT_WIDTH - gap * (COLLAGE_GRID_COLS - 1)) / COLLAGE_GRID_COLS);
  const tileHeight = Math.floor((OUTPUT_HEIGHT - gap * (COLLAGE_GRID_ROWS - 1)) / COLLAGE_GRID_ROWS);
  const maxTiles = COLLAGE_GRID_ROWS * COLLAGE_GRID_COLS;
  const tiles = files.slice(0, maxTiles);
  const composites = await Promise.all(
    tiles.map(async (fileAbs, i) => {
      let pipeline = sharp(fileAbs);
      if (AUTO_ROTATE) pipeline = pipeline.rotate();
      const buf = await pipeline
        .resize(tileWidth, tileHeight, { fit: "cover" })
        .toBuffer();
      const row = Math.floor(i / COLLAGE_GRID_COLS);
      const col = i % COLLAGE_GRID_COLS;
      return {
        input: buf,
        top: row * (tileHeight + gap),
        left: col * (tileWidth + gap)
      };
    })
  );
  const base = sharp({
    create: {
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      channels: 3,
      background: "#000000"
    }
  });
  return base
    .composite(composites)
    .jpeg({ quality: COLLAGE_QUALITY })
    .toBuffer();
}

async function ensureRotateFlags(state) {
  if (!sharp || !state || state.rotateFlags) return;
  const files = state.window || [];
  const flags = await Promise.all(files.map(async (fileAbs) => {
    try {
      const meta = await sharp(fileAbs).metadata();
      const o = meta && meta.orientation;
      return o === 3 || o === 6 || o === 8;
    } catch {
      return false;
    }
  }));
  state.rotateFlags = flags;
}

async function pickNewSelection(reqId) {
  // 1) metų folderis (top-level), excludinam tik #Recycle
  log(reqId, "BUILD set (random N)", { windowSize: WINDOW_SIZE });
  const { dirs: years, cacheHit: rootCacheHit } = await getRootDirsCached(reqId);
  log(reqId, "root dir list", { count: years.length, cacheHit: rootCacheHit });
  if (!years.length) throw new Error("No top-level folders found (after exclude).");

  // bandysim kelis kartus rasti event su >=1 foto
  for (let attempt = 1; attempt <= 15; attempt++) {
    const pickedYear = pickRandom(years);
    const year = pickedYear.val;
    log(reqId, "pick year", { attempt, idx: pickedYear.idx, value: year, total: years.length });
    const yearAbs = path.join(ROOT_DIR, year);

    // 2) event folderis (1 lygis)
    const { dirs: events, cacheHit: yearCacheHit } = await getYearDirsCached(reqId, yearAbs);
    log(reqId, "event list", { year, count: events.length, cacheHit: yearCacheHit });
    if (!events.length) {
      log(reqId, "no events in year", { year, attempt });
      continue;
    }

    const allowedEvents = events.filter((name) => !excludedEvents.has(eventKey(year, name)));
    if (!allowedEvents.length) {
      log(reqId, "all events excluded for year", { year, total: events.length });
      continue;
    }

    const pickedEvent = pickRandom(allowedEvents);
    const eventName = pickedEvent.val;
    log(reqId, "pick event", { year, idx: pickedEvent.idx, value: eventName, total: allowedEvents.length });
    const eventAbs = path.join(yearAbs, eventName);

    // 3) albumo failai (cache)
    const { files, cacheHit, scannedMs, sortKey } = await getAlbumFilesCached(reqId, eventAbs);
    log(reqId, "event files", { year, event: eventName, files: files.length, cacheHit, scannedMs, sortKey });
    if (!files.length) {
      log(reqId, "event has 0 images, retry", { year, event: eventName, attempt });
      continue;
    }

    // 4) random start + 5 iš eilės
    const { startIndex, window } = pickWindow(files, WINDOW_SIZE);
    log(reqId, "pick window", { year, event: eventName, startIndex, windowSize: WINDOW_SIZE, filesTotal: files.length });
    const windowRel = window.map(relFromRoot);

    return {
      picked: { year, event: eventName, startIndex, pickedAt: nowIso() },
      window,
      windowRel,
      files,
      startIndex,
      debug: { cacheHit, scannedMs, filesTotal: files.length, sortKey }
    };
  }

  throw new Error("Failed to find any album with images after attempts.");
}

// --- routes ---
// MMM-Flashbacks tikisi /stream/:id (pvz. /stream/0)
function buildActiveSet(sel) {
  return {
    ...sel,
    generatedAt: nowIso(),
    expiresAt: Date.now() + SET_WINDOW_MS,
    collageEnd: null,
    collageOverview: null,
    refreshJitterMs: Math.floor(Math.random() * 10000)
  };
}

function refreshInfo(set) {
  const refreshAtMs = (set && set.expiresAt) ? set.expiresAt + (set.refreshJitterMs || 0) : null;
  const refreshInMs = refreshAtMs ? Math.max(0, refreshAtMs - Date.now()) : null;
  return { refreshAtMs, refreshInMs };
}

function setRefreshHeaders(res, state) {
  const { refreshAtMs, refreshInMs } = refreshInfo(state);
  if (refreshInMs !== null) {
    res.setHeader("X-Flashbacks-Refresh-In-Ms", String(refreshInMs));
  }
  if (refreshAtMs !== null) {
    res.setHeader("X-Flashbacks-Refresh-At", new Date(refreshAtMs).toISOString());
  }
}

async function getActiveSet(reqId) {
  if (activeSet && activeSet.expiresAt && Date.now() < activeSet.expiresAt) {
    log(reqId, "active set HIT", { expiresInMs: activeSet.expiresAt - Date.now() });
    return activeSet;
  }

  const sel = await pickNewSelection(reqId);
  activeSet = buildActiveSet(sel);
  log(reqId, "active set NEW", { picked: activeSet.picked, debug: activeSet.debug });
  return activeSet;
}

async function forceNewSet(reqId) {
  const sel = await pickNewSelection(reqId);
  activeSet = buildActiveSet(sel);
  log(reqId, "active set FORCED", { picked: activeSet.picked, debug: activeSet.debug });
  return activeSet;
}

app.get("/image/:id", async (req, res) => {
  const reqId = rid();
  const streamId = Number(req.params.id);

  if (!Number.isInteger(streamId) || streamId < 0 || streamId >= STREAM_COUNT) {
    return res.status(400).send("Bad stream id");
  }

  if (!ROOT_EXISTS) {
    return res.status(500).send("Media root missing");
  }

  try {
    const st = Date.now();
    const state = await getActiveSet(reqId);

    const fileAbs = state.window[streamId];
    const fileRel = state.windowRel[streamId];

    log(reqId, "SERVE", {
      streamId,
      file: fileRel,
      picked: state.picked,
      ms: Date.now() - st
    });

    res.setHeader("Cache-Control", "no-store");
    setRefreshHeaders(res, state);

    let pipeline = sharp(fileAbs);
    if (AUTO_ROTATE) pipeline = pipeline.rotate();
    pipeline = pipeline.resize(RESIZE_WIDTH, RESIZE_HEIGHT, { fit: "inside", withoutEnlargement: true });
    const buf = await pipeline.jpeg({ quality: RESIZE_QUALITY }).toBuffer();
    res.setHeader("Content-Type", "image/jpeg");
    res.send(buf);
    return;
  } catch (e) {
    log(reqId, "ERROR", { streamId, err: String(e) });
    res.status(500).send("Internal error");
  }
});

// Collage endpoint: 3x3 from next images in the same album
app.get("/collage/sequence", async (req, res) => {
  const reqId = rid();
  if (!ROOT_EXISTS) {
    return res.status(500).send("Media root missing");
  }

  try {
    const state = await getActiveSet(reqId);
    if (!state.files || !state.files.length) {
      return res.status(500).send("No files for collage");
    }

    if (!state.collageEnd) {
      const count = getCollageCount(state.files);
      const collageFiles = pickCollageFiles(state.files, state.startIndex || 0, count, WINDOW_SIZE);
      state.collageEnd = await buildCollage(collageFiles);
    }

    res.setHeader("Cache-Control", "no-store");
    setRefreshHeaders(res, state);
    res.setHeader("Content-Type", "image/jpeg");
    res.send(state.collageEnd);
  } catch (e) {
    log(reqId, "ERROR collage", { err: String(e) });
    res.status(500).send("Collage error");
  }
});

// Collage overview: evenly spaced tiles across the whole album
app.get("/collage/overview", async (req, res) => {
  const reqId = rid();
  if (!ROOT_EXISTS) {
    return res.status(500).send("Media root missing");
  }

  try {
    const state = await getActiveSet(reqId);
    if (!state.files || !state.files.length) {
      return res.status(500).send("No files for collage");
    }

    if (!state.collageOverview) {
      const count = getCollageCount(state.files);
      const collageFiles = pickOverviewFiles(state.files, count);
      state.collageOverview = await buildCollage(collageFiles);
    }

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "image/jpeg");
    res.send(state.collageOverview);
  } catch (e) {
    log(reqId, "ERROR collage/overview", { err: String(e) });
    res.status(500).send("Collage error");
  }
});

// State endpoint for frontend overlay
app.get("/state", async (req, res) => {
  const reqId = rid();
  try {
    const st = await getActiveSet(reqId);
    await ensureRotateFlags(st);
    const { refreshAtMs, refreshInMs } = refreshInfo(st);
    res.setHeader("Cache-Control", "no-store");
    setCors(res);
    res.json({
      generatedAt: st.generatedAt,
      expiresAt: st.expiresAt,
      refreshAt: refreshAtMs ? new Date(refreshAtMs).toISOString() : null,
      refreshInMs,
      albumExposeSec: ALBUM_EXPOSE_SEC > 0 ? ALBUM_EXPOSE_SEC : Math.round(SET_WINDOW_MS / 1000),
      streamCount: STREAM_COUNT,
      windowRel: st.windowRel,
      rotateFlags: st.rotateFlags || [],
      picked: st.picked,
      filesCount: st.files ? st.files.length : 0
    });
  } catch (e) {
    log(reqId, "ERROR state", { err: String(e) });
    res.status(500).json({ error: "state_failed" });
  }
});

// Debug endpointas: pažiūrėt ką backendas laiko atminty
// Exclude current album (year/event) from future random picks
app.get("/exclude", async (req, res) => {
  if (!activeSet || !activeSet.picked) {
    return res.status(400).json({ error: "no_active_set" });
  }
  const { year, event } = activeSet.picked;
  if (!year || !event) {
    return res.status(400).json({ error: "missing_event" });
  }
  const key = eventKey(year, event);
  excludedEvents.add(key);
  await persistExcludeFile();
  try {
    const st = await forceNewSet(rid());
    return res.json({ excluded: Array.from(excludedEvents), picked: st.picked });
  } catch (e) {
    return res.status(500).json({ error: "exclude_refresh_failed", err: String(e) });
  }
});

// Help endpoint: list available routes
app.get("/help", (req, res) => {
  res.json({
    endpoints: [
      { path: "/image/:id", method: "GET", description: "Serve image for stream id (0..STREAM_COUNT-1)." },
      { path: "/collage/sequence", method: "GET", description: "Serve collage from next images in the same album." },
      { path: "/collage/overview", method: "GET", description: "Serve overview collage from evenly spaced images in the album." },
      { path: "/state", method: "GET", description: "Return current set info (album, images, collages) and timing." },
      { path: "/next", method: "GET", description: "Force-create next set immediately." },
      { path: "/exclude", method: "GET", description: "Exclude current album and force-generate next set." },
      { path: "/help", method: "GET", description: "List available endpoints." }
    ]
  });
});

// Force-create next set immediately
app.get("/next", async (req, res) => {
  const reqId = rid();
  try {
    const st = await forceNewSet(reqId);
    const { refreshAtMs, refreshInMs } = refreshInfo(st);
    res.setHeader("Cache-Control", "no-store");
    setCors(res);
    res.json({
      generatedAt: st.generatedAt,
      expiresAt: st.expiresAt,
      refreshAt: refreshAtMs ? new Date(refreshAtMs).toISOString() : null,
      refreshInMs,
      windowRel: st.windowRel,
      picked: st.picked
    });
  } catch (e) {
    log(reqId, "ERROR next", { err: String(e) });
    res.status(500).json({ error: "next_failed" });
  }
});

const PORT = process.env.PORT || 8099;
app.listen(PORT, () => {
  if (!ROOT_EXISTS) {
    console.error(`[flashbacks] ERROR: ROOT_DIR missing: ${ROOT_DIR}`);
    process.exit(1);
  }
  console.log(`[flashbacks] listening on ${PORT}, root=${ROOT_DIR}, cacheDir=${CACHE_DIR}`);
});

