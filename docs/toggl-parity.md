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

| Area                       | Hourlark today                                                                        | Parity work or decision                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Running timer              | Start/stop, persisted timestamps, recent descriptions, project/tag/billable selection | Running description/project/tag controls are disabled. Match Toggl's editing-while-running behavior and duration/manual input.                                                                    |
| Timer descriptions         | `@` project and `#` tag picker                                                        | Verify autocomplete selection preserves project, tags, and billable state; validate keyboard interactions against Toggl.                                                                          |
| List view                  | Day groups, daily totals, inline editor, continue, duplicate, delete, restore         | Selected checkboxes currently have no bulk action. Add agreed bulk edit/delete, similar-entry grouping, split, and favorites behavior.                                                            |
| Calendar                   | Day/week display, create, drag/resize, open entries                                   | Compare event layout, controls, overlap handling, and edits visually and behaviorally. External calendars are not integrated.                                                                     |
| Timesheet                  | Weekly project/description rows and create-empty-cell flow                            | Existing filled cells are disabled; implement editing and an explicit policy for cells aggregating multiple entries.                                                                              |
| Clients/projects/tags/team | CRUD/archive, assignment, roles, rates, budget field, weekly targets                  | No task/sub-project model, automated estimate alerts, or email invitation flow. Compare permissions and project dashboards.                                                                       |
| Reports and exports        | Summary/detail filters, grouping, financial totals, CSV/PDF                           | Fix the silent 5,000-entry cap first. Compare presets, grouped totals, filters, rounding, timezone boundaries, and export columns. No saved/scheduled reports.                                    |
| Historical rates and locks | Per-entry rate snapshots and age-based entry lock with audited admin override         | These are not proof of Toggl's effective-dated rates or calendar-date timesheet locking parity. Validate required company behavior. No timesheet approval workflow.                               |
| Migration                  | No Toggl importer found                                                               | Add a previewable, repeat-safe import with original source IDs, member/project/client/tag mapping, timezone handling, and reconciliation.                                                         |
| Other clients/integrations | Browser app                                                                           | Native apps, extension timer, offline sync, idle detection, calendar providers, and Jira/Salesforce integration were not found. Confirm use before establishing the replacement acceptance scope. |

Source anchors: `src/web/features/timer/global-timer.tsx`,
`src/web/routes/time.tsx`, `src/web/routes/calendar.tsx`,
`src/web/features/timer/timesheet-view.tsx`, `src/web/routes/reports.tsx`,
`src/worker/routes/api.ts`, `src/worker/schemas.ts`, and
`migrations/0001_initial.sql`.

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
