# Observability Monitor

Native macOS menu bar and dashboard app for monitoring CI/CD and ops activity across multiple providers.

## Developer Prerequisites

Before running the app locally, install or verify these dependencies:

- **macOS**: this is a native macOS app built on the Glaze app platform.
- **Node.js 24 or newer**: `package.json` requires `node >=24`.
- **npm 11**: the lockfile was generated for npm 11. The project declares `npm@11.11.0`.
- **Glaze SDK / CLI**: local scripts call `node glaze.ts ...`, which resolves the Glaze CLI from one of these paths:
  - `$HOME/Library/Application Support/app.glaze.macos.main/sdk/current/@glaze/core/cli/glaze.js`
  - `../glaze-core/cli/glaze.js`
  - `../../../sdk/current/@glaze/core/cli/glaze.js`
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

Install dependencies from the repo root:

```bash
npm install --include=dev
```

Use `--include=dev` because local build, type-check, lint, and formatting commands need dev dependencies. A plain `npm install` under a production `NODE_ENV` can prune them.

## Run Locally

Run the full native app:

```bash
npm run dev
```

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

## Glaze CLI Troubleshooting

If a script fails with:

```text
[glaze] CLI not found. Searched:
  - /Users/you/Library/Application Support/app.glaze.macos.main/sdk/current/@glaze/core/cli/glaze.js
  - /path/to/glaze-core/cli/glaze.js
  - /path/to/sdk/current/@glaze/core/cli/glaze.js
```

then the Glaze SDK is not present at a path expected by `glaze.ts`. The normal multi-developer location is under each developer's home directory at `$HOME/Library/Application Support/app.glaze.macos.main/sdk/current/@glaze/core/cli/glaze.js`. Fix this by installing or linking the SDK so one of the searched paths exists, or update `glaze.ts` only if the team has agreed on a new local SDK layout.

Do not install or modify `@glaze/core` inside this app as a normal npm dependency. The SDK is treated as a local, version-pinned platform dependency.

When `glaze.ts` finds the SDK, it creates a local `.glaze-sdk` symlink so TypeScript can resolve `@glaze/core/*` types through a stable repo-local path. This symlink is ignored by git and can be deleted safely; it will be recreated on the next `npm run ...` command that goes through `glaze.ts`.

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
