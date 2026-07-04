/**
 * History and SLO IPC handlers.
 */

import * as fs from "fs/promises";

import { dialog, ipcMain, logger } from "@glaze/core/backend";

import {
  clearRetainedHistory,
  deleteSlo,
  getAllEvents,
  getAllSamples,
  getEvents,
  getSeries,
  getSloStatus,
  getStats,
  historyDateRange,
  historyRange,
  listSlos,
  pruneRetainedHistory,
  saveSlo,
} from "../services/history-store.js";
import type { HistoryEvent, HistoryEventType, HistorySample, HistoryStats, Provider, SloDefinition } from "../services/types.js";

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function eventsToCsv(events: HistoryEvent[]): string {
  const header = ["id", "ts", "type", "provider", "accountId", "groupId", "sourceUid", "category", "title", "status", "severity", "url"];
  const rows = events.map((e) =>
    [e.id, e.ts, e.type, e.provider, e.accountId, e.groupId, e.sourceUid, e.category, e.title, e.status, e.severity, e.url].map(csvCell).join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

function samplesToCsv(samples: HistorySample[]): string {
  const header = ["ts", "aggregateStatus", "successCount", "failureCount", "openIncidentCount", "alertCount"];
  const rows = samples.map((s) =>
    [s.ts, s.aggregateStatus, s.successCount, s.failureCount, s.openIncidentCount, s.alertCount].map(csvCell).join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" && value !== "all" ? value.trim() : undefined;
}

function asEventTypes(value: unknown): HistoryEventType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<HistoryEventType>(["deploy", "failure", "recovery", "alert", "incident", "check"]);
  return value.filter((candidate): candidate is HistoryEventType => typeof candidate === "string" && allowed.has(candidate as HistoryEventType));
}

function hasExportFilters(req: Record<string, unknown>): boolean {
  return Boolean(
    req.range ||
    req.dateRange ||
    asOptionalString(req.groupId) ||
    asOptionalString(req.accountId) ||
    asOptionalString(req.provider) ||
    asOptionalString(req.status) ||
    asOptionalString(req.severity) ||
    asOptionalString(req.category) ||
    asEventTypes(req.types)?.length,
  );
}

export function registerHistoryHandlers(): void {
  ipcMain.handle("history:getSeries", async (_event, payload: unknown) => {
    const req = asRecord(payload);
    return await getSeries(req.dateRange ? historyDateRange(req.dateRange) : historyRange(req.range), {
      groupId: asOptionalString(req.groupId),
      accountId: asOptionalString(req.accountId),
      provider: asOptionalString(req.provider),
    });
  });

  ipcMain.handle("history:getEvents", async (_event, payload: unknown) => {
    const req = asRecord(payload);
    return await getEvents({
      range: req.dateRange ? historyDateRange(req.dateRange) : historyRange(req.range),
      groupId: asOptionalString(req.groupId),
      accountId: asOptionalString(req.accountId),
      provider: asOptionalString(req.provider),
      status: asOptionalString(req.status),
      severity: asOptionalString(req.severity),
      category: asOptionalString(req.category),
      types: asEventTypes(req.types),
    });
  });

  ipcMain.handle("history:getStats", async (): Promise<HistoryStats> => {
    return await getStats();
  });

  ipcMain.handle("history:clear", async (): Promise<HistoryStats> => {
    return await clearRetainedHistory();
  });

  ipcMain.handle("history:prune", async (): Promise<HistoryStats> => {
    return await pruneRetainedHistory();
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

  ipcMain.handle("history:export", async (_event, payload: unknown): Promise<{ ok: boolean; filePath?: string }> => {
    const req = asRecord(payload);
    const dataset = req.dataset === "samples" ? "samples" : "events";
    const format = req.format === "json" ? "json" : "csv";
    const filtered = hasExportFilters(req);
    const range = req.dateRange ? historyDateRange(req.dateRange) : historyRange(req.range);
    const groupId = asOptionalString(req.groupId);
    const accountId = asOptionalString(req.accountId);
    const provider = asOptionalString(req.provider);
    const samples = dataset === "samples"
      ? filtered
        ? await getSeries(range, { groupId, accountId, provider })
        : await getAllSamples()
      : [];
    const events = dataset === "events"
      ? filtered
        ? await getEvents({
          range,
          groupId,
          accountId,
          provider,
          status: asOptionalString(req.status),
          severity: asOptionalString(req.severity),
          category: asOptionalString(req.category),
          types: asEventTypes(req.types),
        })
        : await getAllEvents()
      : [];

    let contents: string;
    if (format === "json") {
      contents = JSON.stringify(dataset === "samples" ? samples : events, null, 2);
    } else {
      contents = dataset === "samples" ? samplesToCsv(samples) : eventsToCsv(events);
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: "Export history",
      defaultPath: `observability-${dataset}-${stamp}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    await fs.writeFile(result.filePath, contents, "utf-8");
    return { ok: true, filePath: result.filePath };
  });

  logger.info("history", "✓ History handlers registered");
}
