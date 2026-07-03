# Project History

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
