# Project Context

## Overview

- **App Name:** Multi Monitor
- **Purpose:** Menu bar + dashboard app that monitors CI/CD + ops activity across MANY accounts of MANY providers at once, via a pluggable provider registry.
- **Providers (14 in domain/types; 14 registered in this worktree):** GitHub (Actions runs), Cloudflare (Pages + Workers deploys), Supabase (latest migration + error-log rollup), Netlify (site deploys), Resend (domain verification + broadcasts), Grafana (configurable alerts + data source health + dashboards + annotations), Heroku (latest release), Sentry (unresolved issues), PagerDuty (incidents), Statuspage (incidents/components), Datadog (monitors), Honeycomb (triggers/SLOs), PostHog (error-tracking issues/exceptions), Better Stack (Telemetry SQL/logs). Each = one encrypted secret + optional non-secret config fields.
- **Features:**
  - Connect multiple accounts per provider; credentials stored encrypted (safeStorage).
  - Command Center (`/`) is the first screen, summarizing real current snapshot state, active incidents, firing alert rules, at-risk SLOs, down uptime checks, stale/erroring accounts, active notification suppression from global snooze/maintenance windows/per-rule snoozes, retained 24h activity, and suggested next actions, with full issue/activity totals, capped row previews including row-level alert-rule and SLO risk evidence, and scoped direct handoffs into exact Accounts, Incidents, Uptime checks, Alert Rules, Insights/SLO risk, Settings suppression controls, Custom Dashboards, Timeline activity context, and detailed Dashboard item log/detail context.
  - Detailed Dashboard (`/dashboard`) groups by project group, then account, showing recent items with status, relative time, open-in-browser, filtered CSV export, row-level log/detail, start-investigation, and alert-rule draft actions, opt-in live log polling where providers support it, service metadata filters, and history-backed activity for the selected date/filter range with open, investigate, and alert-draft row actions.
  - Apps cockpit (`/apps`) derives first-class service/app health from project groups/accounts, with selectable service detail, filtered CSV export, local service metadata (owner/tier/runbook/dashboard/repo/dependencies/notes), owner/tier/dependency metadata filters, a dependency overview, health contributors, account coverage with edit/refresh remediation actions, related uptime checks, active incidents, signals, metric summaries with provider-open/alert-draft actions where applicable, stale-account state, provider coverage, deep links, active incident/signal rows with provider-open/local-incident/alert-draft actions, and a cross-provider incident timeline with open/investigate/alert-draft row actions, all narrowed by persisted per-tab filters.
  - Persisted observability history (`history.json`) records rolling poll samples + discrete deploy/failure/recovery/alert/incident events for trends, SLOs, and correlation, with configurable local retention.
  - Insights (`/insights`) shows success/failure trends, activity volume, alert volume, filtered retained-history export, and local SLO/error-budget cards with create/edit/delete plus filtered SLO CSV export and scoped target drilldowns, with group/provider/account and service owner/tier/dependency filters layered over scoped retained local history.
  - Incident center (`/incidents`) consolidates durable local incidents, live signals/incidents, main Dashboard/Apps monitor-row incident creation handoffs, Uptime down-check incident creation handoffs, retained Timeline/dashboard-event incident creation handoffs, Apps live signal/incident handoffs, filtered CSV export, local acknowledge/silence state, service owner/runbook context from local metadata, owner/tier/dependency service filters, an investigation workspace with evidence summaries/links/inline notes, deterministic investigation hints, copyable follow-up checklists, copyable postmortem drafts from local incident evidence, local incident lifecycle timelines, per-item history timelines with open actions, structured Markdown incident report export, and redacted JSON incident export.
  - Correlation timeline (`/timeline`) overlays deploys, failures, recoveries, alerts, and incidents across group or provider lanes, with service owner/tier/dependency filters from local metadata, filtered CSV export, and row actions to open provider evidence, start a local incident, or draft a scoped alert rule from retained failure/alert/incident events.
  - Uptime/synthetic checks (`/uptime`): user-defined HTTP checks probed each poll cycle with up/down + latency, uptime %, latency sparkline, filtered CSV export, endpoint-open/start-incident/edit/delete/uptime-down alert actions, and service owner/tier/dependency filters for group-scoped checks (latency history persisted per check).
  - Custom alert rules (`/alerts`): threshold rules on failure rate / check latency / uptime down / open incidents scoped to all/group/account/provider/check; one-click rule templates for common failure, uptime-down, latency, incident, and provider-failure patterns; sustained-breach/cooldown controls; incident severity thresholds; dedupe delivery windows; filtered CSV export with retained-history tuning columns and suggested-threshold columns; current-snapshot preview/test delivery plus 24h retained-history simulation, percentile-based threshold suggestions, and recent matching retained-history or check-sample context in the rule dialog; rule rows show 24h retained-history breach counts/max values plus suggested thresholds for sample-backed rules and can apply differing suggestions with confirmation; row-level target drilldowns into Accounts or Uptime for scoped rules; rule health badges/filters for missing target, delivery issue, suppressed, disabled, no-data, noisy, pending, firing, and healthy rules; service metadata context in channel payloads where scope maps to a service; multiple global/scoped maintenance-window delivery suppression rules; per-rule snooze; optional per-rule Slack/webhook channel routing; fire/recover with notification + channel dispatch + timeline events.
  - Notification channels (Settings): Slack incoming-webhook or generic webhook forwarding for failure/success/alert/digest events; webhook URL stored encrypted; per-channel test; filtered metadata CSV export; persisted filters by search/type/enabled/url/event with a filter-miss reset action.
  - Scheduled digest (Settings): daily/weekly health summary notification + channel dispatch; CSV/JSON export of history events/samples from Insights.
  - Custom Dashboards (`/dashboards`) lets users create, import, export, and template persisted Recharts dashboards with local all-provider monitor-history panels plus live provider query panels for adapters that explicitly expose dashboard query capabilities; dashboard definitions can persist non-secret variables for group/provider/account/check/owner/tier/dependency defaults that apply to local panels unless a panel has a narrower explicit scope, dashboard runtime filters can temporarily override those variables, and individual panels can override the dashboard range and refresh cadence; the old dedicated Grafana tab has been removed from navigation.
  - Comprehensive per-tab filters (persisted to localStorage): relative/custom date ranges where local history exists, plus group/provider/account/status/category/severity/type/health/stale/rule/check/token filters as appropriate; data-heavy views use a consolidated native-style Filters popover with applied-filter chips and saved per-tab filter presets that can be applied, updated, renamed, deleted, or pinned as the tab default rather than long inline select rows; manual refresh.
- Accounts/Setup reliability surface: setup checklist with next-action buttons for incomplete setup steps, portable setup import/export with granular account selection, filtered account/diagnostic CSV export, provider capability matrix across the registry, account diagnostics for token presence, required config, last sync/error, stale state, provider retry backoff, encryption availability, provider dashboard capability support including live default/custom panel names after diagnostics run, direct edit/single-account refresh actions, on-demand stored-credential validation, account filtering by search/provider/group/enabled/diagnostic/token/dashboard-support state, and a user-triggered live smoke verification report with opt-in notification-channel delivery tests.
  - Background polling with configurable interval; native notifications on failure/success (configurable).
  - Menu bar (tray) icon tinted by aggregate status with a dropdown of recent items, alert/down summaries, and quick actions including notification snooze.
  - Adding a new provider = one backend adapter module + one icon entry in `provider-meta.tsx`.

## Current State

### Key files
- `AGENTS.md` — repo-level architecture/conventions doc for AI coding agents (mirrors this file's non-sensitive parts), including current storage and IPC summaries for app/window, accounts/setup, diagnostics/verification, services/channels, monitor/history/SLOs, checks/rules, triage/local incidents, dashboards, and legacy Grafana support; keep in sync when architecture/conventions change.
- `README.md` — developer setup guide plus current app overview covering providers, Command Center at `/`, detailed Dashboard at `/dashboard`, custom dashboards replacing the Grafana tab, macOS/Node/npm/Glaze/Xcode prerequisites, importing `Observability Monitor.glaze` into the Glaze macOS app, install/run/validation commands, troubleshooting, and runtime data notes.
- `scripts/check-provider-contracts.ts` — credential-free source contract check for provider additions plus app boundary invariants; verifies registry imports, backend/renderer Provider unions, provider metadata coverage, exactly-one-secret-field declarations, password secret inputs, dashboard capability hook pairing, renderer preload IPC isolation, handler-group registration, main renderer IPC wrappers, Settings IPC calls, README current-state/validation claims, old Grafana route removal, Command Center root route plus preserved `/dashboard` route and scoped action handoffs, token-free dashboard storage/export boundaries, persisted dashboard variables plus empty-variable omission/export/import/remapping in dashboard and portable setup bundles, dashboard fixed-grid builder controls, panel-level refresh overrides, required local/provider default dashboard panels including event-specific local default identity, local dashboard all-status aggregation and snapshot provider/group/account breakdown stats, alert-rule retained-history tuning context and threshold suggestions in editor/list/export/apply paths, one-time Grafana preset migration persistence plus Loki/Tempo panel shape and runtime datasource discovery fallback, empty-dashboard import preservation, retained-history clear/prune IPC wiring, retained-history series/event/export scope filters for group/provider/account/status/severity/category/type, history event CSV filter-evidence columns, history storage-size reporting, shared persisted filter/date-range wiring including retained-history custom input bounds through now and stored custom-range normalization, saved filter preset/pinned-default mechanics plus setup-bundle preset allowlists, AGENTS.md IPC summary coverage, tab-specific filter controls and predicates across Dashboard/Apps/Insights/Incidents/Timeline/Uptime/Alert Rules, Accounts diagnostics/token/dashboard-support filters, notification-channel filters, Insights no-history vs filter-miss empty states, dashboard row-link metadata/rendering for table/log/trace/event results, dashboard panel no-retry error behavior, stable provider dashboard row links including Grafana Loki/Tempo Explore links, Grafana Loki/Tempo/Prometheus capability gating/query routing/discovered datasource defaults, local-only dashboard runtime filter application with check filters limited to local uptime-check panels, SELECT-only/no-semicolon/bounded custom-query limits for read-only SQL/HogQL providers, and command-palette smoke-verification discoverability without loading Glaze runtime modules or calling provider APIs. Run with `npm run test:contracts`.
- `scripts/check-provider-contracts.ts` also guards the detailed Dashboard retained-activity group fallback so older/imported history events missing `groupId` are filtered with `event.groupId ?? account.groupId` rather than being misclassified as ungrouped.
- `scripts/check-provider-contracts.ts` also guards shared retained-history account-derived group fallback for `history:getSeries`, `history:getEvents`, group-scoped SLO status, local dashboard panel event/sample metadata, Command Center/Incidents retained-event handoffs, Timeline group lanes, Insights post-processing, and Alert Rules retained-history simulations.
- `renderer/main/command-center-view.tsx` — first-screen operations summary using existing renderer data hooks (`monitor:getSnapshot`, monitor settings, retained history events, accounts, checks, dashboards, local incidents, alert rules/states, SLO statuses) to show current issues, firing alert-rule rows with current values/thresholds, SLO risk with row-level budget/burn-rate/sample evidence, active notification snooze/maintenance-window/per-rule snoozes, suggested next actions, account attention, active incident queue, and retained 24h activity without adding storage or IPC; summary cards/actions count full issue/activity totals separately from capped row previews, and suggested actions plus issue/activity rows write existing one-shot handoff payloads for exact account edit, uptime check filters, firing alert-rule selection/filtering, rule-snooze review, SLO risk scoped to Insights filters, Settings suppression review, live/local incident drilldowns, retained Timeline context with account-derived group fallback, and detailed dashboard item log/detail context.
- `eslint.config.js` — local ESLint flat config that loads the Glaze SDK lint config and adds a generated `.build/**` ignore so the CLI's staged backend output is not linted as app source.
- `main/handlers/app.ts` — app-level metadata IPC (`app:getInfo`) returning Multi Monitor identity/package/version/environment.
- `main/index.ts` — app entry; creates main window (1000×700, min 720×480), inits tray + starts poller AND digest scheduler on ready, `showMainWindow()` helper, stops poller + digest on quit.
- `main/handlers/index.ts` — calls `registerProviders()` first, then registers account/channels/checks/dashboards/diagnostics/grafana/history/local-incident/monitor/provider/rules/service/setup/triage/verification handlers.
- `main/handlers/accounts.ts` — generic, registry-driven `accounts:list/add/update/remove/test/exportSetup/importSetup` plus `groups:list`; splits creds into secret (token-store) + non-secret (`account.config`) via `definition.fields`; blank non-secret fields clear optional config on edit; `validate()` resolves identity; account add/update can assign an existing project group or create/reuse one by name. Setup export writes account/group metadata only; setup import creates disabled accounts because exported files never contain tokens.
- `main/handlers/dashboards.ts` — custom dashboard IPC: list/save/delete/export/import dashboards, list local/live query capabilities, and run a single panel; dashboard export bundles include only non-secret account/group/check reference metadata and import remaps matching local references while preserving intentionally empty dashboards and skipping malformed/unmatched imported panels.
- `main/handlers/diagnostics.ts` — account diagnostics IPC: list account health, provider retry backoff state, provider live-dashboard capability support/counts/names, and run a stored-credential validation/capability load without returning tokens.
- `main/handlers/verification.ts` — user-triggered live smoke verification IPC: validates enabled accounts with stored credentials, optionally sends enabled notification-channel test messages, probes enabled uptime checks, lists dashboard capabilities with default/custom counts and safe example panel names, and loads local dashboard/incident/rule stores while returning only status metadata.
- `main/handlers/grafana.ts` — legacy Grafana observability IPC kept for backend support and existing integrations: overview, run saved Loki log preset, run saved Tempo trace preset, update observability config.
- `main/handlers/history.ts` — `history:getSeries/getEvents/getStats/clear/prune/listSlos/saveSlo/deleteSlo/getSloStatus` plus `history:export` (CSV/JSON of events or samples via `dialog.showSaveDialog`, optionally filtered by retained-history date/scope/event fields; event CSV includes source UID and category evidence columns); series/events accept relative or custom date ranges, series can be scoped by group/account/provider, and events can be filtered by group/account/provider/status/severity/category/type; stats returns retained local counts, timestamp bounds, and `history.json` byte size; clear removes retained samples/events/check samples and returns updated stats while preserving SLO definitions; prune applies the current retention window to disk without deleting in-window rows or SLO definitions.
- `main/handlers/local-incidents.ts` — local incident lifecycle IPC: list/save/updateStatus/delete/export; Markdown report export includes summary, impact, service context, evidence, suspected/confirmed cause, resolution, notes, related events, and follow-up actions; optional redacted JSON export includes non-secret incident/service/evidence metadata without provider URLs.
- `main/handlers/channels.ts` — `channels:list/save/delete/test`; never returns the stored URL (only `hasUrl`).
- `main/handlers/checks.ts` — `checks:list/save/delete/getLatencySeries` for uptime checks; latency series accepts relative or custom date ranges.
- `main/handlers/rules.ts` — `rules:list/save/delete/getState/preview/testDelivery` for custom alert rules (state = in-memory firing state; preview/test use current aggregate snapshot and never mutate rule state).
- `main/handlers/setup.ts` — portable app setup IPC: exports selected accounts plus compatible groups/settings/dashboards/checks/rules/SLOs/channel metadata/service metadata/UI filters and filter presets; imports in merge mode with id remapping (including dashboard panel sources/variables, rule target channel ids, scoped maintenance-window ids, history retention, and group/account-derived service metadata ids), duplicate skips, disabled imported accounts/channels, preserves intentionally empty dashboards, and excludes secrets/webhook URLs/history/incidents/triage.
- `main/handlers/monitor.ts` — `monitor:getSnapshot/refresh/getSettings/updateSettings/getStatus`, `monitor:getItemLogs`, `monitor:openExternal`; `updateSettings` reschedules both poller and digest and refreshes tray snooze state.
- `main/handlers/providers.ts` — `providers:list` → `registry.publicList()` (id/label/scopeHint/fields; no functions).
- `main/handlers/services.ts` — `services:listMetadata/saveMetadata/deleteMetadata` for local service-catalog annotations; validates shape and delegates persistence without exposing secrets.
- `main/handlers/triage.ts` — local triage IPC for `triage:list/acknowledge/silence/clear`.
- `main/services/providers/registry.ts` — `ProviderDefinition` interface + `register/get/has/list/publicList/secretField`; provider fields support text/password plus string-backed boolean defaults for renderer switches; adapters can optionally implement `fetchSignals`, `fetchIncidents`, `fetchMetricsSummary`, `getDeepLinks`, `fetchLogs(account, creds, item)`, and live custom-dashboard query hooks (`getDashboardQueryCapabilities`, `runDashboardQuery`) with optional `defaultPanel` templates.
- `main/services/providers/index.ts` — `registerProviders()` registers all adapters; re-exports registry.
- `main/services/providers/{github,cloudflare,supabase,netlify,resend,grafana,heroku,sentry,pagerduty,statuspage,datadog,honeycomb,posthog,betterstack}.ts` — one adapter each (`fields`, `validate`, `fetch`; many also richer observability hooks and/or `fetchLogs`). `github.ts` and `cloudflare.ts` wrap the existing `github-api.ts`/`cloudflare-api.ts` clients and expose live read-only dashboard workflow/deploy table panels. `grafana.ts` exposes alert and datasource-health dashboard panels for Grafana accounts, only exposes Loki/Tempo live dashboard panels when those datasource UIDs are saved in observability config or discovered from Grafana's datasource API, and pre-fills discovered Loki/Tempo UIDs into default/custom dashboard params so one-click Tempo defaults run without manually typing the UID. `netlify.ts` exposes deploy polling plus live read-only dashboard deploy table panels. `resend.ts` exposes domain/broadcast polling, API log details, and live read-only dashboard domain/broadcast table panels. `heroku.ts` exposes release output details plus live read-only dashboard release table panels. `sentry.ts` exposes latest issue event details through row logs plus live read-only dashboard issue-search panels. `pagerduty.ts` exposes incident polling plus live read-only dashboard incident table panels. `statuspage.ts` exposes unresolved incidents/components plus live read-only dashboard incident and component table panels. `datadog.ts` exposes monitor health plus live read-only dashboard monitor table panels. `honeycomb.ts` exposes trigger/SLO summaries plus live read-only dashboard trigger and SLO table panels when a dataset is configured, with optional non-secret team slug/UI base URL fields for direct Honeycomb row links. `posthog.ts` (modeled on sentry): personal API key + region (us/eu) + projectId; error-tracking issues with a HogQL `$exception` aggregation fallback and default exception dashboard rows linking to project Error Tracking. `betterstack.ts` uses Better Stack Telemetry SQL credentials for recent log summaries, live logs, and read-only dashboard SQL/log panels with row-level links back to Better Stack Telemetry.
- `main/services/channels-store.ts` — `channels.json` non-secret channel meta; webhook URL stored in token-store under `channel:<id>`. `main/services/dispatch.ts` — `dispatch(event)`/`dispatchTest(id)` POST to enabled Slack/webhook channels by explicit `event.channelIds` when provided, otherwise by event kind subscription (never throws into the poll cycle); Slack text and generic webhook JSON include optional non-secret service context when supplied.
- `main/services/checks-store.ts` — `checks.json` HTTP check defs. `main/services/checks-runner.ts` — `runChecks()` probes enabled checks with `AbortController` timeout, returns up/down + latency results.
- `main/services/rules-store.ts` — `rules.json` alert-rule defs with normalized per-rule snooze timestamps, non-secret per-rule `channelIds`, incident `minSeverity`, and `dedupeMinutes`, accepting failure-rate, check-latency, check-down, and open-incident metrics. `main/services/rules-engine.ts` — shared metric computation for live evaluation, preview, and test delivery; `evaluateRules(snapshot)` keeps in-memory firing state, honors global snooze/maintenance windows/per-rule snooze plus per-rule dedupe for delivery, applies severity thresholds to open incident/alert-signal rules, resolves service metadata context for account/group/check-scoped rule dispatch, routes dispatch to per-rule channels when selected, fires on sustained breach and recovers on clear (notification + dispatch + `history.appendEvent`); `getRuleStates()`.
- `main/services/notification-mute.ts` — shared notification mute helper for global snooze plus multiple global or provider/account/group/check-scoped recurring local maintenance windows, used by transition notifications and alert rules.
- `main/services/digest-scheduler.ts` — poller-style timer; at configured daily/weekly hour builds a 24h summary from history and delivers a native notification + dispatch (kind "digest"); `start/stop/reschedule`.
- `main/services/types.ts` — `Provider` union, generic `Account { …, groupId?, identity?, config? }`, `ProjectGroup`, `MonitorItem { kind:string, category, logAvailable?, logFallbackUrl?, logRef?, liveLogAvailable?, liveLogPollSeconds?, liveLogLabel? }`, `MonitorLogResponse`/`MonitorLogLine`, observability signal/incident/service types, local service metadata types, dispatch service-context payload types, local incident lifecycle types, account diagnostic/backoff types, verification report/result types, alert-rule snooze/control fields, history sample/event types, SLO/triage types, `NormalizedStatus` (adds `warning`,`info`), settings.
- `main/services/accounts-store.ts` — accounts.json (no secrets) with `{ accounts, groups }`; `migrate()` shim maps legacy `login`/`accountName`/`cloudflareAccountId`/`repoFilter` → `identity`/`config`; group helpers list/create-or-reuse/validate/prune unused groups.
- `main/services/token-store.ts` (safeStorage → tokens.bin.json base64, one secret per account), `settings-store.ts`.
- `main/services/history-store.ts` — DataStore-backed `history.json` with configurable 1-90 day samples/events/checkSamples retention from settings, scaled row caps, retained-history stats including file byte size, event de-dupe, relative/custom date windows clamped to retained history, downsampled series queries with optional group/account/provider scoping and account-derived group fallback for older rows missing `groupId`, filtered event queries with the same fallback, per-account status plus alert/open-incident sample counts for scoped local panels, per-check latency series + uptime (`getCheckLatencySeries`), `appendEvent`, `getAllSamples/getAllEvents` (export), `clearRetainedHistory` for clearing samples/events/check samples while preserving SLO definitions, `pruneRetainedHistory` for applying the current retention window to disk, SLO CRUD capped by retained history, and SLO compliance/error-budget computation with group-scoped SLO fallback. NOTE: uptime checks are NOT written as `HistoryEvent`s (that field is strictly `Provider`-typed and feeds provider icons) — they persist as separate `checkSamples`.
- `main/services/local-incidents-store.ts` — DataStore-backed `local-incidents.json` for durable local incident records: source metadata, status, severity override, assignee, notes, root cause, resolved reason, and related history event ids; no provider-side mutations or secrets.
- `main/services/service-metadata-store.ts` — DataStore-backed `service-metadata.json` for local service-catalog annotations keyed by derived service ids (group id or account-derived id): owner, tier, runbook/dashboard/repository URLs, dependencies, notes, and updated timestamp; supports list/save/delete with no provider secrets or account config.
- `main/services/dashboard-store.ts` — DataStore-backed `dashboards.json` for user-authored dashboard definitions; migrates saved Grafana Loki/Tempo presets into dashboards on first empty-dashboard load without deleting Grafana account config and persists that migration flag only for the first migration pass; defensively normalizes dashboard/panel ids, names, layout, visualization, local metric, event types, dashboard variables, scope fields, provider account/capability ids, provider query/params/mapping fields, range, panel-level refresh overrides, sequential order, and panel source ranges on save/import, omits empty dashboard variable objects, and skips malformed panel sources instead of persisting odd shapes. `main/services/dashboard-query-runner.ts` executes local normalized history/snapshot/check panels for every provider, applies optional service metadata filters to local event/snapshot/status/check/incident-alert panels, aggregates unscoped status panels from per-account rows so all normalized statuses are preserved, uses account-derived group fallback for scoped history rows and local event metadata, counts current snapshot providers/accounts from matching account scope even when no current items exist, appends capped provider/group/account item-count breakdown stats to current snapshot panels, attaches scoped deploy/failure/recovery/alert/incident annotations to local timeseries panel results, exposes one-click default panel templates, adds direct row links plus hidden incident-creation metadata for local event rows, and delegates live provider queries only to adapters that declare dashboard capabilities.
- `main/services/triage-store.ts` — DataStore-backed `triage.json` for local acknowledge/silence state; notifier checks active silence before showing terminal transition notifications.
- `main/services/poller.ts` — non-overlapping loop; `registry.get(provider).fetch(account, creds)` where creds = config + secret, plus optional observability hooks; failed accounts enter capped exponential retry backoff (larger base for 429/rate-limit errors, bypassed by single-account manual refresh) exposed to diagnostics; on FULL cycles (not single-account refresh) runs `runChecks()` and sets aggregator check results; records history (incl. check latency samples) after `buildSnapshot()`, drives notifications/tray/push, then `evaluateRules(snapshot)`.
- `main/services/grafana-observability.ts` — backend-only Grafana token use for incident console: parses/persists `account.config.grafanaObservability`, discovers datasources, checks health, runs Loki `query_range` and Tempo `api/search` through Grafana datasource proxy.
- `main/services/aggregator.ts` — in-memory cache for feed rows plus first-class `services`, `signals`, `incidents`, `metrics`, `deepLinks`, and `staleness`; derives service health from project groups/accounts and applies priority failure>warning>running>queued>success>info>cancelled>unknown. `diff-engine.ts`, `notifier.ts`, `push.ts`, `tray-controller.ts` consume the aggregate snapshot. `tray-controller.ts` also tracks active global notification snooze state and exposes tray menu snooze/clear actions.
- `renderer/main/root-view.tsx` — SplitView + Sidebar nav; `router.tsx` routes (`/`, `/apps`, `/insights`, `/incidents`, `/timeline`, `/uptime`, `/alerts`, `/dashboards`, `/accounts`); secondary data-heavy routes (`/accounts`, `/apps`, `/insights`, `/incidents`, `/timeline`, `/uptime`, `/alerts`, `/dashboards`) are lazy-loaded so the main dashboard route carries less startup code.
- `renderer/main/components/command-palette.tsx` — Cmd/Ctrl-K search/jump surface with shortcut hints for views, actions (refresh/run smoke verification/settings/add account/create dashboard/add uptime check/create local incident/create alert rule), accounts, apps/services, uptime checks, alert rules, dashboards, live incidents/items, local incidents, provider deep links, and service metadata runbook/dashboard/repository links; account, app/service, alert-rule, dashboard, dashboard recent-item logs, local-incident, manual incident creation, smoke verification, alert-rule draft, account/check/dashboard creation, and uptime-check results hand off one-shot selection/filter/action payloads so the destination opens the chosen item or workflow instead of only the tab.
- `renderer/main/dashboard-view.tsx` (grouped account dashboard with date/group/provider/account/status/category plus service owner/tier/dependency filters, history-backed activity, row-level log viewer, row-level start-investigation handoff to Incidents, one-shot command-palette recent-item log/detail handoff, and reset actions on account/activity filter misses), `apps-view.tsx` (selectable service detail with editable local metadata, owner/tier/dependency filtering, dependency overview, metadata badges on service tiles, health contributors, accounts, provider links, related uptime checks, incidents, signals, metrics, and activity, with distinct no-accounts/no-polling/no-filter-match empty states plus confirmation before clearing service metadata), `insights-view.tsx` (history trends + SLOs + CSV export button + service owner/tier/dependency filters, retained-history no-data vs no-filter-match empty states, SLO filter-miss reset action, plus confirmation before deleting SLOs), `incidents-view.tsx` (local incident lifecycle + live provider sources + main Dashboard monitor-row and retained Timeline/dashboard-event incident creation handoffs + service owner/tier/dependency filters + service metadata context + investigation workspace for evidence summaries/provider/runbook links/inline local-incident notes + deterministic investigation hints + copyable local incident follow-up checklist + detail timelines + correlated evidence linking when creating local incidents from live sources or retained events + Markdown report and redacted JSON export actions + local/live filter-miss reset actions + confirmation before deleting local incidents, plus one-shot dashboard drilldown filters), `timeline-view.tsx` (correlation chart/list with service owner/tier/dependency filters, distinct no-history/no-filter-match states, row-level retained-event incident creation, reset action, plus one-shot dashboard drilldown filters), `uptime-view.tsx` (checks list with status/uptime/latency chart + owner/tier/dependency filters + no-match reset action + add/edit dialog + command-palette add-check handoff + per-check uptime-down alert draft action + delete confirmation plus one-shot dashboard drilldown filters), `alerts-view.tsx` (rule list with firing/snoozed/channel/service-metadata badges, retained 24h breach/max/suggested-threshold tuning context for sample-backed rules, confirmed quick-apply for differing suggested thresholds, tuning and suggested-threshold columns in CSV export, owner/tier/dependency filters, no-match reset action, one-click rule templates in the add dialog, retained-history threshold suggestions plus recent matching retained-history and check-sample context in the rule dialog, per-rule snooze controls, per-rule channel selection, current-snapshot preview, test delivery, add/edit dialog with dashboard-panel/command-palette draft handoff, and delete confirmation), `dashboards-view.tsx` (custom dashboard builder + searchable dashboard selector with match counts and clear action + searchable selected-dashboard panel grid with match counts and clear actions + command-palette template creation handoff + template picker for Executive Health, Deployment Reliability, Incident Response, Uptime/SLO, Provider Observability, and Team/Service Ownership dashboards; panel grid with searchable/filterable Default panels vs Custom query creation modes, capability-filter clear action in the panel editor, editor-side required query/param validation, one-click uptime check latency/uptime defaults that prefill the first available check, unavailable live-capability indicators for saved provider panels, provider x/y mapping controls, provider default params editable without forcing custom-query mode, blank optional provider params removed in editor state, default-query panels reopening in Default mode until the query is customized, panel-level range overrides, explicit local panel scopes for group/account/provider/check/owner/tier/dependency and editable event-type scopes for local event panels, per-panel refresh plus refreshing/stale status text, disabled boundary move controls for first/last panels, delete confirmations for dashboards/panels, at-a-glance panel source/range/scope metadata badges, panel account/provider drilldowns into Accounts, chart-point drilldowns into Timeline/Incidents/Uptime, local chart annotations with clickable retained history events, dashboard duplication, same-dashboard panel duplication, cross-dashboard panel copy, single-dashboard export/import, alert-rule draft actions for supported local panels, local event-row incident creation, service owner/tier/dependency runtime filters for local panels, a runtime-filter boundary callout when live provider panels are present, and searchable/sortable/exportable row-level open actions for linked table/log/trace/event rows); all data-heavy views have persisted scoped filters, reset actions, saved filter presets, and shared custom date inputs that cap their oldest selectable timestamp by retained history while allowing the current retained window through now and normalizing older stored custom values when bounds change. `accounts-view.tsx` includes setup checklist with next-action buttons, portable setup import/export with account picker, persisted search/provider/group/enabled/diagnostic/token/dashboard-support filters over accounts and diagnostics, accepts one-shot account/provider/group selection, add-account, and smoke-verification payloads, account diagnostics with per-account Dashboards actions that open Custom Dashboards scoped to that provider/account, and a live smoke verification runner whose notification-channel delivery tests are opt-in. The old Grafana tab route/sidebar/command-palette entry and renderer view source have been removed; backend Grafana IPC remains for migration/provider support.
- `renderer/main/dashboard-view.tsx` applies retained-history activity group filters in the renderer with account-derived fallback for events missing `groupId`, while live snapshot date filtering remains based on each monitor row's `updatedAt`.
- `renderer/main/insights-view.tsx` and `renderer/main/timeline-view.tsx` also use account-derived group fallback when post-processing retained series/events, so group-scoped rows returned by history IPC do not disappear or render as ungrouped only because older history rows lack `groupId`.
- `renderer/main/incidents-view.tsx` uses the same fallback when opening local incident creation from retained events, and `renderer/main/alerts-view.tsx` uses it when simulating group-scoped alert rules from unscoped retained 24h samples for list badges/CSV tuning context.
- `renderer/main/components/` — `add-account-dialog.tsx` (data-driven: provider Select + dynamic fields from `providers:list`, boolean fields as switches, project group assignment/create), `provider-meta.tsx` (provider→icon/label + category→icon; ONLY manual per-provider UI), `account-section.tsx`, `run-row.tsx` (icon via `categoryIcon`, row log/open actions), `log-viewer-dialog.tsx` (on-demand logs with search/copy/open fallback plus opt-in live polling for eligible rows), `charts.tsx` (Recharts-backed responsive charts with axes/tooltips/legends), `filters.tsx` (shared persisted filter state, relative/custom date ranges with retained-history min/max bounds for custom inputs, applied-filter chips, and native-style Filters popover primitives), `status-badge.tsx` (warning/info added), `relative-time.ts`.
- `renderer/main/hooks/` — `use-monitor-data.ts`, `use-accounts.ts`, `use-providers.ts`, `use-diagnostics.ts` (account diagnostics + smoke verification mutation), `use-history.ts` (relative/custom date ranges + richer event filters + retained-history stats for date-bound UI), `use-local-incidents.ts`, `use-slos.ts`, `use-triage.ts`, `use-checks.ts` (list/mutations/latency with relative/custom date ranges), `use-rules.ts` (list/states/save/delete/preview/test mutations), `use-dashboards.ts` (dashboard CRUD/export/import/capabilities/panel runs with refresh interval and stale-time handling; panel queries do not auto-retry invalid custom provider queries), `use-service-metadata.ts` (local service-catalog metadata list/save).
- `renderer/main/utils/csv.ts` — shared renderer CSV escaping and browser download helper used by filtered CSV exports in main views and Settings notification channels.
- Accounts setup also includes a provider capability matrix over all registered providers, showing connected/enabled account counts, diagnostic status distribution, normalized local panel availability, live dashboard support/load state, one-click default counts, custom-query counts, and actions into filtered Accounts or Custom Dashboards.
- Local incident detail includes a lifecycle timeline from created/acknowledged/note/resolved timestamps and a Postmortem copy action that builds a Markdown draft from the incident summary, status/severity/duration, retained evidence, notes, service metadata, root cause/resolution fields, and follow-up gaps without writing a file.
- Alert Rules list classifies each rule with a health badge/filter (`healthy`, `firing`, `pending`, `no data`, `disabled`, `suppressed`, `missing target`, `noisy`, `delivery issue`), while the rule dialog includes an automatic 24h retained-history simulation for failure-rate/open-incident rules from local history samples and uptime latency/down rules from retained check samples, alongside the existing current-snapshot preview and recent evidence list.
- Root navigation supports `Cmd/Ctrl+1` through `Cmd/Ctrl+9` for Dashboard, Apps, Insights, Incidents, Timeline, Uptime, Alert Rules, Dashboards, and Accounts; command-palette navigation rows show matching shortcut hints.
- Timeline can export the currently filtered retained events as CSV from the view actions, including provider/account/group/status/severity/category/source/link fields.
- Uptime can export the currently filtered check list as CSV from the view actions, including current probe status, last latency/status/error, group, owner/tier/dependency metadata, and endpoint configuration.
- Alert Rules can export the currently filtered rule list as CSV from the view actions, including scope, current state/value, health classification/detail, delivery/snooze settings, channel count, and service owner/tier/dependency metadata.
- Apps can export the currently filtered service/app list as CSV from the view actions, including health, provider/account coverage, visible/stale account counts, incident/alert/signal counts, deep-link count, and service owner/tier/dependency/link metadata.
- Dashboard can export the currently filtered live account sections and retained activity as CSV from the view actions, using row types for account summaries, current monitor items, and history events with provider/account/group/status/category/link/service metadata fields.
- Incidents can export the currently filtered local incidents and live provider incident/signal rows as CSV from the view actions, using row types with status/severity/source/provider/account/group/timeline/link/service metadata fields.
- Accounts can export the currently filtered account list as CSV from the view actions, including provider/group/enabled state, token/validation/diagnostic status, stale/backoff details, and dashboard capability support counts/languages/result kinds.
- Settings notification channels can export the currently filtered non-secret channel metadata as CSV, including name/type/enabled state, URL configured/missing state, and subscribed event kinds without exposing webhook URLs.
- Insights can export the currently filtered SLO/error-budget cards as CSV separately from retained history exports, including scope, target/window, compliance/budget/burn rate, risk state, counts, and service owner/tier/dependency metadata.
- `renderer/main/ipc.ts` / `types.ts` — typed IPC wrappers (+`listProviders`, `listGroups`, enriched `AggregateSnapshot`, `getItemLogs`, `openSettings`, diagnostics, smoke verification, service metadata calls, alert rule preview/test delivery, local incident lifecycle calls, dashboard export/import/list-capability/run-panel calls, history clear/prune/export/SLO/triage calls with custom date-range filter payloads) + renderer mirror. Legacy Grafana observability IPC remains backend-only for migration/provider support; renderer wrappers for the deleted Grafana view were removed.
- `renderer/settings/settings-view.tsx` — Theme + Monitoring + history retention (7/14/30/60/90 days) with retained sample/event/check/SLO stats, history file size, an Apply retention now action that prunes out-of-window rows from disk, and a confirmed clear-retained-history action that preserves SLO definitions + notification snooze (1h/8h/tomorrow/clear) + recurring maintenance-window controls with optional group/account/provider/check scope and delete confirmation + Digest (enabled/cadence/hour) fieldsets + `notification-channels.tsx` (add/list/toggle-events/test/delete channels with delete confirmation); settings window 560×480. Settings renderer is a SEPARATE bundle — it defines its own inline `MonitorSettings`/`DigestSettings` and calls `window.glazeAPI.glaze.ipc.invoke` directly (not the main `monitorApi`).

### Components
Uses @glaze/core: `SplitView` (storageKey "cicd-monitor"), `Sidebar*` (route nav), `ScrollArea`, `List`, `Dialog` (add/edit, controlled), `AlertDialog` (remove), `Select`/`Input`/`Switch`/`Field`/`FieldSet`, `Status`, `Badge`, `Callout`, `EmptyState`, `Text`, `Button`. lucide-react icons. Recharts powers Insights trend/SLO charts, the Timeline correlation chart, and user-authored custom dashboard panels.

### Data & storage
- `userData/accounts.json` — `{ accounts: Account[], groups: ProjectGroup[] }` with account `groupId`, `identity` + `config` (non-secret fields: `accountId`, `repos`, `projectRef`, `baseUrl`, Grafana `show*` toggles + filter strings, `grafanaObservability` JSON string with datasource defaults + saved presets), NO secrets.
- `userData/tokens.bin.json` — `{ version:1, tokens: {accountId: base64(safeStorage-encrypted secret)} }`.
- `userData/settings.json` — MonitorSettings (pollIntervalSeconds default 60/min 30 + notify flags + `historyRetentionDays` default 14/min 1/max 90 + `digest {enabled,cadence,hour}` + recurring `maintenanceWindows`, optionally scoped to provider/account/group/check ids).
- `userData/history.json` — `{ version:1, samples, events, slos, checkSamples }`, local observability history with no secrets, pruned according to `settings.historyRetentionDays` (checkSamples = per-check `{checkId,ts,latencyMs,ok}`).
- `userData/local-incidents.json` — `{ version:1, incidents }`, local incident lifecycle data only; no secrets and no provider-side acknowledgement state.
- `userData/service-metadata.json` — `{ version:1, services }`, local service owner/tier/link/dependency/notes annotations keyed by derived service ids; no secrets, no provider-side writes, and included in portable setup bundles with group/account service-id remapping on import.
- `userData/dashboards.json` — `{ version:1, dashboards, migratedGrafanaPresets }`; dashboard definitions store panel layout, source config, dashboard variables, panel range/refresh overrides, query text, x/y mappings, and account/capability ids, but never provider tokens/secrets.
- `userData/triage.json` — local acknowledge/silence metadata keyed by normalized signal/incident uid.
- `userData/channels.json` — `{ channels: Channel[] }` non-secret notification-channel meta (webhook URL kept in tokens.bin.json under `channel:<id>`).
- `userData/checks.json` — `{ checks: HttpCheck[] }` uptime check defs. `userData/rules.json` — `{ rules: AlertRule[] }` alert-rule defs for failure-rate, check-latency, check-down, and open-incident metrics, including non-secret channel routing, snooze, incident severity, and dedupe controls.
- localStorage: versioned per-tab/filter-surface blobs (`accounts.filters.v1`, `dashboard.filters.v2`, `apps.filters.v1`, `insights.filters.v2`, `incidents.filters.v1`, `timeline.filters.v1`, `uptime.filters.v1`, `alerts.filters.v1`, `customDashboards.filters.v2`, `notificationChannels.filters.v1`) plus matching `.presets` arrays for saved filter presets, `.presets.default` pinned default preset ids, and transient one-shot navigation/action payloads (`accounts.select.v1`, `accounts.verify.v1`, `alerts.select.v1`, `apps.select.v1`, `dashboard.item.select.v1`, `dashboards.select.v1`, `incidents.select.v1`, `timeline.drilldown.v1`, `incidents.drilldown.v1`, `uptime.drilldown.v1`). In-memory: enriched aggregator snapshot (+ last check results); diff-engine last-status map; rules-engine firing-state map.

### IPC channels
- `providers:list` → ProviderInfo[]; `groups:list` → ProjectGroup[]; `accounts:list` → Account[]; `accounts:add/update/test` (payload `{ provider, label?, creds, groupId?, newGroupName? }`, creds = flat map; secrets inbound only); `accounts:remove`; `accounts:exportSetup/importSetup` for non-secret account/group setup JSON.
- `diagnostics:listAccounts/runAccount` → account health/credential validation metadata plus non-secret dashboard capability support/counts/names after live diagnostics; never returns tokens.
- `verification:run` → user-triggered `VerificationReport`; accepts optional `{ includeChannelTests }`, validates enabled accounts, optionally sends real test messages to enabled notification channels, probes enabled uptime checks, lists dashboard capabilities, and loads local dashboard/incident/rule stores; never returns provider tokens or webhook URLs.
- `services:listMetadata/saveMetadata/deleteMetadata` → local service metadata list/save/delete; stores only user-entered owner/tier/URL/dependency/note annotations and validates http(s) links.
- `monitor:getSnapshot/refresh/getSettings/updateSettings/getStatus`; snapshot now includes `items`, `services`, `signals`, `incidents`, `metrics`, `deepLinks`, and per-account `staleness`; `monitor:getItemLogs` (accepts only `{ itemUid }`, resolves item/account/token server-side); `monitor:openExternal`; `window:openSettings`.
- `grafana:getOverview`; `grafana:runLogPreset`; `grafana:runTracePreset`; `grafana:updateObservabilityConfig` (all validate Grafana account ownership server-side and keep tokens backend-only).
- `history:getSeries` (relative or custom date ranges; series scoped by group/account/provider); `history:getEvents` (relative or custom date ranges; events filterable by group/account/provider/status/severity/category/type); `history:getStats`; `history:clear` (clears retained samples/events/check samples and keeps SLO definitions); `history:prune` (applies current retention to stored history and returns stats); `history:listSlos/saveSlo/deleteSlo/getSloStatus`; `history:export` (CSV/JSON events or samples to save dialog; optional date/scope/event filters preserve backward-compatible full retained-history exports when omitted).
- `localIncidents:list/save/updateStatus/delete/export` (Markdown report or redacted JSON).
- `triage:list`; `triage:acknowledge`; `triage:silence`; `triage:clear`.
- `channels:list/save/delete/test` (URL write-only, never returned); `checks:list/save/delete/getLatencySeries` (relative or custom date ranges); `rules:list/save/delete/getState/preview/testDelivery`.
- `setup:export/import` for portable app setup bundles; export accepts selected account ids and allowlisted renderer filter state, includes compatible service metadata annotations, and import returns per-area imported/skipped counts plus UI filters for renderer restoration.
- `dashboards:list/save/delete/export/import/listCapabilities/runPanel`; dashboard export/import uses JSON files with no secrets and remaps account/group/check references from panels and persisted dashboard variables to matching local records. Dashboard variables provide group/provider/account/check/owner/tier/dependency defaults for local panels unless a panel has a narrower explicit scope; runtime filters can override them and live provider query panels keep their configured provider parameters. Local dashboard capabilities cover all providers via normalized history/snapshot/check data and include default templates for current health, status counts, recent activity, failures, deploys/releases, alerts/incidents, and checks; local timeseries `runPanel` results can include scoped retained-history annotations for deploy/failure/recovery/alert/incident events. Live provider capabilities are currently implemented for Grafana (alerts and datasource health always, Loki/Tempo only when configured or discovered, Prometheus when discovered), GitHub (read-only workflow run tables), Cloudflare (read-only Pages/Workers deploy tables), Netlify (read-only deploy tables), Resend (read-only domain/broadcast tables), Heroku (read-only release tables), Sentry (read-only issue search), PagerDuty (read-only incident tables), Statuspage (read-only incident/component tables), Datadog (read-only monitor table filters), Honeycomb (read-only trigger/SLO tables with direct row links when UI path metadata is configured), PostHog (read-only HogQL SELECT capped to 100 rows; built-in recent-exception rows link to Error Tracking), Supabase (read-only analytics/log SQL SELECT capped to 100 rows), and Better Stack (bounded Telemetry SQL SELECT capped to 200 rows), with one-click defaults for Grafana recent traces/trace service names only when Tempo support is configured/discovered, Grafana alerts/datasources, GitHub workflow runs, Cloudflare deploys, Netlify deploys, Resend domains/broadcasts, Heroku releases, Sentry unresolved issues, PagerDuty incidents, Statuspage incidents/components, Datadog monitors, Honeycomb triggers/SLOs, PostHog recent exceptions, Supabase recent error logs, and Better Stack recent logs.
- Push (via `ipcMain.broadcast` → renderer `onNotification`): `monitor:snapshot`, `monitor:accountError`, `monitor:pollingState`, `settings:monitor-changed`.

### Integrations (all token/key based, Node 24 global fetch — no new npm deps)
- GitHub REST v2022-11-28; Cloudflare API v4 (Pages + Workers). Supabase Management API (`api.supabase.com`: `/v1/projects`, `/database/migrations`, `/analytics/endpoints/logs.all?sql=` — logs best-effort/feature-detected, also used for read-only dashboard SQL SELECT panels). Netlify (`api.netlify.com/api/v1` sites+deploys). Resend (`api.resend.com` /domains, /broadcasts, `/logs`, `/logs/:id` feature-detected). Grafana (`{baseUrl}/api/health`, `/api/prometheus/grafana/api/v1/rules`, `/api/datasources`, `/api/datasources/uid/:uid/health`, `/api/search`, `/api/annotations`, `/api/datasources/proxy/uid/:uid/loki/api/v1/query_range`, `/api/datasources/proxy/uid/:uid/api/search`, `/api/datasources/proxy/uid/:uid/api/search/tag/service.name/values`, `/api/datasources/proxy/uid/:uid/api/v1/query_range` for Prometheus panels). Heroku (`api.heroku.com` /apps, /releases with `Range: version ..; order=desc,max=3`, `Accept: …version=3`, release `output_stream_url` detail lookup). Current worktree also includes Sentry (`sentry.io/api/0` issues), PagerDuty (`api.pagerduty.com` incidents), Statuspage (`api.statuspage.io/v1` incidents/components), Datadog (`api.<site>` validate/monitors), Honeycomb (`api.honeycomb.io` auth/triggers/SLOs), PostHog (`{us|eu}.posthog.com`: `/api/users/@me/`, `/api/projects/:id/error_tracking/issues/`, HogQL `/api/projects/:id/query/` fallback + dashboard HogQL SELECT panels), and Better Stack (`{region}-connect.betterstackdata.com` SQL Query API over HTTPS Basic auth with `remote(<logsTable>)`). Outbound: Slack incoming-webhook / generic webhook POST via `dispatch.ts`; uptime checks fetch arbitrary user HTTP endpoints.
- Row-level log/detail support: GitHub Actions job logs, Cloudflare Pages deployment history logs, Supabase recent Postgres error logs, Heroku release phase output when available, Grafana first saved Loki log preset, Better Stack recent SQL logs, and Resend API logs best-effort matching. Live polling is opt-in in the log dialog for Better Stack, Grafana Loki preset rows, Supabase recent error logs, and in-progress GitHub/Cloudflare/Heroku logs. Netlify and Cloudflare Workers expose provider-page log fallbacks in v1.
- Endpoints for Supabase logs, Resend broadcasts/logs, Grafana observability surfaces, Cloudflare Pages logs, and Heroku release output were built defensively but NOT curl-validated against live credentials — verify with real tokens at runtime.

### Conventions & constraints
- Adding a provider: create `main/services/providers/<id>.ts` implementing `ProviderDefinition`, register it in `providers/index.ts`, add `<id>` to the `Provider` union in both `types.ts` files, and add an icon/label entry in `renderer/main/components/provider-meta.tsx`. Everything else (dialog, filters, poller) is data-driven.
- `MenuItemColor` is NOT exported from `@glaze/core/backend` — mirror the union locally.
- `shell:openExternal` IPC channel is registered by the native runtime — do NOT re-register; app uses `monitor:openExternal`. Backend calls `shell.openExternal()` directly (tray/notifier).
- Tray icon SF Symbol `bolt.horizontal.circle.fill`, tinted by aggregate status. Poller seeds diff-engine silently on first cycle.
- The Live-app evaluate MCP tool errored (GlazeIPCError) during validation; the app's own IPC works fine — validate via DOM snapshot / real runtime instead.
- `HistoryEvent.provider` is strictly `Provider`-typed and drives `providerIcon/providerLabel`; do NOT widen it for non-provider events (e.g. uptime checks). Rule alerts only write a `HistoryEvent` when a provider is determinable. `HistoryEventType` includes `"check"` for forward-compat but no check events are emitted — adding a member to that union breaks exhaustive `switch`es (e.g. `incidents-view.tsx` `eventIcon`).
- Notification channel secrets reuse `token-store` under the `channel:<id>` key (arbitrary key namespace); channels are non-secret meta in `channels.json`. `dispatch()` must never throw into the poll cycle.
- New views drive the TanStack in-memory router via sidebar `<button>` clicks; programmatic runtime navigation in the inspector requires dispatching a full pointer event sequence on the actual nav `<button>` (a plain `.click()` on text nodes does not navigate).

## Recent History

### 2026-07-04 — Discover Grafana datasource UIDs for migrated panels
- **Goal:** Make migrated Grafana LogQL/TraceQL dashboard panels run even when the old saved preset did not include a datasource UID.
- **What was done:** Updated `main/services/providers/grafana.ts` so Loki, Tempo trace search, and Tempo service-name dashboard queries fall back from explicit panel params/capability suffixes and saved observability config to Grafana datasource discovery at runtime. Added contract coverage for the runtime discovery fallback.
- **Key decisions:** This preserves existing explicit datasource behavior and does not store tokens or mutate account config; it only reuses the already-authenticated datasource API when a legacy/migrated panel has no non-secret UID saved.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Keep dashboard check filters truthful
- **Goal:** Avoid implying that the Custom Dashboards global check filter scopes local panels that do not have check-level data.
- **What was done:** Updated `renderer/main/dashboards-view.tsx` so runtime dashboard check filters are merged into local panels only for `checkLatency` and `checkUptime` panels. Other local panels still receive dashboard group/provider/account/owner/tier/dependency filters when applicable, while live provider panels remain unchanged. Added contract coverage for the check-filter gate.
- **Key decisions:** This does not fabricate check-scoped status/event/snapshot history. Non-check local panels continue to use normalized monitor history, and uptime check panels keep honoring dashboard-level check variables/runtime filters unless the panel has its own explicit check.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Omit empty dashboard variables
- **Goal:** Keep `dashboards.json` clean and only persist dashboard variables when a user actually sets a non-secret scope default.
- **What was done:** Updated `main/services/dashboard-store.ts` so normalized dashboard variables are computed once and only persisted when at least one normalized scope field has a value. Updated contract checks to guard against empty variable objects being written.
- **Key decisions:** This does not change populated dashboard variables, export/import remapping, or live provider query behavior; it only avoids saving empty `{}` variable metadata.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add dashboard snapshot breakdown stats
- **Goal:** Make the local Current snapshot counts dashboard panel reflect provider/group/account breakdowns, not only aggregate totals.
- **What was done:** Updated `main/services/dashboard-query-runner.ts` so snapshot-count panels still show overall items/incidents/alerts/providers/accounts, then append capped provider, group, and account item-count breakdown stats based on the already-scoped matching accounts. Extended the provider contract check to guard the breakdown wiring.
- **Key decisions:** The breakdown uses only local aggregate snapshot data and local account/group metadata; it does not call provider APIs or store credentials.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Prefill uptime check dashboard defaults
- **Goal:** Make one-click local uptime check default panels immediately useful when at least one synthetic check exists.
- **What was done:** Updated `renderer/main/dashboards-view.tsx` so the Check latency and Check uptime default panels prefill the first available uptime check when created from the Default panels flow, matching the existing Uptime/SLO dashboard template behavior. Extended contract checks for the prefill helper and panel-dialog wiring.
- **Key decisions:** If no uptime check exists, the panel still saves and shows the existing “Select an uptime check” warning rather than fabricating data or creating a check implicitly.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add shared retained-history group fallback
- **Goal:** Make group-scoped history filters reliable for retained samples/events that were written before `groupId` existed or came from imports with only `accountId`.
- **What was done:** Updated `main/services/history-store.ts` so `history:getSeries`, `history:getEvents`, history export, and group-scoped SLO status can use the current account-to-group map as fallback when a retained row lacks `groupId`. Updated `main/services/dashboard-query-runner.ts` so local dashboard sample aggregation and event metadata use the same fallback. Updated Insights retained-series post-processing, Timeline group lanes, Command Center retained-event drilldowns, Incidents retained-event creation handoffs, and Alert Rules retained-history simulations so fallback rows remain visible and correctly grouped. Updated `AGENTS.md` and extended contract checks for the shared fallback.
- **Key decisions:** The fallback only uses local account metadata from `accounts.json`; it does not call provider APIs and does not persist or expose secrets.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Fix Dashboard activity group fallback
- **Goal:** Keep detailed Dashboard activity filters accurate for retained events that predate persisted `groupId` evidence or come from imports.
- **What was done:** Updated `renderer/main/dashboard-view.tsx` so the Activity in range section fetches retained events for the selected date/provider/account/status/category scope and applies group filtering in the renderer using `event.groupId ?? account.groupId`. This prevents grouped-account events with missing event `groupId` from appearing under Ungrouped and lets selected group filters include older matching account events. Extended contract checks for the fallback.
- **Key decisions:** Live snapshot rows remain filtered by `item.updatedAt`; retained activity still comes only from local history and provider queries are not involved.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Prefill discovered Grafana datasource UIDs
- **Goal:** Make one-click Grafana Tempo/Loki dashboard panels work when datasource support is discovered from Grafana rather than manually saved in observability config.
- **What was done:** Updated `main/services/providers/grafana.ts` to choose saved Loki/Tempo datasource UIDs first and otherwise use the first discovered datasource UID of the matching type. The selected UID is now prefilled into Loki/Tempo capability params and into Grafana Recent traces / Trace service names default panels. Extended contract checks to guard the discovered-UID fallback and default-panel params.
- **Key decisions:** Capabilities are still gated by real configured or discoverable datasource support, and dashboard definitions persist only non-secret datasource UIDs, not Grafana tokens.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Guard dashboard row-link renderer
- **Goal:** Ensure direct row links render consistently for dashboard tables, logs, traces, and events.
- **What was done:** Extended `scripts/check-provider-contracts.ts` to require table/event/log/trace dashboard results to route through the shared `TablePanel`, hide internal `__` metadata, use hidden `__urlLabel` values for open-action labels, open links through `monitorApi.openExternal`, and export CSV using only visible columns.
- **Key decisions:** Runtime behavior already existed in `renderer/main/dashboards-view.tsx`; this adds regression coverage without changing saved dashboard definitions or provider query execution.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Preserve all local dashboard statuses
- **Goal:** Ensure local normalized dashboard panels reflect all provider status states, not just success/failure.
- **What was done:** Updated `main/services/dashboard-query-runner.ts` so unscoped local status-count panels aggregate every `NormalizedStatus` from per-account history rows, with a fallback for older samples that only have aggregate success/failure counts. Also changed current snapshot provider/account stats to count matching accounts rather than only accounts with current items. Added contract checks for both behaviors.
- **Key decisions:** This stays entirely within local normalized history/snapshot data and does not change provider query panels or credential handling.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Guard saved filter presets
- **Goal:** Make the comprehensive filter system durable across tabs and portable setup bundles.
- **What was done:** Added an inline reset action to the Accounts filter-miss empty state. Extended `scripts/check-provider-contracts.ts` to require the shared filter preset implementation to save/update/rename/delete presets, pin default presets, apply a pinned default only when the tab has no stored filter state, wire every filter surface to `presetKey`/`presetValue`/`onApplyPreset`, and allowlist every saved preset/default key in portable setup import/export.
- **Key decisions:** This keeps filter state renderer-local and setup bundles still only copy explicitly allowlisted localStorage values; no backend filter persistence or provider credential access was added.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Preserve dashboard variables in portable setup
- **Goal:** Keep portable setup import/export aligned with custom dashboard persistence and single-dashboard import semantics.
- **What was done:** Updated `main/handlers/setup.ts` so exported setup dashboards keep compatible dashboard-level variables, include referenced variable groups, remap variables on import, and preserve intentionally empty dashboards while still skipping dashboards whose provided panels all fail remapping. Updated `AGENTS.md` to describe the setup import/export behavior. Extended `scripts/check-provider-contracts.ts` to guard the setup filter allowlist, dashboard variable remapping, compatible variable export, empty-dashboard import behavior, and AGENTS setup summary wording.
- **Key decisions:** Setup bundles remain non-secret and still disable imported accounts/channels; this only preserves dashboard metadata and localStorage filter state that is already explicitly allowlisted.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Guard Grafana preset migration shape
- **Goal:** Make the Grafana-tab replacement migration preserve saved observability presets as dashboard panels.
- **What was done:** Extended the provider contract check to require dashboard migration to read `grafanaObservability`, import saved LogQL presets as `grafana.loki` logs panels, import saved TraceQL presets as `grafana.tempo` traces panels, carry preset queries and optional datasource UIDs into panel source metadata, and keep the migration one-time/empty-dashboard gated.
- **Key decisions:** Runtime behavior already existed in `main/services/dashboard-store.ts`; this makes the old Grafana preset preservation path regression-guarded without deleting or rewriting Grafana account config.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Guard local dashboard default identity
- **Goal:** Ensure event-specific local default panels keep their identity in the dashboard editor.
- **What was done:** Extended the provider contract check to require `localCapabilityId()` to map failure, deploy, and alert/incident event panel sources back to `local.failures`, `local.deploys`, and `local.alertEvents`, and to use that mapping when matching saved panels and default-panel instances.
- **Key decisions:** Runtime behavior already existed; the new guard protects the one-click default-panel workflow from collapsing all event table panels into the generic `local.events` source when panels are reopened or edited.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Guard custom dashboard builder controls
- **Goal:** Make the v1 fixed-grid custom dashboard builder requirements verifiable.
- **What was done:** Extended the provider contract check to require dashboard CRUD/templates, panel add/edit/delete, reordering, full/half width and small/medium/large height controls, panel range and refresh overrides, default-panel vs custom-query modes, provider query parameters, x/y mappings, local event-type scopes, fixed-grid full-width spanning, and panel duplicate/copy actions.
- **Key decisions:** Runtime behavior already existed in `renderer/main/dashboards-view.tsx`; this change regression-guards the builder surface promised by the custom dashboard plan.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Sync README with current navigation
- **Goal:** Keep user/developer-facing documentation aligned with the implemented Command Center, preserved detailed Dashboard route, and Custom Dashboards replacing Grafana.
- **What was done:** Updated `README.md` to explicitly describe Command Center at `/`, the detailed grouped Dashboard at `/dashboard`, Custom Dashboards at `/dashboards`, and the removed `/grafana` route. Added contract checks that require README coverage for current dashboard/filter/navigation claims, validation commands, and local runtime data boundaries.
- **Key decisions:** This is documentation and regression-guard work only; runtime navigation and dashboard behavior were already implemented.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Guard setup and notification filters
- **Goal:** Extend the “filters everywhere” regression coverage to Accounts setup and Settings notification channels.
- **What was done:** Added contract checks for persisted Accounts filters covering search, provider, group, enabled state, diagnostic status, token presence, and dashboard live-support state, including portable setup filter export/import. Added contract checks for notification-channel search, type, enabled state, URL configured/missing, event subscription filters, and filtered CSV export without webhook URLs.
- **Key decisions:** The renderer behavior already existed; this change makes the setup and notification filter surfaces verifiable alongside the main data-heavy tabs.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Guard renderer IPC wiring
- **Goal:** Make sure implemented backend handler groups remain reachable through the expected renderer surfaces.
- **What was done:** Extended `scripts/check-provider-contracts.ts` to require registration of all backend handler groups, typed `renderer/main/ipc.ts` wrappers for diagnostics, verification, services, dashboards, history/SLOs, checks, rules, triage, local incidents, and safe external opening, plus Settings-bundle direct IPC calls for monitor settings, history maintenance, scope options, and notification-channel list/save/test/delete.
- **Key decisions:** The runtime wiring already existed; this adds regression coverage without changing the preload boundary or adding new IPC channels.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Sync AGENTS IPC summary
- **Goal:** Keep the repo-level contributor guidance aligned with the implemented storage and IPC surface after the dashboard, history, alerting, and filter work.
- **What was done:** Updated `AGENTS.md` to include the current app/window, notification-channel, check, rule, SLO, triage, local-incident, dashboard, and legacy Grafana IPC groups. Extended the provider contract check to require those IPC groups in the AGENTS summary so future handler-surface changes are less likely to leave the guide stale.
- **Key decisions:** This is documentation and regression-guard work only; it changes no runtime IPC behavior or storage format.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Guard tab-specific filter behavior
- **Goal:** Make the comprehensive cross-app filter plan verifiable at the renderer tab level, not just through shared filter primitives.
- **What was done:** Extended `scripts/check-provider-contracts.ts` with targeted checks for Dashboard date/account/status/category filtering plus activity history, Apps group/provider/account/health/stale filters with date-filtered incidents/signals/metrics/activity, Insights scoped retained-history series/events, Incidents kind/status/severity/date/scope filtering and range-scoped detail timelines, Timeline event/status/severity/category filters, Uptime range/group/status/enabled/method/search filters with range-scoped latency, and Alert Rules enabled/state/metric/scope/target filters without adding a rule-list date filter.
- **Key decisions:** Runtime behavior already existed in the renderer; this change makes the explicit per-tab filter requirements regression-guarded in the contract suite.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Guard Grafana Prometheus dashboard panels
- **Goal:** Make the Grafana Prometheus-compatible time-series requirement from the custom dashboard plan verifiable.
- **What was done:** Extended the provider contract check to require discovered Prometheus datasource capabilities with `grafana.prometheus:<uid>` ids, PromQL metadata, and execution through Grafana datasource-proxy `query_range` returning timeseries results.
- **Key decisions:** Runtime behavior already existed in `main/services/providers/grafana.ts`; this change regression-guards the declared Prometheus panel support beside Loki and Tempo.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Guard read-only custom query safety
- **Goal:** Make the provider custom-query safety requirement verifiable for SQL/HogQL dashboard panels.
- **What was done:** Extended the provider contract check for Supabase, PostHog, and Better Stack dashboard query adapters so it now requires SELECT-only validation, semicolon rejection, and bounded custom-query limits.
- **Key decisions:** Runtime behavior already existed in the provider adapters; this change regression-guards the security boundary promised by the custom dashboard plan.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Guard retained-history scope filters
- **Goal:** Make the comprehensive filter plan verifiable at the IPC/storage layer, not only through renderer controls.
- **What was done:** Extended the provider contract check to require `history:getSeries` group/provider/account scoping, `history:getEvents` group/provider/account/status/severity/category/type filtering, `history:export` preservation of retained-history scope filters, and the corresponding event-filter predicates in `history-store.ts`.
- **Key decisions:** The runtime behavior already existed; this change regression-guards the retained-history filters that Dashboard, Insights, Incidents, Timeline, Custom Dashboards, and exports rely on.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Guard required dashboard default panels
- **Goal:** Make the default-panel plan verifiable by contract rather than relying on broad capability summaries.
- **What was done:** Extended the provider contract check to require all local normalized default dashboard panels (`successFailure`, `statusCounts`, `incidentsAlerts`, recent activity, failures, deploys/releases, alerts/incidents, snapshot counts, check latency, check uptime) and the named live defaults for Grafana active alerts, Grafana datasource health, Grafana recent traces (`{}` with limit 50), Grafana trace service names, PostHog recent exceptions, and Supabase recent error logs.
- **Key decisions:** Runtime behavior already existed; this change regression-guards the required one-click default panels from the original dashboard/default-panel plans.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Guard Grafana Loki dashboard row links
- **Goal:** Close a direct-link contract gap from the dashboard row-link plan by ensuring Grafana log rows remain covered, not only traces, alerts, and data sources.
- **What was done:** Extended the provider contract check to require Grafana Loki dashboard rows to build Grafana Explore URLs through `grafanaLogsUrl`, preserve the LogQL range query state, and attach hidden row-link metadata with the “Open in Grafana” label.
- **Key decisions:** The runtime behavior was already implemented in `main/services/providers/grafana.ts`; this change makes it regression-guarded alongside Tempo trace links, alerting links, and datasource edit links.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add per-rule snoozes to Command Center suppression
- **Goal:** Make the Command Center suppression card cover every active alert-delivery suppression path, including per-rule snoozes.
- **What was done:** The notification suppression card now includes active alert-rule snoozes alongside global snooze and active maintenance windows. Snoozed rule rows show the rule name, snooze expiration, scope, and an Open action that selects the exact alert rule through the existing `alerts.select.v1` handoff. Contract checks now guard the per-rule snooze evidence path.
- **Key decisions:** This reuses the existing alert-rule list already loaded by Command Center. It adds no backend IPC, storage schema, provider calls, or credential handling.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Surface notification suppression in Command Center
- **Goal:** Make active global snooze and maintenance-window suppression visible on the first screen so users can tell when notifications or alert delivery are intentionally quiet.
- **What was done:** Added a `useMonitorSettings` renderer hook that reads `monitor:getSettings` and stays current through `settings:monitor-changed`, then added a Command Center `Notification suppression` section showing active global snooze and currently active maintenance windows with scope and time range. The section opens Settings through the existing `window:openSettings` IPC, and contract checks now guard the settings hook and suppression surface.
- **Key decisions:** This mirrors the backend maintenance-window active-time semantics in renderer display code only. It adds no backend IPC, storage schema, provider calls, or credential handling.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add row-level firing alert evidence to Command Center
- **Goal:** Make firing alert rules visible as first-screen evidence instead of only contributing to the issue total and suggested action list.
- **What was done:** Added a compact `AlertRuleRow` section for currently firing rules, including scope, metric, current value, threshold, and firing duration when available. Each row opens the exact alert rule through the existing `alerts.select.v1` handoff, and contract checks now guard the row-level firing-rule evidence path.
- **Key decisions:** This is renderer-only and reuses the existing alert rule/state hooks. It adds no backend IPC, storage schema, provider calls, or credential handling.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add row-level SLO risk evidence to Command Center
- **Goal:** Make the Command Center's SLO risk total auditable instead of only showing a summary card and suggested action.
- **What was done:** Added a compact `SloRiskRow` preview section listing at-risk SLOs with scope, target, remaining budget, burn rate, and retained sample count. Selecting a risky SLO opens Insights through the existing `insights.filters.v2` handoff scoped to that SLO, and contract checks now guard the row-level SLO evidence path.
- **Key decisions:** This is renderer-only and reuses existing retained-history SLO status data. It adds no backend IPC, storage schema, provider calls, or credential handling.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add SLO risk to Command Center
- **Goal:** Make the first screen include retained-history reliability risk, not only live incidents/checks/rules.
- **What was done:** Command Center now loads SLO statuses, includes at-risk SLOs in the current issue total, adds a SLO risk summary card, and adds a suggested action when any SLO is at risk. Clicking the card/action opens Insights with `insights.filters.v2` scoped to the risky SLO target when available. Contract checks now guard the SLO risk hook, count/action state, and Insights handoff key.
- **Key decisions:** This reuses retained-history SLO status data and existing renderer filter state. It does not add backend IPC, storage schema, provider calls, or credential handling.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Make Command Center issue totals use full data
- **Goal:** Keep the first-screen operational summary from underreporting issues when more rows exist than the compact preview renders.
- **What was done:** Split Command Center issue/activity collections into full `all*` arrays for summary counts, suggested-action details, and section badges, plus capped `visible*` arrays for row previews. Sections now show “Showing X of Y” when a preview is capped, and the Current issues summary includes warning rows in its total/copy. Contract checks now guard the full-total versus visible-row split.
- **Key decisions:** This is renderer-only and keeps the same compact UI density. It does not add backend IPC, storage, provider calls, or new data fetching.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Scope Command Center actions to exact destinations
- **Goal:** Make the Command Center more actionable by landing users on the specific account, check, rule, incident, retained event, or dashboard item that needs attention instead of only opening broad tabs.
- **What was done:** Command Center suggested actions, summary cards, account-attention rows, failing monitor rows, down uptime rows, active incident rows, and retained activity rows now write the same one-shot handoff payloads used elsewhere in the app. Accounts open the exact account dialog, uptime rows apply the matching check/status filter, single firing rules open their editor while multiple firing rules apply the firing filter, local incidents select the exact incident, live incidents apply scoped incident filters, retained activity rows apply a scoped Timeline drilldown, and provider issue rows open the detailed Dashboard item log/detail context. Contract checks now guard these Command Center handoff keys.
- **Key decisions:** This is renderer-only and reuses existing localStorage handoff contracts; it adds no IPC, storage schema, provider calls, or credential handling.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Suggest alert-rule thresholds from retained history
- **Goal:** Make alert-rule creation less guessy by deriving a starting threshold from retained local samples.
- **What was done:** Extended the Alert Rules dialog's retained-history simulation to compute percentile-based threshold suggestions for failure-rate, open-incident, and check-latency rules, including suggestions before the user enters a threshold. The dialog now shows the suggested value, basis, and a Use suggestion action while preserving breach simulation once a threshold is set. The rule list and filtered CSV export also surface retained-history suggested thresholds for sample-backed rules, and differing row suggestions can be applied to the saved rule after confirmation. Contract checks now guard the suggestion helper plus editor/list/export/apply affordances.
- **Key decisions:** Check-down rules remain boolean and do not receive fabricated threshold suggestions. Suggestions are renderer-only, use retained local history/check samples, and do not change saved rule storage or backend evaluation.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Surface alert-rule tuning context in the rule list
- **Goal:** Move the alerting V2 tuning workflow out of the editor-only path so users can scan for noisy rules before opening each one.
- **What was done:** Added retained 24h rule simulations for sample-backed alert rules directly in the Alert Rules list, scoped by rule account/group/provider from per-account retained samples. Rule rows now show retained breach counts and max values, and alert-rule CSV exports include `historyEvaluated24h`, `historyBreaches24h`, and `historyMax24h`. Contract checks now guard the tuning helper, row context, and export columns.
- **Key decisions:** Check latency/down rules still use the existing editor-side per-check history hook because those require per-check series queries. Severity-filtered incident rules keep the existing note that retained samples count all incidents/alerts while event evidence handles severity.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add panel-level dashboard refresh overrides
- **Goal:** Complete the dashboard V2 range/refresh override slice by letting individual panels choose their own refresh cadence instead of only inheriting the dashboard-level refresh.
- **What was done:** Added optional `refreshSeconds` to dashboard panel/template types, normalized panel refresh values on save/import with the same 15-second minimum as dashboard refresh, exposed a Panel refresh field in the panel editor, added panel metadata badges for overrides, and made panel queries use `panel.refreshSeconds ?? dashboard.refreshSeconds`. Contract checks now guard the schema, normalization, editor, and runtime fallback.
- **Key decisions:** This is still metadata in `dashboards.json` and stores no credentials. Leaving a panel refresh blank keeps the dashboard-level refresh behavior.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Persist dashboard variables for local panels
- **Goal:** Move custom dashboards toward reusable V2 dashboards by letting a dashboard carry its own non-secret scope defaults instead of relying only on per-tab runtime filters.
- **What was done:** Added `DashboardVariables` to shared backend/renderer types and `dashboards.json` normalization, exposed dashboard variables in the dashboard metadata dialog, applied variables to local panels unless a panel has a narrower explicit scope, kept runtime filters as temporary overrides, and preserved live provider query parameters. Dashboard export/import now includes and remaps account/group/check references used by dashboard variables. Contract checks guard the schema, normalization, render application, and import/export remapping.
- **Key decisions:** Variables are metadata only: group/provider/account/check/owner/tier/dependency. They never store provider credentials and do not silently rewrite live provider query panels.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Command Center first screen
- **Goal:** Start the product-improvement roadmap with a useful operations entry point instead of landing directly in the detailed grouped provider dashboard.
- **What was done:** Added `renderer/main/command-center-view.tsx`, made it the root `/` route, preserved the existing live grouped provider Dashboard at `/dashboard`, and updated sidebar/command-palette shortcuts and dashboard item-log handoffs accordingly. The Command Center uses existing snapshot/accounts/checks/dashboards/local-incident/history/rule hooks to summarize current issues, enabled accounts, active incidents, aggregate status, account attention, retained 24h activity, and suggested next actions.
- **Key decisions:** This is renderer-only and adds no backend IPC, storage, provider calls, or secret handling. It deliberately summarizes real local/live app state already available through existing hooks rather than seeding placeholder metrics.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Disable automatic retries for dashboard panel queries
- **Goal:** Keep invalid custom dashboard queries as single panel-level errors instead of repeatedly reissuing the same bad provider query.
- **What was done:** Dashboard panel `useQuery` calls now set `retry: false`, so provider query validation/runtime failures settle directly into the existing panel error callout. Contract checks now guard this no-retry behavior.
- **Key decisions:** Manual panel refresh and dashboard refresh still work. This only disables automatic retry loops for a failed panel run, which is more appropriate for user-authored SQL/HogQL/TraceQL/LogQL input errors.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Preserve empty dashboards during import
- **Goal:** Make dashboard export/import round-trip valid dashboards even when they intentionally have no panels yet.
- **What was done:** Dashboard import now skips a dashboard only when it had source panels and all of them failed reference remapping. Exported dashboards with an empty panel list are imported as empty dashboards instead of being counted as skipped. Contract checks now guard this distinction.
- **Key decisions:** Malformed or unmatched panels are still skipped, and dashboards whose provided panels all fail remapping are still skipped. This change only treats “no panels were provided” as a valid empty dashboard state.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Include filter evidence in history event CSV exports
- **Goal:** Make retained-history event exports carry the same fields users can filter by and use for investigation correlation.
- **What was done:** Added `sourceUid` and `category` columns to event CSV exports from `history:export`, matching fields already stored on `HistoryEvent` and already used by filters. Contract checks now guard those export columns.
- **Key decisions:** This does not change stored history, JSON exports, or query semantics. It only improves the CSV projection so filtered exports remain explainable outside the app.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Persist Grafana dashboard preset migration only once
- **Goal:** Keep the Grafana preset-to-dashboard migration from rewriting `dashboards.json` on every dashboard load after the migration flag is already set.
- **What was done:** `dashboard-store` now records whether the loaded file still needs the empty-dashboard Grafana preset migration before running migration logic, and only saves when that first migration pass actually sets `migratedGrafanaPresets`. Contract checks now guard the one-time migration persistence condition.
- **Key decisions:** This does not change the migration output: existing saved Grafana LogQL/TraceQL presets are still imported only when no dashboards exist, and Grafana account config remains intact. The change only avoids unnecessary repeated writes after migration has completed.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Keep custom date filters open through now
- **Goal:** Prevent sparse retained-history data from blocking current custom date windows in filtered views.
- **What was done:** Adjusted shared retained-history date bounds so the minimum stays capped by the retained/oldest local data window, while the maximum remains the current time instead of the newest retained row timestamp. The shared custom date filter now also normalizes previously stored custom `from`/`to` values against current bounds when retention settings or history bounds change. Contract checks now guard that custom date inputs can select ranges through now and that stored custom ranges are normalized.
- **Key decisions:** Backend history queries still enforce retention and row availability. This is a renderer UX correction so live snapshot rows and current retained-history queries are not artificially hidden when local history is sparse.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Gate Grafana dashboard capabilities by datasource support
- **Goal:** Avoid showing Grafana Loki/Tempo live dashboard options when an account has no configured or discoverable datasource support for them.
- **What was done:** Grafana dashboard capability loading now parses saved observability config and discovers datasource types before advertising Loki LogQL, Tempo TraceQL, or Tempo service-name defaults. Alerts and datasource health remain available for Grafana accounts, while Prometheus remains discovery-based. Contract checks now guard the Loki/Tempo capability gates, Grafana alert/datasource/trace row-link metadata, and direct row-link metadata for other stable provider dashboard rows.
- **Key decisions:** This keeps the one-click Recent traces path for accounts with a Tempo datasource, but avoids presenting unsupported live defaults as if every Grafana account had Tempo/Loki. Existing saved panels still fail at panel level if their datasource is removed, preserving the current error boundary behavior.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Better Stack dashboard row links
- **Goal:** Extend dashboard row direct-link behavior to another provider-backed default/query surface where a stable provider URL exists.
- **What was done:** Better Stack dashboard SQL/log rows now include hidden `__url`/`__urlLabel` metadata pointing to Better Stack Telemetry, so dashboard table/log panels show the existing compact row-level open action without exposing metadata columns. Contract checks now guard this row-link metadata.
- **Key decisions:** This is a stable provider-page link rather than a fabricated object-specific URL. It reuses `monitorApi.openExternal` through the existing dashboard table renderer and does not persist provider credentials or row data.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Cap live dashboard custom query limits
- **Goal:** Enforce the result-limit part of provider-backed custom dashboard query safety, not just read-only query shape.
- **What was done:** Supabase analytics SQL, PostHog HogQL, and Better Stack SQL dashboard runners now cap explicit user-provided `LIMIT` values to provider-safe maxima while still adding a default limit when omitted. Contract checks now verify those read-only dashboard providers keep limit bounding in place.
- **Key decisions:** This does not loosen query support or add provider capabilities. Queries still must be single-statement `SELECT`s and credentials remain backend-only; the change only reduces runaway result sizes for supported read-only custom query panels.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Clarify Insights history filter misses
- **Goal:** Make Insights empty states match the cross-app filter contract instead of implying retained history is missing when filters hide it.
- **What was done:** Insights now uses retained-history stats to distinguish a genuinely empty history store from a selected range/filter set with no matching samples. It shows a filter-miss empty state with reset action when retained rows exist but the current filters return no trend points. The SLO filter miss copy now references all current filters, not only service metadata filters.
- **Key decisions:** This is renderer-only and reuses the existing `history:getStats` data already loaded for date bounds. It does not change history queries, exports, provider calls, or retained storage.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Cap custom date filters by retained history
- **Goal:** Make custom date filters reflect the retained local-history window instead of relying only on backend query clamping.
- **What was done:** Added retained-history bounds to the shared date-range filter. Dashboard, Apps, Insights, Incidents, Timeline, and Uptime now load `history:getStats`, compute retained min/max datetime bounds, pass them into the custom range inputs, and clamp manually typed values before persisting filters.
- **Key decisions:** This reuses the existing `history:getStats` IPC and does not add backend state, provider access, or credential handling. Backend history queries still clamp to retention as the final authority.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Guard filter and row-link contracts
- **Goal:** Make the custom dashboard and cross-app filter work harder to regress accidentally while continuing the stabilization phase.
- **What was done:** Extended `scripts/check-provider-contracts.ts` to verify the shared persisted filter popover is used by data-heavy views, date-filtered tabs use the shared date range controls, history events accept custom date/scope/status/severity/category/type filters, dashboard row links keep hidden `__url` metadata out of visible columns while opening through `monitorApi.openExternal`, and dashboard runtime filters only rewrite local panels while preserving narrower saved panel scope.
- **Key decisions:** This remains a source-based, credential-free verifier. It does not load the Glaze runtime, call provider APIs, inspect user data, or replace runtime/manual testing for live credentials.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add command-palette smoke verification
- **Goal:** Make the live smoke verification workflow discoverable from Cmd/Ctrl-K.
- **What was done:** Added a Run smoke verification command-palette action that writes a one-shot `accounts.verify.v1` payload and navigates to Accounts. The Accounts verification panel consumes that payload once and runs smoke verification with notification-channel delivery tests off, preserving the existing safety default.
- **Key decisions:** This is renderer-only navigation/action state and does not add IPC or change `verification:run`. Real Slack/webhook delivery tests remain opt-in from the Accounts panel toggle.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add apply-retention history prune
- **Goal:** Let users shrink retained-history storage immediately after changing the retention window, without clearing all history.
- **What was done:** Added `pruneRetainedHistory()` to `history-store`, `history:prune` IPC, a typed `monitorApi.pruneHistory()` wrapper, an Apply retention now action in Settings, and contract checks covering prune IPC wiring. The action applies the current retention window and row caps to `history.json`, then returns fresh stats including file size.
- **Key decisions:** Retention pruning is explicit rather than automatic on every settings save. It preserves in-window samples/events/check samples and SLO definitions, while Clear retained history remains the destructive reset.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Show retained history storage size
- **Goal:** Complete the retention control slice by showing users how much disk space retained history uses.
- **What was done:** Added `DataStore.sizeBytes()`, included `storageBytes` in `HistoryStats`, displayed formatted `history.json` size in Settings next to retained sample/event/check/SLO counts, and extended the contract check to keep storage-size reporting wired.
- **Key decisions:** The size is limited to `history.json` because the retention controls affect retained history only. Other configuration stores remain visible through their existing setup/export surfaces and are not included in the history-size number.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add clear retained history action
- **Goal:** Improve data-retention trust controls by letting users clear local retained history without disturbing configuration or secrets.
- **What was done:** Added `clearRetainedHistory()` to `history-store`, `history:clear` IPC, a typed `monitorApi.clearHistory()` wrapper, Settings UI with a destructive confirmation, and contract checks covering the clear IPC wiring. The action clears samples, discrete history events, and check latency samples, then returns fresh stats.
- **Key decisions:** SLO definitions are preserved because they are user configuration, while SLO status naturally becomes empty until new samples accumulate. Accounts, tokens, dashboards, checks, rules, local incidents, triage, service metadata, and notification channels are unchanged.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Extend contract checks for app boundaries
- **Goal:** Guard the security/navigation invariants that matter most after replacing the Grafana tab with custom dashboards.
- **What was done:** Extended `scripts/check-provider-contracts.ts` to verify only `renderer/preload.ts` imports/references `ipcRenderer`, the old `/grafana` route/sidebar/command-palette entry and `grafana-view.tsx` stay removed, `dashboard-store.ts` does not import/read tokens, dashboard definitions persist to `dashboards.json`, and dashboard export/import handlers keep `secretsIncluded: false`.
- **Key decisions:** The check remains source-based and credential-free. Live provider query execution can still read tokens through `dashboard-query-runner.ts`; the guarded invariant is that dashboard persistence/export code never stores or exports secrets.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add provider contract verification
- **Goal:** Start the stabilization/test phase by adding a cheap guardrail for provider and dashboard capability regressions.
- **What was done:** Added `scripts/check-provider-contracts.ts` and `npm run test:contracts`. The check validates all 14 provider modules are registered, mirrored in backend/renderer provider unions, represented in provider metadata, declare exactly one password secret field, expose registry token-boundary helpers, and implement dashboard capability loading/running hooks as a pair.
- **Key decisions:** The script is source-based and credential-free because plain `tsx` does not load the Glaze SDK runtime aliases outside the Glaze CLI. It does not call provider APIs or read userData, so it is safe for local validation and CI-style checks.
- **Validation:** `npm run test:contracts`, `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add pinned default filter presets
- **Goal:** Complete the saved-view filter workflow by letting users choose a default saved filter preset per tab.
- **What was done:** The shared Filters popover now lets users mark a selected preset as the tab default or clear that default. Default preset ids are stored in JSON-compatible `.presets.default` localStorage keys, auto-apply only when the tab has no restored filter state, and are included in both renderer-collected and backend-allowlisted portable setup filters.
- **Key decisions:** Default presets remain renderer-side and store only preset ids, not provider credentials. Existing filter state wins over a default preset so reopening a tab does not overwrite active saved filters.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add saved-filter preset management
- **Goal:** Make saved filter presets usable as ongoing saved views instead of one-shot snapshots.
- **What was done:** The shared Filters popover now supports applying a preset, updating the selected preset with the current filters, renaming the selected preset, deleting presets, and preventing duplicate preset names. Every data-heavy view using the shared `FilterMenu` inherits the behavior.
- **Key decisions:** This is renderer-only and keeps preset data in the existing per-tab localStorage preset keys. No IPC, backend storage schema, provider calls, or secret handling changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Centralize renderer CSV downloads
- **Goal:** Reduce duplicate CSV escaping/download code introduced by the cross-view export work.
- **What was done:** Added a shared `renderer/main/utils/csv.ts` helper and switched Dashboard, Apps, Insights SLOs, Incidents, Timeline, Uptime, Alert Rules, Accounts, Custom Dashboard table exports, and Settings notification-channel exports to use it.
- **Key decisions:** Row construction stays local to each view because each export has domain-specific columns. The shared helper owns only CSV escaping and browser download mechanics, so behavior and security boundaries remain unchanged.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add notification-channel filter reset
- **Goal:** Keep Settings filter miss behavior consistent with the rest of the data-heavy app views.
- **What was done:** Notification Channels now shows a Reset filters action when channel filters hide every configured channel.
- **Key decisions:** This is renderer-only and reuses the existing persisted filter reset helper. No IPC, storage schema, provider calls, or secret handling changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Export filtered Insights SLOs
- **Goal:** Make Insights SLO/error-budget state portable independently from retained history event exports.
- **What was done:** Insights now has an Export SLOs action that downloads the currently filtered SLO cards with scope, target, window, compliance, remaining budget, burn rate, risk state, success/failure counts, created/updated timestamps, and service owner/tier/dependency metadata.
- **Key decisions:** The export is renderer-only and uses the SLO status and service metadata already loaded by the view. The existing retained-history export remains unchanged for event/sample handoff.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Export filtered notification channels
- **Goal:** Make Settings notification-channel routing metadata portable without exposing webhook URLs.
- **What was done:** Notification Channels now has an Export CSV action that downloads the currently filtered channel list with id, name, type, enabled state, URL configured/missing state, and subscribed event kinds.
- **Key decisions:** The export is renderer-only and uses the channel list already returned by `channels:list`, which exposes only `hasUrl` rather than the encrypted webhook URL. It does not add IPC, storage schema, provider calls, or secret exposure.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Export filtered Accounts diagnostics
- **Goal:** Make filtered account setup and diagnostic state portable without using the migration-oriented setup bundle.
- **What was done:** Accounts now has an Export CSV action that downloads the currently filtered account list with provider/group/enabled state, identity, token presence, encryption/validation status, missing config, last sync/error, stale/backoff details, and live dashboard capability support/counts/languages/result kinds.
- **Key decisions:** The export is renderer-only and uses visible filtered accounts plus non-secret diagnostics already loaded by the view. It does not include tokens, webhook URLs, account secret values, IPC changes, provider calls, or storage schema changes.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Export filtered Incidents rows
- **Goal:** Make the Incident Center's filtered local and live incident queues portable for response handoff.
- **What was done:** Incidents now has an Export CSV action that downloads the currently filtered durable local incidents and live provider incident/signal rows. Rows include row type, ids/source ids, kind, title, status, severity, provider, account/group, timestamps, acknowledgement/silence/resolution fields, assignee/root cause/resolution, related-event and note counts, URL, service owner/tier/dependency metadata, and detail text.
- **Key decisions:** The export is renderer-only and uses visible filtered local/live rows plus triage/account/service metadata already loaded by the view. It does not add IPC, storage schema, provider calls, or credential access.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Export filtered Dashboard rows
- **Goal:** Make the main Dashboard's visible live monitor rows and retained activity portable in one filtered handoff.
- **What was done:** Dashboard now has an Export CSV action that downloads the currently filtered account summaries, current monitor items, and retained activity events. Rows include row type, timestamp, provider, account, group, status, category, kind/type, title, severity, URL, owner/tier/dependency metadata, and detail/source fields.
- **Key decisions:** The export is renderer-only and uses the visible account sections, filtered monitor rows, retained activity query, and service metadata already loaded by the view. It does not add IPC, storage schema, provider calls, or credential access.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Export filtered Apps service inventory
- **Goal:** Make the Apps cockpit's filtered service inventory portable for operational reviews and handoffs.
- **What was done:** Apps now has an Export CSV action that downloads the currently filtered service/app list with health, provider coverage, visible and total account counts, visible account labels, incident/alert/signal counts, stale visible-account count, deploy/update timestamps, service owner/tier/dependencies, service links, and deep-link count.
- **Key decisions:** The export is renderer-only and uses visible filtered services plus snapshot/account/service metadata already loaded by the view. It does not add IPC, storage schema, provider calls, or credential access.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Export filtered Alert Rules
- **Goal:** Make filtered alert-rule configuration and health state portable for audits and handoffs.
- **What was done:** Alert Rules now has an Export CSV action that downloads the currently filtered rule list with enabled state, current firing/pending/OK/no-data state, health label/detail, metric/operator/threshold, scope, severity/sustain/cooldown/dedupe settings, channel count, snooze timestamp, and service owner/tier/dependency metadata.
- **Key decisions:** The export is renderer-only and uses rule, state, health, channel, check, and service metadata already loaded by the view. It does not add IPC, storage schema, provider calls, or credential access.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Export filtered Uptime checks
- **Goal:** Make the Uptime view's filtered operational state portable for review and handoff.
- **What was done:** Uptime now has an Export CSV action that downloads the currently filtered check list with endpoint config, enabled state, group, current up/down/pending status, last probe timestamp/status/latency/error, and service owner/tier/dependency metadata.
- **Key decisions:** The export is renderer-only and uses the visible filtered checks plus the current snapshot results already loaded by the view. It does not add IPC, storage schema, provider calls, or credential access.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Export filtered Timeline events
- **Goal:** Keep Timeline data portable in the same filtered shape users are reviewing in the app.
- **What was done:** Timeline now has an Export CSV action that downloads the currently filtered retained event set, including timestamp, type, provider, account, group, status, severity, category, source uid, and provider URL columns.
- **Key decisions:** The export is renderer-only and uses the already loaded filtered event array, so no IPC, storage schema, provider calls, or credential access changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add alert-rule health badges and filters
- **Goal:** Make unhealthy or risky alert rules visible without opening each rule.
- **What was done:** Alert Rules now derives a health state for every rule and shows a badge/detail on the rule row. The Filters menu can narrow by healthy, firing, pending, no data, disabled, suppressed, missing target, noisy, or delivery issue states.
- **Key decisions:** Health classification is renderer-only and uses existing rule state, scope targets, provider/account/group/check lists, channel metadata, and snooze settings. It does not add IPC, storage schema, provider calls, or credential access.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add PostHog default row links
- **Goal:** Improve dashboard direct-link coverage for provider defaults without fabricating links for arbitrary query output.
- **What was done:** Built-in PostHog recent-exception dashboard rows now include hidden row URLs to the project Error Tracking page, so dashboard tables show an Open action for those default rows. Generic custom HogQL result rows remain unlinked unless the query returns a stable provider identity in a future adapter path.
- **Key decisions:** The default HogQL aggregation does not return issue IDs, so the link targets the stable project Error Tracking page rather than pretending each aggregate row has a direct issue URL. No secrets, storage schema, or provider mutations changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Honeycomb dashboard row links
- **Goal:** Continue provider-depth/direct-link coverage so dashboard rows open the relevant provider object where stable URLs exist.
- **What was done:** Honeycomb accounts now support optional non-secret `teamSlug` and `uiBaseUrl` fields. Honeycomb trigger/SLO monitor items, metrics summaries, and live dashboard trigger/SLO rows now include Honeycomb UI URLs; dashboard tables show row-level open actions through the existing hidden `__url` metadata.
- **Key decisions:** Direct trigger/SLO paths are generated only from non-secret UI path metadata plus dataset/object ids. If team/environment/dataset path information is incomplete, the adapter falls back to the Honeycomb UI base URL instead of inventing an object-specific URL.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add local incident lifecycle timeline
- **Goal:** Make local incident state progression visible without requiring users to infer it from notes and related provider events.
- **What was done:** Local incident detail now renders a Lifecycle section derived from persisted created, acknowledged, note, and resolved timestamps, with status-colored rows and relative times.
- **Key decisions:** The timeline is derived from fields already stored on local incidents and notes, so no storage schema, IPC, provider calls, or credential behavior changed. It does not invent missing state transitions that are not persisted.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add copyable incident postmortem drafts
- **Goal:** Let users turn local incident evidence into a postmortem draft without manually collecting notes, timeline, and links.
- **What was done:** Local incident detail now has a Postmortem action that copies a Markdown draft to the clipboard. The draft includes summary, incident metadata, impact placeholder, timeline, root cause/resolution fields, retained evidence links, service context, and follow-up actions derived from missing owner/runbook/root-cause/resolution/notes/evidence.
- **Key decisions:** This is renderer-only and uses the existing browser clipboard path already used for follow-up tasks. It does not add IPC, storage schema, provider calls, credential handling, or a new file export format.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add main navigation shortcuts
- **Goal:** Improve native keyboard navigation for the main app shell.
- **What was done:** Root navigation now supports `Cmd/Ctrl+1` through `Cmd/Ctrl+9` for Dashboard, Apps, Insights, Incidents, Timeline, Uptime, Alert Rules, Dashboards, and Accounts. The command palette's Go To rows now display the matching shortcut hints.
- **Key decisions:** Shortcuts are ignored while focus is in editable inputs/selects/textareas/contenteditable regions, and they reuse the existing in-memory router routes. No IPC, storage, provider calls, or credential behavior changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Simulate alert rules over retained history
- **Goal:** Make alert-rule setup less blind by showing whether a draft rule would have matched recent retained data.
- **What was done:** The Alert Rules dialog now automatically simulates the draft over the last 24h. Failure-rate and open-incident rules use scoped retained history samples; latency and uptime-down rules use retained check samples. The UI shows evaluated samples, breach count, latest/max values, first/last breach times, and keeps the existing current preview/test delivery actions.
- **Key decisions:** This is renderer-only and reuses existing history/check hooks, so no new IPC, storage schema, provider calls, or credential handling were added. Open-incident severity thresholds are still evaluated by the current preview and recent event evidence because retained sample rows do not store severity breakdowns.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add provider capability matrix
- **Goal:** Make provider coverage and dashboard capability support visible at a glance instead of only per account.
- **What was done:** Accounts now includes a provider capability matrix for all registered providers. The matrix shows connected/enabled account counts, diagnostic status distribution, local dashboard panel availability, live dashboard support/load state, one-click default counts, custom-query counts, result kinds, and actions into filtered Accounts or provider-filtered Custom Dashboards.
- **Key decisions:** The matrix is renderer-only and uses existing provider metadata plus non-secret account diagnostics. It does not fetch credentials, add IPC, change storage, or fabricate provider live-query support for providers without diagnostics/capability declarations.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Filter Insights history exports
- **Goal:** Keep exported Insights data aligned with the date and scope filters currently visible in the view.
- **What was done:** `history:export` now accepts optional retained-history date/scope/event filters while preserving the old unfiltered export behavior when filters are omitted. Insights CSV export sends its active date, group, provider, account, and event-type filters so exported rows match the visible retained-history scope.
- **Key decisions:** Service metadata filters remain renderer-side display filters and are not pushed into the backend export path because they are local annotations layered over history records rather than native history fields. No secrets, provider credentials, or provider APIs are involved.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add SLO target drilldowns
- **Goal:** Make scoped SLO cards traceable back to the monitored account, group, or provider.
- **What was done:** Insights SLO cards now include an Open target action for account/group/provider-scoped SLOs. The action opens Accounts with the matching account selection or filters through the existing one-shot handoff.
- **Key decisions:** All-activity SLOs remain without a target action because there is no narrower destination. No IPC, storage schema, provider calls, or credential behavior changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add alert-rule target drilldowns
- **Goal:** Make alert rules traceable back to the account, provider, group, or uptime check they monitor.
- **What was done:** Scoped alert-rule rows now include an Open target action. Check-scoped rules open Uptime filtered to the exact check id, while account/group/provider-scoped rules open Accounts with the matching selection or filters.
- **Key decisions:** This uses existing renderer one-shot handoffs (`uptime.drilldown.v1`, `accounts.select.v1`) and does not add IPC, storage schema, provider calls, or credential access.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add incident related-event open actions
- **Goal:** Keep local incident evidence actionable inside the incident detail view.
- **What was done:** Related timeline rows in local incident detail now include an open action for each retained event URL.
- **Key decisions:** This reuses the existing external URL helper and only affects retained events already shown in the incident detail. No IPC, storage, provider, or credential behavior changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Start incidents from down uptime checks
- **Goal:** Let users turn a failing synthetic check into a local incident without manually copying check details.
- **What was done:** Down Uptime check cards now include a Start incident action. Incidents accepts the uptime-check handoff and opens a local manual incident draft with the check id, URL, status, HTTP code/error, latency, title, and severity prefilled.
- **Key decisions:** Uptime checks remain synthetic local data, not provider `HistoryEvent`s, so incidents created from checks use the existing local manual incident source kind instead of widening provider/event types. No backend IPC, storage schema, provider call, or credential behavior changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Uptime endpoint open action
- **Goal:** Let users inspect the exact URL behind a failing or suspicious uptime check directly from the Uptime card.
- **What was done:** Uptime check cards now include an Open endpoint action alongside alert, edit, and delete actions. The action uses the existing `monitor:openExternal` IPC wrapper.
- **Key decisions:** This only opens the configured URL; it does not run an extra probe or change check state. No backend IPC, storage schema, provider API, or credential handling changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Apps account remediation actions
- **Goal:** Let users fix stale or failing account coverage directly from the Apps cockpit.
- **What was done:** Apps account coverage rows now include Edit Account and Refresh Account actions. Edit opens the existing Accounts account dialog through the one-shot account selection handoff, while Refresh triggers a single-account monitor refresh.
- **Key decisions:** This mirrors account diagnostics remediation behavior and uses existing `accounts.select.v1` plus `monitor:refresh`. No new IPC, storage schema, provider mutation, or credential handling changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Apps metric summary actions
- **Goal:** Make Apps metric summaries actionable when providers expose stable metric/source URLs or non-success metric state.
- **What was done:** Apps metric summary rows now show a provider-open action when the summary includes a URL and an alert-rule draft action when the summary is non-success. The draft opens Alert Rules with an editable account/provider-scoped failure-rate rule.
- **Key decisions:** Metric summaries do not create local incidents directly because they are aggregate health evidence rather than a concrete incident/signal source. The feature reuses existing `alerts.draft.v1` and `monitor:openExternal` paths with no backend or credential changes.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Start incidents from Apps live sources
- **Goal:** Make Apps active incident and signal rows actionable, not only informational/provider-link rows.
- **What was done:** Apps active incident and signal rows now include local-incident and alert-rule draft actions alongside provider-open. Incidents accepts the Apps live source handoff and opens a local incident draft with the source kind, account/provider, severity, URL, and source UID preserved.
- **Key decisions:** This reuses existing renderer handoffs and the existing local incident dialog. Alert drafts use the existing open-incidents metric with the source severity as the threshold. No backend IPC, storage schema, provider mutations, or credential behavior changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Apps activity row actions
- **Goal:** Make service-level activity in Apps actionable without returning to Dashboard or Timeline.
- **What was done:** Apps cockpit activity rows now include provider-open, start-investigation, and alert-rule draft actions. Investigation opens a local incident draft from the monitor item, while non-success activity drafts an account/provider-scoped failure-rate alert rule.
- **Key decisions:** This reuses existing `incidents.create.v1`, `alerts.draft.v1`, and `monitor:openExternal` paths. No backend IPC, storage schema, provider API, or credential handling changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Draft alert rules from Timeline events
- **Goal:** Make retained Timeline events as actionable for alert setup as Dashboard activity rows.
- **What was done:** Timeline event rows now show an alert-rule action for failure, alert, and incident events. The action opens Alert Rules with an editable draft scoped to the event account/provider, using failure-rate for failures and open-incidents with the event severity threshold for alerts/incidents.
- **Key decisions:** Deploy/recovery events do not show alert drafting because they are evidence, not alert conditions. The feature reuses the existing `alerts.draft.v1` renderer handoff and does not add IPC, storage, provider calls, or credentials.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Make Dashboard history activity actionable
- **Goal:** Let users act on the main Dashboard's retained “Activity in range” rows without jumping to Timeline first.
- **What was done:** Dashboard history event rows now include start-investigation and alert-rule actions in addition to opening the provider URL. Investigate opens a local incident draft from the retained event; alert creates an editable scoped draft for failure, alert, and incident events.
- **Key decisions:** The actions reuse existing `incidents.create.v1` and `alerts.draft.v1` renderer handoffs. Deploy/recovery events stay unlinked for alert drafting because they do not imply an alert condition on their own.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Draft alert rules from Dashboard rows
- **Goal:** Let users turn a failing main Dashboard row into an alert-rule draft without manually recreating the scope.
- **What was done:** Non-success monitor rows now show a row-level alert action. The action creates an editable failure-rate alert-rule draft scoped to the row's account when available, then opens Alert Rules for review and save.
- **Key decisions:** This reuses the existing `alerts.draft.v1` renderer handoff and existing alert-rule dialog. It does not save rules automatically, add IPC channels, call provider alert APIs, or expose credentials.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add remediation actions to account diagnostics
- **Goal:** Let setup diagnostics lead directly to fixes instead of only reporting account problems.
- **What was done:** Account diagnostics rows now include Edit and Refresh actions alongside Dashboards and Run. Edit opens the existing account dialog for missing token/config remediation, while Refresh triggers a single-account monitor refresh for stale sync/error checks.
- **Key decisions:** This is a renderer workflow improvement over existing account edit and `monitor:refresh` paths. No new IPC channels, storage schemas, provider credentials, or secret handling changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Start incidents from Dashboard rows
- **Goal:** Let users start an investigation from the main Dashboard activity row they are already looking at.
- **What was done:** Dashboard account rows now expose a start-investigation action. The action sends the `MonitorItem` through the existing `incidents.create.v1` renderer handoff, and Incidents opens a local incident draft with title, description, source URL, account/provider, source uid, and severity derived from the monitor row.
- **Key decisions:** Monitor rows create local manual incidents because they are normalized activity rows, not provider-side incidents. No backend storage, IPC, provider mutation, or credential behavior changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add command-palette setup create actions
- **Goal:** Make core setup workflows reachable from search instead of requiring users to navigate to each tab first.
- **What was done:** Cmd/Ctrl-K now includes Add provider account, Create dashboard, and Add uptime check actions. Accounts, Dashboards, and Uptime consume new one-shot localStorage create handoffs to open the add account dialog, dashboard template dialog, or add check dialog after navigation.
- **Key decisions:** These are renderer-only workflow handoffs. They do not add IPC, storage schema, provider credential access, or backend mutations beyond what the existing dialogs already perform after user confirmation.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Show check history in alert-rule dialog
- **Goal:** Give uptime-down and latency alert rules retained local context, matching the event history already shown for event-based rules.
- **What was done:** The alert-rule dialog now loads the selected check's last 24 hours of retained check samples and shows uptime percentage, down sample count, and average latency for check-scoped latency/check-down rules. The check latency hook now skips empty check ids so the dialog can safely wait for a selected check.
- **Key decisions:** This uses existing `checks:getLatencySeries` data and does not add provider calls, storage fields, or IPC channels.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Draft uptime-down alerts from checks
- **Goal:** Make the new uptime-down alert metric reachable from the check that users are looking at.
- **What was done:** Each Uptime check card now has an alert action that writes a `checkDown` alert-rule draft scoped to that check and opens Alert Rules for review, preview, and save.
- **Key decisions:** This reuses the existing `alerts.draft.v1` renderer handoff. No check storage, rule storage schema, IPC channel, or backend evaluator behavior changed beyond the already-added `checkDown` metric.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add create actions to command palette
- **Goal:** Make the newer investigation and alert-rule workflows reachable without first navigating to their tabs.
- **What was done:** Cmd/Ctrl-K now includes Create local incident and Create alert rule actions. The incident action opens the manual local incident dialog through the existing Incidents view, and the alert action opens Alert Rules with a prefilled failure-rate draft using the existing draft handoff.
- **Key decisions:** This is renderer-only navigation state using localStorage one-shot payloads. No IPC, storage schema, provider credentials, or backend mutations changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add uptime-down alert rules
- **Goal:** Cover the missing “uptime down” alert-rule use case instead of only supporting check latency thresholds.
- **What was done:** Added a `checkDown` alert-rule metric that evaluates the selected uptime check's current poll result as `1` when down and `0` when up. The Add Rule dialog now includes an Uptime down template, the rule list displays Down/Up values for that metric, rule storage accepts the metric, and dashboard check-uptime panels can draft a matching alert rule.
- **Key decisions:** The metric is check-scoped and uses existing local uptime check poll results from the aggregate snapshot. No provider credentials, new IPC channels, or new persisted secret data are involved.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Start incidents from dashboard event rows
- **Goal:** Make dashboard evidence rows actionable as investigation starting points.
- **What was done:** Local dashboard event panels now include hidden retained-history event metadata in their row results, and the dashboard table renderer shows an Investigate action for those rows. The action reuses the `incidents.create.v1` handoff so Incidents opens a local incident draft with the dashboard event linked as evidence.
- **Key decisions:** Hidden metadata columns remain invisible in dashboard tables and CSV exports. This applies only to local normalized event rows; provider query rows remain unlinked for incident creation unless they expose stable retained-history event identity.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Start incidents from Timeline events
- **Goal:** Make retained history events actionable as investigation starting points.
- **What was done:** Timeline event rows now include a create-incident action. It sends the retained `HistoryEvent` through a one-shot `incidents.create.v1` localStorage handoff, and Incidents opens the local incident dialog prefilled from that event with the event id linked as evidence.
- **Key decisions:** The created incident remains a local manual incident because retained history events are local evidence, not provider-side incident objects. No backend schema, IPC, provider mutation, or credential behavior changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add dashboard account drilldowns
- **Goal:** Make custom dashboard panels easier to trace back to provider/account setup and diagnostics.
- **What was done:** Dashboard panel cards now show an account-context action when the effective panel scope has an account or provider. The action opens Accounts with the exact account edit dialog when available, or applies provider/group filters when only a broader scope exists. Accounts now accepts filter payloads through the existing `accounts.select.v1` one-shot localStorage handoff.
- **Key decisions:** This is renderer-only navigation state. It reuses existing Accounts filters and selection behavior and does not add IPC, backend storage, provider credential access, or account mutations.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Lazy-load secondary data views
- **Goal:** Reduce main renderer startup cost as the app grows more data-heavy.
- **What was done:** Accounts, Apps, Incidents, and Alert Rules now use the same lazy/Suspense route pattern already used by Insights, Timeline, Uptime, and Custom Dashboards. The root dashboard remains eagerly loaded as the first screen.
- **Key decisions:** This is a router-level performance change only. Routes, IPC, storage, and view behavior are unchanged; users see the existing route fallback while a secondary view chunk loads.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass; production build now emits separate Accounts/Apps/Incidents/Alerts chunks and a smaller main-window chunk.

### 2026-07-04 — Add alert rule history context
- **Goal:** Make alert-rule preview and setup easier to reason about with retained local history, not only the current snapshot.
- **What was done:** The alert rule dialog now queries the last 24 hours of retained local history for the selected rule scope and metric type. Failure-rate rules show recent failure/recovery events, open-incident rules show recent alert/incident events filtered by the selected severity threshold, and latency rules point users to the current check preview because latency is stored as check samples rather than `HistoryEvent`s.
- **Key decisions:** This is a renderer-only read path over existing `history:getEvents`; no rule schema, persisted storage, provider API access, or evaluator behavior changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add alert rule templates
- **Goal:** Make common alert-rule setup faster and less error-prone.
- **What was done:** The Add Rule dialog now offers one-click templates for failure-rate spikes, uptime latency regression, high-severity open incidents, and provider-scoped failures. Selecting a template fills the existing rule form fields, including threshold, scope type, sustained duration, cooldown, dedupe window, and incident severity where applicable.
- **Key decisions:** Templates are renderer-only form presets and do not save automatically. They reuse the existing alert-rule schema, preview/test delivery paths, and backend evaluator without introducing new storage or IPC.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Scope Insights history series queries
- **Goal:** Make Insights charts respect group/provider/account filters at the retained-history query layer instead of deriving everything from global samples.
- **What was done:** `history:getSeries` now accepts optional group/account/provider filters, `history-store` narrows per-account sample rows and recomputes scoped totals before downsampling, and Insights passes its selected group/provider/account filters into the series hook.
- **Key decisions:** This remains local normalized history only. Service owner/tier/dependency filters still apply renderer-side because they are local service metadata overlays, while provider credentials and provider-side history APIs remain untouched.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add account-scoped dashboard handoff
- **Goal:** Make account dashboard capability diagnostics actionable instead of informational only.
- **What was done:** Each account diagnostics row now has a Dashboards action. It opens Custom Dashboards and writes the dashboard runtime filters so local panels are scoped to that account's group/provider/account immediately.
- **Key decisions:** This is renderer-only state handoff through the existing `customDashboards.filters.v2` localStorage key. No IPC, backend storage, or secrets behavior changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add dashboard default examples to smoke verification
- **Goal:** Make the live smoke verification report more useful for dashboard setup verification.
- **What was done:** The dashboard-capabilities smoke check now reports total capabilities, one-click default count, custom-query source count, and several safe example default panel names instead of only an opaque capability count.
- **Key decisions:** The report still returns status metadata only and does not expose provider credentials or raw saved query contents.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Show dashboard capability names in account diagnostics
- **Goal:** Make provider-backed dashboard defaults discoverable before users open the dashboard panel editor.
- **What was done:** Account diagnostics now return non-secret live dashboard capability labels, default panel titles, and custom query labels after the per-account Run action loads capabilities with stored credentials. The Accounts diagnostics panel includes the concrete default/custom panel names in its summary and badges.
- **Key decisions:** The diagnostics payload still never includes provider credentials, raw query text, or secrets. It only exposes adapter-declared labels and titles already safe for the renderer.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Resend dashboard panels
- **Goal:** Deepen provider-backed dashboard defaults for Resend without requiring users to write queries.
- **What was done:** Resend now exposes live dashboard capabilities for read-only domain and broadcast tables. One-click defaults support optional name/status/limit filters and row actions to open the corresponding Resend app pages.
- **Key decisions:** The implementation reuses Resend’s existing domains/broadcasts APIs and keeps log details on the existing on-demand log surface. Credentials remain backend-only; dashboards persist only account id, capability id, and non-secret filter params.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add GitHub and Cloudflare dashboard panels
- **Goal:** Deepen provider-backed CI/CD dashboard defaults using the existing normalized provider clients.
- **What was done:** GitHub now exposes a live dashboard capability for read-only workflow run tables with repo/status/limit filters. Cloudflare now exposes a live dashboard capability for read-only Pages/Workers deploy tables with project/kind/status/limit filters. Rows include direct provider links.
- **Key decisions:** Both capabilities delegate to the existing backend provider clients and filter normalized rows, so no arbitrary GitHub or Cloudflare API paths are exposed and credentials remain backend-only.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Netlify deploy dashboard panels
- **Goal:** Deepen provider-backed deployment dashboard defaults for Netlify using the existing deploy API.
- **What was done:** The Netlify adapter now exposes a live dashboard capability for read-only deploy tables. The one-click default lists recent deploys across accessible sites with optional non-secret site-name, state, and limit filters; rows link to Netlify deploy pages when available.
- **Key decisions:** The panel keeps the existing bounded site/deploy scan and does not expose arbitrary Netlify API paths. Credentials remain backend-only; dashboards persist only account id, capability id, and non-secret filter params.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Heroku release dashboard panels
- **Goal:** Deepen provider-backed deployment dashboard defaults for Heroku using the existing release API.
- **What was done:** The Heroku adapter now exposes a live dashboard capability for read-only release tables. The one-click default lists recent releases across accessible apps with optional non-secret app-name, state, and limit filters; rows link to Heroku app activity pages.
- **Key decisions:** The provider still polls a bounded app/release set and the dashboard panel does not expose arbitrary Heroku API paths. Credentials remain backend-only; dashboards persist only account id, capability id, and non-secret filter params.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Honeycomb trigger and SLO dashboard panels
- **Goal:** Deepen provider-backed dashboard defaults for Honeycomb datasets without introducing arbitrary query execution.
- **What was done:** The Honeycomb adapter now exposes live dashboard capabilities for read-only trigger and SLO tables when a dataset is configured. One-click defaults list triggers and SLO definitions with bounded non-secret filters for trigger state and row limits.
- **Key decisions:** The implementation reuses Honeycomb’s existing trigger/SLO APIs already used by polling and does not fabricate object-level links where the adapter lacks stable Honeycomb UI URLs. Accounts without a configured dataset keep local normalized dashboard panels only.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Statuspage incident and component dashboard panels
- **Goal:** Deepen provider-backed dashboard defaults for Statuspage without adding fake query semantics.
- **What was done:** The Statuspage adapter now exposes live dashboard capabilities for unresolved incidents and component health tables. One-click defaults list unresolved incidents and non-operational components, with optional non-secret filters for status/impact/limit and direct Statuspage row links.
- **Key decisions:** The implementation reuses Statuspage’s existing unresolved-incidents and components APIs already used by polling. Dashboards store only account id, capability id, and non-secret filter params; provider credentials remain backend-only.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add PagerDuty incident dashboard panels
- **Goal:** Deepen provider-backed dashboard defaults for incident response data already exposed by PagerDuty’s read-only incident API.
- **What was done:** The PagerDuty adapter now exposes a live dashboard capability for read-only incident tables. The one-click default panel lists triggered/acknowledged incidents and supports optional non-secret filters for statuses, service ids, sort, and limit; rows include direct PagerDuty incident links.
- **Key decisions:** The feature reuses the same PagerDuty incidents API path as polling and does not add a fake query language. Credentials remain backend-only; dashboards persist only account id, capability id, and non-secret params.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Datadog monitor dashboard panels
- **Goal:** Deepen provider-backed dashboard defaults for Datadog without inventing unsupported arbitrary query semantics.
- **What was done:** The Datadog adapter now exposes a live dashboard capability for read-only monitor tables when an application key is available. The one-click default panel lists Datadog monitors and supports optional non-secret filters for monitor tags, name, state, and limit; rows include direct Datadog monitor links.
- **Key decisions:** The feature uses Datadog’s existing monitor list API and bounded filter params instead of pretending there is a general query language. Credentials remain backend-only; dashboards persist only account id, capability id, and non-secret params.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Sentry issue dashboard panels
- **Goal:** Deepen provider-backed dashboard defaults for a provider that already has stable read-only issue APIs.
- **What was done:** The Sentry adapter now exposes a live dashboard capability for read-only issue search, including a one-click “Unresolved Sentry issues” default panel. The same bounded issue-search API backs custom dashboard issue queries with configurable limit/sort parameters, and table rows include direct Sentry issue links.
- **Key decisions:** This uses the existing Sentry Issues API and existing stored account credentials on the backend only. The dashboard stores only account id, capability id, query text, and non-secret params.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Copy incident follow-ups as Markdown tasks
- **Goal:** Make local incident follow-up checklists portable without requiring a full report export.
- **What was done:** The local incident Follow-ups section now has a Copy tasks action that writes a Markdown task list to the browser clipboard, preserving completed/open state and each item’s current detail.
- **Key decisions:** This is renderer-only and uses the same browser clipboard path already used by the log viewer. No new IPC, storage, provider mutation, or report format was added.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Surface follow-up checklist in local incident details
- **Goal:** Make incident follow-up actions visible before users export a report, instead of only embedding them in generated Markdown/JSON reports.
- **What was done:** Local incident details now show a Follow-ups section covering root cause, resolution, service owner, runbook, investigation notes, and linked evidence. Open follow-ups offer existing inline actions where available, such as editing incident fields or drafting a note.
- **Key decisions:** This is renderer-only workflow guidance derived from existing local incident metadata, service metadata, and linked retained-history evidence. No new storage, IPC, or provider mutations were added.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add local history annotations to dashboard charts
- **Goal:** Make custom dashboard charts explain operational changes by overlaying relevant deploy, failure, recovery, alert, and incident events from retained local history.
- **What was done:** Local timeseries panel results now include scoped annotations from `history.json`, filtered by the same group/account/provider/service-metadata scope as the panel. Dashboard charts render those annotations as reference lines and show a compact clickable event strip that opens the underlying provider/history URL through `monitorApi.openExternal`.
- **Key decisions:** Annotations are only added for local normalized timeseries panels. Live provider query panels keep their declared result shapes, and no provider history is fabricated.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Copy dashboard panels across dashboards
- **Goal:** Make custom dashboards easier to reuse by moving useful panel setups between dashboards without recreating source, scope, query, and visualization settings by hand.
- **What was done:** Dashboard panel cards now include a copy-to-dashboard action when another dashboard exists. The new copy dialog lets users choose the target dashboard, saves a cloned panel at the end of that dashboard, selects the target dashboard, and preserves the original panel configuration without changing provider credentials or backend schema.
- **Key decisions:** Same-dashboard duplication remains separate. Cross-dashboard copy only uses persisted non-secret panel definitions and the existing dashboard save IPC.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add next actions to setup checklist
- **Goal:** Make first-run setup more actionable by turning incomplete checklist items into direct navigation or filtering actions.
- **What was done:** The Accounts setup checklist now shows action buttons for incomplete steps: add a provider account, review ungrouped accounts, open Uptime, open Alert Rules, and open Custom Dashboards. Completed steps remain status-only.
- **Key decisions:** This is renderer-only onboarding guidance over existing routes and filters. It does not add new setup storage, backend state, provider behavior, or account mutations.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Link correlated evidence when creating incidents from live sources
- **Goal:** Preserve the investigation context users see before promoting a live provider signal or incident into a durable local incident.
- **What was done:** The Incidents detail panel and investigation workspace now pass correlated evidence event ids into the create-incident dialog. The dialog shows how many related evidence items will be linked, and saved local incidents keep those ids for the detail timeline and report/export flows.
- **Key decisions:** This reuses persisted local history events already visible in the investigation workspace. It does not invent provider history or mutate provider-side incident state.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Create alert-rule drafts from dashboard panels
- **Goal:** Turn useful local dashboard panels into operational alert rules without making users manually recreate the same scope and metric in Alert Rules.
- **What was done:** Supported local dashboard panels now show a create-alert action. Success/failure panels draft a failure-rate rule, incidents/alerts panels draft an open-incidents rule, and check-latency panels scoped to a check draft a latency rule. The draft is passed through a one-shot renderer localStorage handoff and opens the existing Alert Rules add dialog prefilled for review/edit/save.
- **Key decisions:** The workflow only appears for metrics already supported by the local alert-rule engine. Provider live query panels and unsupported local metrics remain unlinked rather than fabricating alert behavior.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add event-type controls to dashboard local event panels
- **Goal:** Let users edit local dashboard event-panel scopes without relying on separate templates or hand-edited dashboard JSON.
- **What was done:** The Custom Dashboards panel editor now shows event-type toggle buttons for local event panels, covering deploys, failures, recoveries, alerts, and incidents, plus an All events reset. Selected event types are saved on the local panel source in the same format already used by templates and the backend query runner.
- **Key decisions:** The controls only appear for local normalized event panels. The forward-compatible `check` event type remains hidden because uptime checks are stored as check samples, not emitted history events.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add service metadata scopes to dashboard local panels
- **Goal:** Let users make individual local dashboard panels narrower by owner, tier, or dependency without relying only on dashboard-wide runtime filters.
- **What was done:** The Custom Dashboards panel editor now exposes Owner, Tier, and Dependency scope controls for local normalized panels, sourced from `service-metadata.json`. These values are saved on the local panel source and already feed the existing backend local-panel service metadata filtering and panel metadata badges.
- **Key decisions:** The controls are only shown for local normalized panels. Live provider query panels still keep their explicit provider params and are not rewritten by service metadata scopes.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add panel-editor capability filter recovery
- **Goal:** Make dashboard panel creation easier to recover from when source/provider/result/search filters hide all available default panels or custom query sources.
- **What was done:** The Custom Dashboards panel editor now shows a “Clear filters” action next to the matching capability count whenever its capability search/source/provider/result filters are active.
- **Key decisions:** This is transient renderer UI state only. It does not change dashboard definitions, provider capabilities, panel execution, runtime filters, or backend IPC.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Clean blank dashboard provider params in editor
- **Goal:** Keep custom dashboard panel definitions clean while users edit provider default/custom query params.
- **What was done:** The panel editor now removes optional provider param keys from `panel.source.params` when an input is cleared, instead of keeping empty-string values in renderer state until backend save normalization.
- **Key decisions:** This mirrors existing backend normalization without changing dashboard JSON schema, provider query execution, required-param validation, or default panel templates.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Clarify Custom Dashboard runtime filter boundaries
- **Goal:** Make dashboard-level filters understandable on mixed dashboards that contain both local normalized panels and live provider query panels.
- **What was done:** Custom Dashboards now show a secondary callout when runtime filters are active and the selected dashboard has provider-backed panels, explaining that runtime filters apply to local monitor panels only while live provider query panels keep their configured provider parameters.
- **Key decisions:** This preserves the intentional no-rewrite behavior for custom provider queries. It is renderer-only guidance and does not change panel execution, provider query payloads, dashboard storage, or filter persistence.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add filter-miss reset actions across operational views
- **Goal:** Make comprehensive filters easier to recover from and keep empty states accurate across data-heavy tabs.
- **What was done:** Added inline reset actions to Dashboard account/activity filter misses, Alert Rules no-match, Uptime no-match, Insights SLO no-match, and Incidents local/live no-match states. Timeline now distinguishes “no retained correlation events yet” from “current filters hid all events,” with a reset action that also restores the lane display mode. Incidents now checks unfiltered local incident count before showing the global no-data state.
- **Key decisions:** This is renderer-only UX over existing filtered data and persisted filter state. No IPC, storage, aggregation, or provider behavior changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Clarify Apps filter empty state
- **Goal:** Keep cross-app filters understandable by distinguishing “no app health data yet” from “filters hid every app.”
- **What was done:** Apps now shows the polling/waiting message only when no aggregate services exist at all. When services exist but the current group/provider/account/health/freshness/owner/tier/dependency filters remove all of them, Apps shows a “No apps match filters” empty state with a reset action.
- **Key decisions:** This is renderer-only feedback over existing filtered service data. It does not change aggregation, filter persistence, service metadata, or backend IPC.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Confirm destructive deletes outside dashboards
- **Goal:** Reduce accidental data loss across the expanded app surface, matching the existing custom-dashboard delete confirmations.
- **What was done:** Added confirmation prompts before deleting uptime checks, alert rules, SLOs, notification channels, recurring maintenance windows, local incidents, and local service metadata.
- **Key decisions:** This is renderer/settings UI safety around existing mutations. IPC contracts, backend storage, provider behavior, and import/export formats are unchanged.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Harden dashboard import and persistence normalization
- **Goal:** Make custom dashboard export/import and portable setup restore more reliable when users import hand-edited or stale dashboard JSON.
- **What was done:** Dashboard storage now treats panel definitions as untrusted at the persistence boundary: it normalizes panel ids/titles/layout/source ranges/scopes/provider query fields, validates provider ids and service tiers, requires provider account/capability ids for live sources, and skips malformed panel sources instead of throwing or saving invalid shapes. Dashboard export/import and portable setup import now remap only valid local/provider panel sources and skip malformed dashboard entries or unmatched panels without aborting the whole import.
- **Key decisions:** The backend still preserves valid non-secret dashboard metadata and lets the normal save path assign fresh ids/order. Invalid imported panels are dropped rather than guessed, which keeps credentials out of JSON and avoids fake provider support.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Normalize persisted dashboard panel order, sources, metrics, visualizations, and ranges
- **Goal:** Harden custom dashboard persistence for dashboards created through import/setup restore instead of only the editor.
- **What was done:** `dashboard-store` now normalizes panel visualizations against the supported set, normalizes local panel metrics against executable local metrics, safely filters local event types only when they arrive as arrays, trims provider query/x/y fields, keeps only non-empty string provider params, normalizes panel source ranges against the dashboard range, sorts panels by incoming order, and renumbers persisted panel order sequentially on save/import.
- **Key decisions:** This keeps the existing dashboard JSON schema. It does not change panel execution, provider query text/params, dashboard export shape, or renderer reorder behavior.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Confirm destructive dashboard deletes
- **Goal:** Avoid accidental destructive actions in the custom dashboard builder.
- **What was done:** Added explicit confirmation prompts before deleting an entire dashboard or removing a panel from a dashboard. Prompts include the dashboard or panel name, and dashboard deletion also states how many panels will be removed.
- **Key decisions:** This is renderer-side safety around existing delete/save flows. It does not change dashboard storage, import/export, panel execution, provider queries, or backend IPC behavior.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Disable impossible dashboard panel move actions
- **Goal:** Make the fixed-grid dashboard panel reordering controls reflect the actual saved panel order.
- **What was done:** Panel cards now receive saved-order boundary state and disable Move up for the first panel and Move down for the last panel. When panel search is active, boundary state is still computed from the full saved dashboard order.
- **Key decisions:** This is renderer-only UI feedback. It does not change panel ordering logic, saved dashboard definitions, search filtering, provider queries, or panel execution.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add dashboard selector search count and clear action
- **Goal:** Make the Custom Dashboard selector search easier to recover from when many dashboards exist.
- **What was done:** The action-bar dashboard search now shows matching/total dashboard counts while active and includes a Clear action next to the search field.
- **Key decisions:** This remains transient renderer UI state. It does not change dashboard selection handoff, saved dashboard definitions, runtime filters, provider queries, or dashboard import/export behavior.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add dashboard panel-search counts and clear actions
- **Goal:** Make the selected-dashboard panel search easier to recover from when it filters out panels.
- **What was done:** The selected dashboard header now shows a matching/total panel count beside "Find panel" and a Clear action while search text is active. The no-match empty state also includes a Clear search action.
- **Key decisions:** This remains transient renderer UI state. It does not alter saved dashboard definitions, panel order, runtime filters, provider queries, or panel execution.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Search panels inside a selected dashboard
- **Goal:** Keep large custom dashboards manageable after users create, duplicate, import, or template many panels.
- **What was done:** Added a transient "Find panel" search field to the selected dashboard header. The panel grid now narrows by panel title, visualization/layout fields, source ids/query text, and the same resolved source/range/scope metadata shown on panel cards, with a filter-miss empty state.
- **Key decisions:** Panel search is renderer-only and does not alter saved dashboard definitions, panel order, runtime dashboard filters, provider queries, or panel execution state.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Surface unavailable dashboard live capabilities
- **Goal:** Make saved provider dashboard panels understandable when their account or live capability is no longer available.
- **What was done:** Dashboard panel metadata now adds a "Capability unavailable" badge when a saved provider panel no longer matches the current live capability list. The panel editor keeps the saved unavailable source visible in the source selector and shows a warning explaining that the account may be disabled, missing credentials, or unable to load capabilities.
- **Key decisions:** This is a non-destructive renderer indicator. It does not rewrite saved dashboards, block saving, remove panels, fabricate capabilities, or change backend runtime errors for disabled accounts, missing tokens, permissions, or provider failures.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Open default-query dashboard panels in Default mode
- **Goal:** Keep one-click provider defaults such as Grafana Recent traces feeling like default panels even though their capabilities also support advanced custom queries.
- **What was done:** Added a generic default-panel classifier for the panel editor. Provider capabilities with `defaultPanel` and `requiresQuery` now reopen in Default panels mode while their saved query still matches the default template query, and customized queries reopen in Custom query mode.
- **Key decisions:** The behavior is based on capability metadata and saved panel source data, not hardcoded provider ids. Default-mode users can still switch to Custom query explicitly, and no dashboard schema or backend execution behavior changes.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Validate custom dashboard panel inputs before save
- **Goal:** Prevent avoidable provider custom-query panel failures by catching missing required inputs in the panel editor.
- **What was done:** Added editor-side validation for panel title, provider source selection, required custom query text, and provider-declared required params including x/y mapping fields. The Save action is disabled while validation errors exist, and the dialog shows a panel-level callout explaining what is missing.
- **Key decisions:** Runtime provider errors still surface at the panel level for invalid query syntax, permissions, and provider failures. This validation only covers required local editor inputs and does not change provider query execution, dashboard persistence, or token handling.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Preserve provider default panels in the dashboard editor
- **Goal:** Fix Custom Dashboard panel editing for provider-backed defaults that do not require a query and keep safe default queries intact when users switch into advanced editing.
- **What was done:** The panel editor now opens provider non-query defaults such as Grafana alerts, datasource health, and trace service-name panels in Default panels mode instead of Custom query mode. Provider default parameters like datasource UID and limit are editable in default mode, and switching between Default panels and Custom query preserves the current panel when its capability belongs in the target mode instead of resetting the safe default query/params.
- **Key decisions:** This is renderer-only editor behavior. It does not alter saved dashboard schema, provider capability declarations, token boundaries, backend query execution, or unsupported-provider behavior.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add per-panel dashboard refresh and stale state
- **Goal:** Close a Custom Dashboard panel-state gap by making individual panels refreshable and clearer when cached data is being refreshed or is stale.
- **What was done:** Added a per-panel refresh action that invalidates only the matching panel query, added refreshing/stale status text next to the panel generated timestamp, and gave dashboard panel queries a practical stale window tied to the dashboard refresh interval or a 30-second default.
- **Key decisions:** This is renderer-query state only. It does not change persisted dashboard definitions, provider query payloads, dashboard runtime filters, secrets handling, or backend panel execution.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Show dashboard panel metadata badges
- **Goal:** Make Custom Dashboard panels easier to audit after users duplicate, import, or template dashboards.
- **What was done:** Added compact metadata badges to each dashboard panel card showing effective range, visualization, height, local/provider source, resolved provider/account/group/check labels, explicit local scope fields, event-type narrowing, query language, and chart field mapping where present.
- **Key decisions:** The change is renderer-only and uses existing account/group/provider/check/capability data already loaded by the Dashboards view. It does not change saved dashboard definitions, provider query payloads, secrets handling, or panel execution behavior.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Remove unused renderer Grafana IPC wrappers
- **Goal:** Continue UI-side cleanup after replacing the dedicated Grafana tab with Custom Dashboards.
- **What was done:** Removed unused renderer `monitorApi` wrappers for `grafana:getOverview`, `grafana:runLogPreset`, `grafana:runTracePreset`, and `grafana:updateObservabilityConfig`, plus the renderer-only overview/result types that only backed the deleted Grafana view.
- **Key decisions:** Backend Grafana handlers and services remain registered for dashboard preset migration, saved account config preservation, provider live dashboard capabilities, and existing backend integrations. Renderer keeps only the Grafana preset config metadata type needed by account/dashboard data shapes.

### 2026-07-04 — Add Custom Dashboard selector search
- **Goal:** Keep the Custom Dashboards view manageable when users create or import many dashboards.
- **What was done:** Added a dashboard search box next to the selector. It filters selectable dashboards by name, description, range, refresh interval, panel titles, visualizations, and local/provider source ids while preserving the currently selected dashboard when it does not match the search.
- **Key decisions:** Dashboard selector search is transient renderer UI state and does not alter saved dashboard definitions, runtime dashboard filters, or command-palette selection handoff.

### 2026-07-04 — Refresh README for current app surface
- **Goal:** Keep user-facing developer documentation aligned with the implemented Multi Monitor feature set.
- **What was done:** Updated README title/overview, provider coverage, main app features, Custom Dashboards replacing the old Grafana tab, and runtime data files/localStorage notes.
- **Key decisions:** Documentation continues to avoid token examples and raw secret values; backend Grafana support is described as preserved/migrated through dashboards rather than a routed tab.

### 2026-07-04 — Export dashboard table rows as CSV
- **Goal:** Let users take Custom Dashboard table, log, trace, and event panel data out of the app after filtering and sorting it.
- **What was done:** Added a renderer-side CSV export action to the shared dashboard table renderer. Exports include visible columns only, keep hidden `__` metadata out of the file, and use the current row search plus sort order across all matching rows.
- **Key decisions:** Export is client-side Blob download and does not add backend IPC, read secrets, alter provider queries, or change saved dashboard definitions.

### 2026-07-04 — Remove legacy Grafana renderer view
- **Goal:** Finish the UI-side Grafana tab replacement cleanup after Custom Dashboards took over Grafana observability workflows.
- **What was done:** Deleted the unused `renderer/main/grafana-view.tsx` component after verifying it was no longer routed, imported, or referenced from navigation/command palette. Project context now records that the renderer tab source is gone while backend Grafana IPC remains for migration/provider support.
- **Key decisions:** Backend Grafana observability handlers and services remain because dashboard migration, saved Grafana config preservation, provider live capabilities, and existing backend integrations still depend on them.

### 2026-07-04 — Replace scaffold app metadata
- **Goal:** Remove leftover Glaze starter placeholder metadata from the registered app info IPC.
- **What was done:** Updated `app:getInfo` backing data to return `Multi Monitor`, package name `observability-monitor`, version, and environment, and removed the template TODO/example comments from `main/handlers/app.ts`.
- **Key decisions:** The handler remains static and non-sensitive; it does not read credentials, settings, or user data.

### 2026-07-04 — Add dashboard table sorting
- **Goal:** Make Custom Dashboard table, log, trace, and event panels easier to inspect after row filtering.
- **What was done:** Added client-side sortable column headers to the shared dashboard table renderer. Sorting handles numeric values, date-like strings, and text, and applies before the existing 100-row display cap.
- **Key decisions:** Sorting is local renderer state and does not affect saved dashboard definitions, provider queries, local history queries, row links, or hidden `__` metadata columns.

### 2026-07-04 — Add dashboard row search for table-like panels
- **Goal:** Make dense Custom Dashboard table, log, trace, and event panels usable after data is rendered.
- **What was done:** Added a local row filter to the shared dashboard table renderer, with row counts, filter-miss messaging, and the existing 100-row display cap applied after filtering. The search covers visible row values plus row-link labels while still hiding internal `__` metadata columns.
- **Key decisions:** Row search is purely client-side panel UI state. It does not rewrite provider queries, local panel scopes, saved dashboard definitions, or direct row-link behavior.

### 2026-07-04 — Filter dashboard panel capabilities while adding panels
- **Goal:** Keep the Custom Dashboard add-panel flow usable as local defaults and provider-backed live capabilities grow.
- **What was done:** Added transient picker filters inside the panel dialog for capability search, local vs provider source, provider, and result kind. The Default panels and Custom query modes now show filtered counts and only list matching capabilities while preserving the currently selected capability if a filter hides it.
- **Key decisions:** Picker filters are dialog-local helper state, not persisted dashboard runtime filters. They do not alter saved dashboard definitions, provider capability payloads, or credential handling.

### 2026-07-04 — Manage multiple maintenance windows
- **Goal:** Make scoped maintenance windows fully usable from Settings instead of editing only the first persisted window.
- **What was done:** Replaced the single maintenance-window editor with a list editor that can add, label, enable/disable, retime, scope, and delete multiple maintenance windows. The UI now writes the full `maintenanceWindows` array that backend settings, notification suppression, and portable setup already support.
- **Key decisions:** Existing windows are preserved as-is. New windows get local generated ids and default to the existing daily 22:00-06:00 template. Removing every window stores an empty array, which disables maintenance suppression without affecting global notification snooze.

### 2026-07-04 — Add Notification channel filters
- **Goal:** Extend the cross-app filter system to the Settings notification-channel list, which is operational configuration data with searchable/filterable state.
- **What was done:** Added persisted `notificationChannels.filters.v1` filters and saved presets for channel search, Slack/webhook type, enabled/disabled state, stored URL presence, and subscribed event kind. The channel list now shows filtered counts and a filter-miss empty state. Portable setup collection/restoration and backend setup allowlisting now include the notification-channel filter keys.
- **Key decisions:** Filters remain renderer-local and store no webhook URLs. The backend still exports/imports only allowlisted non-secret UI filter JSON, while channel webhook URLs remain excluded from portable setup bundles.

### 2026-07-04 — Filter Accounts by dashboard capability support
- **Goal:** Make account dashboard capability diagnostics actionable from the Accounts tab.
- **What was done:** Added a persisted `accounts.filters.v1` Dashboard support filter with options for live provider support, local-only accounts, live capabilities loaded, and live support unavailable. Account search now also indexes the dashboard capability summary.
- **Key decisions:** The filter is renderer-local and uses the non-secret diagnostics summary. Older saved filter state remains compatible through default merging.

### 2026-07-04 — Show dashboard capability diagnostics per account
- **Goal:** Help users understand which connected accounts can power live custom dashboard panels versus local normalized panels.
- **What was done:** Added non-secret dashboard capability diagnostics to account diagnostics. The default diagnostics list now reports whether a provider declares live dashboard support without making provider API calls, while the per-account Run action loads live capability counts, default-panel counts, custom-query counts, query languages, and result kinds with stored credentials. The Accounts diagnostics panel displays the support summary and compact capability badges.
- **Key decisions:** Capability diagnostics never return tokens or provider credentials. Normal diagnostics remain lightweight; provider network calls happen only during the explicit per-account diagnostic run.

### 2026-07-04 — Preserve Accounts filters in portable setup
- **Goal:** Keep the new Accounts tab filters portable across setup export/import.
- **What was done:** Added `accounts.filters.v1` and `accounts.filters.v1.presets` to the backend setup bundle allowlist so renderer-collected account filters survive `setup:export/import` alongside the other per-tab filter states.
- **Key decisions:** The allowlist continues to accept only known non-secret localStorage filter keys; account credentials and tokens remain excluded from portable setup bundles.

### 2026-07-04 — Add Accounts tab filters
- **Goal:** Extend the cross-app filtering work to the Accounts/Setup tab, which has operational account and diagnostic data but no filter surface.
- **What was done:** Added persisted `accounts.filters.v1` filters with saved presets for search, provider, project group/ungrouped, enabled/disabled state, diagnostic status, and token presence. The account list and diagnostics panel now respect the selected account filter set, and empty states distinguish no accounts from no filter matches. Portable setup filter export/import now includes the account filter key and presets.
- **Key decisions:** Filters stay renderer-local and store only non-secret UI state. Diagnostic and token filters use diagnostic metadata returned by the existing diagnostics IPC and never expose provider tokens.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Grafana trace service-name default panel
- **Goal:** Add another useful Grafana Tempo default dashboard panel so users can inspect trace coverage without writing TraceQL.
- **What was done:** Added a `grafana.tempo-services` live dashboard capability with a one-click "Trace service names" table panel. The panel queries Tempo service-name tag values through the existing Grafana datasource proxy using the dashboard range and limit, and each row includes an Explore link scoped to that service with TraceQL. The run dispatcher checks this capability before the generic Tempo TraceQL branch.
- **Key decisions:** The panel is provider-backed and only appears through Grafana's declared dashboard capabilities; it does not fabricate support for non-Tempo providers. It persists only account/capability ids and non-secret params in dashboard definitions. The endpoint shape follows the official Tempo tag-values API used through Grafana's datasource proxy.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass. Live behavior still needs validation with real Grafana Tempo datasource permissions.

### 2026-07-04 — Open recent item logs from command palette
- **Goal:** Make command-palette recent item results use the app's in-app log/detail viewer where provider rows support it.
- **What was done:** Recent item commands now show a Logs shortcut for rows with `logAvailable` or `logFallbackUrl`. Selecting those rows writes a one-shot `dashboard.item.select.v1` payload, dispatches a same-window dashboard selection event when the Dashboard is already mounted, and navigates to `/`. The Dashboard consumes the payload after snapshot data is available and reuses its existing log viewer/fallback behavior for the matching item.
- **Key decisions:** Rows without log/detail support still open their provider URL directly. The handoff is renderer-only and stores only the item uid/action, not provider credentials or log contents.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add command palette app/service deep links
- **Goal:** Let users jump from search directly into an Apps cockpit service detail.
- **What was done:** Added current aggregate services to the command palette and wrote one-shot `apps.select.v1` payloads before navigating to `/apps`. The Apps view now consumes that payload after snapshot data loads, resets conflicting filters to defaults while preserving a matching group filter when available, and selects the target service detail.
- **Key decisions:** Service selection remains renderer-local and transient. It uses the current normalized aggregate service ids and does not add backend IPC, provider calls, or persisted service metadata.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Deep-link more command palette result types
- **Goal:** Continue making command-palette selections land on the selected object instead of broad destination tabs.
- **What was done:** Account results now open the matching account in the edit dialog, alert-rule results open the matching rule editor, and local-incident results navigate to the Incident Center with the matching local incident selected. Local incident selection also applies a focused custom date range and compatible provider/account/severity/kind filters so the selected incident remains visible.
- **Key decisions:** These handoffs remain renderer-only one-shot localStorage payloads and are consumed after destination data loads. Live provider incident results still keep their external provider URL behavior because those rows already have stable source links.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Deep-link command palette selections
- **Goal:** Make command palette results open the relevant dashboard or uptime check directly instead of only navigating to the broad tab.
- **What was done:** Added one-shot `dashboards.select.v1` handoff support in the Dashboards view and made dashboard command-palette results write that selection before navigating. Uptime-check command-palette results now reuse the existing `uptime.drilldown.v1` payload with the check id as the search filter, so the Uptime view lands scoped to the selected check.
- **Key decisions:** The handoff is renderer-local localStorage state and is consumed once by the destination view; it does not add routes, backend IPC, or persisted dashboard/check metadata.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Surface retained history stats
- **Goal:** Make the configurable history retention setting observable so users can tell how much local data exists for date filters, dashboards, SLOs, and incident evidence.
- **What was done:** Added a non-secret `HistoryStats` shape and `history:getStats` IPC returning retained sample/event/check-sample/SLO counts plus oldest/newest retained timestamps. Settings now loads those stats, refreshes them after monitor-setting updates, and shows counts plus the oldest retained timestamp under the History retention control. The main-window typed IPC wrapper also exposes `getHistoryStats` for future reuse.
- **Key decisions:** Stats are metadata only and respect the configured retention window; they do not expose provider event rows, tokens, webhook URLs, or raw history contents.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add configurable history retention
- **Goal:** Make date-filtered views, custom dashboards, SLOs, and incident evidence retention controllable instead of fixed at 14 days.
- **What was done:** Added `historyRetentionDays` to `MonitorSettings` with defaults and validation (1-90 days), exposed it in Settings as 7/14/30/60/90 day choices, and included it in portable setup import/export. `history-store` now reads retention from settings for pruning, custom date clamping, series/event/check queries, full-history export/evidence reads, and SLO status. Row caps scale with the selected retention so frequent polling does not silently truncate history far before the configured window. New SLO windows are capped by the current retention, and existing longer SLOs display status using the effective retained window.
- **Key decisions:** Existing installs keep the 14-day default. Retention controls local normalized history only; it does not claim provider-side historical data exists beyond what has already been collected.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Make smoke verification channel tests opt-in
- **Goal:** Make setup verification safer to run repeatedly without accidentally posting Slack/webhook test messages.
- **What was done:** Extended `verification:run` to accept optional `{ includeChannelTests }`, defaulting to skipped channel delivery tests. The backend now reports notification channels as inspected/skipped unless delivery tests are explicitly requested. The Accounts smoke verification panel adds a “Send notification channel tests” switch, updates the explanatory copy, and passes the selected option through the diagnostics hook and typed IPC wrapper.
- **Key decisions:** Account validation and uptime checks remain real because they are the core smoke tests. Channel delivery is opt-in because it produces visible external side effects.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add scoped maintenance windows
- **Goal:** Let maintenance windows suppress notifications for only the affected service/provider/account/check instead of muting the whole app.
- **What was done:** Added optional `scope` metadata to maintenance windows, normalized it in settings storage, and made the shared notification mute helper accept a notification target. Transition notifications now evaluate maintenance windows per row with provider/account/group context instead of returning early for the whole batch. Alert rules pass their rule scope into the mute helper, so scoped rules can be suppressed by matching scoped windows while broad rules still require a global window. Settings now loads groups/accounts/providers/checks and exposes maintenance-window scope controls. Portable setup import/export preserves scoped windows and remaps group/account/check ids before saving imported settings.
- **Key decisions:** Global snooze remains all-or-nothing. Scoped maintenance windows are conservative: they suppress only notifications whose known target matches the stored scope, rather than muting broad rules or unrelated providers by inference.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add alert noise controls
- **Goal:** Reduce alert noise from broad incident rules and rapid repeat fires without weakening existing rule evaluation.
- **What was done:** Added non-secret `minSeverity` and `dedupeMinutes` fields to alert rules across backend/renderer types, IPC parsing, persistence, preview/test payloads, and portable setup import duplicate handling. Open-incident rules now count only matching unresolved incidents and alert signals at or above the selected severity. Rule evaluation now honors a per-rule dedupe delivery window before re-firing. The Alert Rules editor exposes Minimum severity for incident rules and Dedupe window controls, and rule cards show severity/dedupe badges.
- **Key decisions:** Severity thresholds apply only to open-incident rules because failure-rate and latency metrics do not carry severity. Dedupe is stored with rule metadata and uses existing firing-state timing; it does not introduce secrets or provider-side state.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Deepen incident report exports
- **Goal:** Make exported incident reports more useful for postmortems and handoffs.
- **What was done:** Expanded local incident Markdown reports with Summary, Impact, Service Context, Evidence Summary, Timeline, Linked Evidence, Suspected/Confirmed Cause, Resolution, Notes, Related Events, and Follow-up Actions sections. Fixed related-event matching so incidents without a source uid do not accidentally include every source-less event. Added explicit redacted JSON export from the Incident detail view and backend export handler.
- **Key decisions:** Markdown reports may include provider/source URLs because they are intended for operational handoff. Redacted JSON omits raw provider URLs while preserving non-secret incident fields, service metadata, evidence metadata, and booleans indicating whether source URLs exist.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add incident investigation workspace
- **Goal:** Make the Incident Center a focused investigation surface instead of only a list/detail view.
- **What was done:** Added an investigation workspace to incident details that summarizes related deploy/failure/alert/recovery evidence, groups recent evidence by type, surfaces provider/runbook/dashboard/repository links, and lets users append inline notes directly to local incidents without reopening the edit dialog. Selected incident metadata lookup now falls back to account/group-derived service metadata when an aggregate service is unavailable.
- **Key decisions:** The workspace uses existing local incident storage, service metadata, retained history events, and provider/source URLs. Live provider sources still require creating a local incident before notes can be persisted, so the app does not pretend provider-side incidents are locally mutable.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add dashboard chart drilldowns
- **Goal:** Make dashboard charts actionable by letting users jump from a clicked chart point into the relevant operational view.
- **What was done:** Dashboard local chart panels now create one-shot drilldown payloads and navigate to Timeline, Incidents, or Uptime depending on panel metric and clicked series. Timeline, Incidents, and Uptime consume those payloads once, apply custom time windows plus matching group/provider/account/service/check filters, and then clear the payload.
- **Key decisions:** Drilldowns are renderer-local and transient; they do not change persisted dashboard definitions, provider query payloads, or backend IPC. Provider custom-query chart panels are not given fabricated drilldowns because their result semantics are adapter/query-specific.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add dashboard templates
- **Goal:** Make Custom Dashboards useful immediately by letting users create common operational dashboards without assembling panels one at a time.
- **What was done:** Added a Dashboards template picker with Executive Health, Deployment Reliability, Incident Response, Uptime/SLO, Provider Observability, and Team/Service Ownership templates. Each template creates a normal persisted dashboard made from local normalized dashboard panels, with uptime templates preselecting the first existing check when available.
- **Key decisions:** Templates use existing local dashboard panel sources so they work across all providers without fabricating provider-specific live query support. Generated dashboards remain fully editable and exportable like manually created dashboards.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add saved filter presets
- **Goal:** Let users reuse common filter combinations across data-heavy views without rebuilding them every session.
- **What was done:** Added reusable saved filter preset controls to the shared Filters popover and enabled them for Dashboard, Apps, Insights, Incidents, Timeline, Uptime, Alert Rules, and Custom Dashboards. Presets are stored per tab in renderer localStorage next to the existing filter blobs; Timeline presets also preserve the group/provider lane display mode.
- **Key decisions:** Presets store only the existing non-secret renderer filter values. Portable setup export/import now includes the allowlisted `.presets` localStorage keys so presets can move with other UI setup metadata.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Sync AGENTS history storage summary
- **Goal:** Keep repo-level agent guidance aligned with the new scoped history sample data.
- **What was done:** Updated `AGENTS.md` storage notes to include `userData/history.json` and its per-account status plus alert/open-incident counts used by scoped local dashboard panels.
- **Key decisions:** This was documentation-only; no runtime code, IPC channels, or persisted data migration changed.
- **Validation:** `npm run type-check` and `npm run lint` pass.

### 2026-07-04 — Scope dashboard incident and alert history panels
- **Goal:** Make Custom Dashboard runtime filters meaningful for the local incidents/alerts history panel instead of showing only global counts.
- **What was done:** New history samples now persist optional per-account open-incident and alert counts. The dashboard query runner scopes the local `incidentsAlerts` panel by group/account/provider/service metadata using those per-account counts, and warns when older retained samples predate the scoped fields.
- **Key decisions:** Existing `history.json` files remain compatible because the new per-account fields are optional. Older scoped points are not fabricated; they are omitted with a panel warning when the stored sample lacks per-account alert/incident counts.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Tighten Alert Rules pending filter semantics
- **Goal:** Make Alert Rules state filters match the visual rule states and the intended firing/pending/OK split.
- **What was done:** Updated the Alert Rules `Pending` filter so it only includes breaching rules that are not already firing; firing rules now appear only under the `Firing` state filter.
- **Key decisions:** This is renderer-only filtering behavior and does not change alert evaluation, rule state storage, dispatch, or notification behavior.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Include maintenance windows in portable setup
- **Goal:** Preserve notification-suppression behavior when users export/import app setup.
- **What was done:** Portable setup settings now include recurring maintenance windows, with import-time normalization for ids, labels, days, enabled state, and bounded start/end hours before settings are applied.
- **Key decisions:** Global one-off snooze timestamps remain excluded from portable setup because they are transient runtime state; recurring maintenance windows are durable configuration and safe to export because they contain no secrets.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Preserve Custom Dashboard v2 filters in portable setup
- **Goal:** Keep portable setup export/import aligned with the newer Custom Dashboards runtime filter storage.
- **What was done:** Updated the backend setup bundle allowlist and Accounts view filter collection/restoration list from `customDashboards.filters.v1` to `customDashboards.filters.v2`, so owner/tier/dependency dashboard runtime filters are included in portable setup bundles.
- **Key decisions:** This is a renderer/backend setup metadata fix only; no dashboard definitions, provider queries, account secrets, or local history are changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Custom Dashboard service metadata runtime filters
- **Goal:** Let user-authored dashboards narrow local normalized panels by service ownership and dependencies without rewriting live provider queries.
- **What was done:** Custom Dashboards now expose persisted owner/tier/dependency runtime filters sourced from local service metadata. Local panel runs carry optional service scope fields, and the dashboard query runner applies them to event rows, current snapshot stats, success/failure and status-count history series, and group-scoped uptime check panels.
- **Key decisions:** Provider-backed custom query panels are left untouched by global dashboard runtime filters. Service filters use local `service-metadata.json` account/group-derived service ids and do not store or transmit provider secrets.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Uptime dependency filter
- **Goal:** Let teams narrow uptime/synthetic checks by declared service dependencies.
- **What was done:** Uptime now normalizes older saved filter state and adds a persisted Dependency filter sourced from local service metadata, applied to group-scoped checks through their group/service metadata.
- **Key decisions:** Ungrouped checks remain visible unless service metadata filters are active because they do not map to local service metadata. Filtering is renderer-local and does not change checks storage, probing, or latency history IPC.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Alert Rules dependency filter
- **Goal:** Let teams narrow alert rule configuration by declared service dependencies.
- **What was done:** Alert Rules now normalizes older saved filter state and adds a persisted Dependency filter sourced from local service metadata, applied to rules whose group/account/check scope resolves to an aggregate service.
- **Key decisions:** Provider-scoped and all-activity rules remain untagged unless they map to a concrete service. Filtering is renderer-local and does not change alert evaluation, dispatch, or rules IPC.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Incidents dependency filter
- **Goal:** Let responders narrow local incidents and live provider incident sources by declared service dependencies.
- **What was done:** Incidents now normalizes older saved filter state and adds a persisted Dependency filter sourced from local service metadata. Service metadata lookup also falls back to account group/account-derived ids when the aggregate service is unavailable.
- **Key decisions:** Dependency filtering stays renderer-local over existing local incidents, live snapshot sources, accounts, aggregate services, and `service-metadata.json`; no provider mutation/query behavior changed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Insights dependency filter
- **Goal:** Let teams analyze trends, alert volume, incident volume, and SLO cards by declared service dependencies.
- **What was done:** Insights now normalizes older saved filter state and adds a persisted Dependency filter sourced from local service metadata. The filter applies to success/failure trend aggregation, deploy/activity frequency, alert/incident event totals, alert volume charts, and SLO cards.
- **Key decisions:** Dependency filtering stays renderer-local over existing history/SLO query results and `service-metadata.json`; dependencies remain user-entered annotations and no history IPC contract changes were needed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Timeline dependency filter
- **Goal:** Let teams narrow correlation history by declared service dependencies, matching the service metadata filters available in Apps and Dashboard.
- **What was done:** Timeline now normalizes older saved filter state and adds a persisted Dependency filter sourced from local service metadata. The filter applies to retained history events after resolving each event to its aggregate service or account/group-derived service metadata.
- **Key decisions:** Dependency filtering is renderer-local over existing history results and `service-metadata.json`; dependencies remain user-entered annotations, not provider-side topology.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Dashboard service metadata filters
- **Goal:** Bring the main Dashboard filter coverage in line with service-aware Apps, Insights, Incidents, Timeline, Alerts, and Uptime views.
- **What was done:** Dashboard now loads local service metadata, normalizes older saved filter state, and adds persisted owner/tier/dependency filters for both live account sections and the retained history activity list.
- **Key decisions:** Filtering stays renderer-local and uses existing aggregate services plus `service-metadata.json`; no history IPC or provider query contract changes were needed. Ungrouped activity is filtered locally when the Ungrouped group filter is selected.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Apps dependency overview
- **Goal:** Make service dependency metadata useful beyond filtering and per-service detail.
- **What was done:** Apps now derives a dependency overview from filtered services and local service metadata, showing each service-dependency relationship with owner/tier context and a View action that selects the declaring service.
- **Key decisions:** The overview is renderer-only and uses existing local metadata; dependencies remain user-entered annotations, not provider-side topology or new persisted graph records.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Uptime service metadata filters
- **Goal:** Let teams narrow uptime/synthetic checks by service ownership and tier.
- **What was done:** Uptime now loads local service metadata, normalizes older saved filter state, and adds persisted owner/tier filters that apply to group-scoped HTTP checks through their group/service metadata.
- **Key decisions:** Ungrouped checks remain visible unless owner/tier filters are active because they do not map to a service metadata record. Filtering is renderer-local and does not change checks IPC or latency history queries.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Insights service metadata filters
- **Goal:** Let teams analyze success/failure trends, alert volume, incident volume, and SLO cards by service owner or tier.
- **What was done:** Insights now loads local service metadata, normalizes older saved filter state, adds persisted owner/tier filters, applies them while aggregating per-account history samples, filters alert/incident event totals, and narrows SLO cards whose group/account scope maps to a single service.
- **Key decisions:** Filtering stays renderer-local over existing history/SLO query results, so no backend history IPC contract changes were needed. Provider-wide and all-activity SLOs do not match owner/tier filters because they do not identify a single service.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Timeline service metadata filters
- **Goal:** Let teams narrow correlation history by service ownership and tier.
- **What was done:** Timeline now loads aggregate services and local service metadata, normalizes older saved Timeline filter state, and adds persisted owner/tier filters applied to retained history events by resolving each event account/group to service metadata.
- **Key decisions:** Filtering is renderer-local and layered on top of the existing history query results, so no history IPC contract or provider access changes were needed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add service metadata delete
- **Goal:** Let users remove stale local service-catalog annotations instead of only overwriting them.
- **What was done:** Added `deleteServiceMetadata` persistence support, `services:deleteMetadata` IPC, typed renderer API/hook mutation, and a Clear action in the Apps service metadata panel.
- **Key decisions:** Deleting metadata removes only local non-secret annotations for the derived service id. It does not affect provider accounts, groups, dashboards, incidents, or history.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Alert Rules service metadata filters
- **Goal:** Make the alert-rule list reflect the same service-catalog context now included in alert dispatch payloads.
- **What was done:** Alert Rules now load aggregate services and local service metadata, show service/owner/tier badges on rules whose group/account/check scope maps to a service, normalize older saved filter state, and add persisted owner/tier filters.
- **Key decisions:** Provider-scoped and all-activity rules remain untagged unless they map to a specific derived service; filtering is renderer-local and does not add credential access.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add incident owner and tier filters
- **Goal:** Let responders narrow the Incident Center by service ownership and criticality now that local service metadata is shown in incident detail.
- **What was done:** Added persisted Incidents filters for service owner and tier, normalized older saved incident filter state, and applied the filters to both local incidents and live provider signal/incident rows by resolving each row's account to the current aggregate service and local metadata.
- **Key decisions:** Filtering stays renderer-local and uses existing snapshot services plus `service-metadata.json`; it does not add backend credential access or provider-side queries.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add service context to alert dispatch
- **Goal:** Carry service-catalog response context into alert-rule delivery and test messages.
- **What was done:** Added optional non-secret dispatch context, included it in Slack text and generic webhook JSON, and updated rule fire/recovery/test delivery to resolve account/group/check-scoped rules to aggregate services and attach local service metadata such as owner, tier, dependencies, runbook, dashboard, and repository links.
- **Key decisions:** Native notifications stay concise; detailed context is sent through channel dispatch payloads. Provider-scoped or all-activity rules only include service context when they map to a specific derived service.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add service context to incident reports
- **Goal:** Carry service-catalog response context into exported incident/postmortem reports.
- **What was done:** Local incident Markdown export now resolves the incident account to its group/account-derived service, looks up local service metadata, and adds a Service Context section with service/account/provider/group, owner, tier, dependencies, notes, and runbook/dashboard/repository links when available.
- **Key decisions:** Report generation remains backend-only and reads only non-secret local stores plus retained history; it does not include provider tokens, webhook URLs, or provider-side mutation state.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Surface service metadata in Incidents
- **Goal:** Make service-catalog annotations useful during incident response, not only in the Apps cockpit.
- **What was done:** Incident details now resolve the selected live source or local incident account back to the aggregate service, load matching local service metadata, and show service status, owner, tier, dependencies, notes, and runbook/dashboard/repository actions.
- **Key decisions:** This is renderer-only and uses existing snapshot services plus `service-metadata.json`; it does not mutate provider incidents or add a new backend query path.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add service links to command palette
- **Goal:** Make service-catalog metadata actionable from anywhere in the app instead of only inside the Apps detail view.
- **What was done:** Added command-palette entries for service metadata runbook, dashboard, and repository URLs, labeled from the current aggregate service name when available and opened through the existing external URL IPC boundary.
- **Key decisions:** Only user-saved metadata URLs are shown; the command palette does not fabricate links or touch provider credentials.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Include service metadata in portable setup
- **Goal:** Make service-catalog annotations portable with the rest of the app setup so owner/tier/runbook/dependency context is not stranded on one machine.
- **What was done:** Added optional `serviceMetadata` to portable setup bundles, exported metadata compatible with selected account/group services, remapped group ids and `account:<id>` service ids during import, skipped duplicate local metadata by remapped service id, updated import summaries, and surfaced service metadata in the Accounts export dialog summary.
- **Key decisions:** Service metadata remains non-secret and local-only. Dependencies are preserved as user-entered labels/strings rather than rewritten because they are annotations, not guaranteed service ids.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add Apps metadata filters
- **Goal:** Make the new local service metadata operationally useful in the Apps cockpit rather than only visible in the selected-service detail.
- **What was done:** Added persisted Apps filters for service owner, tier, and dependency, normalized older saved filter state that lacks those fields, and surfaced owner/tier badges on service tiles.
- **Key decisions:** Filters remain renderer-local and operate over `service-metadata.json` plus the current aggregate service list; no backend credential access or provider-side service data is needed.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add local service metadata
- **Goal:** Continue service catalog work by letting users annotate derived services with operational metadata without changing provider adapters or account config.
- **What was done:** Added local service metadata types, `service-metadata.json` persistence, `services:listMetadata/saveMetadata` IPC, typed renderer API/hook support, and an Apps service detail metadata panel/editor for owner, tier, runbook/dashboard/repository URLs, dependencies, and notes.
- **Key decisions:** Metadata is local-only, non-secret, and keyed by derived service ids. It complements the aggregate service-health snapshot and does not create provider-side service records or store provider credentials.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add service detail in Apps
- **Goal:** Continue service catalog work by turning Apps service tiles into actionable service views rather than only summary cards.
- **What was done:** Expanded `/apps` selected-service detail with health contributor counts, account coverage rows, complete provider link actions, and related uptime checks, alongside the existing incidents, signals, metric summaries, and activity timeline.
- **Key decisions:** This is renderer-only and uses the existing aggregate snapshot. Service detail does not create a new backend route or persisted service definition yet; it makes current project-group/account-derived services inspectable.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add dashboard export/import
- **Goal:** Continue export/share/reporting work by letting users share individual custom dashboards without exporting the entire portable app setup.
- **What was done:** Added `dashboards:export/import` IPC, JSON dashboard bundles, non-secret account/group/check reference metadata, and import remapping by account id or provider/label/identity, group id/name, and check id/name/url/method. Imported dashboards use the normal dashboard save path, duplicate names get a numeric suffix, and panels with unmatched provider/scope references are skipped instead of saved broken. The Dashboards view now has Export and Import actions.
- **Key decisions:** Dashboard exports never include provider tokens, webhook URLs, runtime history, or local incidents. Import is additive only and does not create accounts, groups, or checks; broader setup movement stays in portable setup import/export.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add alert rule preview and test delivery
- **Goal:** Continue smarter alerting by letting users verify a rule against the current snapshot and test its delivery route before saving or waiting for a poll cycle.
- **What was done:** Added shared `RulePreview` types, `rules:preview` and `rules:testDelivery` IPC, and rule-engine helpers that reuse the same metric computation as live rule evaluation. The alert rule dialog now has Preview rule and Send test actions for the current unsaved form state, shows whether the rule would fire, and sends user-triggered test alerts through the selected per-rule routing or global channel subscriptions. Fixed rule IPC parsing so `channelIds` and `mutedUntil` are preserved/persisted correctly, with `null` clearing explicit channel routing back to global routing.
- **Key decisions:** Preview/test use the current aggregate snapshot and do not mutate in-memory rule state or write history events. Test delivery intentionally does not honor maintenance windows or snooze because it is an explicit user action.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add per-rule channel routing
- **Goal:** Continue smarter alerting/noise control by letting individual alert rules target specific Slack/webhook channels instead of always using global event subscriptions.
- **What was done:** Added optional non-secret `channelIds` to alert rules and dispatch events, normalized target ids in `rules-store`, and updated dispatch so explicit rule targets override global event-kind subscriptions while still requiring enabled channels and backend-only webhook URLs. The Alerts rule editor now lists configured channels, saves per-rule selections, and shows a channel-count badge. Portable setup import/export now remaps rule target channel ids when channels are imported or matched, and Settings exposes the existing recovery event kind for global channel subscriptions.
- **Key decisions:** Empty or missing `channelIds` preserves existing behavior: deliver to all enabled channels subscribed to the event kind. Selected rule channels receive alert/recovery dispatch regardless of their global event-kind subscription, but disabled channels and missing URLs still do not deliver.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add recurring maintenance windows
- **Goal:** Continue smarter alerting/noise control by letting users suppress delivery during predictable maintenance periods without disabling monitoring or rules.
- **What was done:** Added `MaintenanceWindow` settings types, default/normalization support in `settings-store`, a shared `notification-mute` helper, and backend delivery suppression for both status-transition notifications and alert-rule fire/recovery delivery. Settings now exposes a compact recurring maintenance-window control with daily/weekdays/weekends presets and local start/end hour selectors.
- **Key decisions:** Maintenance windows suppress native/channel delivery only; polling, rule evaluation, runtime firing state, and history event recording continue. The persisted model supports multiple windows, while v1 Settings exposes a single common quiet-hours window.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass.

### 2026-07-04 — Add live smoke verification runner
- **Goal:** Continue the reliability/verification baseline by making real runtime checks repeatable from inside the app when credentials, uptime checks, and notification channels are configured.
- **What was done:** Added verification report/result types, `verification:run` IPC, backend smoke checks for enabled account credential validation, enabled notification-channel test delivery, enabled uptime checks, dashboard capability loading, and local dashboard/incident/rule store loading. Added an Accounts view runner with a clear warning that enabled Slack/webhook channels receive real test messages. Added a local ESLint config and `.gitignore` entry so Glaze's generated `.build` staging output is ignored by lint.
- **Key decisions:** Verification is user-triggered only, returns status metadata only, and never exposes provider tokens or webhook URLs. Dashboard/local verification uses per-area settled results so one failing store or live capability lookup does not hide the rest of the report.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass. Live account/channel delivery still depends on configured real credentials and endpoints.

### 2026-07-04 — Add Better Stack logs and live log polling
- **Goal:** Add Better Stack support and make realtime logs available across providers where repeated pulls can return changing log data.
- **What was done:** Added the Better Stack provider with Telemetry SQL Query API connection fields, encrypted SQL password storage, recent-log dashboard rows, row-level log fetch, and bounded read-only dashboard SQL panels. Added shared live-log item metadata and an opt-in Live toggle in the log dialog that re-pulls logs while open without clearing the last successful payload on refresh errors. Enabled live polling for Better Stack, Grafana Loki preset rows, Supabase recent error logs, and in-progress GitHub/Cloudflare/Heroku logs.
- **Key decisions:** Better Stack v1 is logs-only and uses the existing one-secret-per-account model, so SQL host/username/table are non-secret config and the SQL password is the encrypted secret. Realtime means provider polling, not streaming. Dashboard query runner now passes provider secrets under each provider's declared secret field key instead of assuming `token`.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass. Live Better Stack/Grafana/Supabase queries still need runtime validation with real provider credentials.

### 2026-07-04 — Add dashboard provider field mapping controls
- **Goal:** Close the custom dashboard editor gap where provider query x/y mappings existed in the data model and backend but were only indirectly editable as generic params.
- **What was done:** The custom query panel editor now separates provider chart mappings into first-class X field and Y field controls, while keeping real provider parameters in their own section. The backend continues to receive `source.xField`/`source.yField` for PostHog and Supabase chart conversion.
- **Key decisions:** This is renderer-only editor polish; persisted dashboard shape and provider query execution stay unchanged.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Add local incident Markdown export
- **Goal:** Continue Incident Workflow V2 by turning durable local incidents into portable postmortem/report artifacts.
- **What was done:** Added single-incident lookup, `localIncidents:export` IPC, Markdown report generation through a save dialog, renderer API/hook support, and an Export action in local incident details. Reports include incident metadata, description, root cause, resolution, notes, related retained history events, and source links without provider credentials.
- **Key decisions:** Export reads only local incident/history data and writes Markdown; it does not persist new state or mutate provider-side incidents.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Add portable app setup export/import
- **Goal:** Let users share a full portable app setup while choosing exactly which accounts to include, without exporting credentials or runtime state.
- **What was done:** Added `setup:export/import` IPC and an Accounts view export dialog with account selection, included-data summary, and explicit secrets-excluded messaging. Portable bundles include selected account metadata, compatible project groups, monitor settings, dashboards, uptime checks, alert rules, SLOs, notification-channel metadata, and allowlisted UI filter localStorage. Imports merge into the recipient setup, reuse matching groups/accounts, remap account/group/check ids into dependent objects, skip duplicates, disable imported accounts/channels, and return UI filters for renderer restoration.
- **Key decisions:** Provider tokens, webhook URLs, history samples/events, local incidents, and triage state are never exported. Import is additive only; there is no destructive replace mode. Settings import excludes `mutedUntil` and `launchAtLogin`.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Consolidate filter controls into native-style popovers
- **Goal:** Fix crowded filter headers across data-heavy views and make the new filter menu feel native instead of like a large web panel.
- **What was done:** Added shared filter popover primitives with applied-filter chips and active counts, then moved Dashboard, Apps, Insights, Incidents, Timeline, Uptime, Alert Rules, and Custom Dashboard runtime filters behind a single Filters button. Tightened the popover to use Glaze popover surface tokens, compact inspector-style rows, and small filled controls while keeping primary actions visible.
- **Key decisions:** Existing localStorage filter keys and filtering semantics were preserved. Timeline lane display resets with the filter menu because it now lives inside the same popover. No backend or IPC changes were needed.
- **Validation:** `npm run type-check` and `npm run lint` pass. Renderer dev server was started for UI review; screenshot capture through regular `screencapture` was unavailable, and direct deep-link screenshots 404 because the Vite dev server does not serve those paths directly.

### 2026-07-04 — Add command palette shortcut hints
- **Goal:** Close the remaining command-palette polish item from the improvement plan.
- **What was done:** Added `CommandShortcut` hints to primary command palette actions and navigation rows, including settings’ existing `⌘,` accelerator.
- **Key decisions:** Kept this as renderer-only polish; no command behavior or routing changed.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Add Settings tomorrow snooze shortcut
- **Goal:** Close the remaining QoL parity gap between Settings and tray notification snooze controls.
- **What was done:** Added a “Tomorrow” button to Settings snooze controls that mutes notifications until 09:00 local time tomorrow, matching the tray’s until-tomorrow-morning action.
- **Key decisions:** This still writes only the existing `MonitorSettings.mutedUntil` ISO timestamp; no new persistence or IPC shape was added.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Lazy-load Uptime chart route
- **Goal:** Continue hardening/performance work by keeping Recharts-heavy code out of the initial renderer route set.
- **What was done:** Changed `/uptime` to use the same React lazy/Suspense route pattern as Insights, Timeline, and custom Dashboards, so its latency chart code loads only when the Uptime view is opened.
- **Key decisions:** Kept the existing route fallback and did not alter Uptime behavior or IPC. This is a routing/bundling change only.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Surface provider retry backoff in diagnostics
- **Goal:** Continue hardening/reliability work by making the existing provider retry backoff visible instead of leaving users with only a stale last-error message.
- **What was done:** Added a token-free `getAccountBackoff()` poller readout and included it in account diagnostics with failure count, next retry time, and remaining seconds. Accounts diagnostics now mark active backoff as warning and show a retry ETA in the detail line.
- **Key decisions:** Backoff remains in-memory runtime state and is not persisted to account JSON. Manual single-account refresh still bypasses backoff, matching existing poller behavior.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Polish tray notification snooze state
- **Goal:** Continue native-polish work by making the menu-bar tray reflect and control notification snooze state consistently.
- **What was done:** Added active snooze state tracking to `tray-controller`, including a disabled menu row showing the snooze-until time, an “until tomorrow morning” shortcut, and a disabled Clear action when no snooze is active. Startup, Settings IPC updates, and tray-triggered snooze changes now all refresh the tray menu state.
- **Key decisions:** The tray still uses the existing global `MonitorSettings.mutedUntil` setting and does not add another persistence path. Settings remains the source of truth; tray state is a synchronized presentation/cache.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Expand command palette coverage
- **Goal:** Finish the first UX/search polish slice by making Cmd/Ctrl-K useful across the expanded app surface.
- **What was done:** Added typed `openSettings` IPC wrapper and expanded the command palette with actions for refresh/settings, custom dashboards, local incidents, and provider deep links, while retaining view/account/check/rule/live incident/recent item search.
- **Key decisions:** Commands reuse existing navigation and backend IPC. Provider URLs still open through `monitor:openExternal`; settings opens through the existing `window:openSettings` handler.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Add Sentry issue event details
- **Goal:** Continue provider-depth work by giving Sentry rows a useful drill-in path through the existing log/detail surface.
- **What was done:** Sentry issue feed rows now mark event details as available and store a non-secret issue id in `logRef`. Added `fetchLogs` for Sentry that loads the latest issue event via the backend token boundary and renders event title, culprit, tags, and entries as log/detail lines with a Sentry fallback URL.
- **Key decisions:** No renderer-side Sentry branch was added. The implementation reuses `monitor:getItemLogs`, so tokens stay backend-only and rows still fall back to the provider URL when details cannot be fetched.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Add incident investigation hints
- **Goal:** Start the correlation/root-cause roadmap with a deterministic helper that makes local history more useful during incident triage.
- **What was done:** Added incident detail investigation hints that rank nearby persisted history events by source, account, provider, time window, and event type. Local incidents and live source items now surface likely related deploys, failures, alerts, incidents, or recoveries alongside a reason and open action when the history event has a URL.
- **Key decisions:** This is not framed as AI RCA and does not fabricate provider history. It only uses the already-retained local `history.json` events inside the selected incident filter range.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Add per-rule alert snooze
- **Goal:** Continue the smarter-alerting roadmap by giving users a noise-control option narrower than disabling a rule or globally snoozing all notifications.
- **What was done:** Added `mutedUntil` to alert rules and save payloads, normalized future snooze timestamps in `rules-store`, and updated `rules-engine` so global or per-rule snooze suppresses delivery while preserving evaluation state and timeline event recording. The Alerts view now shows a Snoozed badge and lets users snooze a single rule for one hour or clear that snooze.
- **Key decisions:** Snoozing does not disable the rule and does not hide firing/pending/OK state. It only suppresses native/channel delivery for that rule while the timestamp is in the future.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Add Dashboard Builder V2 polish
- **Goal:** Continue the dashboard roadmap by making custom dashboards faster to iterate and by exposing the panel range setting already supported by the data model.
- **What was done:** Added dashboard duplication, panel duplication, and a panel-level range selector that can inherit the dashboard range or override it per panel. Duplicated dashboards and panels get fresh panel ids and copy layout/source/query settings without copying any credentials.
- **Key decisions:** Duplication stays renderer-side through the existing `dashboards:save` IPC because dashboard definitions are already non-secret metadata. Panel range overrides write to `panel.source.range`, preserving the existing backend execution path.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Add non-secret account setup import/export
- **Goal:** Continue the onboarding/reliability roadmap phase by making account setup portable without weakening the token boundary.
- **What was done:** Added `accounts:exportSetup/importSetup` IPC, typed renderer wrappers, account-hook mutations, and Accounts view controls for exporting/importing provider account metadata and project groups. Export files contain provider ids, labels, group mapping, identity, and non-secret provider config only. Imports reuse/create groups, skip duplicate account metadata, and create imported accounts disabled until credentials are supplied.
- **Key decisions:** Raw provider tokens are never exported or imported. Imported accounts are disabled because the backup cannot prove valid credentials exist on the target machine. Import/export is scoped to account setup for this slice; broader app-level backup can build on the same pattern later.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Add setup checklist and account diagnostics
- **Goal:** Continue the onboarding/reliability roadmap phase by making setup progress and provider/account health visible.
- **What was done:** Added account diagnostic types, `diagnostics:listAccounts/runAccount` IPC, renderer API/hook, and an Accounts view reliability surface. Accounts now shows a setup checklist for connected accounts, groups, uptime checks, alert rules, and dashboards, plus per-account diagnostics with token presence, required config, encryption availability, stale state, last sync/error, and on-demand stored-credential validation.
- **Key decisions:** Diagnostics never return provider tokens. On-demand validation uses the encrypted stored token in the backend and classifies common failures as auth, permission, rate limit, network, config, provider, or unknown.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Start Incident Workflow V2 with local incidents
- **Goal:** Begin the broader improvement roadmap by turning the Incident Center from transient triage into a durable local incident workflow.
- **What was done:** Added shared local incident types, `local-incidents.json` persistence, `localIncidents:list/save/updateStatus/delete` IPC, typed renderer wrappers, and a React Query hook. Updated `/incidents` to show local incidents above live provider sources, create a local incident from a live signal/incident, create manual incidents, edit incident metadata, add notes, acknowledge, resolve, reopen, delete, and show related history events.
- **Key decisions:** Local incidents remain local-only and do not call provider mutation APIs. Stored data contains source ids/URLs, account/provider ids, notes, assignee, severity/status overrides, root cause, resolved reason, and related event ids; no secrets are stored.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Add comprehensive cross-app filters
- **Goal:** Let users filter every data-heavy tab by the dimensions available for that data, including date ranges on provider/activity views.
- **What was done:** Added shared renderer filter primitives for persisted per-tab filter state, reset actions, select controls, and relative/custom date ranges. Extended history and uptime latency IPC/backend paths to accept custom date windows and richer event filters. Dashboard now combines filtered live account sections with a history-backed “Activity in range” list. Apps, Insights, Incidents, Timeline, Uptime, Alert Rules, and Custom Dashboards now expose scoped filters appropriate to their data, with custom dashboard runtime filters applying only to local normalized panels that do not already have explicit panel scope.
- **Key decisions:** Filters remain renderer-local in localStorage and never store secrets. Live provider tabs filter already-normalized snapshot data; older historical activity comes only from local history. Provider custom query panels are not silently rewritten by dashboard-level filters.
- **Validation:** `npm run type-check` and `npm run lint` pass; production build was run after this memory update.

### 2026-07-04 — Add dashboard row direct links
- **Goal:** Let users open Grafana traces and other linked dashboard rows directly from custom dashboard panels.
- **What was done:** Added hidden dashboard row link metadata (`__url`, `__urlLabel`) and updated dashboard table rendering to hide metadata fields while showing a compact open action for linked rows. Local event rows now carry their history URL. Grafana dashboard rows now link active alerts to alerting, datasource health rows to datasource edit pages, Loki log rows to Explore with query/range state, and Tempo trace rows to Explore with the selected Tempo datasource UID, trace ID, and panel range.
- **Key decisions:** Links are row-level actions using existing `monitor:openExternal`; rows without stable URLs remain unlinked. PostHog and Supabase generic query rows remain unlinked unless future provider-specific identity URLs are added.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass. Grafana Explore URLs still need live validation against real Grafana accounts and datasource permissions.

### 2026-07-04 — Add one-click default provider dashboard panels
- **Goal:** Let users add useful dashboard panels without writing queries, especially Grafana Tempo traces that are visible in Grafana Explore by default.
- **What was done:** Extended dashboard query capabilities with optional `defaultPanel` templates and split the panel editor into “Default panels” and “Custom query” modes. Added local all-provider default templates for current health, status counts, recent activity, failures, deploys/releases, alerts/incidents, check latency, and check uptime. Added live provider defaults for Grafana active alerts, datasource health, and recent Tempo traces; PostHog recent exceptions; and Supabase recent error logs.
- **Key decisions:** Grafana “Recent traces” uses TraceQL `{}` with limit 50 and does not require user-authored TraceQL. Custom query mode still exposes editable TraceQL/HogQL/SQL/LogQL/PromQL where supported. Unsupported providers still get normalized local defaults and do not expose fake live query defaults.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass. Live provider query defaults still need validation with real Grafana/PostHog/Supabase credentials.

### 2026-07-03 — Replace Grafana tab with custom query dashboards
- **Goal:** Let users build their own dashboards from Recharts panels and custom queries, replacing the dedicated static Grafana tab while keeping Grafana preset data safe.
- **What was done:** Added persisted `dashboards.json`, dashboard CRUD/capability/run-panel IPC, and a `/dashboards` fixed-grid builder with dashboard selector, metadata dialog, panel editor, reorder/delete controls, refresh, and chart/stat/table/log/trace rendering. Removed `/grafana` from router/sidebar/command palette; backend Grafana IPC remains available for migration/provider support and existing config.
- **Key decisions:** Every provider is available through local normalized history/snapshot/check panels; live custom queries are capability-based and only exposed by adapters that implement `getDashboardQueryCapabilities`/`runDashboardQuery`. Tokens stay backend-only; dashboards persist account ids, capability ids, query text, x/y mapping, and layout only. Saved Grafana Loki/Tempo presets are migrated into dashboards on first dashboard load without deleting account config.
- **Provider query support:** Grafana live panels cover active alerts, datasource health, Loki LogQL logs, Tempo TraceQL search, and Prometheus range queries. PostHog supports read-only HogQL `SELECT` panels. Supabase supports read-only analytics/log SQL `SELECT` panels scoped to the configured project.
- **Validation:** `npm run type-check`, `npm run lint`, and `npm run build` pass. Live provider query execution was not curl-validated against real credentials; invalid provider queries surface as panel-level errors.

### 2026-07-03 — Add PostHog provider, uptime checks, alert rules, digests/export, and Slack/webhook channels
- **Goal:** Verify the shipped observability features, add PostHog as a provider, and extend toward a fuller platform (user selected uptime checks, custom alert rules, scheduled digests/export, and Slack/webhook notifications).
- **What was done:** Verified prior 4 features (type-check/lint pass, all wired). Added PostHog adapter (error-tracking issues + HogQL fallback). Added notification channels (`channels-store`/`dispatch`) wired into the notifier. Added uptime/synthetic checks (`checks-store`/`checks-runner`, `/uptime` view, latency series persisted in history, `snapshot.checks`). Added custom alert rules (`rules-store`/`rules-engine`, `/alerts` view) that fire on transition into breach via notification + dispatch + timeline event. Added scheduled digest (`digest-scheduler`, Settings) + `history:export` CSV/JSON with save dialog. Delivered phase-by-phase; type-check + lint pass after each; build succeeded and `/uptime` + `/alerts` render at runtime.
- **Key decisions:** Slack/webhook dispatch is shared infra reused by rules + digests; channels subscribe by event kind (failure/success/alert/digest) rather than per-rule channel ids. Webhook URL stored encrypted via token-store `channel:<id>`. Uptime checks persist as separate `checkSamples` (NOT `HistoryEvent`s) to keep `HistoryEvent.provider` strictly a `Provider`. Alert metrics computed from the latest snapshot (failureRate/latency/openIncidents); firing state kept in memory like the diff-engine. Checks run on full poll cycles only.
- **UI elements:** New `/uptime` and `/alerts` sidebar routes with add/edit dialogs; Insights export button; Settings gains Digest fieldset + notification-channels manager.
- **Backend elements:** `posthog.ts` adapter; `channels-store.ts`, `dispatch.ts`, `checks-store.ts`, `checks-runner.ts`, `rules-store.ts`, `rules-engine.ts`, `digest-scheduler.ts`; handlers `channels.ts`/`checks.ts`/`rules.ts`; `history-store` gains checkSamples + latency series + appendEvent + export getters; poller runs checks + evaluates rules; digest scheduler in app lifecycle + reschedule on settings change.
- **Corrections/Lessons Learned:** Backend lint rejects the DOM `RequestInit` type (use a local init interface). Adding `"check"` to `HistoryEventType` broke an exhaustive `switch` in `incidents-view.tsx` (needed a case). `Button` variants are transparent/accent/destructive/filled/muted/glass/glassAccent + sizes small/medium/large + `iconOnly` (no ghost/outline/sm). `Callout` uses `color` not `variant`. PostHog error-tracking + HogQL endpoints and Slack/webhook delivery are NOT live-verified — confirm with real credentials/URLs.
- **User Frustrations & Important Remarks:** User asked to verify prior work, add PostHog observability, and pick the next features; approved building all four selected next features plus PostHog.

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
