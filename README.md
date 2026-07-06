# Multi Monitor

Native macOS menu bar and dashboard app for monitoring CI/CD, uptime, incidents, alerts, logs, traces, and observability activity across multiple provider accounts.

## What It Monitors

Multi Monitor connects many accounts across GitHub Actions, Cloudflare, Supabase, Netlify, Resend, Grafana, Heroku, Sentry, PagerDuty, Statuspage, Datadog, Honeycomb, PostHog, and Better Stack. Provider credentials are stored through the platform encrypted storage API; account metadata and UI state stay local.

The main app includes:

- Command Center at `/` for current issues, SLO risk, alert-rule evidence, notification suppression, and scoped handoffs
- detailed grouped live account dashboard at `/dashboard` with retained history activity
- Apps cockpit with local service ownership metadata, runbooks, dependencies, and health contributors
- shared investigation context for provider rows, retained events, uptime checks, and dashboard evidence without fetching secrets in the renderer
- Custom Dashboards at `/dashboards` with Recharts panels, investigation templates, local normalized data panels, configured provider-declared live query panels, dedicated log/trace evidence renderers, row links, row search/sort, and CSV export
- Insights, Timeline, Incidents, Uptime checks, Alert Rules, Accounts diagnostics, portable setup import/export, and notification channel settings
- persisted per-tab filters and saved filter presets for data-heavy views

The old dedicated Grafana tab and `/grafana` route have been replaced by Custom Dashboards. Advanced provider collection areas are configured-only by default; Grafana account config and saved Loki/Tempo presets are preserved and migrated into dashboard panels when dashboards are first loaded.

## Developer Prerequisites

Before running the app locally, install or verify these dependencies:

- **macOS**: this is a native macOS app built on the Glaze app platform.
- **Glaze macOS app**: install the Glaze desktop app and import the project file described below.
- **Node.js 24 or newer**: `package.json` requires `node >=24`.
- **npm 11**: the lockfile was generated for npm 11. The project declares `npm@11.11.0`.
- **Glaze project file**: `Observability Monitor.glaze` must be present in the repo root and imported into the Glaze macOS app before running the native app.
- **Xcode Command Line Tools**: recommended for local macOS app builds and native packaging tasks.

Check your local versions:

```bash
node --version
npm --version
xcode-select -p
```

If `xcode-select -p` fails, install the command line tools:

```bash
xcode-select --install
```

## Install

Before installing npm dependencies, copy `Observability Monitor.glaze` into this repository root and import it from the Glaze macOS app. The imported Glaze app provides the local project/runtime context that native development expects.

Install dependencies from the repo root:

```bash
npm install --include=dev
```

Use `--include=dev` because local build, type-check, lint, and formatting commands need dev dependencies. A plain `npm install` under a production `NODE_ENV` can prune them.

## Run Locally

Start the full dev environment:

```bash
npm run dev
```

This starts the backend watcher and the renderer dev server, then writes `.devserverhost` for the Glaze desktop host. Open or reload the imported `Observability Monitor.glaze` project from the Glaze macOS app while `npm run dev` is running to attach the native host and show the app window.

If you run `npm run dev` from a plain terminal without the Glaze host attached, the servers can still start, but native calls such as theme, screen, menu, tray, and window APIs may time out in the logs.

Run only the renderer in a browser-based dev server for faster UI work when native backend/IPC behavior is not needed:

```bash
npm run dev:renderer
```

## Validate Changes

Run these before handing off code:

```bash
npm run test:contracts
npm run type-check
npm run lint
npm run build
```

`npm run test:contracts` is a credential-free source check for provider registration, IPC/security boundaries, dashboard storage/linking, and shared filter/date-range wiring.

Format code when needed:

```bash
npm run format
```

## Glaze Project Troubleshooting

If scripts cannot find the Glaze CLI or native APIs time out while running `npm run dev`, first confirm that `Observability Monitor.glaze` exists in the repo root and has been imported/opened in the Glaze macOS app.

Do not install or modify `@glaze/core` inside this app as a normal npm dependency. The SDK is treated as a local, version-pinned platform dependency managed by Glaze.

## Runtime Data

The app stores local runtime data outside the repo under the platform `userData` directory:

- `accounts.json`: account metadata and project groups, no secrets.
- `tokens.bin.json`: encrypted provider secrets.
- `settings.json`: polling, notifications, digest, retention, launch, snooze, and maintenance-window settings.
- `history.json`: retained local samples, events, check latency, and SLO state inputs.
- `dashboards.json`: custom dashboard definitions and migrated Grafana preset state; no provider secrets.
- `checks.json`, `rules.json`, `channels.json`, `local-incidents.json`, `service-metadata.json`: local uptime, alerting, notification metadata, incident lifecycle, and service annotations.
- renderer `localStorage`: per-tab filter state, saved filter presets, and one-shot navigation/deep-link payloads.

Provider credentials are encrypted through the platform safe storage API. Do not store raw tokens in source files, JSON fixtures, localStorage, or documentation examples.

## Useful Repo Notes

- Frontend code lives in `renderer/`.
- Backend IPC handlers and services live in `main/`.
- Provider integrations are registry-driven under `main/services/providers/`.
- The renderer talks to the backend through `window.glazeAPI`; only `renderer/preload.ts` may import `ipcRenderer` directly.
- Generated `.glaze/` output is not source. Change `main/`, `renderer/`, or `glaze.ts` and rebuild instead.
