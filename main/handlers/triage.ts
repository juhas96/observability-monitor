/**
 * Local triage IPC handlers for acknowledge/silence state.
 */

import { ipcMain, logger } from "@glaze/core/backend";

import { clearTriage, listTriage, updateTriage } from "../services/triage-store.js";
import type { TriageState } from "../services/types.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return value as Record<string, unknown>;
}

function uidFrom(payload: unknown): string {
  const req = asRecord(payload);
  if (typeof req.uid !== "string" || req.uid.trim() === "") throw new Error("Triage uid is required.");
  return req.uid.trim();
}

export function registerTriageHandlers(): void {
  ipcMain.handle("triage:list", async (): Promise<Record<string, TriageState>> => {
    return await listTriage();
  });

  ipcMain.handle("triage:acknowledge", async (_event, payload: unknown): Promise<TriageState> => {
    return await updateTriage(uidFrom(payload), { acknowledgedAt: new Date().toISOString() });
  });

  ipcMain.handle("triage:silence", async (_event, payload: unknown): Promise<TriageState> => {
    const req = asRecord(payload);
    const minutes = Number(req.minutes);
    const duration = Number.isFinite(minutes) ? Math.max(1, Math.min(24 * 60, minutes)) : 60;
    return await updateTriage(uidFrom(payload), { silencedUntil: new Date(Date.now() + duration * 60 * 1000).toISOString() });
  });

  ipcMain.handle("triage:clear", async (_event, payload: unknown): Promise<{ ok: true }> => {
    await clearTriage(uidFrom(payload));
    return { ok: true };
  });

  logger.info("triage", "✓ Triage handlers registered");
}
