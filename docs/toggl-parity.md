# Toggl Track replacement scope

## Product goal

Hourlark replaces the company's paid Toggl Track subscription for fewer than 30
people. It remains deployed entirely on Cloudflare. Success means the team can
perform its Toggl workflows with familiar UI and reliable historical/report data,
while reducing subscription and infrastructure expense.

Close UI and feature parity is an explicit requirement. Match screen structure,
control placement, terminology, editing behavior, keyboard interactions, and
report/export semantics against the company's actual Toggl Track experience.
Keep the Hourlark name. The existing custom dark/green styling is not evidence of
visual parity; use actual Toggl reference screens for visual acceptance.

The company confirmed **Toggl Track Starter at $12 per user per month**, with
**Calendar and Members** as additional features the team uses, without assigning
them implementation priority. Calendar means the **time-entry
calendar only**, confirmed by the company. The exact paid seat count and reliance
on other clients/integrations remain unconfirmed. The target remains close UI and
feature parity across the company's Toggl workflows. Do not silently omit a workflow because it is
inconvenient to implement.

## Confirmed additional workflows

### Calendar

Start with the existing time-entry calendar: create an entry by click/drag, edit
details, move/resize entries, navigate dates, and show daily totals and project
colors. Compare these directly with the company's Toggl screen and interactions.

The current implementation has day/week modes. Toggl also documents a five-day
mode, zoom controls, visible-hour settings, a date picker, and the `T` shortcut.
These controls, matching entry popovers/actions, and visual detail need parity
work. Preserve entry permissions, locks, conflict rollback, and timezone accuracy.
See [Toggl Calendar documentation](https://support.toggl.com/en-us/article/tracking-time-in-the-calendar-view-1fftm9r/).

Connected Google/Outlook events are outside the confirmed replacement scope.
The calendar acceptance criteria cover time-entry workflows.

### Members

Start with directory/search, adding members, roles, project access, and
deactivation/reactivation while preserving history. The current UI provides a
member table and edit form, but provisions emails rather than sending invitations.
Verify which Toggl invitation/status, rate, filtering, and team-group behaviors
the company uses before declaring parity. Match the actual screen and visible
actions for each role. The concurrent-update and last-admin fixes are implemented
locally; their guard migration must be applied before serving the updated API.

## Initial feature inventory

This inventory reflects local source inspection on 2026-10-04. Present means code
exists, not that Toggl parity or production acceptance has been demonstrated.

| Area                       | Hourlark today                                                                                                                                      | Parity work or decision                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Running timer              | Start/stop, persisted timestamps, recent descriptions, project/tag/billable selection; running description/project/tags/billable now PATCH in place | Duration popover (start/stop/date) and manual mode are still outstanding. Do not treat this slice as full timer parity.                                                                           |
| Timer descriptions         | `@` project and `#` tag picker                                                                                                                      | Verify autocomplete selection preserves project, tags, and billable state; validate keyboard interactions against Toggl.                                                                          |
| List view                  | Day groups, daily totals, inline editor, continue, duplicate, delete, restore                                                                       | Same-day session grouping, bulk delete and Undo are implemented. Bulk metadata edits, split, and favorites remain open.                                                                           |
| Calendar                   | Day/week display, create, drag/resize, open entries                                                                                                 | Compare event layout, controls, overlap handling, and edits visually and behaviorally. External calendars are not integrated.                                                                     |
| Timesheet                  | Weekly project/description rows and create-empty-cell flow                                                                                          | Filled cells open the entry editor; aggregated cells offer an entry chooser. Copy last week remains open.                                                                                         |
| Clients/projects/tags/team | CRUD/archive, assignment, roles, rates, budget field, weekly targets                                                                                | No task/sub-project model, automated estimate alerts, or email invitation flow. Compare permissions and project dashboards.                                                                       |
| Reports and exports        | Summary/detail filters, grouping, financial totals, CSV/PDF                                                                                         | The 5,000-entry ceiling now rejects oversized reports explicitly. Compare presets, grouped totals, filters, rounding, timezone boundaries, and export columns. No saved/scheduled reports.        |
| Historical rates and locks | Per-entry rate snapshots and age-based entry lock with audited admin override                                                                       | These are not proof of Toggl's effective-dated rates or calendar-date timesheet locking parity. Validate required company behavior. No timesheet approval workflow.                               |
| Migration                  | No Toggl importer found                                                                                                                             | Add a previewable, repeat-safe import with original source IDs, member/project/client/tag mapping, timezone handling, and reconciliation.                                                         |
| Other clients/integrations | Browser app                                                                                                                                         | Native apps, extension timer, offline sync, idle detection, calendar providers, and Jira/Salesforce integration were not found. Confirm use before establishing the replacement acceptance scope. |

Source anchors: `src/web/features/timer/global-timer.tsx`,
`src/web/routes/time.tsx`, `src/web/routes/calendar.tsx`,
`src/web/features/timer/timesheet-view.tsx`, `src/web/routes/reports.tsx`,
`src/worker/routes/api.ts`, `src/worker/schemas.ts`, and
`migrations/0001_initial.sql`.

## First timer/list slice (not full parity)

This slice aligns the desktop Timer chrome and running-entry metadata with the
company's Toggl Track screens. See the [live comparison notes](design/toggl-live-comparison.md)
for observed report, calendar, list-action, and timesheet gaps. It is a first visual/behavioral cut, not a claim
that Hourlark now matches Toggl.

Implemented:

- Full-width dark timer/list layout: 226px sidebar (47px Hourlark rail + 179px
  navigation), main `#212121`, borders `#3b3b3b`, pink accent `#cd7fc2`. Content
  is no longer centered in an 1800px column.
- 84px running/idle header with in-place description, project, tags, and
  billable controls. Play is 42px pink; no decorative manual-mode button.
- One-row toolbar on wide desktop screens with a shared 322×36 date control, compact Today/Week totals,
  text-only Calendar / List view / Timesheet segments, and a compact admin
  member selector that does not replace those controls.
- Compact 50px day headers (`Today` or `Thu, 30 Jul`) and entry rows with
  muted comma-separated tags, hover continue/more actions, and a working
  **View full history in reports** link. The workspace stripe is removed from
  the timer page only.
- Running description saves on blur or Enter; Escape restores the latest server
  value; polling does not clobber a local draft. Stop waits for a pending
  description or metadata save and stays put when that save fails. Edits typed
  during a save are persisted before stopping. A rejected description requires
  Retry or Cancel; pressing Stop does not silently overwrite a conflict. Drafts
  and late responses do not carry over to a replacement timer from another tab.
- Running project, tags, and billable persist through `PATCH /time-entries/:id`
  with the current `version` and only the changed metadata. Timestamps and rate
  fields are not sent. A project change does not reset running billable/rate.
  A null running project is not replaced by a stale idle project selection.
  Archived project/tag labels stay available on the running timer.
- Success updates the timer/list/calendar query cache, then invalidates timer,
  list, calendar, reports, and recent queries and broadcasts. A 409 refreshes
  authoritative state, shows an error, and keeps the rejected draft for
  explicit Retry/Cancel. It does not silently retry against the new version.

Still outstanding (do not treat as done):

- Duration editor / start-stop-date calendar popover on the running timer.
- Manual mode.
- Bulk metadata edits, split, and favorites.
- Timesheet Copy last week and further comparison with Toggl.
- Calendar control/visual parity (five-day mode, zoom, `T` shortcut, popovers).
- Members invitation flow and remaining team-group behaviors.
- Saved/scheduled reports and remaining grouping/rounding comparisons after
  the existing 5,000-entry ceiling guard. Common presets are implemented below.
- Toggl importer and other clients/integrations.

Keep Hourlark branding and existing permissions. Calendar and Members remain
confirmed workflows without an assigned implementation priority.

## Timer/list and report workflow pass

The selected project shows its colored name and client in idle and running
states. Project search includes client names, selected state and empty results.
Entry project/tag/time controls open the corresponding editor directly; Escape
closes nested pickers before the editor and restores trigger focus.

List dates now have presets, a calendar range and working period navigation.
All dates includes historical entries instead of the former 60-day window;
capped results show a warning. Changing member or range clears stale selections
and editors. Empty periods offer a reset to All dates.

Reports now has compact Summary/Detailed navigation and filters, a metrics strip,
daily duration chart, project distribution and grouping controls. Its shared date
picker displays inclusive local dates and requests the next local midnight as
the exclusive API end, including DST transitions. The global timer stays mounted
but hidden on Reports so navigation preserves the idle draft. These changes are
implemented locally; the remaining workflows above still need work and company
acceptance. See the [live comparison notes](design/toggl-live-comparison.md).

Official Toggl references reviewed:

- [Creating a time entry](https://support.toggl.com/en-us/article/creating-a-time-entry-wg8nug/)
  documents creation methods, running-field edits, description commands, and
  keyboard behavior.
- [List view](https://support.toggl.com/en-us/article/tracking-time-in-list-view-1pt3xo2/)
  documents editable fields, bulk actions, grouping, split, and favorites.
- [Track payment plans](https://support.toggl.com/en-us/article/payment-plans-at-toggl-track-1ghiwye/)
  distinguishes paid features.
- [Premium differences](https://support.toggl.com/en-us/article/what-are-the-differences-between-starter-and-premium-bfvx8y/)
  describes approvals, reminders, required fields, and other Premium workflows.

Toggl's current marketing site and Track-specific help articles describe different
product bundles and rates. The company's account and invoice define the baseline,
not whichever public page gives the largest savings number.

## Existing-feature repair audit

The [workflow audit](design/feature-workflow-audit.md) records the subsequent
editor, calendar, timesheet, bulk-action, management, and export repairs, with
manual and automated evidence distinguished. These are local changes. Remaining
Toggl features are listed explicitly; the audit is not full replacement acceptance.

## Delivery and switch criteria

1. Use the confirmed Starter plan, price, and Calendar/Members usage to record
   the remaining daily/weekly/monthly workflows. Capture reference
   screens from the company's Toggl account using representative, non-sensitive
   data. Establish a feature matrix with explicit acceptance criteria and known
   differences.
2. The financial-report completeness, concurrent member-update, and browser-state
   isolation fixes from [the architecture review](cloudflare-review.md) are
   implemented locally. Apply the guard migration before serving the updated API.
   Keep report integrity a release requirement alongside UI parity.
3. Complete timer/list/calendar/timesheet interactions, then management/report
   flows. Verify layout and interaction side by side at matching viewport sizes,
   themes, and sample datasets. A passing browser test is not visual acceptance.
4. Rehearse import in an isolated database. Retain the original export; compare
   entry counts, raw seconds, rounded billable totals, currencies, and totals by
   member/project/client and reporting period. Include cross-midnight entries,
   daylight-saving boundaries, archived projects, and historical rates. Hourlark's
   current overlap-and-clipping report rules must be checked against Toggl rather
   than assumed equivalent.
5. Run a representative pilot through a reporting/billing cycle, recording
   mismatches, lost/duplicate entries, user friction, latency, and Cloudflare
   usage. Demonstrate backup/restore and a rollback to Toggl data before switching.
6. Cancel Toggl only after agreed workflow parity, reconciliation, operational
   recovery, and team acceptance. Confirm subscription renewal/cancellation terms
   against the actual account.

## Cost and resume evidence

Under 30 users is within the currently advertised 50-user Cloudflare Access Free
limit. A modest Worker/D1 deployment can start around $5/month on Workers Paid;
verify shared account allowances and actual usage. See the cost assumptions and
primary pricing links in [the Cloudflare review](cloudflare-review.md).

Use the confirmed $12/user/month rate and the actual number of paid seats for the
baseline. With an assumed $5/month Cloudflare bill, projected monthly savings are
`12 × paid seats − 5`; projected annual savings are twelve times that amount.

| Illustrative paid seats | Toggl monthly cost | Projected monthly savings | Projected annual savings |
| ----------------------- | ------------------ | ------------------------- | ------------------------ |
| 20                      | $240               | $235                      | $2,820                   |
| 25                      | $300               | $295                      | $3,540                   |
| 29                      | $348               | $343                      | $4,116                   |

These are scenarios, not the confirmed headcount or a measured outcome. They
exclude development, support, migration, domains, and taxes. Savings start after
Toggl billing ends, and actual Cloudflare usage must be measured.

Track these from deployment:

- Actual active users and adoption period.
- Previous Toggl subscription cost, actual Cloudflare bill, and realized savings
  after cancellation, separate from projected annual savings.
- Imported record count and reconciled totals.
- API p95 latency, error rate, and backup/restore evidence.
- Monthly maintenance/support hours, so infrastructure savings are not confused
  with total ownership cost.

Only after the results exist, use a resume statement such as:
"Built and deployed a Cloudflare Workers/D1 time-tracking platform used by [N]
employees, migrated [M] records, and reduced annual software/platform spend by
[$X / Y%]." Fill every number from evidence; do not report this example as an
achieved saving.
