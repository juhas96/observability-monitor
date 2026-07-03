import { ipcMain, logger } from "@glaze/core/backend";

import {
  getGrafanaOverview,
  normalizeRange,
  runGrafanaLogPreset,
  runGrafanaTracePreset,
  updateGrafanaObservabilityConfig,
  type GrafanaObservabilityConfig,
  type GrafanaOverview,
  type GrafanaLogResult,
  type GrafanaTraceResult,
} from "../services/grafana-observability.js";
import type { Account } from "../services/types.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request payload.");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid "${field}".`);
  }
  return value.trim();
}

export function registerGrafanaHandlers(): void {
  ipcMain.handle("grafana:getOverview", async (_event, payload: unknown): Promise<GrafanaOverview> => {
    const req = asRecord(payload);
    return await getGrafanaOverview(asString(req.accountId, "accountId"));
  });

  ipcMain.handle("grafana:runLogPreset", async (_event, payload: unknown): Promise<GrafanaLogResult> => {
    const req = asRecord(payload);
    return await runGrafanaLogPreset(
      asString(req.accountId, "accountId"),
      asString(req.presetId, "presetId"),
      normalizeRange(req.range),
    );
  });

  ipcMain.handle("grafana:runTracePreset", async (_event, payload: unknown): Promise<GrafanaTraceResult> => {
    const req = asRecord(payload);
    return await runGrafanaTracePreset(
      asString(req.accountId, "accountId"),
      asString(req.presetId, "presetId"),
      normalizeRange(req.range),
    );
  });

  ipcMain.handle("grafana:updateObservabilityConfig", async (
    _event,
    payload: unknown,
  ): Promise<{ account: Account; config: GrafanaObservabilityConfig }> => {
    const req = asRecord(payload);
    const config = req.config;
    if (typeof config !== "object" || config === null) {
      throw new Error('Missing or invalid "config".');
    }
    return await updateGrafanaObservabilityConfig(
      asString(req.accountId, "accountId"),
      config as GrafanaObservabilityConfig,
    );
  });

  logger.info("grafana", "✓ Grafana handlers registered");
}
