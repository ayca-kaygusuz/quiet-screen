# Quiet Screen v0.7.0

- Adding an existing IMDb title updates the existing entry instead of creating a duplicate. Undo stays visible while background metadata is refreshed. Previously watched titles offer an explicit Start rewatch action; viewing history and custom lists are preserved.
- Filter the library by title type using the format supplied by IMDb. IMDb posters appear in library rows and search suggestions, with a title placeholder if an image is unavailable. Existing entries fetch missing images in the background. Refresh IMDb details from the title actions menu to retry.
- Log a season or a range of seasons in one action. Dates are optional; existing episode logs and the current viewing are preserved. Future-dated episodes are excluded, while manual logging can include episodes whose release date is unknown.
- IMDb remains the title source. TVmaze supplies supplemental streaming and broadcast episode release dates, matched by IMDb ID. Episode suggestions use released episodes when a schedule is available. Upcoming episodes and unknown dates are kept separate.
- Completed series viewings keep their recorded episode coverage. Discovering a later season no longer marks it watched automatically.
- Library tools includes Check series for new releases. Finished series are skipped by default, with an option to include them. A first check is needed to learn a series' finished status. Movies and other standalone formats are excluded. Results name each affected series and its unwatched released episodes; open a result directly or use the New episodes filter.
- Release information refreshes daily while the app is open; manual checks are also available. Provider responses may be cached for up to six hours. Known finished series are excluded from routine schedule refreshes. Dates may differ by region, and missing schedules fall back to IMDb episode listings.
- Secondary library, title, and episode actions are tucked into menus. Watch-status navigation is more compact. All six themes support the same controls.
- Fixed Google reconnect getting stuck after successful authorization of the same account. Reconnecting clears the stale sign-in requirement and resumes eligible automatic sync without replacing the current library.

Validation: 64 automated model/API/sync tests, plus Windows UI checks for duplicates and Undo, bulk seasons, release checks, type filters, reconnect recovery, franchise management, poster fallback, and all six themes at desktop and narrow widths.

Release information: [TVmaze](https://www.tvmaze.com/api), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
