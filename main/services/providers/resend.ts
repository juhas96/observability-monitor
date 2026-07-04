/**
 * Resend adapter. Per-email delivery needs webhooks, so this monitors domain
 * verification status and recent broadcasts. Credential: API key (re_…).
 */

import type {
  DashboardPanelResult,
  DashboardProviderQuery,
  DashboardQueryCapability,
  DashboardTableRow,
  MonitorItem,
  MonitorLogLine,
  MonitorLogResponse,
  NormalizedStatus,
} from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const API_BASE = "https://api.resend.com";
const DEFAULT_DOMAIN_LIMIT = "50";
const DEFAULT_BROADCAST_LIMIT = "50";

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

function boundedLimit(value: string | undefined, fallback: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

async function fetchDomains(token: string): Promise<RsDomain[]> {
  const res = await rsFetch<RsListEnvelope<RsDomain>>(token, "/domains");
  if (!res.ok) throw new Error(`Resend domains are unavailable (status ${res.status}).`);
  return res.data.data ?? [];
}

async function fetchBroadcasts(token: string): Promise<RsBroadcast[]> {
  const res = await rsFetch<RsListEnvelope<RsBroadcast>>(token, "/broadcasts");
  if (!res.ok) throw new Error(`Resend broadcasts are unavailable (status ${res.status}).`);
  return res.data.data ?? [];
}

function filteredDomains(domains: RsDomain[], query?: DashboardProviderQuery): RsDomain[] {
  const status = query?.params?.status?.trim();
  const name = query?.params?.name?.trim().toLowerCase();
  return domains
    .filter((domain) => !status || status === "all" || domain.status === status)
    .filter((domain) => !name || domain.name.toLowerCase().includes(name))
    .slice(0, boundedLimit(query?.params?.limit, DEFAULT_DOMAIN_LIMIT));
}

function filteredBroadcasts(broadcasts: RsBroadcast[], query?: DashboardProviderQuery): RsBroadcast[] {
  const status = query?.params?.status?.trim();
  const name = query?.params?.name?.trim().toLowerCase();
  return broadcasts
    .filter((broadcast) => !status || status === "all" || broadcast.status === status)
    .filter((broadcast) => !name || (broadcast.name ?? "").toLowerCase().includes(name))
    .slice(0, boundedLimit(query?.params?.limit, DEFAULT_BROADCAST_LIMIT));
}

function domainRows(domains: RsDomain[]): DashboardTableRow[] {
  return domains.map((domain) => ({
    name: domain.name,
    status: domain.status,
    created: domain.created_at ? new Date(domain.created_at).toLocaleString() : "",
    __url: "https://resend.com/domains",
    __urlLabel: "Open domains",
  }));
}

function broadcastRows(broadcasts: RsBroadcast[]): DashboardTableRow[] {
  return broadcasts.map((broadcast) => ({
    name: broadcast.name ?? "Broadcast",
    status: broadcast.status,
    created: broadcast.created_at ? new Date(broadcast.created_at).toLocaleString() : "",
    sent: broadcast.sent_at ? new Date(broadcast.sent_at).toLocaleString() : "",
    __url: "https://resend.com/broadcasts",
    __urlLabel: "Open broadcasts",
  }));
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
    const count = (await fetchDomains(creds.token)).length;
    return { identity: `${count} domain${count === 1 ? "" : "s"}` };
  },
  async fetch(account, creds) {
    const token = creds.token;
    const items: MonitorItem[] = [];

    for (const domain of await fetchDomains(token).catch(() => [])) {
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

    for (const b of (await fetchBroadcasts(token).catch(() => [])).slice(0, 10)) {
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

    return items;
  },
  async fetchLogs(_account, creds, item) {
    return await fetchResendLogs(creds.token, item);
  },
  async getDashboardQueryCapabilities(account): Promise<DashboardQueryCapability[]> {
    return [
      {
        id: "resend.domains",
        label: `${account.label} domains`,
        description: "List Resend domain verification status with optional name, status, and limit filters.",
        requiresQuery: false,
        resultKind: "table",
        defaultVisualization: "table",
        defaultPanel: {
          title: "Resend domains",
          source: {
            kind: "provider",
            accountId: account.id,
            capabilityId: "resend.domains",
            params: { name: "", status: "all", limit: DEFAULT_DOMAIN_LIMIT },
          },
          visualization: "table",
          width: "full",
          height: "medium",
        },
        params: [
          { key: "name", label: "Domain contains", required: false, placeholder: "example.com" },
          { key: "status", label: "Status", required: false, placeholder: "all / verified / pending / failed", defaultValue: "all" },
          { key: "limit", label: "Limit", required: false, placeholder: DEFAULT_DOMAIN_LIMIT, defaultValue: DEFAULT_DOMAIN_LIMIT },
        ],
      },
      {
        id: "resend.broadcasts",
        label: `${account.label} broadcasts`,
        description: "List Resend broadcasts with optional name, status, and limit filters.",
        requiresQuery: false,
        resultKind: "table",
        defaultVisualization: "table",
        defaultPanel: {
          title: "Resend broadcasts",
          source: {
            kind: "provider",
            accountId: account.id,
            capabilityId: "resend.broadcasts",
            params: { name: "", status: "all", limit: DEFAULT_BROADCAST_LIMIT },
          },
          visualization: "table",
          width: "full",
          height: "medium",
        },
        params: [
          { key: "name", label: "Broadcast contains", required: false, placeholder: "launch" },
          { key: "status", label: "Status", required: false, placeholder: "all / draft / queued / sent", defaultValue: "all" },
          { key: "limit", label: "Limit", required: false, placeholder: DEFAULT_BROADCAST_LIMIT, defaultValue: DEFAULT_BROADCAST_LIMIT },
        ],
      },
    ];
  },
  async runDashboardQuery(account, creds, query: DashboardProviderQuery): Promise<DashboardPanelResult> {
    if (query.capabilityId === "resend.domains") {
      const domains = filteredDomains(await fetchDomains(creds.token), query);
      const failing = domains.filter((domain) => mapDomainStatus(domain.status) === "failure").length;
      return {
        kind: "table",
        generatedAt: new Date().toISOString(),
        rows: domainRows(domains),
        columns: ["name", "status", "created"],
        provider: "resend",
        accountId: account.id,
        warnings: failing > 0 ? [`${failing} Resend domains need attention.`] : undefined,
      };
    }
    if (query.capabilityId === "resend.broadcasts") {
      const broadcasts = filteredBroadcasts(await fetchBroadcasts(creds.token), query);
      return {
        kind: "table",
        generatedAt: new Date().toISOString(),
        rows: broadcastRows(broadcasts),
        columns: ["name", "status", "created", "sent"],
        provider: "resend",
        accountId: account.id,
      };
    }
    throw new Error(`Unsupported Resend dashboard query: ${query.capabilityId}`);
  },
};
