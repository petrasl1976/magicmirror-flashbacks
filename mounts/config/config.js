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
    baseUrl: "http://192.168.88.48:8099",
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
    baseUrl: "http://192.168.88.48:8099",
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
    url: "https://calendar.google.com/calendar/ical/51664cc4c639109c4c8c6ff082526a9cd504a7d8c067ec29a2cf2499ce9dbff1%40group.calendar.google.com/private-4a5f0f7fb7f5681193da7459072a8de7/basic.ics",
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

  