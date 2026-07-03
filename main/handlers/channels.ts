/**
 * Notification channel IPC handlers. The stored webhook URL is never returned
 * to the renderer — only `hasUrl` is exposed.
 */

import { ipcMain, logger } from "@glaze/core/backend";

import { deleteChannel, getChannelUrl, listChannels, saveChannel } from "../services/channels-store.js";
import { dispatchTest } from "../services/dispatch.js";
import type { Channel, ChannelInput, ChannelType, DispatchEventKind } from "../services/types.js";

export interface ChannelView extends Channel {
  hasUrl: boolean;
}

const CHANNEL_TYPES: ChannelType[] = ["slack", "webhook"];
const EVENT_KINDS: DispatchEventKind[] = ["failure", "success", "alert", "recovery", "digest"];

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return value as Record<string, unknown>;
}

function parseInput(payload: unknown): ChannelInput {
  const req = asRecord(payload);
  const type = String(req.type) as ChannelType;
  if (!CHANNEL_TYPES.includes(type)) throw new Error("Invalid channel type.");
  const name = typeof req.name === "string" ? req.name.trim() : "";
  if (name === "") throw new Error("Channel name is required.");
  const events = Array.isArray(req.events)
    ? (req.events.filter((e): e is DispatchEventKind => EVENT_KINDS.includes(e as DispatchEventKind)))
    : [];
  return {
    id: typeof req.id === "string" && req.id ? req.id : undefined,
    type,
    name,
    enabled: req.enabled !== false,
    events,
    url: typeof req.url === "string" ? req.url : undefined,
  };
}

async function toView(channel: Channel): Promise<ChannelView> {
  return { ...channel, hasUrl: (await getChannelUrl(channel.id)) != null };
}

export function registerChannelHandlers(): void {
  ipcMain.handle("channels:list", async (): Promise<ChannelView[]> => {
    const channels = await listChannels();
    return Promise.all(channels.map(toView));
  });

  ipcMain.handle("channels:save", async (_event, payload: unknown): Promise<ChannelView> => {
    const input = parseInput(payload);
    if (!input.id && (!input.url || input.url.trim() === "")) {
      throw new Error("A webhook URL is required for a new channel.");
    }
    const channel = await saveChannel(input);
    return toView(channel);
  });

  ipcMain.handle("channels:delete", async (_event, payload: unknown): Promise<{ ok: true }> => {
    const req = asRecord(payload);
    if (typeof req.id !== "string" || req.id.trim() === "") throw new Error("Channel id is required.");
    await deleteChannel(req.id);
    return { ok: true };
  });

  ipcMain.handle("channels:test", async (_event, payload: unknown): Promise<{ ok: true }> => {
    const req = asRecord(payload);
    if (typeof req.id !== "string" || req.id.trim() === "") throw new Error("Channel id is required.");
    await dispatchTest(req.id);
    return { ok: true };
  });

  logger.info("channels", "✓ Channel handlers registered");
}
