/**
 * App monitoring settings (poll interval + notification preferences).
 * Plain JSON in userData/settings.json.
 */

import { DataStore } from "./data-store.js";
import { DEFAULT_SETTINGS, MIN_POLL_INTERVAL_SECONDS, type MonitorSettings } from "./types.js";

const store = new DataStore<MonitorSettings>("settings.json", DEFAULT_SETTINGS);

export async function getSettings(): Promise<MonitorSettings> {
  const loaded = await store.load();
  // Merge with defaults so newly-added keys are always present.
  return { ...DEFAULT_SETTINGS, ...loaded };
}

export async function updateSettings(patch: Partial<MonitorSettings>): Promise<MonitorSettings> {
  const current = await getSettings();
  const next: MonitorSettings = { ...current, ...patch };
  // Clamp poll interval to a safe floor to respect provider rate limits.
  if (typeof next.pollIntervalSeconds !== "number" || Number.isNaN(next.pollIntervalSeconds)) {
    next.pollIntervalSeconds = current.pollIntervalSeconds;
  }
  next.pollIntervalSeconds = Math.max(MIN_POLL_INTERVAL_SECONDS, Math.round(next.pollIntervalSeconds));
  // Normalize the snooze: drop empty/invalid/past values so "clear" works over IPC
  // (where `undefined` fields are stripped from the JSON payload).
  if (typeof next.mutedUntil === "string") {
    const until = new Date(next.mutedUntil).getTime();
    if (!Number.isFinite(until) || until <= Date.now()) next.mutedUntil = undefined;
  }
  await store.save(next);
  return next;
}
