/**
 * Outbound notification dispatch. Forwards events to enabled Slack, Teams, and webhook
 * channels. Never throws into the caller (poll cycle) — delivery failures are
 * logged and swallowed.
 */

import { logger } from "@glaze/core/backend";

import { getChannelUrl, listChannels } from "./channels-store.js";
import type { Channel, DispatchEvent } from "./types.js";

const TIMEOUT_MS = 10_000;

function contextLines(event: DispatchEvent): string[] {
  const context = event.context;
  if (!context) return [];
  const lines = [
    context.serviceName ? `Service: ${context.serviceName}` : undefined,
    context.owner ? `Owner: ${context.owner}` : undefined,
    context.tier ? `Tier: ${context.tier}` : undefined,
    context.dependencies && context.dependencies.length > 0 ? `Dependencies: ${context.dependencies.join(", ")}` : undefined,
    context.runbookUrl ? `Runbook: ${context.runbookUrl}` : undefined,
    context.dashboardUrl ? `Dashboard: ${context.dashboardUrl}` : undefined,
    context.repositoryUrl ? `Repository: ${context.repositoryUrl}` : undefined,
  ];
  return lines.filter((line): line is string => Boolean(line));
}

function fact(name: string, value: string | undefined): { title: string; value: string } | null {
  return value ? { title: name, value } : null;
}

function teamsPayloadFor(event: DispatchEvent): string {
  const context = event.context;
  const facts = [
    fact("Kind", event.kind),
    fact("Service", context?.serviceName),
    fact("Owner", context?.owner),
    fact("Tier", context?.tier),
    fact("Dependencies", context?.dependencies && context.dependencies.length > 0 ? context.dependencies.join(", ") : undefined),
    fact("Runbook", context?.runbookUrl),
    fact("Dashboard", context?.dashboardUrl),
    fact("Repository", context?.repositoryUrl),
    fact("URL", event.url),
    fact("At", new Date().toISOString()),
  ].filter((item): item is { title: string; value: string } => item !== null);

  return JSON.stringify({
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard",
          version: "1.0",
          body: [
            {
              type: "TextBlock",
              text: event.title,
              weight: "Bolder",
              size: "Medium",
              wrap: true,
            },
            ...(event.body
              ? [
                  {
                    type: "TextBlock",
                    text: event.body,
                    wrap: true,
                  },
                ]
              : []),
            ...(facts.length > 0
              ? [
                  {
                    type: "FactSet",
                    facts,
                  },
                ]
              : []),
          ],
        },
      },
    ],
  });
}

function payloadFor(channel: Channel, event: DispatchEvent): string {
  if (channel.type === "slack") {
    const text = [event.title, event.body, ...contextLines(event), event.url].filter(Boolean).join("\n");
    return JSON.stringify({ text });
  }
  if (channel.type === "teams") {
    return teamsPayloadFor(event);
  }
  return JSON.stringify({
    kind: event.kind,
    title: event.title,
    body: event.body,
    url: event.url,
    context: event.context,
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

/** Forward an event to explicit target channels, or every enabled channel subscribed to its kind. */
export async function dispatch(event: DispatchEvent): Promise<void> {
  let channels: Channel[];
  try {
    channels = await listChannels();
  } catch {
    return;
  }
  const targetedIds = event.channelIds && event.channelIds.length > 0 ? new Set(event.channelIds) : null;
  const targets = channels.filter((c) => c.enabled && (targetedIds ? targetedIds.has(c.id) : c.events.includes(event.kind)));
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
