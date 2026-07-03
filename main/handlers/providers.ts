/**
 * Exposes provider metadata (id, label, scope hint, credential fields) so the
 * add-account dialog can render provider options and dynamic fields without
 * any hardcoded per-provider UI.
 */

import { ipcMain, logger } from "@glaze/core/backend";

import * as registry from "../services/providers/index.js";
import type { ProviderInfo } from "../services/providers/index.js";

export function registerProviderHandlers(): void {
  ipcMain.handle("providers:list", async (): Promise<ProviderInfo[]> => {
    return registry.publicList();
  });
  logger.info("providers", "✓ Provider handlers registered");
}
