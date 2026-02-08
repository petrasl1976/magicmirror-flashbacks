/* global Module */

Module.register("MMM-Flashbacks", {
  DEFAULT_ROTATE_MS: 20 * 1000,
  DEFAULT_OBJECT_FIT: "contain",
  DEFAULT_STREAM_COUNT: 6,
  defaults: {
    baseUrl: "http://127.0.0.1:8099",
    fadeMs: 1200,
    collage: "off", // off | atend | both (legacy)
    collageOverview: true,
    collageSequence: true,
    collageEnd: true,
    loadTimeoutMs: 8000,
    collageLoadTimeoutMs: 20000
  },

  start() {
    this.index = 0;
    this.started = false;
    this.state = null;
    this.lastStateFetch = 0;
    this.history = [];
    this.sequence = [];
    this.lastSetId = null;
    this.collageFailed = false;
    this._loadTimer = null;
    this._loadToken = 0;
    this._tickTimer = null;
    this._refreshTimer = null;
    this._awaitFirstState = true;
  },

  getStyles() {
    return ["MMM-Flashbacks.css"];
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "fb-wrap";
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";

    const img = document.createElement("img");
    img.className = "fb-img";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = this.DEFAULT_OBJECT_FIT;
    img.style.opacity = "0";
    img.style.transition = `opacity ${this.config.fadeMs}ms ease`;

    this.imgEl = img;
    wrapper.appendChild(img);

    const overlay = document.createElement("div");
    overlay.className = "fb-overlay";
    overlay.textContent = "[loading]";
    this.overlayEl = overlay;
    // Mount overlay to body to escape module stacking context
    if (document.body) {
      document.body.appendChild(overlay);
    } else {
      wrapper.appendChild(overlay);
    }

    // no test element

    // start once
    if (!this.started) {
      this.started = true;
      setTimeout(() => {
        this.updateImage();
        this._scheduleNextTick();
      }, 50);
    }

    return wrapper;
  },

  _scheduleNextTick() {
    if (this._tickTimer) clearTimeout(this._tickTimer);
    this._tickTimer = setTimeout(() => {
      this.index = (this.index + 1) % this.sequence.length;
      this.updateImage();
      this._scheduleNextTick();
    }, this._getRotateMs());
  },

  _getRotateMs() {
    const parts = Math.max(1, this.sequence.length || 1);
    const setSec = this.state && Number(this.state.albumExposeSec);
    if (!setSec) return this.DEFAULT_ROTATE_MS;
    const per = Math.floor((setSec * 1000) / parts);
    return Math.max(1000, per);
  },

  _scheduleRefresh(ms) {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      this._restartFromOverview();
    }, Math.max(0, ms + 50));
  },

  _restartFromOverview() {
    this.collageFailed = false;
    this.sequence = this.buildSequence();
    this.index = 0;
    this.updateImage();
    this._scheduleNextTick();
  },

  buildSequence() {
    const streamCount = this.state && Number(this.state.streamCount)
      ? Number(this.state.streamCount)
      : this.DEFAULT_STREAM_COUNT;
    const items = [];

    const legacy = this.config.collage || "off";
    const showOverview = this.config.collageOverview ?? (legacy === "both");
    const showSequence = this.config.collageSequence ?? (legacy !== "off");
    const showEnd = this.config.collageEnd ?? (legacy === "both" || legacy === "atend");

    if (showSequence) {
      for (let i = 0; i < streamCount; i++) {
        items.push({ type: "stream", streamId: i });
      }
    }

    if (this.collageFailed) {
      return items.length ? items : [{ type: "stream", streamId: 0 }];
    }

    const out = [];
    if (showOverview) out.push({ type: "collageOverview" });
    out.push(...items);
    if (showEnd) out.push({ type: "collageEnd" });
    return out.length ? out : [{ type: "stream", streamId: 0 }];
  },

  _handleLoadError(current) {
    if (current.type === "collageOverview" || current.type === "collageEnd") {
      this.collageFailed = true;
      this.sequence = this.buildSequence();
      this.index = 0;
    } else {
      this.index = (this.index + 1) % this.sequence.length;
    }
    this.updateImage();
  },

  refreshState(force = false) {
    const now = Date.now();
    if (!force && now - this.lastStateFetch < 5000) return;
    this.lastStateFetch = now;

    const url = `${this.config.baseUrl}/state?t=${now}`;
    fetch(url, { cache: "no-store" })
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .then((data) => {
        this.state = data;
        if (data && data.generatedAt && data.generatedAt !== this.lastSetId) {
          this.lastSetId = data.generatedAt;
          this._restartFromOverview();
        }
        if (!this.sequence.length) this.sequence = this.buildSequence();
        if (this._awaitFirstState) {
          this._awaitFirstState = false;
          this._restartFromOverview();
          return;
        }
        if (data && data.refreshInMs !== null && data.refreshInMs !== undefined) {
          this._scheduleRefresh(data.refreshInMs);
        }

        const current = this.sequence[this.index] || { type: "stream", streamId: 0 };
        const pathFromState = this._labelFor(current, data, "");
        if (this.overlayEl && pathFromState) {
          const prev = this.history[0] || "";
          const older = this.history[1] || "";
          this.overlayEl.innerHTML = this._formatOverlayHtml(pathFromState, prev, older);
        }
      })
      .catch(() => {
        // ignore state fetch errors (image will still load)
      });
  },

  _escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },

  _formatCurrentPath(pathText) {
    const raw = String(pathText || "");
    const parts = raw.split("/");
    if (!parts.length) return this._escapeHtml(raw);
    const year = this._escapeHtml(parts[0]);
    const rest = this._escapeHtml(parts.slice(1).join("/"));
    if (!rest) return `<span class="fb-year">${year}</span>`;
    return `<span class="fb-year">${year}</span>/${rest}`;
  },

  _formatOverlayHtml(currentPath, prevPath, olderPath) {
    if (!currentPath) return "";
    const lines = [];
    lines.push(`<div class="fb-line fb-line-current">${this._formatCurrentPath(currentPath)}</div>`);
    if (prevPath) lines.push(`<div class="fb-line fb-line-prev">${this._escapeHtml(prevPath)}</div>`);
    if (olderPath) lines.push(`<div class="fb-line fb-line-older">${this._escapeHtml(olderPath)}</div>`);
    return lines.join("");
  },

  _overviewLabel(baseLabel, data) {
    const count = data && Number(data.filesCount);
    if (!count || !baseLabel) return baseLabel || "COLLAGE OVERVIEW";
    return `${baseLabel}/overview_of_${count}`;
  },

  _labelFor(current, data, fallback) {
    const label = (data && data.picked)
      ? `${data.picked.year}/${data.picked.event}`
      : "";
    if (current.type === "stream") {
      const base = data && data.windowRel ? data.windowRel[current.streamId] : "";
      const rotated = data && data.rotateFlags ? data.rotateFlags[current.streamId] : false;
      return rotated ? `${base} [R]` : base;
    }
    if (current.type === "collageOverview") {
      return this._overviewLabel(label, data);
    }
    if (current.type === "collageEnd") {
      return label ? `${label}/glimpse` : "COLLAGE";
    }
    return fallback || "";
  },

  updateImage() {
    if (!this.imgEl) return;
    if (this._awaitFirstState) {
      this.refreshState(true);
      return;
    }
    this.refreshState();
    if (!this.sequence.length) this.sequence = this.buildSequence();

    const current = this.sequence[this.index] || { type: "stream", streamId: 0 };
    const url = current.type === "collageOverview"
      ? `${this.config.baseUrl}/collage/overview?t=${Date.now()}`
      : current.type === "collageEnd"
        ? `${this.config.baseUrl}/collage/sequence?t=${Date.now()}`
        : `${this.config.baseUrl}/image/${current.streamId}?t=${Date.now()}`;

    // fade-out
    this.imgEl.style.opacity = "0";

    this._loadToken += 1;
    const token = this._loadToken;
    if (this._loadTimer) clearTimeout(this._loadTimer);
    const timeoutMs = (current.type === "collageOverview" || current.type === "collageEnd")
      ? this.config.collageLoadTimeoutMs
      : this.config.loadTimeoutMs;
    this._loadTimer = setTimeout(() => {
      if (token !== this._loadToken) return;
      this._handleLoadError(current);
    }, timeoutMs);

    // UŽDĖK handlerius PRIEŠ src (fix)
    this.imgEl.onload = () => {
      if (this._loadTimer) clearTimeout(this._loadTimer);
      this.imgEl.style.opacity = "1";
      const pathFromState = this._labelFor(current, this.state, "COLLAGE");
      const prev = this.history[0] || "";
      const older = this.history[1] || "";
      const pathToShow = this._formatOverlayHtml(pathFromState, prev, older) || "[path unavailable]";
      if (this.overlayEl) this.overlayEl.innerHTML = pathToShow;
      if (current.type === "stream" && pathFromState && pathFromState !== this.history[0]) {
        this.history.unshift(pathFromState);
        this.history = this.history.slice(0, 2);
      }
    };

    this.imgEl.onerror = () => {
      if (this._loadTimer) clearTimeout(this._loadTimer);
      this._handleLoadError(current);
    };

    setTimeout(() => {
      this.imgEl.src = url;
    }, Math.min(200, this.config.fadeMs));
  },
});

