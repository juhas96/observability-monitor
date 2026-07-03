/**
 * History and SLO IPC handlers.
 */

import * as fs from "fs/promises";

import { dialog, ipcMain, logger } from "@glaze/core/backend";

import {
  deleteSlo,
  getAllEvents,
  getAllSamples,
  getEvents,
  getSeries,
  getSloStatus,
  historyRange,
  listSlos,
  saveSlo,
} from "../services/history-store.js";
import type { HistoryEvent, HistoryEventType, HistorySample, Provider, SloDefinition } from "../services/types.js";

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function eventsToCsv(events: HistoryEvent[]): string {
  const header = ["id", "ts", "type", "provider", "accountId", "groupId", "title", "status", "severity", "url"];
  const rows = events.map((e) =>
    [e.id, e.ts, e.type, e.provider, e.accountId, e.groupId, e.title, e.status, e.severity, e.url].map(csvCell).join(","),
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

  ipcMain.handle("history:export", async (_event, payload: unknown): Promise<{ ok: boolean; filePath?: string }> => {
    const req = asRecord(payload);
    const dataset = req.dataset === "samples" ? "samples" : "events";
    const format = req.format === "json" ? "json" : "csv";
    const [samples, events] = await Promise.all([getAllSamples(), getAllEvents()]);

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
