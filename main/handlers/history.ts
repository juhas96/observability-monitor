/**
 * History and SLO IPC handlers.
 */

import { ipcMain, logger } from "@glaze/core/backend";

import {
  deleteSlo,
  getEvents,
  getSeries,
  getSloStatus,
  historyRange,
  listSlos,
  saveSlo,
} from "../services/history-store.js";
import type { HistoryEventType, Provider, SloDefinition } from "../services/types.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" && value !== "all" ? value.trim() : undefined;
}

function asEventTypes(value: unknown): HistoryEventType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<HistoryEventType>(["deploy", "failure", "recovery", "alert", "incident"]);
  return value.filter((candidate): candidate is HistoryEventType => typeof candidate === "string" && allowed.has(candidate as HistoryEventType));
}

export function registerHistoryHandlers(): void {
  ipcMain.handle("history:getSeries", async (_event, payload: unknown) => {
    const req = asRecord(payload);
    return await getSeries(historyRange(req.range));
  });

  ipcMain.handle("history:getEvents", async (_event, payload: unknown) => {
    const req = asRecord(payload);
    return await getEvents({
      range: historyRange(req.range),
      groupId: asOptionalString(req.groupId),
      provider: asOptionalString(req.provider),
      types: asEventTypes(req.types),
    });
  });

  ipcMain.handle("history:listSlos", async (): Promise<SloDefinition[]> => {
    return await listSlos();
  });

  ipcMain.handle("history:saveSlo", async (_event, payload: unknown): Promise<SloDefinition> => {
    const req = asRecord(payload);
    const name = typeof req.name === "string" ? req.name.trim() : "";
    if (!name) throw new Error("SLO name is required.");
    const scope = asRecord(req.scope) as SloDefinition["scope"];
    const target = Number(req.target);
    const windowDays = Number(req.windowDays);
    return await saveSlo({
      id: asOptionalString(req.id),
      name,
      scope: {
        groupId: asOptionalString(scope.groupId),
        accountId: asOptionalString(scope.accountId),
        provider: asOptionalString(scope.provider) as Provider | undefined,
      },
      target: Number.isFinite(target) ? target : 99,
      windowDays: Number.isFinite(windowDays) ? windowDays : 7,
    });
  });

  ipcMain.handle("history:deleteSlo", async (_event, payload: unknown): Promise<{ ok: true }> => {
    const req = asRecord(payload);
    const id = asOptionalString(req.id);
    if (!id) throw new Error("SLO id is required.");
    await deleteSlo(id);
    return { ok: true };
  });

  ipcMain.handle("history:getSloStatus", async () => {
    return await getSloStatus();
  });

  logger.info("history", "✓ History handlers registered");
}
