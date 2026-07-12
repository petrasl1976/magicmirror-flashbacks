/* global Module */

Module.register("MMM-WeatherTrends", {
  defaults: {
    baseUrl: "",
    historyHours: 72,
    refreshSec: 300,
    width: 520,
    height: 220,
    debug: false,
    futureDays: 3,
    showPrecip: true,
    showPressure: true,
    precipColor: "90,200,250",
    pressureColor: "168,200,50",
    precipHeight: 90,
    pressureHeight: 90,
    panelOrder: ["pressure", "precip", "temp"]
  },

  start() {
    this.samples = [];
    this.forecast = [];
    this.current = null;
    this._timer = null;
    this._baseUrl = this._getBaseUrl();
    this._fetch();
    this._timer = setInterval(() => this._fetch(), this.config.refreshSec * 1000);
  },

  _getBaseUrl() {
    if (this.config.baseUrl) return this.config.baseUrl;
    const port = Number(this.config.backendPort);
    return `http://${window.location.hostname}:${port}`;
  },

  getStyles() {
    return ["MMM-WeatherTrends.css"];
  },

  _getUiFontFamily() {
    const body = document.body;
    if (!body) return "sans-serif";
    const family = window.getComputedStyle(body).fontFamily;
    return family || "sans-serif";
  },

  getDom() {
    const wrap = document.createElement("div");
    wrap.className = "wtr-wrap";

    if (!this.samples.length) {
      const empty = document.createElement("div");
      empty.className = "wtr-empty";
      empty.textContent = "Loading...";
      wrap.appendChild(empty);
      return wrap;
    }

    const order = Array.isArray(this.config.panelOrder) && this.config.panelOrder.length
      ? this.config.panelOrder
      : ["pressure", "precip", "temp"];

    order.forEach((kind) => {
      if (kind === "pressure" && !this.config.showPressure) return;
      if (kind === "precip" && !this.config.showPrecip) return;

      const canvas = document.createElement("canvas");
      canvas.width = this.config.width;
      if (kind === "temp") {
        canvas.className = "wtr-canvas wtr-canvas-temp";
        canvas.height = this.config.height;
      } else if (kind === "pressure") {
        canvas.className = "wtr-canvas wtr-canvas-pressure";
        canvas.height = this.config.pressureHeight;
      } else {
        canvas.className = "wtr-canvas wtr-canvas-precip";
        canvas.height = this.config.precipHeight;
      }
      wrap.appendChild(canvas);

      if (kind === "temp") this._drawTempPanel(canvas);
      else if (kind === "pressure") this._drawPressurePanel(canvas);
      else this._drawPrecipPanel(canvas);
    });

    return wrap;
  },

  _fetch() {
    const baseUrl = this._baseUrl || this._getBaseUrl();
    const url = `${baseUrl}/weather/trends?t=${Date.now()}`;
    fetch(url, { cache: "no-store" })
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .then((data) => {
        const samples = data && Array.isArray(data.samples) ? data.samples : [];
        const forecast = data && Array.isArray(data.forecast) ? data.forecast : [];
        this.samples = samples;
        this.forecast = forecast;
        this.current = data && data.current ? data.current : null;
        this.updateDom(0);
      })
      .catch((err) => {
        if (this.config.debug) {
          console.warn(`[MMM-WeatherTrends] fetch failed: ${String(err)}`);
        }
      });
  },

  // Shared time window + sorted history/forecast series (all metrics ride along).
  _computeWindow() {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const offsetsDays = [-4, -3, -2, -1, 0, 1, 2, 3];
    const markerTimes = offsetsDays.map((d) => now + d * dayMs);
    const start = Math.min(...markerTimes);
    const end = Math.max(...markerTimes);
    const historySeries = this.samples
      .filter((s) => s.ts >= start && s.ts <= now)
      .sort((a, b) => a.ts - b.ts);
    const forecastSeries = (this.forecast || [])
      .filter((s) => s.ts >= now && s.ts <= end)
      .sort((a, b) => a.ts - b.ts);
    if (!historySeries.length && !forecastSeries.length) return null;
    const maxSpan = Math.max(now - start, end - now);
    return { now, dayMs, offsetsDays, start, end, historySeries, forecastSeries, maxSpan };
  },

  _alphaFor(ts, now, maxSpan, minAlpha = 0.2, maxAlpha = 1) {
    if (!Number.isFinite(maxSpan) || maxSpan <= 0) return maxAlpha;
    const dist = Math.abs(ts - now);
    const t = Math.min(1, dist / maxSpan);
    const eased = t * t * t * t;
    return minAlpha + (maxAlpha - minAlpha) * (1 - eased);
  },

  // Linear-interpolated hourly samples of one metric across the whole window,
  // splitting history (<= now) from forecast (> now). Skips null/absent values.
  _lineFor(key, win) {
    const clean = (series) =>
      series
        .map((s) => ({ ts: s.ts, v: typeof s[key] === "number" && Number.isFinite(s[key]) ? s[key] : null }))
        .filter((p) => p.v !== null);
    const hist = clean(win.historySeries);
    const fore = clean(win.forecastSeries);
    const interp = (arr, ts) => {
      if (!arr.length) return null;
      if (ts <= arr[0].ts) return arr[0].v;
      const last = arr[arr.length - 1];
      if (ts >= last.ts) return last.v;
      let lo = 0;
      let hi = arr.length - 1;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (arr[mid].ts === ts) return arr[mid].v;
        if (arr[mid].ts < ts) lo = mid + 1;
        else hi = mid - 1;
      }
      const left = arr[Math.max(0, hi)];
      const right = arr[Math.min(arr.length - 1, lo)];
      if (!left || !right || left.ts === right.ts) return (left || right).v;
      const t = (ts - left.ts) / (right.ts - left.ts);
      return left.v + (right.v - left.v) * t;
    };
    const stepMs = 60 * 60 * 1000;
    const out = [];
    for (let ts = win.start; ts <= win.end; ts += stepMs) {
      const v = ts <= win.now ? interp(hist, ts) : interp(fore, ts);
      if (v !== null && Number.isFinite(v)) out.push({ ts, v });
    }
    return out;
  },

  // Faded, black-outlined line matching the temperature panel's style.
  _drawFadedLine(ctx, xFor, yFor, pts, now, maxSpan, rgb) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const alpha = this._alphaFor((a.ts + b.ts) / 2, now, maxSpan, 0.2, 1);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(0,0,0,${0.9 * alpha})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(xFor(a.ts), yFor(a.v));
      ctx.lineTo(xFor(b.ts), yFor(b.v));
      ctx.stroke();

      ctx.strokeStyle = `rgba(${rgb},${0.95 * alpha})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(0,0,0,0.95)";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(xFor(a.ts), yFor(a.v));
      ctx.lineTo(xFor(b.ts), yFor(b.v));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  },

  _outlinedLabel(ctx, text, x, y, rgb, alpha, font) {
    ctx.font = font;
    ctx.shadowBlur = 0;
    ctx.lineWidth = 4;
    ctx.strokeStyle = `rgba(0,0,0,${0.95 * alpha})`;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = `rgba(${rgb},${0.95 * alpha})`;
    ctx.fillText(text, x, y);
  },

  _drawPressurePanel(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const win = this._computeWindow();
    if (!win) return;
    const line = this._lineFor("pressure", win);
    if (line.length < 2) return;

    const rgb = this.config.pressureColor;
    const uiFont = this._getUiFontFamily();
    const padX = 36;
    const padTop = 22;
    const padBottom = 20;
    const vals = line.map((p) => p.v);
    const cur = this.current && Number.isFinite(this.current.pressure) ? this.current.pressure : null;
    if (cur !== null) vals.push(cur);
    let minY = Math.min(...vals);
    let maxY = Math.max(...vals);
    if (maxY - minY < 2) {
      minY -= 2;
      maxY += 2;
    } else {
      const m = (maxY - minY) * 0.15;
      minY -= m;
      maxY += m;
    }
    const xFor = (ts) => padX + ((ts - win.start) / (win.end - win.start)) * (w - padX * 2);
    const yFor = (v) => padTop + (1 - (v - minY) / (maxY - minY)) * (h - padTop - padBottom);

    this._drawFadedLine(ctx, xFor, yFor, line, win.now, win.maxSpan, rgb);

    // Extremes + current value labels (minimal).
    let maxP = line[0];
    let minP = line[0];
    line.forEach((p) => {
      if (p.v > maxP.v) maxP = p;
      if (p.v < minP.v) minP = p;
    });
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    this._outlinedLabel(ctx, `${Math.round(maxP.v)}`, xFor(maxP.ts), Math.max(2, yFor(maxP.v) - 22),
      rgb, this._alphaFor(maxP.ts, win.now, win.maxSpan), `18px ${uiFont}`);
    this._outlinedLabel(ctx, `${Math.round(minP.v)}`, xFor(minP.ts), Math.min(h - 20, yFor(minP.v) + 6),
      rgb, this._alphaFor(minP.ts, win.now, win.maxSpan), `18px ${uiFont}`);

    if (cur !== null) {
      const x = xFor(win.now);
      const y = yFor(cur);
      ctx.shadowBlur = 0;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(${rgb},0.95)`;
      ctx.fillStyle = `rgba(${rgb},0.95)`;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
      this._outlinedLabel(ctx, `${Math.round(cur)}`, x, Math.max(2, y - 30), rgb, 1, `600 20px ${uiFont}`);
    }
  },

  _drawPrecipPanel(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const win = this._computeWindow();
    if (!win) return;
    const line = this._lineFor("precip", win);
    if (!line.length) return;

    const rgb = this.config.precipColor;
    const uiFont = this._getUiFontFamily();
    const padX = 36;
    const padTop = 22;
    const padBottom = 16;
    const baseY = h - padBottom;
    let maxP = line[0];
    line.forEach((p) => {
      if (p.v > maxP.v) maxP = p;
    });
    const maxVal = Math.max(maxP.v, 0.5); // floor so a light drizzle is still visible
    const xFor = (ts) => padX + ((ts - win.start) / (win.end - win.start)) * (w - padX * 2);
    const hourMs = 60 * 60 * 1000;
    const barW = Math.max(2, ((w - padX * 2) / ((win.end - win.start) / hourMs)) * 0.8);

    // Baseline
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, baseY + 0.5);
    ctx.lineTo(w - padX, baseY + 0.5);
    ctx.stroke();

    line.forEach((p) => {
      if (p.v <= 0) return;
      const alpha = this._alphaFor(p.ts, win.now, win.maxSpan, 0.2, 1);
      const x = xFor(p.ts);
      const barH = ((baseY - padTop) * Math.min(1, p.v / maxVal));
      const y = baseY - barH;
      ctx.shadowColor = "rgba(0,0,0,0.95)";
      ctx.shadowBlur = 8;
      ctx.fillStyle = `rgba(${rgb},${0.9 * alpha})`;
      ctx.fillRect(x - barW / 2, y, barW, barH);
    });
    ctx.shadowBlur = 0;

    // Labels: peak amount, and current if raining.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const fmt = (v) => (v >= 10 ? `${Math.round(v)}` : `${v.toFixed(1)}`);
    if (maxP.v > 0) {
      const x = xFor(maxP.ts);
      const barH = (baseY - padTop) * Math.min(1, maxP.v / maxVal);
      this._outlinedLabel(ctx, `${fmt(maxP.v)}`, x, Math.max(2, baseY - barH - 22),
        rgb, this._alphaFor(maxP.ts, win.now, win.maxSpan), `18px ${uiFont}`);
    } else {
      this._outlinedLabel(ctx, "0", padX + 8, 2, rgb, 0.7, `18px ${uiFont}`);
    }
    const cur = this.current && Number.isFinite(this.current.precip) ? this.current.precip : null;
    if (cur !== null && cur > 0) {
      const x = xFor(win.now);
      const barH = (baseY - padTop) * Math.min(1, cur / maxVal);
      this._outlinedLabel(ctx, `${fmt(cur)}`, x, Math.max(2, baseY - barH - 30), rgb, 1, `600 20px ${uiFont}`);
    }
  },

  _drawTempPanel(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const now = Date.now();
    const futureDays = Math.max(0, Number(this.config.futureDays) || 0);
    const dayMs = 24 * 60 * 60 * 1000;
    const offsetsDays = [-4, -3, -2, -1, 0, 1, 2, 3];
    const markerTimes = offsetsDays.map((d) => now + d * dayMs);
    const start = Math.min(...markerTimes);
    const end = Math.max(...markerTimes);
    const samples = this.samples
      .filter((s) => s.ts >= start && s.ts <= now)
      .sort((a, b) => a.ts - b.ts);
    const futureSamples = (this.forecast || [])
      .filter((s) => s.ts >= now && s.ts <= end)
      .sort((a, b) => a.ts - b.ts);

    if (!samples.length && !futureSamples.length) return;

    const current = this.current && typeof this.current.temp === "number" && typeof this.current.feels === "number"
      ? this.current
      : null;
    const historySeries = samples.slice();
    const forecastSeries = futureSamples.slice();
    const allSeries = historySeries.concat(forecastSeries);
    const minVal = Math.min(
      ...allSeries.map((s) => Math.min(s.temp, s.feels)),
      current ? Math.min(current.temp, current.feels) : Infinity
    );
    const maxVal = Math.max(
      ...allSeries.map((s) => Math.max(s.temp, s.feels)),
      current ? Math.max(current.temp, current.feels) : -Infinity
    );
    let minY = minVal;
    let maxY = maxVal;
    if (Math.abs(maxY - minY) < 1) {
      minY -= 1;
      maxY += 1;
    } else {
      minY -= 1;
      maxY += 1;
    }

    const pad = 36;
    const w = canvas.width;
    const h = canvas.height;
    const xFor = (ts) => pad + ((ts - start) / (end - start)) * (w - pad * 2);
    const yFor = (val) => pad + (1 - (val - minY) / (maxY - minY)) * (h - pad * 2);

    ctx.clearRect(0, 0, w, h);

    const strongShadowPath = "rgba(0,0,0,0.95)";

    // Markers: past 4 days, today, next 3 days at the same time-of-day
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "22px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.shadowColor = "rgba(0,0,0,0.95)";
    ctx.shadowBlur = 16;
    const interpolateAt = (series, ts) => {
      if (!series || !series.length) return null;
      if (ts <= series[0].ts) return series[0];
      const last = series[series.length - 1];
      if (ts >= last.ts) return last;
      let lo = 0;
      let hi = series.length - 1;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const cur = series[mid];
        if (cur.ts === ts) return cur;
        if (cur.ts < ts) lo = mid + 1;
        else hi = mid - 1;
      }
      const left = series[Math.max(0, hi)];
      const right = series[Math.min(series.length - 1, lo)];
      if (!left || !right || left.ts === right.ts) return left || right;
      const t = (ts - left.ts) / (right.ts - left.ts);
      return {
        ts,
        temp: left.temp + (right.temp - left.temp) * t,
        feels: left.feels + (right.feels - left.feels) * t
      };
    };
    const maxSpan = Math.max(now - start, end - now);
    const alphaFor = (ts, minAlpha = 0.05, maxAlpha = 1) => {
      if (!Number.isFinite(maxSpan) || maxSpan <= 0) return maxAlpha;
      const dist = Math.abs(ts - now);
      const t = Math.min(1, dist / maxSpan);
      const eased = t * t * t * t;
      return minAlpha + (maxAlpha - minAlpha) * (1 - eased);
    };
    const stepMs = 60 * 60 * 1000;
    const lineSamples = [];
    for (let ts = start; ts <= end; ts += stepMs) {
      let s = null;
      if (ts <= now) {
        s = interpolateAt(historySeries, ts);
      } else {
        s = interpolateAt(forecastSeries, ts);
      }
      if (s && Number.isFinite(s.temp) && Number.isFinite(s.feels)) {
        lineSamples.push({ ts, temp: s.temp, feels: s.feels });
      }
    }
    const markers = offsetsDays
      .map((offsetDays) => {
        const ts = now + offsetDays * dayMs;
        let nearest = null;
        if (offsetDays === 0 && current) {
          nearest = { temp: current.temp, feels: current.feels };
        } else if (offsetDays < 0) {
          nearest = interpolateAt(historySeries, ts);
        } else {
          nearest = interpolateAt(forecastSeries, ts);
        }
        if (!nearest) return null;
        const x = xFor(ts);
        const xLabel = x;
        return {
          offsetDays,
          x,
          xLabel,
          temp: nearest.temp,
          feels: nearest.feels
        };
      })
      .filter(Boolean);
    ctx.shadowBlur = 0;

    // Temp line (white) + strong outline
    ctx.shadowBlur = 0;
    if (lineSamples.length > 1) {
      for (let i = 0; i < lineSamples.length - 1; i++) {
        const a = lineSamples[i];
        const b = lineSamples[i + 1];
        const alpha = alphaFor((a.ts + b.ts) / 2, 0.2, 1);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(0,0,0,${0.9 * alpha})`;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(xFor(a.ts), yFor(a.temp));
        ctx.lineTo(xFor(b.ts), yFor(b.temp));
        ctx.stroke();

        ctx.strokeStyle = `rgba(255,255,255,${0.95 * alpha})`;
        ctx.lineWidth = 2;
        ctx.shadowColor = strongShadowPath;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(xFor(a.ts), yFor(a.temp));
        ctx.lineTo(xFor(b.ts), yFor(b.temp));
        ctx.stroke();
      }
    }

    // Feels-like line (yellow) + strong outline
    ctx.shadowBlur = 0;
    if (lineSamples.length > 1) {
      for (let i = 0; i < lineSamples.length - 1; i++) {
        const a = lineSamples[i];
        const b = lineSamples[i + 1];
        const alpha = alphaFor((a.ts + b.ts) / 2, 0.2, 1);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(0,0,0,${0.9 * alpha})`;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(xFor(a.ts), yFor(a.feels));
        ctx.lineTo(xFor(b.ts), yFor(b.feels));
        ctx.stroke();

        ctx.strokeStyle = `rgba(255,204,0,${0.95 * alpha})`;
        ctx.lineWidth = 2;
        ctx.shadowColor = strongShadowPath;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(xFor(a.ts), yFor(a.feels));
        ctx.lineTo(xFor(b.ts), yFor(b.feels));
        ctx.stroke();
      }
    }

    // Draw marker rings above curves
    markers.forEach((m) => {
      const yTemp = yFor(m.temp);
      const yFeels = yFor(m.feels);
      const r = 6;
      const isCurrent = m.offsetDays === 0;
      const alpha = alphaFor(now + m.offsetDays * dayMs, 0.2, 1);
      const tempStroke = `rgba(255,255,255,${0.95 * alpha})`;
      const feelsStroke = `rgba(255,204,0,${0.95 * alpha})`;
      ctx.shadowBlur = 0;
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(0,0,0,${0.9 * alpha})`;
      ctx.beginPath();
      ctx.arc(m.x, yTemp, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(m.x, yFeels, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = tempStroke;
      ctx.beginPath();
      ctx.arc(m.x, yTemp, r, 0, Math.PI * 2);
      ctx.stroke();
      if (isCurrent) {
        ctx.fillStyle = tempStroke;
        ctx.fill();
      }
      ctx.strokeStyle = feelsStroke;
      ctx.beginPath();
      ctx.arc(m.x, yFeels, r, 0, Math.PI * 2);
      ctx.stroke();
      if (isCurrent) {
        ctx.fillStyle = feelsStroke;
        ctx.fill();
      }
    });

    // Subtle horizontal guides through current points
    const currentMarker = markers.find((m) => m.offsetDays === 0);
    if (currentMarker) {
      const alpha = alphaFor(now, 0.05, 1);
      const guideAlpha = 0.5 * alpha;
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(255,255,255,${guideAlpha})`;
      ctx.beginPath();
      ctx.moveTo(pad, yFor(currentMarker.temp));
      ctx.lineTo(w - pad, yFor(currentMarker.temp));
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,204,0,${guideAlpha})`;
      ctx.beginPath();
      ctx.moveTo(pad, yFor(currentMarker.feels));
      ctx.lineTo(w - pad, yFor(currentMarker.feels));
      ctx.stroke();
    }

    // Draw labels below curves
    const uiFontFamily = this._getUiFontFamily();
    markers.forEach((m) => {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const isCurrent = m.offsetDays === 0;
      const alpha = alphaFor(now + m.offsetDays * dayMs, 0.2, 1);
      ctx.font = isCurrent ? `600 28px ${uiFontFamily}` : `22px ${uiFontFamily}`;
      const tempUpOffset = 52;
      const feelsUpOffset = 36;
      const tempDownOffset = 26;
      const feelsDownOffset = 20;
      const yTemp = yFor(m.temp);
      const yFeels = yFor(m.feels);
      let yTempLabel;
      let yFeelsLabel;
      const labelMin = 2;
      if (m.temp >= m.feels) {
        yTempLabel = Math.max(labelMin, Math.min(h - 6, yTemp - tempUpOffset));
        yFeelsLabel = Math.max(labelMin, Math.min(h - 6, yFeels + feelsDownOffset));
      } else {
        yTempLabel = Math.max(labelMin, Math.min(h - 6, yTemp + tempDownOffset));
        yFeelsLabel = Math.max(labelMin, Math.min(h - 6, yFeels - feelsUpOffset));
      }
      const tempText = `${Math.round(m.temp)}°`;
      const feelsText = `${Math.round(m.feels)}°`;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(0,0,0,${0.95 * alpha})`;
      ctx.lineWidth = 4;
      ctx.fillStyle = `rgba(255,255,255,${0.95 * alpha})`;
      ctx.strokeText(tempText, m.xLabel, yTempLabel);
      ctx.fillText(tempText, m.xLabel, yTempLabel);
      ctx.fillStyle = `rgba(255,204,0,${0.95 * alpha})`;
      ctx.strokeText(feelsText, m.xLabel, yFeelsLabel);
      ctx.fillText(feelsText, m.xLabel, yFeelsLabel);
    });
  }
});
