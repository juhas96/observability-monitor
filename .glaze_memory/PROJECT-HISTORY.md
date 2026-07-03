# Project History

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

### 2026-07-03 — Add project groups for related provider accounts
- **Goal:** Let users group related provider accounts under one project/app (for example GitHub CI, Heroku deploys, and Grafana observability for the same product) and filter the dashboard by that group.
- **What was done:** Added `ProjectGroup` metadata and optional `Account.groupId`, extended `accounts.json` to `{ accounts, groups }` with legacy migration, added group list/create-or-reuse/validation/pruning helpers, exposed `groups:list`, and extended account add/update IPC to accept `groupId` or `newGroupName`. Renderer now has a groups query, account dialog group assignment/create controls, Accounts list group labels, and a dashboard group filter.
- **Key decisions:** Each account belongs to zero or one group; group names are trimmed and reused case-insensitively; unused groups are pruned after account removal/reassignment; polling/tray/notifications remain account-based.
- **UI elements:** Project group select + new group input in add/edit account dialog; dashboard group filter; dashboard renders project group sections containing account sections.
- **Backend elements:** accounts-store group helpers, `ProjectGroup`/`groupId` domain types, `groups:list` IPC, group assignment handling in `accounts:add/update`.
- **Corrections/Lessons Learned:** Normal Glaze validation commands could not run in this checkout because the Glaze CLI path was unavailable; validation must be rerun once the SDK path is restored.
- **User Frustrations & Important Remarks:** User explicitly wanted grouping across providers for the same app and the ability to filter to only one group.

### 2026-07-03 — Add AGENTS.md
- **Goal:** User asked for an AGENTS.md documenting how Glaze apps should be built and how this repo works.
- **What was done:** Wrote `AGENTS.md` at the repo root covering architecture (frontend/backend/IPC split), repo layout, hard constraints (SDK is read-only, public exports only, IPC/preload boundary, no fake CSS blur, encrypted secrets, no mock data), repo conventions (provider-registry pattern, styling, surgical edits, project-memory discipline), commands, and the current data/IPC surface.
- **Key decisions:** Deliberately omitted internal tool names, skill names, and guide file references (kept confidential per platform rules) — described equivalent workflows generically instead (e.g. "the platform's own build pipeline" rather than naming a specific tool).
- **UI elements:** none (docs-only change).
- **Backend elements:** none (docs-only change).
- **Corrections/Lessons Learned:** None.
- **User Frustrations & Important Remarks:** None.

### 2026-07-03 — Add Supabase, Netlify, Resend, Grafana, Heroku via a provider registry
- **Goal:** Broaden the app beyond GitHub/Cloudflare into a general ops monitor with 5 more providers, and make future providers easy to add.
- **What was done:** Refactored the hardcoded 2-provider branches into a pluggable `ProviderDefinition` registry (`main/services/providers/`). Generalized `Account` to `{ identity, config }` (with a legacy migration shim), broadened `NormalizedStatus` (+warning/info) and `MonitorItem` (+category, kind:string). Added 7 adapters (github/cloudflare wrap existing clients; supabase/netlify/resend/grafana/heroku new). Made the poller, accounts handler, add-account dialog, and dashboard filter fully data-driven; added `providers:list` IPC + `use-providers` hook + `provider-meta.tsx` (icons). Supabase = latest migration + error-log rollup, Grafana = firing/pending alerts, Resend = domains + broadcasts, Netlify = deploys, Heroku = latest release.
- **Key decisions:** Registry/adapter pattern so a new provider = 1 adapter file + 1 icon entry; one encrypted secret per account + non-secret fields in `config`; Resend limited to domains/broadcasts (per-email needs webhooks).
- **UI elements:** data-driven add/edit dialog with dynamic credential fields, provider-filtered dashboard, per-provider icons.
- **Backend elements:** provider registry, 5 new api_integrations, generic credential split (safeStorage + config), ipc_handler (`providers:list`), legacy account migration.
- **Corrections/Lessons Learned:** New adapters imported the `Account` type without referencing it → TS6196 unused-import errors; dropped the import where `account` was only a param. External endpoints couldn't be curl-validated (no sandbox network) so built with feature-detection; must verify with real tokens.
- **User Frustrations & Important Remarks:** User added Heroku on top of the four proposed providers. Live-app evaluate tool was unavailable (IPC error) — validated via build + DOM snapshot instead.

### 2026-07-03 — Build multi-account GitHub Actions + Cloudflare monitor
- **Goal:** Recreate the "GitHub Actions Monitor" app but supporting multiple GitHub AND multiple Cloudflare accounts.
- **What was done:** Built full backend (encrypted token vault, GitHub/Cloudflare REST clients, polling loop, aggregator, diff-engine, native notifications, menu bar tray) + frontend (SplitView sidebar nav, dashboard grouped by account with filters, accounts management with add/edit/remove + test-connection, monitoring settings). Bumped main window min to 720×480 and settings window to 560×480.
- **Key decisions:** API tokens over OAuth (clean multi-account, no browser session conflicts); Cloudflare monitors both Pages + Workers; menu bar + dashboard hybrid; notify on failure+success configurable.
- **UI elements:** sidebar nav, dashboard list grouped by account, account list, add/edit dialog, alert dialog, settings form, tray dropdown.
- **Backend elements:** safeStorage secrets, JSON local_storage, api_integration (GitHub + Cloudflare), scheduler (poller), ipc_handler, native notifications, tray.
- **Corrections/Lessons Learned:** Initial crash-loop — registering `shell:openExternal` conflicts with the native runtime's built-in handler; renamed to `monitor:openExternal`. `MenuItemColor` type isn't exported from backend; mirrored locally.
- **User Frustrations & Important Remarks:** None; app launched and verified rendering after the handler-collision fix.
