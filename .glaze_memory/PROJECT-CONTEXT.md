# Project Context

## Overview

- **App Name:** Multi Monitor
- **Purpose:** Menu bar + dashboard app that monitors CI/CD + ops activity across MANY accounts of MANY providers at once, via a pluggable provider registry.
- **Providers (12 in domain/types; 12 registered in this worktree):** GitHub (Actions runs), Cloudflare (Pages + Workers deploys), Supabase (latest migration + error-log rollup), Netlify (site deploys), Resend (domain verification + broadcasts), Grafana (configurable alerts + data source health + dashboards + annotations), Heroku (latest release), Sentry (unresolved issues), PagerDuty (incidents), Statuspage (incidents/components), Datadog (monitors), Honeycomb (triggers/SLOs). Each = one encrypted secret + optional non-secret config fields.
- **Features:**
  - Connect multiple accounts per provider; credentials stored encrypted (safeStorage).
  - Dashboard grouped by project group, then account, showing recent items with status, relative time, open-in-browser, and row-level log/detail actions.
  - Apps cockpit (`/apps`) derives first-class service/app health from project groups/accounts, with active incidents, signals, metric summaries, stale-account state, provider coverage, deep links, and a cross-provider incident timeline.
  - Persisted observability history (`history.json`) records rolling poll samples + discrete deploy/failure/recovery/alert/incident events for trends, SLOs, and correlation.
  - Insights (`/insights`) shows success/failure trends, activity volume, alert volume, and local SLO/error-budget cards with create/edit/delete.
  - Incident center (`/incidents`) consolidates live signals/incidents with local acknowledge/silence state and a per-item history timeline.
  - Correlation timeline (`/timeline`) overlays deploys, failures, recoveries, alerts, and incidents across group or provider lanes.
  - Dedicated Grafana incident console for alerts, data source health, saved Loki log presets, and saved Tempo trace presets.
  - Project group + provider + status filters (persisted to localStorage), manual refresh.
  - Background polling with configurable interval; native notifications on failure/success (configurable).
  - Menu bar (tray) icon tinted by aggregate status with a dropdown of recent items + quick actions.
  - Adding a new provider = one backend adapter module + one icon entry in `provider-meta.tsx`.

## Current State

### Key files
- `AGENTS.md` — repo-level architecture/conventions doc for AI coding agents (mirrors this file's non-sensitive parts); keep in sync when architecture/conventions change.
- `README.md` — developer setup guide covering macOS/Node/npm/Glaze/Xcode prerequisites, importing `Observability Monitor.glaze` into the Glaze macOS app, install/run/validation commands, troubleshooting, and runtime data notes.
- `main/index.ts` — app entry; creates main window (1000×700, min 720×480), inits tray + starts poller on ready, `showMainWindow()` helper, stops poller on quit.
- `main/handlers/index.ts` — calls `registerProviders()` first, then registers account/grafana/history/monitor/provider/triage handlers.
- `main/handlers/accounts.ts` — generic, registry-driven `accounts:list/add/update/remove/test` plus `groups:list`; splits creds into secret (token-store) + non-secret (`account.config`) via `definition.fields`; blank non-secret fields clear optional config on edit; `validate()` resolves identity; account add/update can assign an existing project group or create/reuse one by name.
- `main/handlers/grafana.ts` — Grafana incident-console IPC: overview, run saved Loki log preset, run saved Tempo trace preset, update observability config.
- `main/handlers/history.ts` — `history:getSeries/getEvents/listSlos/saveSlo/deleteSlo/getSloStatus` for persisted trend, event, and SLO data.
- `main/handlers/monitor.ts` — `monitor:getSnapshot/refresh/getSettings/updateSettings/getStatus`, `monitor:getItemLogs` (backend-resolved row log fetch by current snapshot `itemUid`), and `monitor:openExternal` (open-in-browser proxy).
- `main/handlers/providers.ts` — `providers:list` → `registry.publicList()` (id/label/scopeHint/fields; no functions).
- `main/handlers/triage.ts` — local triage IPC for `triage:list/acknowledge/silence/clear`.
- `main/services/providers/registry.ts` — `ProviderDefinition` interface + `register/get/has/list/publicList/secretField`; provider fields support text/password plus string-backed boolean defaults for renderer switches; adapters can optionally implement `fetchSignals`, `fetchIncidents`, `fetchMetricsSummary`, `getDeepLinks`, and `fetchLogs(account, creds, item)`.
- `main/services/providers/index.ts` — `registerProviders()` registers all adapters; re-exports registry.
- `main/services/providers/{github,cloudflare,supabase,netlify,resend,grafana,heroku,sentry,pagerduty,statuspage,datadog,honeycomb}.ts` — one adapter each (`fields`, `validate`, `fetch`; many also richer observability hooks and/or `fetchLogs`). github/cloudflare wrap the existing `github-api.ts`/`cloudflare-api.ts` clients.
- `main/services/types.ts` — `Provider` union, generic `Account { …, groupId?, identity?, config? }`, `ProjectGroup`, `MonitorItem { kind:string, category, logAvailable?, logFallbackUrl?, logRef? }`, `MonitorLogResponse`/`MonitorLogLine`, observability signal/incident/service types, history sample/event types, SLO/triage types, `NormalizedStatus` (adds `warning`,`info`), settings.
- `main/services/accounts-store.ts` — accounts.json (no secrets) with `{ accounts, groups }`; `migrate()` shim maps legacy `login`/`accountName`/`cloudflareAccountId`/`repoFilter` → `identity`/`config`; group helpers list/create-or-reuse/validate/prune unused groups.
- `main/services/token-store.ts` (safeStorage → tokens.bin.json base64, one secret per account), `settings-store.ts`.
- `main/services/history-store.ts` — DataStore-backed `history.json` with rolling 14-day samples/events retention, event de-dupe, downsampled series queries, SLO CRUD, and SLO compliance/error-budget computation.
- `main/services/triage-store.ts` — DataStore-backed `triage.json` for local acknowledge/silence state; notifier checks active silence before showing terminal transition notifications.
- `main/services/poller.ts` — non-overlapping loop; `registry.get(provider).fetch(account, creds)` where creds = config + secret, plus optional observability hooks for signals/incidents/metrics/deep links; records history after `buildSnapshot()`, then drives notifications/tray/push.
- `main/services/grafana-observability.ts` — backend-only Grafana token use for incident console: parses/persists `account.config.grafanaObservability`, discovers datasources, checks health, runs Loki `query_range` and Tempo `api/search` through Grafana datasource proxy.
- `main/services/aggregator.ts` — in-memory cache for feed rows plus first-class `services`, `signals`, `incidents`, `metrics`, `deepLinks`, and `staleness`; derives service health from project groups/accounts and applies priority failure>warning>running>queued>success>info>cancelled>unknown. `diff-engine.ts`, `notifier.ts`, `push.ts`, `tray-controller.ts` consume the aggregate snapshot.
- `renderer/main/root-view.tsx` — SplitView + Sidebar nav; `router.tsx` routes (`/`, `/apps`, `/insights`, `/incidents`, `/timeline`, `/grafana`, `/accounts`).
- `renderer/main/dashboard-view.tsx` (project group + provider filters from `groups:list`/`providers:list`), `apps-view.tsx` (cross-provider ops cockpit), `insights-view.tsx` (history trends + SLOs), `incidents-view.tsx` (triage inbox + item timeline), `timeline-view.tsx` (correlation lanes), `grafana-view.tsx` (incident console), `accounts-view.tsx`.
- `renderer/main/components/` — `add-account-dialog.tsx` (data-driven: provider Select + dynamic fields from `providers:list`, boolean fields as switches, project group assignment/create), `provider-meta.tsx` (provider→icon/label + category→icon; ONLY manual per-provider UI), `account-section.tsx`, `run-row.tsx` (icon via `categoryIcon`, row log/open actions), `log-viewer-dialog.tsx` (on-demand logs with search/copy/open fallback), `charts.tsx` (Recharts-backed responsive charts with axes/tooltips/legends), `status-badge.tsx` (warning/info added), `relative-time.ts`.
- `renderer/main/hooks/` — `use-monitor-data.ts`, `use-accounts.ts` (accounts + groups queries/mutations), `use-providers.ts`, `use-history.ts`, `use-slos.ts`, `use-triage.ts`.
- `renderer/main/ipc.ts` / `types.ts` — typed IPC wrappers (+`listProviders`, `listGroups`, enriched `AggregateSnapshot`, `getItemLogs`, Grafana incident-console calls, history/SLO/triage calls) + renderer mirror.
- `renderer/settings/settings-view.tsx` — Theme + Monitoring fieldset; settings window 560×480.

### Components
Uses @glaze/core: `SplitView` (storageKey "cicd-monitor"), `Sidebar*` (route nav), `ScrollArea`, `List`, `Dialog` (add/edit, controlled), `AlertDialog` (remove), `Select`/`Input`/`Switch`/`Field`/`FieldSet`, `Status`, `Badge`, `Callout`, `EmptyState`, `Text`, `Button`. lucide-react icons. Recharts powers Insights trend/SLO charts and the Timeline correlation chart.

### Data & storage
- `userData/accounts.json` — `{ accounts: Account[], groups: ProjectGroup[] }` with account `groupId`, `identity` + `config` (non-secret fields: `accountId`, `repos`, `projectRef`, `baseUrl`, Grafana `show*` toggles + filter strings, `grafanaObservability` JSON string with datasource defaults + saved presets), NO secrets.
- `userData/tokens.bin.json` — `{ version:1, tokens: {accountId: base64(safeStorage-encrypted secret)} }`.
- `userData/settings.json` — MonitorSettings (pollIntervalSeconds default 60/min 30 + notify flags).
- `userData/history.json` — `{ version:1, samples, events, slos }`, rolling 14-day local observability history with no secrets.
- `userData/triage.json` — local acknowledge/silence metadata keyed by normalized signal/incident uid.
- localStorage: `dashboard.groupFilter`, `dashboard.providerFilter`, `dashboard.statusFilter`, `insights.groupFilter`, `insights.providerFilter`. In-memory: enriched aggregator snapshot; diff-engine last-status map.

### IPC channels
- `providers:list` → ProviderInfo[]; `groups:list` → ProjectGroup[]; `accounts:list` → Account[]; `accounts:add/update/test` (payload `{ provider, label?, creds, groupId?, newGroupName? }`, creds = flat map; secrets inbound only); `accounts:remove`.
- `monitor:getSnapshot/refresh/getSettings/updateSettings/getStatus`; snapshot now includes `items`, `services`, `signals`, `incidents`, `metrics`, `deepLinks`, and per-account `staleness`; `monitor:getItemLogs` (accepts only `{ itemUid }`, resolves item/account/token server-side); `monitor:openExternal`.
- `grafana:getOverview`; `grafana:runLogPreset`; `grafana:runTracePreset`; `grafana:updateObservabilityConfig` (all validate Grafana account ownership server-side and keep tokens backend-only).
- `history:getSeries`; `history:getEvents`; `history:listSlos/saveSlo/deleteSlo/getSloStatus`.
- `triage:list`; `triage:acknowledge`; `triage:silence`; `triage:clear`.
- Push (via `ipcMain.broadcast` → renderer `onNotification`): `monitor:snapshot`, `monitor:accountError`, `monitor:pollingState`, `settings:monitor-changed`.

### Integrations (all token/key based, Node 24 global fetch — no new npm deps)
- GitHub REST v2022-11-28; Cloudflare API v4 (Pages + Workers). Supabase Management API (`api.supabase.com`: `/v1/projects`, `/database/migrations`, `/analytics/endpoints/logs.all?sql=` — logs best-effort/feature-detected). Netlify (`api.netlify.com/api/v1` sites+deploys). Resend (`api.resend.com` /domains, /broadcasts, `/logs`, `/logs/:id` feature-detected). Grafana (`{baseUrl}/api/health`, `/api/prometheus/grafana/api/v1/rules`, `/api/datasources`, `/api/datasources/uid/:uid/health`, `/api/search`, `/api/annotations`, `/api/datasources/proxy/uid/:uid/loki/api/v1/query_range`, `/api/datasources/proxy/uid/:uid/api/search`). Heroku (`api.heroku.com` /apps, /releases with `Range: version ..; order=desc,max=3`, `Accept: …version=3`, release `output_stream_url` detail lookup). Current worktree also includes Sentry (`sentry.io/api/0` issues), PagerDuty (`api.pagerduty.com` incidents), Statuspage (`api.statuspage.io/v1` incidents/components), Datadog (`api.<site>` validate/monitors), and Honeycomb (`api.honeycomb.io` auth/triggers/SLOs).
- Row-level log/detail support: GitHub Actions job logs, Cloudflare Pages deployment history logs, Supabase recent Postgres error logs, Heroku release phase output when available, Grafana first saved Loki log preset, and Resend API logs best-effort matching. Netlify and Cloudflare Workers expose provider-page log fallbacks in v1.
- Endpoints for Supabase logs, Resend broadcasts/logs, Grafana observability surfaces, Cloudflare Pages logs, and Heroku release output were built defensively but NOT curl-validated against live credentials — verify with real tokens at runtime.

### Conventions & constraints
- Adding a provider: create `main/services/providers/<id>.ts` implementing `ProviderDefinition`, register it in `providers/index.ts`, add `<id>` to the `Provider` union in both `types.ts` files, and add an icon/label entry in `renderer/main/components/provider-meta.tsx`. Everything else (dialog, filters, poller) is data-driven.
- `MenuItemColor` is NOT exported from `@glaze/core/backend` — mirror the union locally.
- `shell:openExternal` IPC channel is registered by the native runtime — do NOT re-register; app uses `monitor:openExternal`. Backend calls `shell.openExternal()` directly (tray/notifier).
- Tray icon SF Symbol `bolt.horizontal.circle.fill`, tinted by aggregate status. Poller seeds diff-engine silently on first cycle.
- The Live-app evaluate MCP tool errored (GlazeIPCError) during validation; the app's own IPC works fine — validate via DOM snapshot / real runtime instead.

## Recent History

### 2026-07-03 — Add persisted history, insights, triage, SLOs, and timeline
- **Goal:** Implement the plan to turn the app from a live-only monitor into an observability platform foundation with trends, incident triage, SLO/error-budget tracking, and correlation.
- **What was done:** Added DataStore-backed `history.json` for rolling poll samples/events and `triage.json` for local acknowledge/silence state. The poller now records history after each snapshot and before notifications. Added history/SLO/triage IPC and typed renderer hooks. Added `/insights` for success/failure trends, activity volume, alert volume, and SLO CRUD/cards; `/incidents` for consolidated live signals/incidents with acknowledge/silence and item timeline; `/timeline` for deploy/failure/recovery/alert/incident correlation lanes.
- **Key decisions:** Added `recharts` for interactive/responsive charts with axes, legends, and tooltips instead of maintaining custom chart primitives. SLO compliance is computed from persisted success/failure sample counts and scoped by all/group/account/provider. Triage actions are local-only provider-independent metadata; provider-side acknowledgement APIs remain future work.
- **UI elements:** New sidebar routes for Insights, Incidents, and Timeline; range/group/provider filters; SLO dialog; triage detail panel; Recharts timeline scatter chart with time axis, group/provider lanes, deploy reference lines, event tooltips, clickable markers, and event list.
- **Backend elements:** `history-store.ts`, `triage-store.ts`, `history.ts` and `triage.ts` handlers, poller record hook, notifier silence check, and shared history/SLO/triage types.
- **Corrections/Lessons Learned:** `npm run type-check`, `npm run lint`, and `npm run build` pass. Recharts increases the main renderer bundle enough to trigger Vite's chunk-size warning; consider code-splitting Insights later if startup cost matters. History views need real polling cycles after launch before charts/timelines have meaningful data; live-token validation is still provider-dependent.
- **User Frustrations & Important Remarks:** User asked to implement the plan file for the full observability-platform direction.

### 2026-07-03 — Add cross-provider ops cockpit and observability snapshot
- **Goal:** Implement the roadmap for a fuller cross-provider, cross-app observability dashboard using API polling and provider registry extensions.
- **What was done:** Extended the shared snapshot model with first-class services/apps, signals, incidents, metric summaries, provider deep links, and account staleness. Updated the provider interface with optional `fetchSignals`, `fetchIncidents`, `fetchMetricsSummary`, and `getDeepLinks` hooks; the poller now calls them, and the aggregator derives default signals/incidents/deep links from existing feed rows. Added `/apps` with service health tiles, active incidents, signals, metric summaries, stale account warnings, provider coverage, deep links, and a cross-provider incident timeline.
- **Provider expansion:** Added registered adapters for Sentry (unresolved issues), PagerDuty (triggered/acknowledged incidents), Statuspage (unresolved incidents + degraded components), Datadog (non-OK monitors + monitor summary), and Honeycomb (dataset triggers/SLO summaries).
- **Key decisions:** Kept the app as an API-polled ops cockpit, not a raw OTLP telemetry sink; kept one encrypted secret per account, so Datadog uses `api_key:application_key` in the single secret field; raw logs/metrics/traces stay in providers with in-app summaries and deep links.
- **UI elements:** New Apps sidebar route; reusable rows for incidents, signals, metric summaries, and timeline events; existing Dashboard remains the grouped activity feed.
- **Backend elements:** Enriched `AggregateSnapshot`, aggregator service-health derivation from project groups/accounts, staleness detection, optional provider observability hooks, and five new adapters.
- **Corrections/Lessons Learned:** `npm run type-check`, `npm run lint`, and `npm run build` pass. New provider API behavior still needs live-token verification because permissions and account features vary by customer/provider.
- **User Frustrations & Important Remarks:** User asked to implement the full cross-provider observability roadmap; delivered the first broad registry-compatible slice rather than replacing dedicated observability backends.

### 2026-07-03 — Add row-level provider log viewer
- **Goal:** User wanted to directly see logs/details from CI/CD, releases, and provider activity inside the app where possible, with external fallbacks where provider APIs are limited.
- **What was done:** Added `MonitorLogResponse`/`MonitorLogLine` and per-item log metadata (`logAvailable`, `logLabel`, `logFallbackUrl`, `logRef`); added optional provider `fetchLogs`; added `monitor:getItemLogs` that accepts only a current snapshot `itemUid`, resolves the account and encrypted token in the backend, and rejects stale/disabled/unsupported items. Added a dashboard log action and `LogViewerDialog` with on-demand fetch, search, copy, and provider fallback open.
- **Key decisions:** Kept logs on-demand and non-persistent; renderer never passes arbitrary provider object IDs or tokens; `logRef` contains only provider-safe identifiers; Grafana row logs reuse the first saved Loki preset from the existing incident console; Netlify and Cloudflare Workers are fallback-only in v1.
- **UI elements:** New log icon beside each eligible row's browser-open button; log dialog with search input, copy button, open-provider button, loading/error/empty states, and timestamped monospaced output.
- **Backend elements:** GitHub job-log fetch via Actions jobs, Cloudflare Pages deployment history logs, Supabase recent Postgres error logs, Heroku release output stream lookup, Resend API log lookup, and Grafana Loki preset execution through the existing Grafana observability service.
- **Corrections/Lessons Learned:** `npm run type-check`, `npm run lint`, and `npm run build` pass. Type-check also required completing provider metadata for the expanded provider union and loosening an existing Sentry severity helper to accept the partial level object it actually uses.
- **User Frustrations & Important Remarks:** User asked whether direct logs for CI/CD, releases, and each provider are possible; implemented a hybrid in-app/fallback approach.

### 2026-07-03 — Add Grafana incident console for saved logs/traces presets
- **Goal:** User wanted a stronger Grafana observability experience with a dedicated dashboard for logs, traces, and incident triage rather than only normalized summary rows.
- **What was done:** Added a `/grafana` route/sidebar item with Grafana account selector, range selector, overview cards, active alerts, data source health, default Loki/Tempo datasource selectors, saved LogQL preset editor/runner, and saved TraceQL preset editor/runner. Added backend-only Grafana observability service and IPC handlers for overview, running presets, and updating config.
- **Key decisions:** Stored incident-console config as a non-secret JSON string at `account.config.grafanaObservability`; kept all tokens in the backend; used only fixed Grafana/Loki/Tempo endpoints rather than exposing a generic proxy; did not auto-run broad logs/traces queries when no presets exist.
- **UI elements:** New Grafana sidebar route; dense operational sections for defaults, overview, logs, and traces; inline add/edit/delete controls for presets.
- **Backend elements:** `grafana:getOverview`, `grafana:runLogPreset`, `grafana:runTracePreset`, `grafana:updateObservabilityConfig`; datasource discovery via `/api/datasources`; Loki queries via datasource proxy `query_range`; Tempo searches via datasource proxy `api/search`.
- **Corrections/Lessons Learned:** `npm run type-check` and `npm run lint` pass. Live Grafana Loki/Tempo behavior still needs verification with real datasource UIDs and service account permissions.
- **User Frustrations & Important Remarks:** User asked whether Grafana observability could be improved with a dedicated dashboard for logs/traces.

### 2026-07-03 — Expand Grafana into configurable observability surfaces
- **Goal:** User wanted the existing Grafana provider to show more than alerts, with the visible observability data configurable by the user.
- **What was done:** Added string-backed boolean provider fields and renderer switch support; updated account edit handling so blank non-secret fields clear optional config while blank secrets keep the stored token; expanded Grafana to configurable `showAlerts`, `showDataSourceHealth`, `showDashboards`, and `showAnnotations` surfaces plus optional data source UID/dashboard/annotation filters. Added Grafana rows for data source health, dashboard links, and recent annotations, with warning rows for enabled surfaces that fail independently.
- **Key decisions:** Kept configuration per Grafana account inside the existing add/edit account dialog; existing Grafana accounts default to alerts + data source health enabled and dashboards/annotations disabled; no custom PromQL/Loki/Tempo query editor in this version.
- **UI elements:** Boolean provider fields render as switches; new category icons for data sources, dashboards, and annotations.
- **Backend elements:** Grafana adapter calls `/api/datasources`, `/api/datasources/uid/:uid/health`, `/api/search`, and `/api/annotations` in addition to health + alert rules; data source health is capped at 25, dashboards at 10, annotations at 20 over the last 24 hours.
- **Corrections/Lessons Learned:** Type-check and lint both pass via the Glaze CLI; live Grafana behavior still needs verification with real service account permissions.
- **User Frustrations & Important Remarks:** User emphasized that Grafana should become broader observability and that what the user sees must be configurable.

### 2026-07-03 — Revert dev-run resolver experiment and document Glaze import
- **Goal:** User asked to revert the runtime/tooling changes made while trying to run the app, leaving only the README and project group feature changes.
- **What was done:** Restored `glaze.ts` and `tsconfig.json` to the normal SDK path shape, removed the temporary `.glaze-sdk` ignore/symlink behavior, removed the `sonner` dependency added for Vite dev scanning, and adjusted `README.md` to tell developers to copy/import `Observability Monitor.glaze` from the repo root into the Glaze macOS app before running.
- **Key decisions:** Kept project group changes and the README; did not keep the per-user SDK resolver hook because app import via `Observability Monitor.glaze` is the intended setup flow.
- **UI elements:** none.
- **Backend elements:** tooling/docs cleanup only.
- **Corrections/Lessons Learned:** The developer setup should be documented around importing the `.glaze` app file rather than hardcoding per-user SDK resolver behavior.
- **User Frustrations & Important Remarks:** User said they will copy `Observability Monitor.glaze` here before pushing and wants the README to point developers to that import flow.

### 2026-07-03 — Add developer setup README
- **Goal:** Document what a developer needs installed before running the app locally.
- **What was done:** Added `README.md` with prerequisites (macOS, Glaze macOS app, Node 24+, npm 11, Xcode Command Line Tools), instructions to copy/import `Observability Monitor.glaze` into the Glaze app, install/run/validation commands, troubleshooting, runtime data locations, and key repo notes.
- **Key decisions:** Documented the Glaze app import workflow; warned not to install or modify `@glaze/core` as a normal app dependency.
- **UI elements:** none (docs-only change).
- **Backend elements:** none (docs-only change).
- **Corrections/Lessons Learned:** The README now points developers at the intended Glaze project import step before running native dev commands.
- **User Frustrations & Important Remarks:** User asked for developer prerequisites before running the app.
