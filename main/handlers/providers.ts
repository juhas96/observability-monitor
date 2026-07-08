/**
 * Exposes renderer-safe provider metadata and provider workspace summaries.
 * Workspace IPC is read-only and is backed by normalized snapshot/history data.
 */

import * as fs from "fs/promises";

import { dialog } from "@glaze/core/backend";
import { ipcMain, logger } from "@glaze/core/backend";

import { getWorkspaceOverview, listWorkspaceCapabilities, parseProvider } from "../services/provider-workspace.js";
import * as registry from "../services/providers/index.js";
import { historyRange } from "../services/history-store.js";
import type { ProviderInfo } from "../services/providers/index.js";
import type { ProviderWorkspaceCapability, ProviderWorkspaceOverview } from "../services/types.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" && value !== "all" ? value.trim() : undefined;
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function workspaceToCsv(workspace: ProviderWorkspaceOverview): string {
  const rows: unknown[][] = [
    ["section", "id", "timestamp", "type", "label", "value", "status", "account", "detail", "url"],
  ];
  for (const stat of workspace.stats) {
    rows.push(["stats", "", workspace.generatedAt, stat.tone ?? "", stat.label, stat.value, "", "", stat.detail ?? "", ""]);
  }
  for (const series of workspace.series) {
    for (const point of series.points) {
      for (const field of series.fields) {
        rows.push(["series", series.id, point.ts, field.key, series.label, point.values[field.key] ?? 0, field.tone ?? "", "", field.label, ""]);
      }
    }
  }
  for (const table of workspace.resources) {
    for (const row of table.rows) {
      rows.push(["resource", table.id, "", "", table.label, "", String(row.status ?? ""), String(row.account ?? ""), JSON.stringify(row), row.__url ?? ""]);
    }
  }
  for (const row of workspace.evidence) {
    rows.push(["evidence", row.id, row.ts, row.type, row.title, "", row.status ?? "", row.accountLabel ?? "", row.subtitle ?? "", row.url ?? ""]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function registerProviderHandlers(): void {
  ipcMain.handle("providers:list", async (): Promise<ProviderInfo[]> => {
    return registry.publicList();
  });

  ipcMain.handle("providers:listWorkspaceCapabilities", async (): Promise<ProviderWorkspaceCapability[]> => {
    return await listWorkspaceCapabilities();
  });

  ipcMain.handle("providers:getWorkspaceOverview", async (_event, payload: unknown): Promise<ProviderWorkspaceOverview> => {
    const req = asRecord(payload);
    return await getWorkspaceOverview({
      provider: parseProvider(req.provider),
      accountId: optionalString(req.accountId),
      range: historyRange(req.range),
    });
  });

  ipcMain.handle("providers:runWorkspaceQuery", async (_event, payload: unknown): Promise<ProviderWorkspaceOverview> => {
    const req = asRecord(payload);
    return await getWorkspaceOverview({
      provider: parseProvider(req.provider),
      accountId: optionalString(req.accountId),
      range: historyRange(req.range),
    });
  });

  ipcMain.handle("providers:exportWorkspace", async (_event, payload: unknown): Promise<{ ok: boolean; filePath?: string }> => {
    const req = asRecord(payload);
    const format = req.format === "json" ? "json" : "csv";
    const workspace = await getWorkspaceOverview({
      provider: parseProvider(req.provider),
      accountId: optionalString(req.accountId),
      range: historyRange(req.range),
    });
    const contents = format === "json" ? JSON.stringify(workspace, null, 2) : workspaceToCsv(workspace);
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: "Export provider workspace",
      defaultPath: `${workspace.provider}-workspace-${stamp}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    await fs.writeFile(result.filePath, contents, "utf-8");
    return { ok: true, filePath: result.filePath };
  });

  logger.info("providers", "✓ Provider handlers registered");
}
