/**
 * Resend adapter. Per-email delivery needs webhooks, so this monitors domain
 * verification status and recent broadcasts. Credential: API key (re_…).
 */

import type { MonitorItem, MonitorLogLine, MonitorLogResponse, NormalizedStatus } from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const API_BASE = "https://api.resend.com";

async function rsFetch<T>(token: string, path: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (res.status === 404 || res.status === 403 || res.status === 422) {
    return { ok: false, status: res.status };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status} on ${path}: ${res.statusText}${body ? ` — ${body.slice(0, 160)}` : ""}`);
  }
  return { ok: true, data: (await res.json()) as T };
}

interface RsListEnvelope<T> {
  data: T[];
}

interface RsDomain {
  id: string;
  name: string;
  status: string; // verified | pending | not_started | failed | temporary_failure
  created_at?: string;
}

interface RsBroadcast {
  id: string;
  name?: string;
  status: string; // draft | queued | sent
  created_at?: string;
  sent_at?: string;
}

interface RsLogSummary {
  id: string;
  created_at?: string;
  endpoint?: string;
  method?: string;
  response_status?: number;
  user_agent?: string;
}

interface RsLogDetail extends RsLogSummary {
  request_body?: unknown;
  response_body?: unknown;
}

function mapDomainStatus(status: string): NormalizedStatus {
  switch (status) {
    case "verified":
      return "success";
    case "failed":
    case "temporary_failure":
      return "failure";
    case "pending":
    case "not_started":
    case "pending_verification":
      return "warning";
    default:
      return "unknown";
  }
}

function mapBroadcastStatus(status: string): NormalizedStatus {
  switch (status) {
    case "sent":
      return "success";
    case "queued":
    case "sending":
      return "running";
    case "draft":
      return "info";
    default:
      return "unknown";
  }
}

function logDetailToLines(log: RsLogDetail): MonitorLogLine[] {
  const lines: MonitorLogLine[] = [{
    timestamp: log.created_at,
    section: "Request",
    level: String(log.response_status ?? ""),
    message: `${log.method ?? "REQUEST"} ${log.endpoint ?? ""} -> ${log.response_status ?? "unknown"}`.trim(),
  }];
  if (log.user_agent) lines.push({ timestamp: log.created_at, section: "Request", message: `User agent: ${log.user_agent}` });
  if (log.request_body !== undefined) {
    lines.push({ timestamp: log.created_at, section: "Request body", message: JSON.stringify(log.request_body, null, 2) });
  }
  if (log.response_body !== undefined) {
    lines.push({ timestamp: log.created_at, section: "Response body", message: JSON.stringify(log.response_body, null, 2) });
  }
  return lines;
}

async function fetchResendLogs(token: string, item: MonitorItem): Promise<MonitorLogResponse> {
  const ref = item.logRef ?? {};
  const nativeId = typeof ref.id === "string" ? ref.id : "";
  const fallback = item.logFallbackUrl ?? item.url;
  const logs = await rsFetch<RsListEnvelope<RsLogSummary>>(token, "/logs").catch(() => ({ ok: false as const, status: 0 }));
  if (!logs.ok) throw new Error(`Resend API logs are unavailable (status ${logs.status}).`);
  const match = (logs.data.data ?? []).find((log) => nativeId && (log.endpoint ?? "").includes(nativeId));
  if (!match) {
    return {
      itemUid: item.uid,
      title: item.title,
      subtitle: "Resend API request logs",
      provider: "resend",
      fetchedAt: new Date().toISOString(),
      fallbackUrl: fallback,
      lines: [{ section: "API logs", message: "No matching API request log was found for this item." }],
    };
  }
  const detail = await rsFetch<RsLogDetail>(token, `/logs/${match.id}`);
  if (!detail.ok) throw new Error(`Resend log ${match.id} is unavailable (status ${detail.status}).`);
  return {
    itemUid: item.uid,
    title: item.title,
    subtitle: match.endpoint,
    provider: "resend",
    fetchedAt: new Date().toISOString(),
    fallbackUrl: fallback,
    lines: logDetailToLines(detail.data),
  };
}

export const resendProvider: ProviderDefinition = {
  id: "resend",
  label: "Resend",
  scopeHint: "Create an API key at resend.com/api-keys (read access is enough).",
  fields: [{ key: "token", label: "API key", type: "password", placeholder: "re_…", required: true, secret: true }],
  async validate(creds) {
    const res = await rsFetch<RsListEnvelope<RsDomain>>(creds.token, "/domains");
    if (!res.ok) throw new Error(`Resend API key rejected (status ${res.status}).`);
    const count = res.data.data?.length ?? 0;
    return { identity: `${count} domain${count === 1 ? "" : "s"}` };
  },
  async fetch(account, creds) {
    const token = creds.token;
    const items: MonitorItem[] = [];

    const domainsRes = await rsFetch<RsListEnvelope<RsDomain>>(token, "/domains");
    if (domainsRes.ok) {
      for (const domain of domainsRes.data.data ?? []) {
        const now = domain.created_at || new Date().toISOString();
        items.push({
          uid: `${account.id}:resend-domain:${domain.id}`,
          accountId: account.id,
          provider: "resend",
          kind: "resend-domain",
          category: "domain",
          title: domain.name,
          subtitle: `Domain · ${domain.status}`,
          status: mapDomainStatus(domain.status),
          conclusion: domain.status,
          createdAt: now,
          updatedAt: now,
          url: "https://resend.com/domains",
          logAvailable: true,
          logLabel: "View logs",
          logFallbackUrl: "https://resend.com/logs",
          logRef: { type: "domain", id: domain.id },
        });
      }
    }

    const broadcastsRes = await rsFetch<RsListEnvelope<RsBroadcast>>(token, "/broadcasts").catch(
      () => ({ ok: false as const, status: 0 }),
    );
    if (broadcastsRes.ok) {
      for (const b of (broadcastsRes.data.data ?? []).slice(0, 10)) {
        const when = b.sent_at || b.created_at || new Date().toISOString();
        items.push({
          uid: `${account.id}:resend-broadcast:${b.id}`,
          accountId: account.id,
          provider: "resend",
          kind: "resend-broadcast",
          category: "email",
          title: b.name || "Broadcast",
          subtitle: `Broadcast · ${b.status}`,
          status: mapBroadcastStatus(b.status),
          conclusion: b.status,
          createdAt: b.created_at || when,
          updatedAt: when,
          url: "https://resend.com/broadcasts",
          logAvailable: true,
          logLabel: "View logs",
          logFallbackUrl: "https://resend.com/logs",
          logRef: { type: "broadcast", id: b.id },
        });
      }
    }

    return items;
  },
  async fetchLogs(_account, creds, item) {
    return await fetchResendLogs(creds.token, item);
  },
};
