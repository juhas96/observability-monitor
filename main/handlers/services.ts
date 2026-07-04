/**
 * Local service catalog metadata IPC.
 */

import { ipcMain, logger } from "@glaze/core/backend";

import { deleteServiceMetadata, listServiceMetadata, saveServiceMetadata } from "../services/service-metadata-store.js";
import type { ServiceMetadata, ServiceMetadataInput, ServiceTier } from "../services/types.js";

const TIERS: ServiceTier[] = ["critical", "standard", "internal", "experimental"];

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return value as Record<string, unknown>;
}

function parseInput(payload: unknown): ServiceMetadataInput {
  const req = asRecord(payload);
  return {
    serviceId: typeof req.serviceId === "string" ? req.serviceId : "",
    owner: typeof req.owner === "string" ? req.owner : undefined,
    tier: TIERS.includes(req.tier as ServiceTier) ? req.tier as ServiceTier : undefined,
    runbookUrl: typeof req.runbookUrl === "string" ? req.runbookUrl : undefined,
    dashboardUrl: typeof req.dashboardUrl === "string" ? req.dashboardUrl : undefined,
    repositoryUrl: typeof req.repositoryUrl === "string" ? req.repositoryUrl : undefined,
    dependencies: Array.isArray(req.dependencies) ? req.dependencies.filter((dependency): dependency is string => typeof dependency === "string") : undefined,
    notes: typeof req.notes === "string" ? req.notes : undefined,
  };
}

export function registerServiceHandlers(): void {
  ipcMain.handle("services:listMetadata", async (): Promise<ServiceMetadata[]> => {
    return listServiceMetadata();
  });

  ipcMain.handle("services:saveMetadata", async (_event, payload: unknown): Promise<ServiceMetadata> => {
    return saveServiceMetadata(parseInput(payload));
  });

  ipcMain.handle("services:deleteMetadata", async (_event, payload: unknown): Promise<{ ok: true }> => {
    const req = asRecord(payload);
    await deleteServiceMetadata(typeof req.serviceId === "string" ? req.serviceId : "");
    return { ok: true };
  });

  logger.info("services", "✓ Service metadata handlers registered");
}
