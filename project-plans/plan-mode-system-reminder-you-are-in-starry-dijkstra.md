# Plan: Next improvements — smarter alerts, ⌘K palette, QoL polish, hardening

## Context

The app is now feature-rich (13 providers, dashboard, insights, incidents, timeline, uptime checks, alert rules, digests, Slack/webhook channels). The gaps now are less about new surfaces and more about **making what exists trustworthy and fast to drive**. The user selected all four directions:

1. **Smarter, less noisy alerts** — rules fire instantaneously off a single snapshot, so a one-cycle blip pages you and there's no "resolved" signal. Add sustained-duration ("for N minutes"), a cooldown, and recovery notifications.
2. **Command palette (⌘K)** — a dense multi-provider app needs keyboard-first jump/search.
3. **Quality-of-life & native polish** — launch-at-login, per-account pause, a global notification snooze (lightweight "maintenance window"), and a richer tray menu.
4. **Hardening & performance** — provider rate-limit backoff, code-split the heavy chart routes (recharts chunk-size warning), and live-verify the defensively-built paths.

Confirmed SDK capabilities: `@glaze/core/components` exports `Command`/`CommandDialog`/`CommandInput`/`CommandList`/`CommandGroup`/`CommandItem`/`CommandEmpty`/`CommandShortcut`; `@glaze/core/backend` `app.setLoginItemSettings({openAtLogin})` + `getLoginItemSettings()` (sync) and `globalShortcut`. Tray is menu-based (`tray-controller.ts`) — enrich the menu, not a popover window. Large but each phase ships independently; suggested order A → B → C → D.

## Phase A — Smarter, less noisy alerts

Extend `main/services/rules-engine.ts` (I own this file; in-memory `states` map already tracks `firing`/`since`).
- **Types** (`main/services/types.ts` + `renderer/main/types.ts`): add `forMinutes?: number` (sustained duration; 0 = instant) and `cooldownMinutes?: number` to `AlertRule` + `AlertRuleInput`. Add `"recovery"` to `DispatchEventKind`.
- **Engine:** track internal per-rule `breachingSince` and `lastFiredAt`. Fire only when breach is continuous for ≥ `forMinutes` (compare `now - breachingSince`, no history query needed — cross-cycle state) AND `now - lastFiredAt ≥ cooldownMinutes`. On transition firing→clear after having fired, send a **recovery** native notification + `dispatch({kind:"recovery", …})` + a `history.appendEvent` (type `"recovery"`, which already exists). Respect the global snooze from Phase C.
- **Channels:** add `"recovery"` to `EVENT_KINDS` in `main/handlers/channels.ts` and to `EVENT_OPTIONS` in `renderer/settings/notification-channels.tsx`.
- **UI** (`renderer/main/alerts-view.tsx`): add "For (min)" and "Cooldown (min)" inputs to the rule dialog; show a "pending / firing since" hint from `RuleState`.

## Phase B — Command palette (⌘K)

New `renderer/main/components/command-palette.tsx` using `CommandDialog`/`CommandInput`/`CommandList`/`CommandGroup`/`CommandItem`.
- Open via a `keydown` listener (⌘K / Ctrl+K) added in `renderer/main/root-view.tsx`; controlled `open` state.
- Groups: **Navigation** (each route via `useNavigate`), **Accounts** (→ `/accounts`), **Recent items** (open URL via `monitorApi.openExternal`), **Incidents**, **Uptime checks** (→ `/uptime`), **Rules** (→ `/alerts`). Source data from existing hooks: `useMonitorData` (items/incidents/checks), `useAccounts`, `useChecks`, `useRules`.
- Reuse `providerIcon`/`providerLabel` (`components/provider-meta.tsx`) and `CommandShortcut` for hints. No backend changes.

## Phase C — Quality-of-life & native polish

- **Launch-at-login:** add `launchAtLogin: boolean` to `MonitorSettings` (`types.ts` both + `DEFAULT_SETTINGS` + settings-view inline interface). In `main/index.ts` on ready, apply `app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })`; in `main/handlers/monitor.ts` `updateSettings`, re-apply on change. Toggle in `renderer/settings/settings-view.tsx`.
- **Global notification snooze (lightweight maintenance window):** add `mutedUntil?: string` to `MonitorSettings`. `notifier.ts` and `rules-engine.ts` skip native+dispatch while `mutedUntil` is in the future (reuses the existing silence concept). Expose quick "Snooze 1h / until tomorrow / clear" in Settings and the tray.
- **Per-account pause:** in `renderer/main/accounts-view.tsx` add an inline `Switch` per row bound to `useAccountMutations().update({ id, enabled })` (both already imported) — no more opening the edit dialog to pause.
- **Tray enrichment** (`main/services/tray-controller.ts`, menu-based): add summary lines for uptime-down count (`snapshot.checks`) and firing-rule count (`getRuleStates()`), and a "Snooze notifications" submenu wired through a new `onSnooze(minutes)` callback in `TrayCallbacks` (set from `main/index.ts`).

## Phase D — Hardening & performance

- **Provider rate-limit backoff:** in `main/services/poller.ts` `fetchAccount`, keep a per-account backoff map; on HTTP 429 or repeated consecutive failures, skip the account for an exponentially growing number of cycles (capped), reset on success. Surface as existing `lastError`.
- **Code-split chart routes:** wrap `InsightsView` and `TimelineView` (recharts-heavy) with `React.lazy` + `Suspense` in `renderer/main/router.tsx` (fallback spinner) so recharts leaves the main bundle — resolves the Vite chunk-size warning and speeds cold start.
- **Live-verify (runtime, not code):** with real credentials/URLs, confirm PostHog error-tracking + HogQL fallback, a real Slack/webhook delivery, and an uptime check end-to-end; fix any response-shape mismatches found.

## Critical files

- **Edit backend:** `services/rules-engine.ts` (windowing/cooldown/recovery), `services/types.ts` (`AlertRule` fields, `DispatchEventKind`, `MonitorSettings` fields), `services/notifier.ts` (snooze), `services/tray-controller.ts` (summary + snooze), `services/poller.ts` (backoff), `handlers/channels.ts` (recovery kind), `handlers/monitor.ts` (login-item + snooze apply), `index.ts` (login-item on startup, tray snooze callback).
- **New frontend:** `renderer/main/components/command-palette.tsx`.
- **Edit frontend:** `renderer/main/root-view.tsx` (⌘K), `router.tsx` (lazy routes), `alerts-view.tsx` (for/cooldown), `accounts-view.tsx` (row toggle), `renderer/settings/settings-view.tsx` (+`notification-channels.tsx`) (launch-at-login, snooze, recovery event), `renderer/main/types.ts` mirror.

## Reused patterns (do not re-invent)

- In-memory firing-state pattern already in `rules-engine.ts`; `appendEvent` + `"recovery"` event type already in `history-store.ts`/`types.ts`.
- Global mute reuses the silence idea from `triage-store.ts`/`notifier.ts`.
- `Command*` palette components, `Dialog`/`Field`/`Switch`/`Select` (existing dialogs), `providerIcon`/`providerLabel`, and hooks `useMonitorData`/`useAccounts`/`useChecks`/`useRules`.
- `Button` variants are `transparent|accent|destructive|filled|muted|glass|glassAccent`, sizes `small|medium|large`, `iconOnly`; `Callout`/`Badge` use `color` (learned this build).

## Verification

- After each phase: `npm run type-check && npm run lint`, then build for runtime validation.
- **Alerts:** create a rule with `forMinutes: 2`; confirm a 1-cycle blip does NOT notify, a sustained breach fires once, cooldown suppresses repeats, and clearing sends a recovery notification + `/timeline` recovery event.
- **⌘K:** press ⌘K, search an account/item/check, confirm it navigates or opens the URL; Esc closes.
- **QoL:** toggle launch-at-login and confirm via `getLoginItemSettings()`; snooze and confirm no notifications fire until it lapses; toggle an account off in the row and confirm the poller skips it; tray shows down/firing counts + Snooze submenu.
- **Hardening:** confirm main bundle shrinks (no recharts chunk-size warning) and Insights/Timeline lazy-load; simulate a 429 and confirm backoff + recovery. Then run the live-verification pass with real credentials.
