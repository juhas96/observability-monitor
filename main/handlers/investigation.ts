import { ipcMain, logger } from "@glaze/core/backend";

import { getInvestigationContext } from "../services/investigation-context.js";
import type { InvestigationContext, Provider } from "../services/types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function registerInvestigationHandlers(): void {
  ipcMain.handle("investigation:getContext", async (_event, payload: unknown): Promise<InvestigationContext> => {
    const req = asRecord(payload);
    return await getInvestigationContext({
      itemUid: optionalString(req.itemUid),
      eventId: optionalString(req.eventId),
      accountId: optionalString(req.accountId),
      provider: optionalString(req.provider) as Provider | undefined,
      groupId: optionalString(req.groupId),
      title: optionalString(req.title),
      subtitle: optionalString(req.subtitle),
      ts: optionalString(req.ts),
      url: optionalString(req.url),
    });
  });

  logger.info("investigation", "✓ Investigation handlers registered");
}
