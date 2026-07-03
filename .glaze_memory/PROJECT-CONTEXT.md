# Project Context

## Overview

- **App Name:** Multi Monitor
- **Purpose:** Menu bar + dashboard app that monitors CI/CD + ops activity across MANY accounts of MANY providers at once, via a pluggable provider registry.
- **Providers (7):** GitHub (Actions runs), Cloudflare (Pages + Workers deploys), Supabase (latest migration + error-log rollup), Netlify (site deploys), Resend (domain verification + broadcasts), Grafana (firing/pending alerts), Heroku (latest release). Each = one encrypted secret + optional non-secret config fields (project ref, instance URL, account id, repo filter).
- **Features:**
  - Connect multiple accounts per provider; credentials stored encrypted (safeStorage).
  - Dashboard grouped by account showing recent items with status, relative time, open-in-browser.
  - Provider + status filters (persisted to localStorage), manual refresh.
  - Background polling with configurable interval; native notifications on failure/success (configurable).
  - Menu bar (tray) icon tinted by aggregate status with a dropdown of recent items + quick actions.
  - Adding a new provider = one backend adapter module + one icon entry in `provider-meta.tsx`.

## Current State

### Key files
- `AGENTS.md` — repo-level architecture/conventions doc for AI coding agents (mirrors this file's non-sensitive parts); keep in sync when architecture/conventions change.
- `main/index.ts` — app entry; creates main window (1000×700, min 720×480), inits tray + starts poller on ready, `showMainWindow()` helper, stops poller on quit.
- `main/handlers/index.ts` — calls `registerProviders()` first, then registers account/monitor/provider handlers.
- `main/handlers/accounts.ts` — generic, registry-driven `accounts:list/add/update/remove/test`; splits creds into secret (token-store) + non-secret (`account.config`) via `definition.fields`; `validate()` resolves identity.
- `main/handlers/monitor.ts` — `monitor:getSnapshot/refresh/getSettings/updateSettings/getStatus` + `monitor:openExternal` (open-in-browser proxy).
- `main/handlers/providers.ts` — `providers:list` → `registry.publicList()` (id/label/scopeHint/fields; no functions).
- `main/services/providers/registry.ts` — `ProviderDefinition` interface + `register/get/has/list/publicList/secretField`.
- `main/services/providers/index.ts` — `registerProviders()` registers all 7 adapters; re-exports registry.
- `main/services/providers/{github,cloudflare,supabase,netlify,resend,grafana,heroku}.ts` — one adapter each (`fields`, `validate`, `fetch`). github/cloudflare wrap the existing `github-api.ts`/`cloudflare-api.ts` clients.
- `main/services/types.ts` — `Provider` (7-value union), generic `Account { …, identity?, config? }`, `MonitorItem { kind:string, category }`, `NormalizedStatus` (adds `warning`,`info`), settings.
- `main/services/accounts-store.ts` — accounts.json (no secrets) + `migrate()` shim mapping legacy `login`/`accountName`/`cloudflareAccountId`/`repoFilter` → `identity`/`config`.
- `main/services/token-store.ts` (safeStorage → tokens.bin.json base64, one secret per account), `settings-store.ts`.
- `main/services/poller.ts` — non-overlapping loop; `registry.get(provider).fetch(account, creds)` where creds = config + secret; drives notifications/tray/push.
- `main/services/aggregator.ts` (cache + priority failure>warning>running>queued>success>info>cancelled>unknown), `diff-engine.ts`, `notifier.ts`, `push.ts`, `tray-controller.ts`.
- `renderer/main/root-view.tsx` — SplitView + Sidebar nav; `router.tsx` routes (`/`, `/accounts`).
- `renderer/main/dashboard-view.tsx` (provider filter from `providers:list`), `accounts-view.tsx`.
- `renderer/main/components/` — `add-account-dialog.tsx` (data-driven: provider Select + dynamic fields from `providers:list`), `provider-meta.tsx` (provider→icon/label + category→icon; ONLY manual per-provider UI), `account-section.tsx`, `run-row.tsx` (icon via `categoryIcon`), `status-badge.tsx` (warning/info added), `relative-time.ts`.
- `renderer/main/hooks/` — `use-monitor-data.ts`, `use-accounts.ts`, `use-providers.ts`.
- `renderer/main/ipc.ts` / `types.ts` — typed IPC wrappers (+`listProviders`) + renderer mirror.
- `renderer/settings/settings-view.tsx` — Theme + Monitoring fieldset; settings window 560×480.

### Components
Uses @glaze/core: `SplitView` (storageKey "cicd-monitor"), `Sidebar*` (route nav), `ScrollArea`, `List`, `Dialog` (add/edit, controlled), `AlertDialog` (remove), `Select`/`Input`/`Switch`/`Field`/`FieldSet`, `Status`, `Badge`, `Callout`, `EmptyState`, `Text`, `Button`. lucide-react icons.

### Data & storage
- `userData/accounts.json` — `{ accounts: Account[] }` with `identity` + `config` (non-secret fields: `accountId`, `repos`, `projectRef`, `baseUrl`), NO secrets.
- `userData/tokens.bin.json` — `{ version:1, tokens: {accountId: base64(safeStorage-encrypted secret)} }`.
- `userData/settings.json` — MonitorSettings (pollIntervalSeconds default 60/min 30 + notify flags).
- localStorage: `dashboard.providerFilter`, `dashboard.statusFilter`. In-memory: aggregator snapshot; diff-engine last-status map.

### IPC channels
- `providers:list` → ProviderInfo[]; `accounts:list` → Account[]; `accounts:add/update/test` (payload `{ provider, label?, creds }`, creds = flat map; secrets inbound only); `accounts:remove`.
- `monitor:getSnapshot/refresh/getSettings/updateSettings/getStatus`; `monitor:openExternal`.
- Push (via `ipcMain.broadcast` → renderer `onNotification`): `monitor:snapshot`, `monitor:accountError`, `monitor:pollingState`, `settings:monitor-changed`.

### Integrations (all token/key based, Node 24 global fetch — no new npm deps)
- GitHub REST v2022-11-28; Cloudflare API v4 (Pages + Workers). Supabase Management API (`api.supabase.com`: `/v1/projects`, `/database/migrations`, `/analytics/endpoints/logs.all?sql=` — logs best-effort/feature-detected). Netlify (`api.netlify.com/api/v1` sites+deploys). Resend (`api.resend.com` /domains, /broadcasts feature-detected). Grafana (`{baseUrl}/api/health`, `/api/prometheus/grafana/api/v1/rules`). Heroku (`api.heroku.com` /apps, /releases with `Range: version ..; order=desc,max=3`, `Accept: …version=3`).
- Endpoints for Supabase logs, Resend broadcasts, and Grafana rules were built defensively (feature-detect on 404/403) but NOT curl-validated (sandbox has no network) — verify with real tokens at runtime.

### Conventions & constraints
- Adding a provider: create `main/services/providers/<id>.ts` implementing `ProviderDefinition`, register it in `providers/index.ts`, add `<id>` to the `Provider` union in both `types.ts` files, and add an icon/label entry in `renderer/main/components/provider-meta.tsx`. Everything else (dialog, filters, poller) is data-driven.
- `MenuItemColor` is NOT exported from `@glaze/core/backend` — mirror the union locally.
- `shell:openExternal` IPC channel is registered by the native runtime — do NOT re-register; app uses `monitor:openExternal`. Backend calls `shell.openExternal()` directly (tray/notifier).
- Tray icon SF Symbol `bolt.horizontal.circle.fill`, tinted by aggregate status. Poller seeds diff-engine silently on first cycle.
- The Live-app evaluate MCP tool errored (GlazeIPCError) during validation; the app's own IPC works fine — validate via DOM snapshot / real runtime instead.

## Recent History

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
