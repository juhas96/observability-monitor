/**
 * App monitoring settings (poll interval + notification preferences).
 * Plain JSON in userData/settings.json.
 */

import { DataStore } from "./data-store.js";
import {
  DEFAULT_SETTINGS,
  MAX_HISTORY_RETENTION_DAYS,
  MIN_HISTORY_RETENTION_DAYS,
  MIN_POLL_INTERVAL_SECONDS,
  type MaintenanceWindow,
  type MonitorSettings,
  type RuleScope,
} from "./types.js";

const store = new DataStore<MonitorSettings>("settings.json", DEFAULT_SETTINGS);

function clampHour(value: unknown, fallback: number): number {
  const hour = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(hour)) return fallback;
  return Math.max(0, Math.min(23, Math.round(hour)));
}

function normalizeDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
}

function normalizeRetentionDays(value: unknown, fallback = DEFAULT_SETTINGS.historyRetentionDays): number {
  const days = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(days)) return fallback;
  return Math.max(MIN_HISTORY_RETENTION_DAYS, Math.min(MAX_HISTORY_RETENTION_DAYS, Math.round(days)));
}

function normalizeScope(value: unknown): RuleScope | undefined {
  if (!value || typeof value !== "object") return undefined;
  const scope = value as Partial<Record<keyof RuleScope, unknown>>;
  const next: RuleScope = {
    groupId: typeof scope.groupId === "string" && scope.groupId.trim() ? scope.groupId.trim() : undefined,
    accountId: typeof scope.accountId === "string" && scope.accountId.trim() ? scope.accountId.trim() : undefined,
    provider: typeof scope.provider === "string" && scope.provider.trim() ? scope.provider.trim() as RuleScope["provider"] : undefined,
    checkId: typeof scope.checkId === "string" && scope.checkId.trim() ? scope.checkId.trim() : undefined,
  };
  return Object.values(next).some(Boolean) ? next : undefined;
}

function normalizeMaintenanceWindows(value: unknown): MaintenanceWindow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index): MaintenanceWindow[] => {
    if (!raw || typeof raw !== "object") return [];
    const record = raw as Partial<MaintenanceWindow>;
    const days = normalizeDays(record.days);
    if (days.length === 0) return [];
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `maintenance-${index + 1}`;
    const label = typeof record.label === "string" && record.label.trim() ? record.label.trim().slice(0, 80) : "Maintenance window";
    return [{
      id,
      label,
      enabled: record.enabled !== false,
      days,
      startHour: clampHour(record.startHour, 0),
      endHour: clampHour(record.endHour, 1),
      scope: normalizeScope(record.scope),
    }];
  });
}

export async function getSettings(): Promise<MonitorSettings> {
  const loaded = await store.load();
  // Merge with defaults so newly-added keys are always present.
  return {
    ...DEFAULT_SETTINGS,
    ...loaded,
    historyRetentionDays: normalizeRetentionDays(loaded.historyRetentionDays),
    digest: { ...DEFAULT_SETTINGS.digest, ...(loaded.digest ?? {}) },
    maintenanceWindows: normalizeMaintenanceWindows(loaded.maintenanceWindows),
  };
}

export async function updateSettings(patch: Partial<MonitorSettings>): Promise<MonitorSettings> {
  const current = await getSettings();
  const next: MonitorSettings = { ...current, ...patch };
  // Clamp poll interval to a safe floor to respect provider rate limits.
  if (typeof next.pollIntervalSeconds !== "number" || Number.isNaN(next.pollIntervalSeconds)) {
    next.pollIntervalSeconds = current.pollIntervalSeconds;
  }
  next.pollIntervalSeconds = Math.max(MIN_POLL_INTERVAL_SECONDS, Math.round(next.pollIntervalSeconds));
  next.historyRetentionDays = normalizeRetentionDays(next.historyRetentionDays, current.historyRetentionDays);
  // Normalize the snooze: drop empty/invalid/past values so "clear" works over IPC
  // (where `undefined` fields are stripped from the JSON payload).
  if (typeof next.mutedUntil === "string") {
    const until = new Date(next.mutedUntil).getTime();
    if (!Number.isFinite(until) || until <= Date.now()) next.mutedUntil = undefined;
  }
  next.maintenanceWindows = normalizeMaintenanceWindows(next.maintenanceWindows);
  await store.save(next);
  return next;
}
