/**
 * Notification channel store. Non-secret channel metadata lives in channels.json;
 * the webhook URL is a secret and is stored in the encrypted token vault under
 * `channel:<id>` — mirroring how account tokens are split from account config.
 */

import { randomUUID } from "crypto";

import { DataStore } from "./data-store.js";
import { getToken, removeToken, setToken } from "./token-store.js";
import type { Channel, ChannelInput } from "./types.js";

interface ChannelsFile {
  channels: Channel[];
}

const store = new DataStore<ChannelsFile>("channels.json", { channels: [] });

const secretKey = (id: string): string => `channel:${id}`;

export async function listChannels(): Promise<Channel[]> {
  const file = await store.load();
  return file.channels;
}

export async function getChannelUrl(id: string): Promise<string | null> {
  return getToken(secretKey(id));
}

export async function saveChannel(input: ChannelInput): Promise<Channel> {
  const file = await store.load();
  const channels = [...file.channels];

  let channel: Channel;
  if (input.id) {
    const idx = channels.findIndex((c) => c.id === input.id);
    if (idx === -1) throw new Error("Channel not found.");
    channel = { ...channels[idx], type: input.type, name: input.name, enabled: input.enabled, events: input.events };
    channels[idx] = channel;
  } else {
    channel = { id: randomUUID(), type: input.type, name: input.name, enabled: input.enabled, events: input.events };
    channels.push(channel);
  }

  await store.save({ channels });

  // Only overwrite the stored URL when a non-blank one is provided (blank keeps the existing secret).
  if (input.url && input.url.trim() !== "") {
    await setToken(secretKey(channel.id), input.url.trim());
  }
  return channel;
}

export async function deleteChannel(id: string): Promise<void> {
  const file = await store.load();
  await store.save({ channels: file.channels.filter((c) => c.id !== id) });
  await removeToken(secretKey(id)).catch(() => {});
}
