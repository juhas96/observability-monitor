# Plan: PostHog provider + next observability platform features

## Context

The four observability features from the prior plan are **verified complete and correct**: `npm run type-check` and `npm run lint` both pass (exit 0); history persistence (`history-store.ts`, recorded in `poller.ts` after `buildSnapshot()`), triage/silence wired into `notifier.ts`, three routed views (`/insights`, `/incidents`, `/timeline`), `recharts` charts using semantic color vars, and correct SLO/error-budget math are all in place with no placeholders or TODOs.

This plan adds a new provider and the next platform capabilities the user selected:
- **PostHog provider** — surface error-tracking issues/exceptions (mirrors the Sentry adapter).
- **Uptime / synthetic checks** — actively probe HTTP endpoints, record up/down + latency.
- **Custom alerting rules** — user threshold rules that fire notifications.
- **Scheduled digests & export** — daily/weekly summaries + CSV/JSON export.
- **Slack / webhook notifications** — forward events to a webhook (shared infra).

This is large; deliver phase by phase. **Slack/webhook dispatch is shared infrastructure** that both alerting rules and digests reuse, so it comes early.

## Phase 1 — PostHog provider (smallest, self-contained)

New `main/services/providers/posthog.ts`, modeled directly on `main/services/providers/sentry.ts`:
- **Fields:** `token` (password/secret, `phx_…` personal API key), `region` (text: `us`/`eu`, maps to base host), `projectId` (text, required). Region → base URL `https://us.posthog.com` or `https://eu.posthog.com` (private endpoints).
- **Auth:** `Authorization: Bearer <token>`.
- **`validate`:** `GET /api/users/@me/` (or `/api/projects/{projectId}/`) → return identity (user/org name).
- **`fetch`:** list unresolved error-tracking issues via `GET /api/projects/{projectId}/error_tracking/issues/` (fallback: HogQL `POST /api/projects/{projectId}/query/` counting recent `$exception` events if that path 404s). Map each to a `MonitorItem` `category: "issue"`, status by resolution/severity, `url` = PostHog issue deep link.
- **`fetchIncidents` / `fetchSignals`:** same shape as Sentry (unresolved → open incident + signal).

Wiring (data-driven — same 4 touch-points as any provider):
- Add `"posthog"` to the `Provider` union in **both** `main/services/types.ts` and `renderer/main/types.ts`.
- Register in `main/services/providers/index.ts`.
- Add icon + label in `renderer/main/components/provider-meta.tsx` (lucide `Bug` or `Activity`, no brand glyph).
- Dialog, filters, poller, history are all data-driven — no further changes.

## Phase 2 — Notification channels + dispatch (shared infra)

Foundation reused by Phases 4 and 5.
- **Store:** `main/services/channels-store.ts` → `channels.json`: `Channel = { id, type: "slack"|"webhook", name, enabled, events: string[] }`. The webhook **URL is sensitive** → store it via the existing `token-store.ts`/safeStorage keyed by `channel:{id}`; keep only non-secret meta in `channels.json` (mirrors how account secrets are split today).
- **Dispatch:** `main/services/dispatch.ts` → `dispatch(event)` POSTs to each enabled channel: Slack incoming webhook payload `{ text }`; generic webhook gets the JSON event. Timeout + error-swallow (never break the poll cycle). No OAuth — a Slack **incoming webhook URL** is just a URL.
- **Hook:** call `dispatch()` from `notifier.ts` alongside native notifications (respecting the same silence/settings gates already there).
- **IPC:** `main/handlers/channels.ts` → `channels:list/save/delete/test`. Register in `main/handlers/index.ts`.
- **UI:** a "Notifications" section (extend the existing settings surface / add to `/accounts` or a new settings view) to add/test channels and pick which events forward.

## Phase 3 — Uptime / synthetic checks (new `/uptime` route)

- **Store:** `main/services/checks-store.ts` → `checks.json`: `HttpCheck = { id, name, url, method, expectedStatus?, timeoutMs?, groupId?, enabled }` (no secret).
- **Runner:** `main/services/checks-runner.ts` → for each enabled check, `fetch` with `AbortController` timeout, measure latency, classify up/down vs `expectedStatus`. Run inside `poller.ts` `runCycle()` (after account batch, before `buildSnapshot()`).
- **Snapshot integration:** add a dedicated `checks: HttpCheckResult[]` array to `AggregateSnapshot` (keeps synthetic checks out of the account-keyed maps). Record each result into history — extend `history-store.ts` with a `check` event type and a **latency series** per check so trends/sparklines work. (Reuse existing series downsampling.)
- **IPC:** `main/handlers/checks.ts` → `checks:list/save/delete/getLatencySeries`. Register it.
- **UI:** `renderer/main/uptime-view.tsx` + route in `router.tsx` + nav item in `root-view.tsx` (`Globe`/`Radio`). List checks with up/down `Status`, latency sparkline (reuse `components/charts.tsx`), uptime %, and an add/edit dialog (reuse `add-account-dialog.tsx` patterns). Types + `hooks/use-checks.ts`.

## Phase 4 — Custom alerting rules (new `/alerts` route or Insights section)

- **Store:** `main/services/rules-store.ts` → `rules.json`: `AlertRule = { id, name, scope: {groupId?|accountId?|provider?|checkId?}, metric: "failureRate"|"latency"|"errorBudgetBurn"|"statusIs", operator, threshold, windowMinutes, enabled, channelIds? }`.
- **Engine:** `main/services/rules-engine.ts` → after `history.record()` in `runCycle()`, evaluate each rule against the latest snapshot + history window; maintain per-rule firing state (pattern mirrors `diff-engine.ts`) so a rule alerts on **transition** into/out of breach, not every cycle. On fire → native notification + `dispatch()` to the rule's channels, and write a `HistoryEvent` (`type: "alert"`) so fired rules appear in `/incidents` and `/timeline`.
- **IPC:** `main/handlers/rules.ts` → `rules:list/save/delete/getState`. Register it.
- **UI:** `renderer/main/alerts-view.tsx` + route + nav item (`BellPlus`), with a rule create/edit dialog and current firing state. Types + `hooks/use-rules.ts`.

## Phase 5 — Scheduled digests & export

- **Digest scheduler:** `main/services/digest-scheduler.ts` → timer (like `poller.ts`) that, at the configured cadence (daily/weekly + hour), builds a summary from `history-store` (incidents, deploys, failure rate, SLO status, worst checks) → native notification + optional `dispatch()`. Extend `MonitorSettings` (`main/services/types.ts` `DEFAULT_SETTINGS`) with `digest: { enabled, cadence, hour }`; start/stop the timer with the poller lifecycle in `main/index.ts` (clean up on `before-quit`).
- **Export:** add `history:export` to `main/handlers/history.ts` → serialize samples/events to CSV or JSON, use `dialog.showSaveDialog` (from `@glaze/core/backend`) + `fs` to write the chosen path. UI: "Export…" button on `/insights` (and/or `/timeline`).
- **UI:** digest cadence controls in the settings/notifications section from Phase 2.

## Critical files

- **New backend:** `providers/posthog.ts`, `channels-store.ts`, `dispatch.ts`, `checks-store.ts`, `checks-runner.ts`, `rules-store.ts`, `rules-engine.ts`, `digest-scheduler.ts`, handlers `channels.ts` / `checks.ts` / `rules.ts`.
- **Edit backend:** `providers/index.ts`, `main/services/types.ts` (Provider union, `AggregateSnapshot.checks`, new event/series types, `MonitorSettings.digest`), `poller.ts` (run checks + rules engine), `notifier.ts` (dispatch), `history-store.ts` (check events + latency series, export helpers), `handlers/index.ts`, `handlers/history.ts` (export), `main/index.ts` (digest lifecycle).
- **New frontend:** `uptime-view.tsx`, `alerts-view.tsx`, `hooks/use-checks.ts`, `use-rules.ts`, `use-channels.ts`, channel/rule/check dialogs.
- **Edit frontend:** `router.tsx`, `root-view.tsx` (nav), `types.ts`, `ipc.ts`, `provider-meta.tsx`, insights/settings views (export button, notification/digest settings).

## Reused patterns (do not re-invent)

- `sentry.ts` as the PostHog adapter template; `DataStore<T>` for all new stores; `token-store.ts`/safeStorage split for the webhook secret.
- `diff-engine.ts` firing-state pattern for the rules engine (transition-based, no duplicate alerts).
- `poller.ts` timer/lifecycle pattern for the digest scheduler; existing series downsampling in `history-store.ts` for check latency.
- `components/charts.tsx` for latency sparklines; `add-account-dialog.tsx` for all new CRUD dialogs; localStorage filter persistence from `dashboard-view.tsx`.
- `@glaze/core/backend` `dialog`/`shell` for save-export (confirm each is exported before use).

## Skills to invoke during implementation

`glaze-external-api` (PostHog, HTTP checks, webhook dispatch), `glaze-backend-performance` (fetch timeouts, latency series IPC payloads), `glaze-data-storage` (new stores + secret split), `glaze-backend-rules` + `glaze-ipc-communication` (handlers/channels), `glaze-app-lifecycle` (scheduler cleanup on quit), `glaze-frontend-rules` + `glaze-component-patterns` + `glaze-icon-usage` (new views/nav/charts).

## Suggested delivery order

Phase 1 (PostHog) → Phase 2 (channels/dispatch) → Phase 3 (uptime checks) → Phase 4 (alerting rules) → Phase 5 (digests/export). Each phase is independently buildable and reviewable.

## Verification

- After each phase: `npm run type-check && npm run lint`, then build for runtime validation.
- **PostHog:** add an account with a real `phx_…` key; confirm `validate` returns identity and issues appear on the dashboard + `/incidents`.
- **Channels:** "Test" button posts to a real Slack/webhook URL; confirm delivery; verify the URL is stored via safeStorage (not plaintext in `channels.json`).
- **Uptime:** add an HTTP check; confirm up/down + latency populate over several poll cycles and the sparkline renders (DOM inspection of the running app).
- **Rules:** create a rule that breaches; confirm a single notification + channel dispatch on transition (not every cycle) and a matching `/incidents` + `/timeline` entry.
- **Digest/export:** trigger a digest; confirm summary notification; export produces a valid CSV/JSON at the chosen path.
