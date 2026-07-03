/**
 * Monitoring IPC handlers: snapshot/refresh, settings, health, and the
 * open-in-browser proxy (shell.openExternal lives in the backend).
 */

import { ipcMain, shell, logger } from "@glaze/core/backend";

import * as aggregator from "../services/aggregator.js";
import { listAccounts } from "../services/accounts-store.js";
import * as poller from "../services/poller.js";
import { getSettings, updateSettings } from "../services/settings-store.js";
import { isEncryptionAvailable } from "../services/token-store.js";
import type { AggregateSnapshot, MonitorSettings } from "../services/types.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return value as Record<string, unknown>;
}

export function registerMonitorHandlers(): void {
  ipcMain.handle("monitor:getSnapshot", async (): Promise<AggregateSnapshot> => {
    return aggregator.buildSnapshot();
  });

  ipcMain.handle("monitor:refresh", async (_event, payload: unknown): Promise<AggregateSnapshot> => {
    const req = asRecord(payload);
    const accountId = typeof req.accountId === "string" ? req.accountId : undefined;
    return await poller.refresh(accountId);
  });

  ipcMain.handle("monitor:getSettings", async (): Promise<MonitorSettings> => {
    return await getSettings();
  });

  ipcMain.handle("monitor:updateSettings", async (_event, payload: unknown): Promise<MonitorSettings> => {
    const patch = asRecord(payload) as Partial<MonitorSettings>;
    const next = await updateSettings(patch);
    ipcMain.broadcast("settings:monitor-changed", { value: next });
    await poller.reschedule();
    return next;
  });

  ipcMain.handle("monitor:getStatus", async () => {
    const [encryptionAvailable, accounts] = await Promise.all([isEncryptionAvailable(), listAccounts()]);
    return {
      encryptionAvailable,
      polling: poller.isPolling(),
      accountCount: accounts.length,
    };
  });

  ipcMain.handle("monitor:openExternal", async (_event, payload: unknown): Promise<{ ok: true }> => {
    const req = asRecord(payload);
    const url = typeof req.url === "string" ? req.url : "";
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("Refusing to open a non-http(s) URL.");
    }
    await shell.openExternal(url);
    return { ok: true };
  });

  logger.info("monitor", "✓ Monitor handlers registered");
}
