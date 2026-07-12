# Weather precipitation + pressure panels

**Date:** 2026-07-12
**Module:** MMM-WeatherTrends (+ MMM-PL-Flashbacks backend)

## Goal

Above the existing temperature/feels-like graph (`bottom_right`), add two more
graphs in the same visual language: precipitation (žydra / cyan) and pressure
(žalia / yellow-green). Fill the black gap between the text forecast (top) and
the temp graph.

## Decisions

- **Precipitation** rendered as vertical **bars** (mm), color `#5ac8fa`.
- **Pressure** rendered as a **line** like temperature, color `#a8c832`
  (yellow-green, harmonizes with the existing geltona `rgb(255,204,0)`).
- New panels use **minimal labels**: current value + min/max only. No per-day
  marker rings (those stay unique to the temp panel).
- Extend the **existing module** — one fetch, one shared time axis. Not new modules.

## Data flow

open-meteo already exposes `precipitation` (mm) and `pressure_msl` (hPa) on all
three endpoints in use (verified 2026-07-12):

- current: `current=...,precipitation,pressure_msl`
- history: `archive .../hourly=temperature_2m,apparent_temperature,precipitation,pressure_msl`
- forecast: `.../minutely_15=temperature_2m,apparent_temperature,precipitation,pressure_msl`

No extra API calls, no endpoint change. Precipitation is mm (probability is not
available historically, so mm is the only whole-timeline-consistent metric).

## Backend (server.js)

- Extend the 3 open-meteo URLs with `precipitation,pressure_msl`.
- Sample shape grows: `{ ts, temp, feels, precip, pressure }`.
  - `precip`/`pressure` parsed as numbers; missing → `null`.
  - temp/feels remain the required fields (a sample is kept if temp+feels
    present, matching current behavior); precip/pressure are best-effort.
- Cached samples (`weather-trends.json`) from before this change lack the new
  fields → read back as `undefined`, treated as null downstream. No migration.
- `/weather/trends` returns the sample objects unchanged — new fields ride along.

## Frontend (MMM-WeatherTrends.js / .css)

- `getDom()` builds one `.wtr-wrap` containing up to 3 stacked canvases,
  top→bottom order configurable (default: pressure, precip, temp).
- Refactor the current `_draw` so the shared pieces (time window, `xFor`,
  interpolation, alpha-fade, line-with-shadow drawing) are reusable helpers.
- **Temp panel:** unchanged behavior (white temp line, yellow feels line,
  per-day rings + labels, guide lines).
- **Pressure panel:** single green line, autoscaled y, alpha fade by distance
  from now, minimal labels (now + min + max).
- **Precip panel:** cyan bars, y = 0..max(precip, small floor), alpha fade,
  minimal labels (now + max). Zero-precip → flat baseline, no clutter.
- All panels share the same `start`/`end` window and `xFor`, so time columns
  line up vertically.

## Config (defaults keep current look, panels on)

```js
showPrecip: true,
showPressure: true,
precipColor: "#5ac8fa",
pressureColor: "#a8c832",
precipHeight: 90,
pressureHeight: 90,
panelOrder: ["pressure", "precip", "temp"]
```

Existing `width`/`height` continue to size the temp panel.

## Verification

- curl open-meteo endpoints confirm fields present (done).
- Lint the two JS files.
- On-device (http://192.168.88.48:8080) visual check by owner — cannot reach
  from dev environment.
- Update CHANGELOG_FRONTEND.md / CHANGELOG_BACKEND.md.

## Out of scope

- Precip probability, wind, humidity panels.
- Any change to the text weather forecast module.
