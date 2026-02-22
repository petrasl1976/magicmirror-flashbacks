# Backend changelog

2026-02-15T00:00:00Z init
2026-02-16T18:05:00Z vvt aggregate stop_ids for stopName+stopId
2026-02-16T18:20:00Z vvt support comma-separated stopId list
2026-02-16T18:30:00Z vvt fallback to stopName when stopId list empty
2026-02-16T18:40:00Z vvt allow calendar_dates to override inactive days
2026-02-16T18:55:00Z vvt honor calendar_dates even without calendar entry
2026-02-16T20:05:00Z weather bootstrap from Open-Meteo hourly history
2026-02-16T20:20:00Z weather bootstrap fallback to archive API
2026-02-16T20:30:00Z weather bootstrap prefer archive for >3 days
2026-02-16T20:45:00Z weather bootstrap if span < historyHours
2026-02-16T21:00:00Z weather bootstrap logs and force 7-day past_days
2026-02-16T21:10:00Z weather: remove bootstrap code, keep rolling history only
2026-02-16T21:20:00Z weather trends include current temp/feels
2026-02-21T16:25:00Z weather trends: add history/forecast cache from open-meteo
2026-02-21T16:40:00Z weather trends: set 15-min fetch intervals
2026-02-22T22:35:00Z flashbacks state: include library cache stats

