/**
 * Monitoring IPC handlers: snapshot/refresh, settings, health, and the
 * open-in-browser proxy (shell.openExternal lives in the backend).
 */

import { ipcMain, shell, logger } from "@glaze/core/backend";

import * as aggregator from "../services/aggregator.js";
import { getAccount, listAccounts, listGroups } from "../services/accounts-store.js";
import * as poller from "../services/poller.js";
import * as digest from "../services/digest-scheduler.js";
import * as registry from "../services/providers/index.js";
import { getSettings, updateSettings } from "../services/settings-store.js";
import { getToken, isEncryptionAvailable } from "../services/token-store.js";
import type { AggregateSnapshot, MonitorSettings } from "../services/types.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid "${field}".`);
  }
  return value.trim();
}

export function registerMonitorHandlers(): void {
  ipcMain.handle("monitor:getSnapshot", async (): Promise<AggregateSnapshot> => {
    const [accounts, groups] = await Promise.all([listAccounts(), listGroups()]);
    aggregator.setKnownAccounts(accounts, groups);
    return aggregator.buildSnapshot();
  });

  ipcMain.handle("monitor:refresh", async (_event, payload: unknown): Promise<AggregateSnapshot> => {
    const req = asRecord(payload);
    const accountId = typeof req.accountId === "string" ? req.accountId : undefined;
    return await poller.refresh(accountId);
  });

  ipcMain.handle("monitor:getItemLogs", async (_event, payload: unknown) => {
    const req = asRecord(payload);
    const itemUid = asString(req.itemUid, "itemUid");
    const item = aggregator.buildSnapshot().items.find((candidate) => candidate.uid === itemUid);
    if (!item) throw new Error("This item is no longer in the current monitor snapshot. Refresh and try again.");
    if (!item.logAvailable) throw new Error("Logs are not available in-app for this item.");

    const account = await getAccount(item.accountId);
    if (!account) throw new Error("The account for this item no longer exists.");
    if (!account.enabled) throw new Error("This account is disabled.");
    if (account.provider !== item.provider) throw new Error("The item provider no longer matches its account.");

    const definition = registry.get(account.provider);
    if (!definition.fetchLogs) throw new Error("This provider does not support in-app logs yet.");

    const token = await getToken(account.id);
    if (!token) throw new Error("No stored token for this account.");
    const secret = registry.secretField(account.provider);
    return await definition.fetchLogs(account, { ...(account.config ?? {}), [secret.key]: token }, item);
  });

  ipcMain.handle("monitor:getSettings", async (): Promise<MonitorSettings> => {
    return await getSettings();
  });

  ipcMain.handle("monitor:updateSettings", async (_event, payload: unknown): Promise<MonitorSettings> => {
    const patch = asRecord(payload) as Partial<MonitorSettings>;
    const next = await updateSettings(patch);
    ipcMain.broadcast("settings:monitor-changed", { value: next });
    await poller.reschedule();
    await digest.reschedule();
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
