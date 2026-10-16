# Applications tracker

## Board contract

`GET /api/v1/applications` retains the existing response envelope, six `columns`, and flat `applications` list. Archived applications are excluded from the active board. Legacy records remain valid: missing priority is treated as `medium`, missing pin/archive timestamps as `null`, and missing source as an empty string.

Each application may include:

- `priority`: `high`, `medium`, or `low` (defaults to `medium`).
- `pinnedAt`: timestamp or `null`; pinned cards sort newest pin first.
- `archivedAt`: timestamp or `null`.
- `archiveReason`: optional `withdrawn`, `ghosted`, or `no_longer_interested`.
- `source`: optional origin label.
- `lastActivityAt`: timestamp of a user activity used for stale-card detection and sorting.

Stage colors are presentation tokens derived from `status`; they are not stored in the API or database. Columns sort pinned cards first, then priority, nearest follow-up, then activity.

## Ownership and reminders

Every id-based operation resolves the application with both its id and the authenticated user's id. Missing and other-user records both return `404 NOT_FOUND`.

Reminder dates are replaced by canceling the old scheduled job before scheduling the new date. Moving to `offer` or `rejected`, or archiving, cancels the pending reminder and disables it. Archiving is additive through `PATCH /api/v1/applications/{id}/archive`; send `{ "archived": true, "reason": "ghosted" }` or `{ "archived": false }` to restore.

`updatedAt` is also written by worker reminder bookkeeping, so it is not a reliable measure of candidate activity. New user-created/edited/moved/pinned/priority-updated records set `lastActivityAt`. Older records without it use the latest timeline entry, then creation time, as a migration-free fallback.

The inactivity threshold defaults to 7 days and can be overridden in the frontend build with `NEXT_PUBLIC_APPLICATION_STALE_DAYS`.

## Board filters and statistics

`GET /api/v1/applications` preserves the existing `{ total, applications, columns }` response and adds `stats`. Optional filters are combined server-side:

| Parameter          | Values                                           | Behavior                                                                |
| ------------------ | ------------------------------------------------ | ----------------------------------------------------------------------- |
| `q`                | text (100 chars max)                             | Case-insensitive company or role search                                 |
| `stage`            | comma-separated stages                           | Filters to one or more pipeline stages                                  |
| `priority`         | `high`, `medium`, `low`                          | Filters priority                                                        |
| `pinned`           | `true`, `false`                                  | Filters pinned or unpinned cards                                        |
| `followUp`         | `overdue`, `due-soon`                            | Filters scheduled follow-ups                                            |
| `stale`            | `true`                                           | Applied cards without activity for `APPLICATION_STALE_DAYS` (default 7) |
| `appliedSinceDays` | `7`                                              | Applied-stage events from the last week                                 |
| `sort`             | `recommended`, `recent`, `follow-up`, `priority` | Server-side sort order                                                  |

Statistics always describe the full active board, regardless of filters. `appliedThisWeek` uses an Applied timeline event, not `updatedAt`. `responseRate` counts applications reaching Screening, Interviewing, Offer, or Rejected. The board is unpaginated; add pagination if typical per-user active boards warrant it.

## Quick add, reminders, and deletion

Create accepts optional job link, HR phone, company email, location, source, salary bounds, notes, local date/time follow-up, and reminder toggle. Salary bounds are nonnegative USD values or null. The browser converts the selected local date and time into an ISO instant before sending. The custom calendar keeps date selection consistent across browsers; the time input follows browser locale controls.

Deleting requires confirmation in the UI. The API delete is an owned hard delete and cancels any queued reminder. Archive is the reversible alternative and accepts an optional reason.

## Responsive behavior and accessibility

Desktop cards use native drag and drop. Coarse-pointer devices disable HTML drag because browser touch support is inconsistent; the card menu is the primary move control, with 44px targets. Keyboard users can focus a card, press `1`–`6` to move, `P` to pin/unpin, or `Enter` to open details. Drag, menu, and keyboard moves use one live announcement and an optimistic card update. Creating an application inserts a temporary card, then replaces its id with the server result without reloading the board.

## Verification

The MongoDB integration suite is `tests/applications.mongo.integration.test.js`; `mongodb-memory-server` is a development dependency. It verifies ownership 404s, pin/unpin persistence, reminder scheduling and cancellation, old-record defaults, and the compound board index via `explain("executionStats")`. For offline runs, set `MONGOMS_SYSTEM_BINARY` to an installed MongoDB binary.
