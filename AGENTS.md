# AGENTS.md

Guidance for AI coding agents (and human contributors) working in this repository. This is a native macOS app built on the Glaze app platform — a two-process architecture (frontend + backend) that behaves similarly to Electron, but with its own SDK and constraints described below.

## What this app is

**Multi Monitor** — a menu bar + dashboard app that watches CI/CD and ops activity across many accounts of many providers at once (GitHub Actions, Cloudflare Pages/Workers, Supabase, Netlify, Resend, Grafana, Heroku), via a pluggable provider registry. See `.glaze_memory/PROJECT-CONTEXT.md` for the full current-state snapshot and change history — read that first when picking up work here.

## Architecture

- **Frontend** (`renderer/`): React + Vite, rendered inside a native macOS WebView.
- **Backend** (`main/`): Node.js (`handlers/` = IPC surface, `services/` = business logic), calls native OS APIs (notifications, tray, encrypted storage, shell).
- Frontend and backend only talk over an IPC bridge. Renderer code calls `window.glazeAPI.*`, which is exposed via `renderer/preload.ts`'s `contextBridge`. Only `preload.ts` may import `ipcRenderer` directly — never do that from renderer components.

## Repo layout

```
main/            backend: handlers/ (IPC endpoints), services/ (logic, providers/ registry+adapters)
renderer/        frontend: main/ (dashboard app + components/hooks), settings/ (settings window)
package.json     npm deps go here
glaze.ts         app/window configuration
.glaze_memory/   PROJECT-CONTEXT.md (current state, always read first) + PROJECT-HISTORY.md (full log)
```

`.glaze/` (sibling build output directory, not shown above) is generated — never hand-edit it; change source under `main/`/`renderer/` or `glaze.ts` instead, and rebuild.

## Hard constraints

- **Never modify the framework SDK** (`@glaze/core`, resolved via path aliases) and never `npm install` it — treat it as read-only, vendored, and version-pinned by the platform.
- **Only use the SDK's public backend exports** (`dialog`, `shell`, `clipboard`, `Notification`, `Menu`, `Tray`, `safeStorage`, etc.). Don't reach into internal/native-bridge modules, IPC server internals, or anything not part of the public export surface — if an API isn't exported, treat it as unavailable rather than working around the boundary.
- **IPC security**: only `renderer/preload.ts` imports `ipcRenderer`; all other code uses `window.glazeAPI`. Sensitive capabilities (clipboard, opening external URLs, etc.) must be explicitly wired/enabled in preload rather than exposed wholesale.
- **Window surfaces**: never fake blur with CSS `backdrop-filter` / Tailwind `backdrop-blur-*` as a window background. Use native window vibrancy with `frame: true` for frosted panels/HUDs/popovers; only use `frame: false` for windows where the app itself draws every visible pixel (custom transparent shapes).
- **Secrets**: this app stores provider credentials via OS-level encrypted storage (`safeStorage`, see `main/services/token-store.ts`) — never persist raw tokens/secrets in plain JSON or localStorage.
- **Never ship mock or placeholder data** — wire real APIs or real user input; if something can't be verified without live credentials/network, say so rather than faking a response.

## Conventions in this repo

- **Adding a provider** = one adapter module `main/services/providers/<id>.ts` implementing `ProviderDefinition` (`fields`, `validate`, `fetch`), registered in `providers/index.ts`, plus one icon/label entry in `renderer/main/components/provider-meta.tsx`. Everything else (add/edit dialog, dashboard filters, poller, aggregator) is data-driven off the registry — don't add new hardcoded per-provider branches elsewhere.
- **Styling**: Tailwind v4 utilities plus the design-system components already in use (semantic colors, `Text` variants, `rounded-*` roles). Don't hand-roll CSS files or reach for raw Tailwind palette colors.
- **Surgical edits**: every changed line should trace back to the requested change. Don't refactor unrelated working code or add comments to code you didn't touch.
- **Minimize round trips**: read every file you need for a change up front and batch independent edits; only sequence calls when one genuinely depends on a prior result's output.
- **Project memory discipline**: after every completed change, no matter how small, update `.glaze_memory/PROJECT-CONTEXT.md` — overwrite the relevant `Current State` entries in place (it's a snapshot, not a log) and prepend a new `Recent History` entry (newest first). This is what lets a fresh session re-ground without prior chat context.

## Commands

- Install deps: `npm install --include=dev` from the repo root — a plain `npm install` under a production `NODE_ENV` will prune devDependencies needed for local builds.
- Static validation: `npm run type-check && npm run lint`.
- Runtime/UI validation requires the platform's own build pipeline (not a plain `npm run build`/`vite build` invocation) — use whatever build/launch mechanism your agent harness exposes for this app rather than shelling out directly.

## Current data & IPC surface

- **Storage**: `userData/accounts.json` (accounts, no secrets), `userData/tokens.bin.json` (encrypted secrets), `userData/settings.json` (poll interval + notification flags); a couple of filter keys in renderer localStorage.
- **IPC channels**: `providers:list`; `accounts:list/add/update/remove/test`; `monitor:getSnapshot/refresh/getSettings/updateSettings/getStatus`; `monitor:openExternal`; pushed events `monitor:snapshot`, `monitor:accountError`, `monitor:pollingState`, `settings:monitor-changed`.
- Full detail (key files, components in use, integrations, known pitfalls) lives in `.glaze_memory/PROJECT-CONTEXT.md` — keep this file and that one in sync when either changes.
