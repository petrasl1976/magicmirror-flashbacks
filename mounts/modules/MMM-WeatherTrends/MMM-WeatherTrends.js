/* global Module */

Module.register("MMM-WeatherTrends", {
  defaults: {
    baseUrl: "",
    historyHours: 72,
    refreshSec: 300,
    width: 520,
    height: 220,
    debug: false,
    futureDays: 3
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

    const canvas = document.createElement("canvas");
    canvas.className = "wtr-canvas";
    canvas.width = this.config.width;
    canvas.height = this.config.height;
    wrap.appendChild(canvas);

    this._draw(canvas);
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

  _draw(canvas) {
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

    if (!samples.length) return;

    const current = this.current && typeof this.current.temp === "number" && typeof this.current.feels === "number"
      ? this.current
      : null;
    const hourlySamples = samples.reduce((acc, s) => {
      const bucket = Math.floor(s.ts / dayMs * 24);
      const prev = acc.get(bucket);
      if (!prev || s.ts > prev.ts) {
        acc.set(bucket, s);
      }
      return acc;
    }, new Map());
    const pastLineSamples = Array.from(hourlySamples.values()).sort((a, b) => a.ts - b.ts);
    if (current) {
      pastLineSamples.push({ ts: now, temp: current.temp, feels: current.feels });
    }
    const allSeries = pastLineSamples.concat(futureSamples);
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

    const strongShadow = "0 0 12px rgba(0,0,0,0.95)";
    const strongShadowWide = "0 0 18px rgba(0,0,0,0.95)";
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
    const nearestSample = (list, ts) => {
      if (!list || !list.length) return null;
      return list.reduce((best, s) => {
        if (!best) return s;
        return Math.abs(s.ts - ts) < Math.abs(best.ts - ts) ? s : best;
      }, null);
    };
    const futureLineSamples = futureSamples.slice();
    const markers = offsetsDays
      .map((offsetDays) => {
        const ts = now + offsetDays * dayMs;
        let nearest = null;
        if (offsetDays === 0 && current) {
          nearest = { temp: current.temp, feels: current.feels };
        } else if (offsetDays < 0) {
          nearest = nearestSample(pastLineSamples, ts);
        } else {
          nearest = nearestSample(futureSamples, ts);
        }
        if (!nearest) return null;
        if (offsetDays > 0 && nearest.ts && nearest.ts !== ts) {
          futureLineSamples.push({ ts, temp: nearest.temp, feels: nearest.feels, _virtual: true });
        }
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
    futureLineSamples.sort((a, b) => a.ts - b.ts);

    ctx.shadowBlur = 0;

    // Temp line (white) + strong outline
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    pastLineSamples.forEach((s, idx) => {
      const x = xFor(s.ts);
      const y = yFor(s.temp);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.shadowColor = strongShadowPath;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    pastLineSamples.forEach((s, idx) => {
      const x = xFor(s.ts);
      const y = yFor(s.temp);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Future temp line (faded white)
    if (futureLineSamples.length) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      futureLineSamples.forEach((s, idx) => {
        const x = xFor(s.ts);
        const y = yFor(s.temp);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.65)";
      ctx.lineWidth = 2;
      ctx.shadowColor = strongShadowPath;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      futureLineSamples.forEach((s, idx) => {
        const x = xFor(s.ts);
        const y = yFor(s.temp);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Feels-like line (yellow) + strong outline
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    pastLineSamples.forEach((s, idx) => {
      const x = xFor(s.ts);
      const y = yFor(s.feels);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 2;
    ctx.shadowColor = strongShadowPath;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    pastLineSamples.forEach((s, idx) => {
      const x = xFor(s.ts);
      const y = yFor(s.feels);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Future feels-like line (faded yellow)
    if (futureLineSamples.length) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      futureLineSamples.forEach((s, idx) => {
        const x = xFor(s.ts);
        const y = yFor(s.feels);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,204,0,0.65)";
      ctx.lineWidth = 2;
      ctx.shadowColor = strongShadowPath;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      futureLineSamples.forEach((s, idx) => {
        const x = xFor(s.ts);
        const y = yFor(s.feels);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Draw marker rings above curves
    markers.forEach((m) => {
      const yTemp = yFor(m.temp);
      const yFeels = yFor(m.feels);
      const r = 6;
      const isFuture = m.offsetDays > 0;
      const pastWhite = "rgba(255,255,255,0.98)";
      const pastYellow = "rgba(255,204,0,0.98)";
      const futureWhite = "rgba(255,255,255,0.65)";
      const futureYellow = "rgba(255,204,0,0.65)";
      const tempStroke = isFuture ? futureWhite : pastWhite;
      const feelsStroke = isFuture ? futureYellow : pastYellow;
      ctx.shadowBlur = 0;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
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
      ctx.strokeStyle = feelsStroke;
      ctx.beginPath();
      ctx.arc(m.x, yFeels, r, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Draw labels below curves
    markers.forEach((m) => {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.font = "22px sans-serif";
      const isFuture = m.offsetDays > 0;
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
      ctx.strokeStyle = "rgba(0,0,0,0.95)";
      ctx.lineWidth = 4;
      ctx.fillStyle = isFuture ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.98)";
      ctx.strokeText(tempText, m.xLabel, yTempLabel);
      ctx.fillText(tempText, m.xLabel, yTempLabel);
      ctx.fillStyle = isFuture ? "rgba(255,204,0,0.65)" : "rgba(255,204,0,0.98)";
      ctx.strokeText(feelsText, m.xLabel, yFeelsLabel);
      ctx.fillText(feelsText, m.xLabel, yFeelsLabel);
    });
  }
});

