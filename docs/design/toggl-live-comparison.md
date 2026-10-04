# Live Toggl comparison notes

Captured 2026-10-04 from user-opened Chrome tabs. These are observed differences, not production acceptance. Toggl and Hourlark datasets differ; totals cannot be reconciled from these screens.

## Timer and list

- Toggl: 226px sidebar including 47px product rail, edge-to-edge content, 84px header and 68px toolbar, neutral charcoal with pink controls. Hourlark before: 204px sidebar, green theme, centered 1800px content, 72px header, member selector wraps above views.
- Toggl date control contains three outlined segments, view switch has text-only segments. Project dropdown groups projects by client, uses colored dots and search.
- Toggl groups similar entries (count badge expandable); Hourlark initially had individual entries and selected checkboxes without bulk actions. The repair pass adds same-day session grouping, bulk delete and Undo; bulk metadata edits remain open.
- Duration opens start/stop/date calendar. Manual mode and billable controls were disabled in this account view. Availability here does not define the company Starter feature scope.

## Reports

- Toggl separate Summary/Detailed/Workload/Profitability/My reports navigation, no global timer header on Reports.
- Compact date picker and Member/Client/Project/Tag/Description/Add filter row.
- Date presets include Today, This week, This month, This quarter, This year, Last week, Last month and All shortcuts. Date picker displays inclusive endpoints.
- Total Hours, Billable Hours, Amount, Average Daily Hours in one metrics strip.
- Summary has Duration by day, Project distribution, and Project/member breakdown panels. Detailed has entries and Add entry.
- Rounding toggle, export menu, settings, save/share and invoice actions; some disabled in observed account.
- Hourlark before the report pass had Summary/Detailed only, a large always-visible filter form, separate metrics cards and Time distribution/Grouped summary. Start/end fields explained technical range semantics in user-facing copy.
- The old report dateOnly used toISOString on local dates, shifting displayed dates in positive UTC offsets. The report pass fixes this and tests member-local week boundaries and a 25-hour DST day.
- No totals reconciliation attempted; cross-midnight inclusion and clipping are still unresolved Toggl parity requirements.

## Calendar

- Week/5 days/Day view dropdown.
- Decrease zoom/Increase zoom controls at first time gutter.
- Header displays large date number, weekday, daily duration; today pink circle.
- Full-width week grid, 15-minute labels at current zoom, pink current-time indicator. Current observed week Sep28-Oct4.
- Hourlark before has Day/Week modes only. Calendar controls and event behavior still require implementation/verification.

## Timesheet

- Weekly Project columns, Mon-Sun and Total.
- Add row and Copy last week controls, total row.
- Hourlark initially had filled cells disabled. The repair pass opens single entries directly and offers a chooser for aggregated cells; Copy last week remains open.

## Implemented workflow pass

Cursor implemented the timer/list portion; Codex reviewed and corrected its date-input and responsive behavior, and implemented the report portion. The earlier running metadata save/stop guards remain intact.

- Selected project now shows a colored project dot/name and muted client, matching the supplied `Training • IOMechs` reference. Labels remain available for archived selections; long names have accessible full labels. The selected chip wraps onto its own row on narrow mobile screens.
- Project search matches clients as well as projects, shows the selected project, clears on reopening, and exposes a clear empty result. Escape closes a picker and returns focus.
- Clicking an entry's project, tags, or time opens that field's editor directly. Escape closes the nested picker first; Cancel still discards edits.
- List date selection has presets, an inclusive calendar range, previous/next periods, Today/Week shortcuts, and an empty-period reset. All dates now queries historical entries from the epoch instead of silently restricting results to 60 days. A 5,000-entry result displays an incompleteness warning and links to reports.
- Reports hides the global timer while preserving its idle draft across navigation. Summary/Detailed tabs, compact filters, expandable secondary filters, a metrics strip, Duration by day, Project distribution, and grouping controls follow the observed layout.
- Reports reuses the calendar picker with common presets, inclusive endpoints, and previous/next ranges. Queries convert the member's local dates to the API's exclusive end boundary. Changing a client clears an incompatible project filter.
- At 320px width the selected chip remains visible and Timer/Reports avoid horizontal page overflow.

Still outstanding: running-duration/manual mode, bulk metadata edits, split/favorites, report rounding controls and saved reports, five-day calendar/zoom controls, and Copy last week. Report overlap/clipping and cross-midnight daily allocation still need reconciliation against Toggl. The daily chart currently uses the existing API's clipped-start-day grouping; this is not proof of Toggl daily allocation parity.

Browser tests use a disposable D1 state directory and run serially because they share the seeded test workspace. The everyday development database and Toggl records were not edited during the live comparison.

See the [existing-feature workflow audit](feature-workflow-audit.md) for the subsequent repair pass and its verification evidence. Calendar editing now uses separate date/time fields and h:mm:ss duration. A live Toggl calendar editor was opened read-only for comparison; no Toggl entries were changed.

Hourlark now uses amber branding, preserving neutral charcoal surfaces and user-defined project/tag colors. Same-day matching sessions collapse into a counted row and expand to their individual entries, following the observed Toggl behavior.
