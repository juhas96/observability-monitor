/**
 * Uptime / synthetic check IPC handlers: CRUD plus a per-check latency series.
 */

import { ipcMain, logger } from "@glaze/core/backend";

import { deleteCheck, listChecks, saveCheck } from "../services/checks-store.js";
import { getCheckLatencySeries, historyRange } from "../services/history-store.js";
import type { CheckSeries, HttpCheck, HttpCheckInput } from "../services/types.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return value as Record<string, unknown>;
}

function optionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && value !== "" && value != null ? n : undefined;
}

function parseInput(payload: unknown): HttpCheckInput {
  const req = asRecord(payload);
  if (typeof req.url !== "string") throw new Error("Check URL is required.");
  if (typeof req.name !== "string") throw new Error("Check name is required.");
  return {
    id: typeof req.id === "string" && req.id ? req.id : undefined,
    name: req.name,
    url: req.url,
    method: typeof req.method === "string" ? req.method : undefined,
    expectedStatus: optionalNumber(req.expectedStatus),
    timeoutMs: optionalNumber(req.timeoutMs),
    groupId: typeof req.groupId === "string" && req.groupId ? req.groupId : undefined,
    enabled: typeof req.enabled === "boolean" ? req.enabled : undefined,
  };
}

export function registerCheckHandlers(): void {
  ipcMain.handle("checks:list", async (): Promise<HttpCheck[]> => {
    return listChecks();
  });

  ipcMain.handle("checks:save", async (_event, payload: unknown): Promise<HttpCheck> => {
    return saveCheck(parseInput(payload));
  });

  ipcMain.handle("checks:delete", async (_event, payload: unknown): Promise<{ ok: true }> => {
    const req = asRecord(payload);
    if (typeof req.id !== "string" || req.id.trim() === "") throw new Error("Check id is required.");
    await deleteCheck(req.id);
    return { ok: true };
  });

  ipcMain.handle("checks:getLatencySeries", async (_event, payload: unknown): Promise<CheckSeries> => {
    const req = asRecord(payload);
    if (typeof req.checkId !== "string" || req.checkId.trim() === "") throw new Error("Check id is required.");
    return getCheckLatencySeries(req.checkId, historyRange(req.range));
  });

  logger.info("checks", "✓ Check handlers registered");
}
