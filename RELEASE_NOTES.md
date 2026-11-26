# Quiet Screen v0.7.1

- Logging an episode from Watchlist starts Watching automatically. Its existing episode progress is adopted into the same viewing, so Start watching no longer sends next-episode suggestions back to episode 1.
- Partial episode logs saved by older versions are reconciled on load. Known season boundaries are required before automatically declaring a viewing complete; unknown dates remain unknown.
- Watching all known released episodes completes the current viewing once, without duplicating episode logs. Explicit Start rewatch begins a separate viewing. Future releases remain unwatched when they appear.
- Movies can save a resume timestamp and notes while Watching. Use MM:SS or HH:MM:SS, or leave the timestamp blank and save notes alone. The position and notes survive backup, Drive sync and app restarts, and remain in viewing history after finishing.
- Includes the v0.7.0 improvements: duplicate handling with Undo, IMDb posters and type filters, bulk-season logging, release tracking and named batch results, quieter menus, and the Google reconnect fix.

Validation: 71 automated model/API/sync tests and seven Windows UI suites, including automatic episode statuses, season ranges, movie resume and notes, duplicate Undo, release results, reconnect recovery, franchise management, all six themes and narrow layouts.

Release dates are supplied by [TVmaze](https://www.tvmaze.com/api), matched by IMDb ID. Finished series are skipped by default in batch checks, with an option to include them. Dates can vary by region or be unknown. IMDb remains the title source.
