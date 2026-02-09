/* global Module */

Module.register("MMM-PL-VVT", {
  defaults: {
    baseUrl: "",
    stopName: "Umėdžių st.",
    stopId: "",
    limit: 10,
    refreshSec: 30
  },

  start() {
    this.items = [];
    this.lastError = null;
    this.stopLabel = this.config.stopName;
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
    return ["MMM-PL-VVT.css"];
  },

  getDom() {
    const wrap = document.createElement("div");
    wrap.className = "vvt-wrap";

    const title = document.createElement("div");
    title.className = "vvt-title";
    title.textContent = this.stopLabel || this.config.stopName;
    wrap.appendChild(title);

    if (this.lastError) {
      const err = document.createElement("div");
      err.className = "vvt-error";
      err.textContent = this.lastError;
      wrap.appendChild(err);
      return wrap;
    }

    if (!this.items.length) {
      const empty = document.createElement("div");
      empty.className = "vvt-empty";
      empty.textContent = "No departures";
      wrap.appendChild(empty);
      return wrap;
    }

    this.items.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "vvt-row";
      const strong = idx < 5;
      row.style.opacity = String(strong ? 1 : Math.max(0.75, 1 - idx * 0.03));
      if (strong) row.classList.add("vvt-row-strong");

      const mins = document.createElement("span");
      mins.className = "vvt-mins";
      mins.textContent = item.minutes === 0 ? "now" : `${item.minutes} min`;

      const route = document.createElement("span");
      route.className = "vvt-route";
      route.textContent = item.route || "?";

      const head = document.createElement("span");
      head.className = "vvt-headsign";
      head.textContent = item.headsign || "";

      row.appendChild(mins);
      row.appendChild(route);
      row.appendChild(head);
      wrap.appendChild(row);
    });

    return wrap;
  },

  _fetch() {
    const stopId = (this.config.stopId || "").trim();
    const qs = stopId
      ? `stopId=${encodeURIComponent(stopId)}`
      : `stop=${encodeURIComponent(this.config.stopName)}`;
    const baseUrl = this._baseUrl || this._getBaseUrl();
    const url = `${baseUrl}/vvt/next?${qs}&limit=${this.config.limit}`;
    fetch(url, { cache: "no-store" })
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .then((data) => {
        this.items = (data && data.items) ? data.items : [];
        this.stopLabel = (data && data.stopName) ? data.stopName : this.config.stopName;
        this.lastError = null;
        this.updateDom(0);
      })
      .catch(() => {
        this.lastError = "No data";
        this.items = [];
        this.updateDom(0);
      });
  }
});

