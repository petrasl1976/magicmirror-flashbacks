const fs = require("fs");
const path = require("path");

const BACKEND_PORT = Number(process.env.BACKEND_PORT);
if (!Number.isFinite(BACKEND_PORT)) {
  throw new Error("BACKEND_PORT is required (set via docker-compose)");
}

const secretsPath = path.join(__dirname, "config.secret.js");
const secrets = fs.existsSync(secretsPath) ? require(secretsPath) : {};
const FAMILY_CALENDAR_URL = secrets.FAMILY_CALENDAR_URL || process.env.FAMILY_CALENDAR_URL;
if (!FAMILY_CALENDAR_URL) {
  throw new Error("FAMILY_CALENDAR_URL is required (set in config.secret.js)");
}

var config = {
  address: "0.0.0.0",
  port: 8080,
  ipWhitelist: [],
  language: "en",
  timeFormat: 24,
  units: "metric",
  modules: [
{
  module: "MMM-Flashbacks",
  position: "fullscreen_below",
  config: {
    backendPort: BACKEND_PORT,
    fadeMs: 500,
    collageOverview: true,
    collageSequence: true,
    collageEnd: true
  }
},
{
  module: "MMM-VVT",
  position: "bottom_left",
  config: {
    backendPort: BACKEND_PORT,
    stopName: "Vaduvos st.",
    stopId: "6850",
    limit: 10,
    refreshSec: 30
  }
},
{
  module: "weather",
  position: "top_right",
  config: {
    weatherProvider: "openmeteo",
    type: "current",
    lat: 54.6872,
    lon: 25.2797,
    location: "Vilnius"
  }
},
{
  module: "weather",
  position: "top_right",
  config: {
    weatherProvider: "openmeteo",
    type: "forecast",
    lat: 54.6872,
    lon: 25.2797,
    location: "Vilnius",
    maxNumberOfDays: 5
  }
},
{
  module: "MMM-WeatherTrends",
  position: "bottom_right",
  config: {
    backendPort: BACKEND_PORT,
    historyHours: 72,
    refreshSec: 600,
    width: 520,
    height: 220
  }
},
{ module: "clock", position: "top_left" },
    {
      module: "calendar",
      position: "top_left",
      header: "Kalendorius",
      config: {
        timeFormat: "absolute",
        maximumEntries: 10,
        maximumNumberOfDays: 30,
        colored: true,
        showLocation: false,
        wrapEvents: true,
calendars: [
  {
    symbol: "calendar",
    url: FAMILY_CALENDAR_URL,
    name: "Family",
    color: "#ffffff"
  },
  {
    symbol: "flag",
    url: "http://localhost:8080/modules/default/calendar/lt-holidays-2026.ics",
    name: "LT šventės",
    color: "#ffcc00"
  }
]
      }
    }
  ]
};

if (typeof module !== "undefined") { module.exports = config; }

  