// server.js
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");
const https = require("https");
const unzipper = require("unzipper");

const app = express();

const ROOT_DIR = process.env.MEDIA_ROOT || process.env.ROOT_DIR || "/media";
const CACHE_DIR = process.env.CACHE_DIR
  || (process.env.CACHE_FILE ? path.dirname(process.env.CACHE_FILE) : "")
  || path.join(process.cwd(), "state", "flashbacks-cache");
const ROOT_EXISTS = fs.existsSync(ROOT_DIR);

const STREAM_COUNT = Number(process.env.STREAM_COUNT || 6);
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
const RESIZE_QUALITY = 82;
const ROOT_CACHE_TTL_MS = Number(process.env.ROOT_CACHE_TTL_MS || 30 * 24 * 60 * 60 * 1000);
const YEAR_CACHE_TTL_MS = Number(process.env.YEAR_CACHE_TTL_MS || 180 * 24 * 60 * 60 * 1000);
const EVENT_CACHE_TTL_MS = Number(process.env.EVENT_CACHE_TTL_MS || 180 * 24 * 60 * 60 * 1000);
const GTFS_URL = process.env.GTFS_URL || "https://www.stops.lt/vilnius/vilnius/gtfs.zip";
const GTFS_REFRESH_MS = Number(process.env.GTFS_REFRESH_MS || 24 * 60 * 60 * 1000);
const VVT_STOP_NAME = process.env.VVT_STOP_NAME || "Umėdžių st.";
const VVT_LIMIT = Number(process.env.VVT_LIMIT || 10);
const WEATHER_LAT = Number(process.env.WEATHER_LAT || 54.6872);
const WEATHER_LON = Number(process.env.WEATHER_LON || 25.2797);
const WEATHER_UNIT = String(process.env.WEATHER_UNIT || "celsius");
const WEATHER_INTERVAL_MIN = Number(process.env.WEATHER_INTERVAL_MIN || 60);
const WEATHER_HISTORY_HOURS = Number(process.env.WEATHER_HISTORY_HOURS || 72);

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

const GTFS_PATH = path.join(CACHE_DIR, "gtfs.zip");
let gtfsCache = null; // { stopName, updatedAt, expiresAt, stopsById, stopIds, routesById, tripsById, calendarByService, calendarDatesByService, stopTimesByStop }

const WEATHER_CACHE_FILE = path.join(CACHE_DIR, "weather-trends.json");
let weatherSamples = [];

function downloadGtfs() {
  return new Promise((resolve, reject) => {
    https.get(GTFS_URL, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(downloadGtfs(res.headers.location));
      }
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`GTFS download failed: ${res.statusCode}`));
      }
      fsp.mkdir(path.dirname(GTFS_PATH), { recursive: true })
        .then(() => {
          const out = fs.createWriteStream(GTFS_PATH);
          res.pipe(out);
          out.on("finish", resolve);
          out.on("error", reject);
        })
        .catch(reject);
    }).on("error", reject);
  });
}

function parseCsvLine(line, delim) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        cur += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headerLine = lines[0].replace(/^\uFEFF/, "");
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semiCount = (headerLine.match(/;/g) || []).length;
  const delim = semiCount > commaCount ? ";" : ",";
  const headers = parseCsvLine(headerLine, delim);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], delim);
    if (!cols.length) continue;
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cols[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function normalizeStopName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function dateYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function dayIndex(date) {
  const d = date.getDay(); // 0=Sun
  return d === 0 ? 6 : d - 1; // Mon=0 .. Sun=6
}

function parseTimeToSeconds(t) {
  const parts = String(t).split(":").map((n) => Number(n));
  if (parts.length < 2 || Number.isNaN(parts[0])) return null;
  const h = parts[0];
  const m = parts[1] || 0;
  const s = parts[2] || 0;
  return h * 3600 + m * 60 + s;
}

async function loadGtfs(stopName, stopIdOverride) {
  const now = Date.now();
  const cacheKey = `${stopName || ""}::${stopIdOverride || ""}`;
  if (gtfsCache && gtfsCache.expiresAt > now && gtfsCache.cacheKey === cacheKey) {
    log("gtfs", "cache HIT", { stopName, stopIdOverride, expiresAt: gtfsCache.expiresAt });
    return gtfsCache;
  }

  const zipExists = fs.existsSync(GTFS_PATH);
  const zipAge = zipExists ? (now - fs.statSync(GTFS_PATH).mtimeMs) : Infinity;
  log("gtfs", "zip status", { zipExists, zipAgeMs: zipAge, refreshMs: GTFS_REFRESH_MS, path: GTFS_PATH });
  if (!zipExists || zipAge > GTFS_REFRESH_MS) {
    log("gtfs", "downloading", { url: GTFS_URL });
    await downloadGtfs();
    log("gtfs", "downloaded", { path: GTFS_PATH });
  }

  const zip = await unzipper.Open.file(GTFS_PATH);
  log("gtfs", "zip opened", { entries: zip.files.length });
  async function readFile(name) {
    const entry = zip.files.find((f) => f.path === name);
    if (!entry) return "";
    const buf = await entry.buffer();
    return buf.toString("utf8");
  }

  const fileList = ["stops.txt", "routes.txt", "trips.txt", "calendar.txt", "calendar_dates.txt", "stop_times.txt"];
  log("gtfs", "files present", {
    names: zip.files.map((f) => f.path).filter((p) => fileList.includes(p))
  });

  const stops = parseCsv(await readFile("stops.txt"));
  const routes = parseCsv(await readFile("routes.txt"));
  const trips = parseCsv(await readFile("trips.txt"));
  const calendar = parseCsv(await readFile("calendar.txt"));
  const calendarDates = parseCsv(await readFile("calendar_dates.txt"));
  log("gtfs", "rows loaded", {
    stops: stops.length,
    routes: routes.length,
    trips: trips.length,
    calendar: calendar.length,
    calendarDates: calendarDates.length
  });

  const target = normalizeStopName(stopName);
  const stopsById = new Map(stops.map((s) => [s.stop_id, s]));
  let stopIds = [];
  let resolvedStopName = stopName;
  if (stopIdOverride) {
    stopIds = [String(stopIdOverride)];
    const s = stopsById.get(String(stopIdOverride));
    if (s && s.stop_name) resolvedStopName = s.stop_name;
    log("gtfs", "stop override", { stopIdOverride, resolvedStopName });
  } else {
    const exact = stops.filter((s) => normalizeStopName(s.stop_name) === target);
    const prefix = stops.filter((s) => normalizeStopName(s.stop_name).startsWith(target));
    const contains = stops.filter((s) => normalizeStopName(s.stop_name).includes(target));
    const candidates = exact.length ? exact : (prefix.length ? prefix : contains);
    stopIds = candidates.map((s) => s.stop_id);
    if (candidates.length && candidates[0].stop_name) resolvedStopName = candidates[0].stop_name;
    log("gtfs", "stop match", {
      stopName,
      target,
      exact: exact.length,
      prefix: prefix.length,
      contains: contains.length,
      chosen: candidates.slice(0, 3).map((s) => s.stop_name),
      stopIds: stopIds.slice(0, 3)
    });
  }

  const routesById = new Map(routes.map((r) => [r.route_id, r]));
  const tripsById = new Map(trips.map((t) => [t.trip_id, t]));

  const calendarByService = new Map();
  calendar.forEach((c) => calendarByService.set(c.service_id, c));

  const calendarDatesByService = new Map();
  calendarDates.forEach((c) => {
    const list = calendarDatesByService.get(c.service_id) || [];
    list.push(c);
    calendarDatesByService.set(c.service_id, list);
  });

  const stopTimesByStop = new Map();
  if (stopIds.length) {
    const stopSet = new Set(stopIds);
    const stopTimes = parseCsv(await readFile("stop_times.txt"));
    log("gtfs", "stop_times loaded", { rows: stopTimes.length });
    for (const st of stopTimes) {
      if (!stopSet.has(st.stop_id)) continue;
      const list = stopTimesByStop.get(st.stop_id) || [];
      list.push({
        trip_id: st.trip_id,
        arrival_time: st.arrival_time
      });
      stopTimesByStop.set(st.stop_id, list);
    }
    log("gtfs", "stop_times matched", {
      stopIds: stopIds.slice(0, 3),
      count: stopTimesByStop.get(stopIds[0]) ? stopTimesByStop.get(stopIds[0]).length : 0
    });
  }

  gtfsCache = {
    cacheKey,
    stopName: resolvedStopName,
    updatedAt: now,
    expiresAt: now + GTFS_REFRESH_MS,
    stopIds,
    stopsById,
    routesById,
    tripsById,
    calendarByService,
    calendarDatesByService,
    stopTimesByStop
  };

  return gtfsCache;
}

function isServiceActive(service, exceptions, todayYmd, todayIdx) {
  if (!service) return false;
  if (service.start_date && todayYmd < service.start_date) return false;
  if (service.end_date && todayYmd > service.end_date) return false;
  const dayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  if (service[dayKeys[todayIdx]] !== "1") return false;
  if (!exceptions) return true;
  for (const ex of exceptions) {
    if (ex.date === todayYmd) {
      return ex.exception_type === "1";
    }
  }
  return true;
}

async function getNextArrivals(stopName, limit, stopIdOverride) {
  const cache = await loadGtfs(stopName, stopIdOverride);
  const stopId = cache.stopIds[0];
  const effectiveStopName = cache.stopName || stopName;
  if (!stopId) {
    return { stopName: effectiveStopName, stopId: null, items: [] };
  }

  const list = cache.stopTimesByStop.get(stopId) || [];
  const now = new Date();
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  const out = [];
  for (let dayOffset = 0; dayOffset < 7 && out.length < limit * 5; dayOffset++) {
    const day = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const dayYmd = dateYmd(day);
    const dayIdx = dayIndex(day);
    for (const st of list) {
      const trip = cache.tripsById.get(st.trip_id);
      if (!trip) continue;
      const service = cache.calendarByService.get(trip.service_id);
      const ex = cache.calendarDatesByService.get(trip.service_id);
      if (!isServiceActive(service, ex, dayYmd, dayIdx)) continue;
      const arrivalSec = parseTimeToSeconds(st.arrival_time);
      if (arrivalSec === null) continue;
      const diffSec = dayOffset === 0
        ? arrivalSec - nowSec
        : (dayOffset * 86400 + arrivalSec - nowSec);
      if (diffSec < -60) continue;
      const minutes = Math.max(0, Math.floor(diffSec / 60));
      const route = cache.routesById.get(trip.route_id);
      out.push({
        route: route ? (route.route_short_name || route.route_id) : trip.route_id,
        headsign: trip.trip_headsign || "",
        minutes,
        arrivalTime: st.arrival_time
      });
    }
  }

  out.sort((a, b) => {
    if (a.minutes !== b.minutes) return a.minutes - b.minutes;
    return a.arrivalTime.localeCompare(b.arrivalTime);
  });

  return { stopName: effectiveStopName, stopId, items: out.slice(0, limit) };
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

function loadWeatherFile() {
  try {
    if (!fs.existsSync(WEATHER_CACHE_FILE)) return [];
    const raw = fs.readFileSync(WEATHER_CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function trimWeatherSamples(samples) {
  const cutoff = Date.now() - WEATHER_HISTORY_HOURS * 60 * 60 * 1000;
  return samples.filter((s) => s && typeof s.ts === "number" && s.ts >= cutoff);
}

async function fetchWeatherSample() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(WEATHER_LAT)}&longitude=${encodeURIComponent(WEATHER_LON)}&current=temperature_2m,apparent_temperature&temperature_unit=${encodeURIComponent(WEATHER_UNIT)}&timezone=auto`;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`weather_fetch_${resp.status}`);
  const data = await resp.json();
  const current = data && data.current ? data.current : null;
  if (!current || typeof current.temperature_2m !== "number" || typeof current.apparent_temperature !== "number") {
    throw new Error("weather_missing_current");
  }
  return {
    ts: Date.now(),
    temp: current.temperature_2m,
    feels: current.apparent_temperature
  };
}

async function recordWeatherSample() {
  try {
    const sample = await fetchWeatherSample();
    weatherSamples.push(sample);
    weatherSamples = trimWeatherSamples(weatherSamples);
    await writeCacheFile(WEATHER_CACHE_FILE, weatherSamples);
  } catch (e) {
    console.warn("[flashbacks] WARN: weather sample failed", { err: String(e) });
  }
}

function startWeatherLogger() {
  weatherSamples = trimWeatherSamples(loadWeatherFile());
  recordWeatherSample();
  setInterval(recordWeatherSample, Math.max(5, WEATHER_INTERVAL_MIN) * 60 * 1000);
}

startWeatherLogger();

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
  log(reqId, "BUILD set (random N)", { windowSize: STREAM_COUNT });
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
  const { startIndex, window } = pickWindow(files, STREAM_COUNT);
  log(reqId, "pick window", { year, event: eventName, startIndex, windowSize: STREAM_COUNT, filesTotal: files.length });
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
// MMM-PL-Flashbacks tikisi /stream/:id (pvz. /stream/0)
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
    pipeline = pipeline.resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: "inside", withoutEnlargement: true });
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
      const collageFiles = pickCollageFiles(state.files, state.startIndex || 0, count, STREAM_COUNT);
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

app.get("/weather/trends", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  setCors(res);
  const samples = trimWeatherSamples(weatherSamples);
  weatherSamples = samples;
  res.json({
    updatedAt: nowIso(),
    historyHours: WEATHER_HISTORY_HOURS,
    intervalMin: WEATHER_INTERVAL_MIN,
    samples
  });
});

app.get("/vvt/next", async (req, res) => {
  try {
    const stopName = req.query.stop || VVT_STOP_NAME;
    const stopId = req.query.stopId || null;
    const limit = Number(req.query.limit || VVT_LIMIT);
    const data = await getNextArrivals(stopName, limit, stopId);
    res.setHeader("Cache-Control", "no-store");
    setCors(res);
    res.json({
      stopName: data.stopName,
      stopId: data.stopId,
      updatedAt: nowIso(),
      items: data.items
    });
  } catch (e) {
    res.status(500).json({ error: "vvt_failed" });
  }
});

app.get("/vvt/debug", async (req, res) => {
  try {
    const stopName = req.query.stop || VVT_STOP_NAME;
    const stopIdOverride = req.query.stopId || null;
    const cache = await loadGtfs(stopName, stopIdOverride);
    const stopId = cache.stopIds[0] || null;
    const stopSample = stopId && cache.stopsById ? cache.stopsById.get(stopId) : null;
    res.setHeader("Cache-Control", "no-store");
    setCors(res);
    res.json({
      gtfsUrl: GTFS_URL,
      gtfsPath: GTFS_PATH,
      updatedAt: cache.updatedAt ? new Date(cache.updatedAt).toISOString() : null,
      expiresAt: cache.expiresAt ? new Date(cache.expiresAt).toISOString() : null,
      stopName,
      stopId,
      stopSample,
      stopIds: cache.stopIds.slice(0, 5),
      stopTimesCount: stopId && cache.stopTimesByStop.get(stopId)
        ? cache.stopTimesByStop.get(stopId).length
        : 0
    });
  } catch (e) {
    res.status(500).json({ error: "vvt_failed" });
  }
});
app.get("/vvt/stops", async (req, res) => {
  try {
    const q = normalizeStopName(req.query.q || "");
    const limit = Number(req.query.limit || 50);
    const cache = await loadGtfs(req.query.stop || VVT_STOP_NAME);
    const out = [];
    for (const [id, s] of cache.stopsById.entries()) {
      const name = s.stop_name || "";
      if (!q || normalizeStopName(name).includes(q)) {
        out.push({ stop_id: id, stop_name: name });
      }
    }
    res.setHeader("Cache-Control", "no-store");
    setCors(res);
    res.json({ items: out.slice(0, limit) });
  } catch (e) {
    res.status(500).json({ error: "vvt_failed" });
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
      { path: "/weather/trends", method: "GET", description: "Temperature & feels-like history samples." },
      { path: "/vvt/next", method: "GET", description: "Next departures from a stop (GTFS schedule)." },
      { path: "/vvt/stops", method: "GET", description: "Search stop names (GTFS)." },
      { path: "/vvt/debug", method: "GET", description: "Debug GTFS cache and stop matching." },
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

const BACKEND_PORT = 8099;
app.listen(BACKEND_PORT, () => {
  if (!ROOT_EXISTS) {
    console.error(`[flashbacks] ERROR: ROOT_DIR missing: ${ROOT_DIR}`);
    process.exit(1);
  }
  console.log(`[flashbacks] listening on ${BACKEND_PORT}, root=${ROOT_DIR}, cacheDir=${CACHE_DIR}`);
});

