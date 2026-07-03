/**
 * Outbound notification dispatch. Forwards events to enabled Slack/webhook
 * channels. Never throws into the caller (poll cycle) — delivery failures are
 * logged and swallowed.
 */

import { logger } from "@glaze/core/backend";

import { getChannelUrl, listChannels } from "./channels-store.js";
import type { Channel, DispatchEvent } from "./types.js";

const TIMEOUT_MS = 10_000;

function payloadFor(channel: Channel, event: DispatchEvent): string {
  if (channel.type === "slack") {
    const text = [event.title, event.body, event.url].filter(Boolean).join("\n");
    return JSON.stringify({ text });
  }
  return JSON.stringify({
    kind: event.kind,
    title: event.title,
    body: event.body,
    url: event.url,
    at: new Date().toISOString(),
  });
}

async function post(url: string, body: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText}${text ? ` - ${text.slice(0, 160)}` : ""}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Forward an event to every enabled channel subscribed to its kind. */
export async function dispatch(event: DispatchEvent): Promise<void> {
  let channels: Channel[];
  try {
    channels = await listChannels();
  } catch {
    return;
  }
  const targets = channels.filter((c) => c.enabled && c.events.includes(event.kind));
  await Promise.all(
    targets.map(async (channel) => {
      try {
        const url = await getChannelUrl(channel.id);
        if (!url) return;
        await post(url, payloadFor(channel, event));
      } catch (err) {
        logger.warn("dispatch", "Channel delivery failed", { channel: channel.id, err: String(err) });
      }
    }),
  );
}

/** Send a one-off test message to a single channel; throws so the UI can surface the error. */
export async function dispatchTest(channelId: string): Promise<void> {
  const channels = await listChannels();
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) throw new Error("Channel not found.");
  const url = await getChannelUrl(channelId);
  if (!url) throw new Error("No URL stored for this channel.");
  await post(
    url,
    payloadFor(channel, {
      kind: "alert",
      title: "Test notification from Multi Monitor",
      body: "This channel is configured correctly.",
    }),
  );
}
