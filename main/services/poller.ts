/**
 * Polling orchestrator. Runs a non-overlapping recurring cycle that fetches
 * every enabled account, updates the aggregator, detects status transitions
 * for notifications, refreshes the tray, and pushes snapshots to the renderer.
 */

import { logger } from "@glaze/core/backend";

import * as aggregator from "./aggregator.js";
import { runChecks } from "./checks-runner.js";
import { detectTransitions, forgetAccount } from "./diff-engine.js";
import * as registry from "./providers/index.js";
import * as history from "./history-store.js";
import { notifyTransitions } from "./notifier.js";
import { pushAccountError, pushPollingState, pushSnapshot } from "./push.js";
import { evaluateRules } from "./rules-engine.js";
import { getSettings } from "./settings-store.js";
import { getToken } from "./token-store.js";
import { listAccounts, listGroups, updateAccount } from "./accounts-store.js";
import { updateTray } from "./tray-controller.js";
import type { Account, AggregateSnapshot, HttpCheckResult } from "./types.js";

const CONCURRENCY = 4;

// Per-account backoff after failures (esp. HTTP 429) so we stop hammering a
// rate-limited or broken provider. Reset on the next successful fetch.
const BACKOFF_BASE_MS = 2 * 60_000;
const BACKOFF_RATE_LIMIT_BASE_MS = 5 * 60_000;
const BACKOFF_CAP_MS = 30 * 60_000;
const backoff = new Map<string, { failures: number; nextAttemptAt: number }>();

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let cycleInFlight = false;

async function fetchAccount(account: Account): Promise<void> {
  const now = new Date().toISOString();
  try {
    const token = await getToken(account.id);
    if (!token) {
      throw new Error("No stored token for this account.");
    }
    const secret = registry.secretField(account.provider);
    const creds: Record<string, string> = { ...(account.config ?? {}), [secret.key]: token };
    const definition = registry.get(account.provider);
    const items = await definition.fetch(account, creds);
    const [signals, incidents, metrics, deepLinks] = await Promise.all([
      definition.fetchSignals?.(account, creds, items) ?? Promise.resolve(undefined),
      definition.fetchIncidents?.(account, creds, items) ?? Promise.resolve(undefined),
      definition.fetchMetricsSummary?.(account, creds, items) ?? Promise.resolve(undefined),
      definition.getDeepLinks?.(account, creds, items) ?? Promise.resolve(undefined),
    ]);
    aggregator.setAccountData(account.id, items, now, { signals, incidents, metrics, deepLinks });
    await updateAccount(account.id, { lastSyncAt: now, lastError: undefined });
    backoff.delete(account.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    aggregator.setAccountError(account.id, message, now);
    await updateAccount(account.id, { lastSyncAt: now, lastError: message }).catch(() => {});
    pushAccountError(account.id, message);

    // Exponential backoff; a larger base for rate-limit (429) responses.
    const failures = (backoff.get(account.id)?.failures ?? 0) + 1;
    const base = /(^|\D)429(\D|$)/.test(message) ? BACKOFF_RATE_LIMIT_BASE_MS : BACKOFF_BASE_MS;
    const delay = Math.min(BACKOFF_CAP_MS, base * 2 ** (failures - 1));
    backoff.set(account.id, { failures, nextAttemptAt: Date.now() + delay });
    logger.warn("poller", "Account fetch failed", { accountId: account.id, error: message, failures, backoffMs: delay });
  }
}

async function runInBatches(accounts: Account[]): Promise<void> {
  for (let i = 0; i < accounts.length; i += CONCURRENCY) {
    const batch = accounts.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map(fetchAccount));
  }
}

/** Fetch all (or one) enabled account, then publish results. Returns the snapshot. */
export async function runCycle(onlyAccountId?: string): Promise<AggregateSnapshot> {
  if (cycleInFlight) {
    return aggregator.buildSnapshot();
  }
  cycleInFlight = true;
  try {
    const [all, groups] = await Promise.all([listAccounts(), listGroups()]);
    aggregator.setKnownAccounts(all, groups);
    aggregator.pruneToAccounts(new Set(all.map((a) => a.id)));

    let targets = all.filter((a) => a.enabled);
    if (onlyAccountId) {
      // User-initiated single-account refresh bypasses backoff.
      targets = targets.filter((a) => a.id === onlyAccountId);
    } else {
      const nowMs = Date.now();
      targets = targets.filter((a) => (backoff.get(a.id)?.nextAttemptAt ?? 0) <= nowMs);
    }

    await runInBatches(targets);

    // Uptime checks run on full cycles only; a single-account refresh keeps the
    // last results (and skips recording duplicate latency samples).
    let checkResults: HttpCheckResult[] = [];
    if (!onlyAccountId) {
      checkResults = await runChecks();
      aggregator.setCheckResults(checkResults);
    }

    const snapshot = aggregator.buildSnapshot();

    const settings = await getSettings();
    const transitions = detectTransitions(snapshot.items);
    await history.record(snapshot, transitions, checkResults);
    if (transitions.length > 0) await notifyTransitions(transitions, settings);
    await evaluateRules(snapshot);

    updateTray(snapshot);
    pushSnapshot(snapshot);
    return snapshot;
  } finally {
    cycleInFlight = false;
  }
}

function scheduleNext(delayMs: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!running) return;
    try {
      await runCycle();
    } catch (err) {
      logger.error("poller", "Cycle failed", { error: String(err) });
    }
    const settings = await getSettings();
    scheduleNext(settings.pollIntervalSeconds * 1000);
  }, delayMs);
}

export async function start(): Promise<void> {
  if (running) return;
  running = true;
  pushPollingState(true);
  // Kick off an immediate cycle, then schedule by interval.
  try {
    await runCycle();
  } catch (err) {
    logger.error("poller", "Initial cycle failed", { error: String(err) });
  }
  const settings = await getSettings();
  scheduleNext(settings.pollIntervalSeconds * 1000);
}

export function stop(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
  pushPollingState(false);
}

export function isPolling(): boolean {
  return running;
}

/** Force an immediate refresh (all accounts or one) and reschedule. */
export async function refresh(onlyAccountId?: string): Promise<AggregateSnapshot> {
  const snapshot = await runCycle(onlyAccountId);
  if (running) {
    const settings = await getSettings();
    scheduleNext(settings.pollIntervalSeconds * 1000);
  }
  return snapshot;
}

/** Called when settings change so the interval takes effect immediately. */
export async function reschedule(): Promise<void> {
  if (!running) return;
  const settings = await getSettings();
  scheduleNext(settings.pollIntervalSeconds * 1000);
}

/** Drop cached state for a removed account. */
export function dropAccount(accountId: string): void {
  aggregator.removeAccount(accountId);
  forgetAccount(accountId);
  backoff.delete(accountId);
}
