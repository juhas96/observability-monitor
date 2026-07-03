/**
 * Backend → renderer push helper. Broadcasts on channels that renderer code
 * subscribes to via window.glazeAPI.glaze.ipc.onNotification(channel, cb).
 */

import { ipcMain } from "@glaze/core/backend";

import type { AggregateSnapshot } from "./types.js";

export function pushSnapshot(snapshot: AggregateSnapshot): void {
  ipcMain.broadcast("monitor:snapshot", snapshot);
}

export function pushAccountError(accountId: string, error: string): void {
  ipcMain.broadcast("monitor:accountError", { accountId, error });
}

export function pushPollingState(polling: boolean): void {
  ipcMain.broadcast("monitor:pollingState", { polling });
}
