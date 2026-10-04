# Existing-feature workflow audit

This audit covers the local Hourlark implementation and its existing user flows.
It does not establish production readiness or complete Toggl Track parity.
Toggl was inspected read-only in the user's open account; no Toggl entries were
created, edited, continued, or deleted during the audit.

Browser mutations used disposable, seeded D1 state under `/tmp/hourlark-e2e-*`.
The ordinary development database and production accounts were not test targets.
Project assignment was checked only after explicit approval for seeded accounts.

## Repairs and evidence

| Workflow                     | Repair or verified behavior                                                                                                                                                                                                 | Evidence                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Timer and list               | Selected project/client label, description commands, running metadata, Continue/Stop, direct field editing, working date ranges, controlled More menus, bulk delete and Undo                                                | Manual timer use; component tests; real-browser persistence and action checks                                                                  |
| Time-entry editor            | Separate date/time controls, seconds in duration, preserved fractional timestamps and historical rates, running entries remain running, visible validation/errors, pending controls, accessible scrolling with fixed footer | Manual saved entry reopened at 09:00:00–09:31:16; component tests; 320/768/1280px browser checks                                               |
| Calendar                     | Local timezone placement independent of browser timezone; full 24-hour grid; day/week navigation; create/edit; drag/resize persistence and rollback; overlap handling; daily totals clipped at local midnight               | Live Toggl editor comparison; manual creation/editing; browser checks with browser timezone different from member timezone; timezone/DST tests |
| Timesheet                    | Editable/removable drafts, strict hours validation, failure recovery, filled-cell editing and a chooser for multiple entries, local-day/week clipping, project billable defaults                                            | Component tests including overnight entries and a 25-hour DST day; browser create/edit/mobile flow                                             |
| Projects and clients         | Required-field and rate validation, loading/error recovery, search, persisted edits, archive/reactivate, member assignment, unchanged archived-client metadata edits                                                        | Manual client/project use and approved assignment; management browser checks; archived-client API tests                                        |
| Tracking archived projects   | New-entry pickers omit projects with archived clients; existing entry labels remain available; stale idle selections cannot be submitted as unavailable projects                                                            | Timesheet and global-timer regression tests; management-to-timesheet browser checks                                                            |
| Members and tags             | Validation, meaningful failures, permissions, Enter submission, pending-save guards, activation/archive recovery, bounded dialogs and table scrolling                                                                       | Management browser checks at 320/768px; permission/failure/pending component tests                                                             |
| Workspace settings and audit | Inline validation, disabled controls during save, PDF defaults from workspace settings, paginated audit history with retry that preserves loaded events                                                                     | Settings/PDF browser persistence check; manual settings/audit inspection; export-default and audit-retry component tests                       |
| Reports and exports          | Inclusive local dates and presets, compatible client/project filters, secondary filters, grouping, Detailed view, CSV/PDF downloads, explicit PDF failure/retry, mobile layout                                              | Manual filtered report matched the saved calendar entry; browser downloads/error/mobile checks; component tests                                |

Automated browser checks operate the rendered controls and verify persisted API
state where relevant. They complement manual visual checks; they are not company
acceptance or a reconciliation of the company's Toggl dataset.

## Verification

- `pnpm validate`: formatting, lint, types, 29 Worker tests, 84 web tests, and
  production build passed.
- Full Chromium suite: 17 workflows passed with retries disabled, using a fresh
  disposable database and a separate artifact directory.
- Manual screenshots verified the editor and grouped rows on desktop and mobile.
  These are local QA artifacts, not a deployed release.
- The production build still reports a bundle-size advisory; performance
  profiling and further splitting are separate work.

## Grouping and Hourlark branding

Matching sessions now collapse into a same-day row with a count button and summed
live duration. The key includes member, exact description, project, billable
status, and sorted tag IDs. Days use the viewer's configured timezone. Different
metadata or dates remain separate. Each session remains a separate database
record with its original timestamps and rate snapshot.

The count expands to individual editors and actions. Aggregate field clicks
expand the group rather than editing every entry implicitly. The group checkbox
selects real entry IDs, including partial-selection feedback; existing bulk
delete and Undo still apply. Continue uses the newest session by start timestamp.

The app brand uses amber (`#f59e0b`) with dark text on filled controls, lighter
amber labels, and neutral charcoal surfaces. Navigation, controls, focus rings,
calendar indicators and report charts use the new palette. Project and tag data
colors remain intact; dark project labels are lightened for readable contrast.

Cursor produced the delegated changes; Codex independently reviewed the diffs,
corrected regression checks and contrast, and ran final validation.

## Remaining replacement work

- Running timer duration/start-stop-date editing and manual timer mode.
- Bulk metadata edits, splitting entries, and favorites.
- Calendar five-day view, zoom, keyboard shortcuts, and closer popover styling.
- Timesheet Copy last week.
- Detailed-report Add entry, saved/scheduled reports, and rounding controls.
- Member invitations and team groups.
- Toggl import and reconciliation of entry counts, raw seconds, rates, currencies,
  rounded billing, and cross-midnight daily allocation. The report API currently
  groups clipped durations by the clipped start day; that is not proof of Toggl
  allocation parity.
- Production deployment, backup/restore evidence, and a company pilot through a
  reporting cycle.

The existing report-completeness guard, concurrent-member-update protection, and
isolated browser database remain required. UI progress does not replace those
data-integrity and migration acceptance checks.
