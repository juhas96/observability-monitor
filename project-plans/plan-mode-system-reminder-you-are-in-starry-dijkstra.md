# Plan: Turn Multi Monitor into a full observability platform

## Context

Multi Monitor today is a strong **monitoring aggregator**: 12 provider adapters, background polling, a normalized dashboard, tray, notifications, and a Grafana console. But every snapshot lives **in-memory only** (`aggregator.ts` uses `Map`s; nothing is persisted across restarts), so the app can only ever answer "what is happening right now." A real observability *platform* answers "what happened over time, why, and are we meeting our targets."

The user selected all four gaps to close:
1. **Metrics dashboards & trends** — charts of success/failure, deploy frequency, alert volume over time.
2. **Unified alert & incident center** — cross-provider triage inbox with acknowledge/silence + per-incident timeline.
3. **SLO & error-budget tracking** — user-defined SLOs with burn-rate charts.
4. **Correlation timeline** — deploys/alerts/incidents/failures overlaid on one timeline.

All four depend on one missing keystone: **a persisted history of poll samples and discrete events.** So the plan is a shared foundation (Phase 0) plus four features that build on it. This is a large, multi-phase effort — intended to be delivered and reviewed phase by phase, not all at once.

## Foundation — Phase 0: History persistence (keystone)

New backend service `main/services/history-store.ts` backed by the existing `DataStore` pattern (`data-store.ts`), file `history.json` in userData. Persists two rolling datasets with retention + downsampling (default keep 14 days; cap samples at ~4000, events at ~2000):

- **Samples** — one row per poll cycle: `{ ts, aggregateStatus, perAccount: {id: {counts by status}}, perService: {id: status}, openIncidentCount, alertCount, failureCount, successCount }`. Feeds trend charts + SLO ratios.
- **Events** — discrete occurrences with `{ id, ts, type: "deploy"|"failure"|"recovery"|"alert"|"incident", provider, accountId, groupId?, title, status, severity, url }`. Feeds the correlation timeline + incident detail.

Recording hook: in `poller.ts` `runCycle()`, immediately after `aggregator.buildSnapshot()` (line ~77), call `history.record(snapshot, transitions)`.
- Derive **failure/recovery** events from the existing `detectTransitions(snapshot.items)` result (reuse `diff-engine.ts` — already computes status changes; no duplicate logic).
- Derive **deploy** events from items with `category` in `deploy`/`release`.
- Derive **alert/incident** events from `snapshot.signals` (kind `alert`) and `snapshot.incidents`.
- De-dupe events by a stable key (`type:accountId:sourceUid:ts-bucket`) so re-polls don't double-write.

New IPC handler `main/handlers/history.ts` registered in `main/index.ts` alongside the others:
- `history:getSeries` → `{ range }` → downsampled sample series (bucketed to the range).
- `history:getEvents` → `{ range, groupId?, provider?, types? }` → filtered events.
- `history:listSlos` / `history:saveSlo` / `history:deleteSlo` → SLO CRUD (see Phase 3).
- `history:getSloStatus` → `{ range }` → computed SLO compliance + budget.

Renderer contract: extend `renderer/main/types.ts` with `HistorySample`, `HistoryEvent`, `SloDefinition`, `SloStatus`; add typed wrappers in `renderer/main/ipc.ts`; add React Query hooks in `renderer/main/hooks/` (`use-history.ts`, `use-slos.ts`) subscribing to the existing `monitor:snapshot` push to invalidate.

Charting: add `recharts` to `.glaze-sources/package.json` (mature, complies with the managed npm min-release-age policy) via `npm install --include=dev`. If the install is blocked, fall back to a small hand-rolled SVG line/bar component in `renderer/main/components/charts/`. All charts must use design-system semantic colors (per `glaze-component-patterns` / `glaze-theming`), not raw palette values.

## Feature 1 — Metrics dashboards & trends (new `/insights` route)

- New `renderer/main/insights-view.tsx` + route in `router.tsx` + nav item in `root-view.tsx` (`NAV_ITEMS`, e.g. `LineChart` icon).
- Time-range selector (reuse the 15m/1h/6h/24h pattern already in `grafana-view.tsx`).
- Charts from `history:getSeries`: success-vs-failure rate over time (stacked area), deploy frequency (bar), alert volume (line), plus per-provider/per-group breakdown cards. Filters mirror the dashboard's group/provider filters (persist to localStorage like `dashboard.*` keys).

## Feature 2 — Unified alert & incident center (new `/incidents` route)

- New `renderer/main/incidents-view.tsx` + route + nav item (`BellRing`/`Siren`).
- Consolidates `snapshot.signals` + `snapshot.incidents` (already in the live snapshot) into one triage list with filters: severity, provider, status, group.
- **Acknowledge / silence**: local state persisted via a new `main/services/triage-store.ts` (`triage.json`: `{ [signalUid]: { acknowledgedAt?, silencedUntil? } }`) exposed through the history handler or a small `triage.ts` handler. Silenced items are also suppressed from notifications (`notifier.ts` consults the store).
- **Incident detail**: side panel showing that incident's `HistoryEvent` timeline (from `history:getEvents` filtered to the account/source), with open-in-browser deep links.

## Feature 3 — SLO & error-budget tracking

- SLO definitions persisted in `history-store.ts` (or sibling `slo-store.ts`): `{ id, name, scope: {groupId?|accountId?|provider?}, target (e.g. 99.0), windowDays }`.
- Compute compliance in the backend from persisted **samples**: success ratio = successCount / (successCount+failureCount) over the window; error budget = `1 - target`; burn rate vs. elapsed budget. Return via `history:getSloStatus`.
- UI: an **SLOs** section on the `/insights` view — per-SLO card with current compliance %, remaining error budget, and a burn-down chart; plus a create/edit dialog (reuse `Dialog`/`Field`/`Select` as in `add-account-dialog.tsx`). Warning badge when budget is at risk.

## Feature 4 — Correlation timeline (new `/timeline` route)

- New `renderer/main/timeline-view.tsx` + route + nav item (`GitCommitHorizontal`/`Activity`).
- Horizontal time axis over the selected range; swimlanes per group (or provider). Renders `HistoryEvent`s as markers: deploys as vertical rules, failures/alerts/incidents as dots colored by severity — so a deploy immediately followed by failures is visually obvious.
- Hover shows event detail; click opens the deep link. Range + filters shared with insights.

## Critical files

- **New backend:** `main/services/history-store.ts`, `main/services/triage-store.ts`, `main/handlers/history.ts` (+ optional `triage.ts`).
- **Edit backend:** `main/services/poller.ts` (record hook), `main/services/notifier.ts` (respect silence), `main/index.ts` (register handler), `main/services/types.ts` (new types).
- **New frontend:** `renderer/main/insights-view.tsx`, `incidents-view.tsx`, `timeline-view.tsx`, `components/charts/*`, `hooks/use-history.ts`, `hooks/use-slos.ts`, `hooks/use-triage.ts`.
- **Edit frontend:** `renderer/main/router.tsx`, `root-view.tsx` (nav), `types.ts`, `ipc.ts`.
- **Config:** `package.json` (add `recharts`).

## Reused patterns (do not re-invent)

- `DataStore<T>` (`data-store.ts`) for all new JSON persistence.
- `detectTransitions` (`diff-engine.ts`) for failure/recovery events — do not write parallel transition logic.
- Existing snapshot push (`push.ts` `monitor:snapshot`) to trigger renderer refetch.
- Range selector + dense card layout from `grafana-view.tsx`; dialog/field patterns from `add-account-dialog.tsx`; localStorage filter persistence from `dashboard-view.tsx`.
- Data-driven provider metadata from `provider-meta.tsx` for icons/labels in every new view.

## Skills to invoke during implementation

`glaze-data-storage` (history/triage/SLO stores), `glaze-backend-rules` + `glaze-ipc-communication` (handler + channels), `glaze-frontend-rules` + `glaze-component-patterns` (new views), `glaze-theming`/`glaze-icon-usage` (chart colors + nav icons).

## Suggested delivery order

Phase 0 (foundation) → Feature 1 (insights/trends) → Feature 2 (incident center) → Feature 3 (SLOs) → Feature 4 (timeline). Each phase is independently buildable and reviewable; history needs to accumulate a few poll cycles before trend/SLO charts show meaningful data.

## Verification

- After each phase: `npm run type-check && npm run lint`, then build for runtime validation.
- Foundation: confirm `history.json` appears in userData and grows across poll cycles; verify events de-dupe (no duplicate rows on repeated polls of unchanged items).
- Insights/SLOs/timeline: with at least one connected account, let polling run several cycles, then confirm charts/timeline populate and range/filter selectors work (DOM inspection of the running app).
- Incident center: acknowledge/silence persists across restart; silenced items produce no notification.
