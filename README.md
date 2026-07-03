# Observability Monitor

Native macOS menu bar and dashboard app for monitoring CI/CD and ops activity across multiple providers.

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
npm run type-check
npm run lint
npm run build
```

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
- `settings.json`: polling and notification settings.

Provider credentials are encrypted through the platform safe storage API. Do not store raw tokens in source files, JSON fixtures, localStorage, or documentation examples.

## Useful Repo Notes

- Frontend code lives in `renderer/`.
- Backend IPC handlers and services live in `main/`.
- Provider integrations are registry-driven under `main/services/providers/`.
- The renderer talks to the backend through `window.glazeAPI`; only `renderer/preload.ts` may import `ipcRenderer` directly.
- Generated `.glaze/` output is not source. Change `main/`, `renderer/`, or `glaze.ts` and rebuild instead.
