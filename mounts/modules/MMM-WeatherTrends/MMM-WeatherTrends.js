/* global Module */

Module.register("MMM-WeatherTrends", {
  defaults: {
    baseUrl: "",
    historyHours: 72,
    refreshSec: 300,
    width: 520,
    height: 220,
    debug: false
  },

  start() {
    this.samples = [];
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
        this.samples = samples;
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
    const start = now - this.config.historyHours * 60 * 60 * 1000;
    const samples = this.samples
      .filter((s) => s.ts >= start && s.ts <= now)
      .sort((a, b) => a.ts - b.ts);

    if (!samples.length) return;

    const minVal = Math.min(...samples.map((s) => Math.min(s.temp, s.feels)));
    const maxVal = Math.max(...samples.map((s) => Math.max(s.temp, s.feels)));
    let minY = minVal;
    let maxY = maxVal;
    if (Math.abs(maxY - minY) < 1) {
      minY -= 1;
      maxY += 1;
    } else {
      minY -= 1;
      maxY += 1;
    }

    const pad = 10;
    const w = canvas.width;
    const h = canvas.height;
    const xFor = (ts) => pad + ((ts - start) / (now - start)) * (w - pad * 2);
    const yFor = (val) => pad + (1 - (val - minY) / (maxY - minY)) * (h - pad * 2);

    ctx.clearRect(0, 0, w, h);

    // Vertical 24h markers
    ctx.strokeStyle = "rgba(200,200,200,0.35)";
    ctx.lineWidth = 1;
    [24, 48, 72].forEach((hours) => {
      const ts = now - hours * 60 * 60 * 1000;
      if (ts < start) return;
      const x = xFor(ts);
      ctx.beginPath();
      ctx.moveTo(x, pad);
      ctx.lineTo(x, h - pad);
      ctx.stroke();
    });

    // Horizontal lines for current values
    const latest = samples[samples.length - 1];
    if (latest) {
      ctx.strokeStyle = "rgba(200,200,200,0.35)";
      ctx.lineWidth = 1;
      const yTemp = yFor(latest.temp);
      const yFeels = yFor(latest.feels);
      ctx.beginPath();
      ctx.moveTo(pad, yTemp);
      ctx.lineTo(w - pad, yTemp);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pad, yFeels);
      ctx.lineTo(w - pad, yFeels);
      ctx.stroke();
    }

    // Temp line (white)
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    samples.forEach((s, idx) => {
      const x = xFor(s.ts);
      const y = yFor(s.temp);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Feels-like line (yellow)
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 2;
    ctx.beginPath();
    samples.forEach((s, idx) => {
      const x = xFor(s.ts);
      const y = yFor(s.feels);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
});

