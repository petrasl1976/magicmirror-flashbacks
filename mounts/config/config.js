const BACKEND_PORT = 8099;
const FAMILY_CALENDAR_URL = "YOUR_CALENDAR_URL_HERE";

var config = {
  address: "0.0.0.0",
  port: 8080,
  ipWhitelist: [],
  language: "lt",
  timeFormat: 24,
  units: "metric",
  modules: [
{
  module: "MMM-PL-Flashbacks",
  position: "fullscreen_below",
  config: {
    backendPort: BACKEND_PORT,
    fadeMs: 2500,
    collageOverview: true,
    collageSequence: true,
    collageEnd: true
  }
},
{
  module: "MMM-PL-VVT",
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
    lat: 54.6401508,
    lon: 25.2059223,
    location: "Vilnius",
    roundTemp: true
  }
},
{
  module: "weather",
  position: "top_right",
  config: {
    weatherProvider: "openmeteo",
    type: "forecast",
    lat: 54.6401508,
    lon: 25.2059223,
    location: "Vilnius",
    maxNumberOfDays: 5,
    roundTemp: true
  }
},
{
  module: "MMM-WeatherTrends",
  position: "bottom_right",
  config: {
    backendPort: BACKEND_PORT,
    historyHours: 168,
    refreshSec: 60,
    width: 700,
    height: 260
  }
},
{ module: "clock", position: "top_left" },
    {
      module: "calendar",
      position: "top_left",
      config: {
        timeFormat: "absolute",
        dateFormat: "MMM D",
        dateEndFormat: "MMM D",
        fullDayEventDateFormat: "MMM D",
        maximumEntries: 6,
        maximumNumberOfDays: 365,
        colored: true,
        displaySymbol: false,
        showLocation: false,
        wrapEvents: true,
calendars: [
  {
    symbol: "calendar",
    url: "https://calendar.google.com/calendar/ical/51664cc4c639109c4c8c6ff082526a9cd504a7d8c067ec29a2cf2499ce9dbff1%40group.calendar.google.com/private-43e82f4f3ae953fd21f197a53c277028/basic.ics",
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

  