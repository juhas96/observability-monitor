/**
 * PostHog adapter. Surfaces error-tracking issues (exceptions) as feed rows,
 * incidents, and signals — mirrors the Sentry adapter.
 * Credentials: personal API key (phx_…) + region + numeric project id.
 */

import type { MonitorItem, ObservabilityIncident, ObservabilitySignal } from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const REQUEST_TIMEOUT_MS = 15_000;

/** Map the region field to the private-API host. Accepts "us"/"eu" or a full base URL. */
function baseUrl(region: string | undefined): string {
  const value = (region ?? "us").trim().toLowerCase();
  if (value.startsWith("http")) return value.replace(/\/$/, "");
  if (value === "eu") return "https://eu.posthog.com";
  return "https://us.posthog.com";
}

interface FetchInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

async function posthogFetch<T>(base: string, token: string, path: string, init?: FetchInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`PostHog ${res.status} on ${path}: ${res.statusText}${body ? ` - ${body.slice(0, 160)}` : ""}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface PosthogUser {
  email?: string;
  first_name?: string;
  distinct_id?: string;
  organization?: { name?: string } | null;
}

interface PosthogIssue {
  id: string;
  name?: string;
  description?: string;
  status?: string; // "active" | "resolved" | "suppressed" | "archived"
  first_seen?: string;
  last_seen?: string;
  aggregations?: { occurrences?: number; sessions?: number; users?: number } | null;
}

interface PosthogQueryResponse {
  results?: unknown[][];
}

function statusForIssue(status: string | undefined): MonitorItem["status"] {
  if (status === "resolved") return "success";
  if (status === "suppressed" || status === "archived") return "cancelled";
  return "failure"; // active / unknown → an open exception is a failure
}

function issueUrl(base: string, projectId: string, issueId: string): string {
  return `${base}/project/${encodeURIComponent(projectId)}/error_tracking/${encodeURIComponent(issueId)}`;
}

/** Primary path: the error-tracking issues list. Returns [] if unsupported so we can fall back. */
async function fetchIssues(base: string, token: string, projectId: string, accountId: string): Promise<MonitorItem[]> {
  const params = new URLSearchParams({ order_by: "last_seen", limit: "25", status: "active" });
  const path = `/api/projects/${encodeURIComponent(projectId)}/error_tracking/issues/?${params}`;
  const data = await posthogFetch<{ results?: PosthogIssue[] }>(base, token, path);
  const issues = data.results ?? [];
  return issues.map((issue) => {
    const when = issue.last_seen || issue.first_seen || new Date().toISOString();
    const occurrences = issue.aggregations?.occurrences;
    return {
      uid: `${accountId}:posthog-issue:${issue.id}`,
      accountId,
      provider: "posthog",
      kind: "posthog-issue",
      category: "issue",
      title: issue.name || issue.description || "PostHog exception",
      subtitle: [issue.status, occurrences != null ? `${occurrences} occurrences` : undefined]
        .filter(Boolean)
        .join(" · "),
      status: statusForIssue(issue.status),
      conclusion: issue.status,
      createdAt: issue.first_seen || when,
      updatedAt: when,
      url: issueUrl(base, projectId, issue.id),
    } satisfies MonitorItem;
  });
}

/** Fallback path: aggregate recent $exception events with HogQL when issues API is unavailable. */
async function fetchExceptionAggregation(
  base: string,
  token: string,
  projectId: string,
  accountId: string,
): Promise<MonitorItem[]> {
  const query =
    "SELECT properties.$exception_type AS type, any(properties.$exception_message) AS message, " +
    "count() AS occurrences, max(timestamp) AS last_seen, min(timestamp) AS first_seen " +
    "FROM events WHERE event = '$exception' AND timestamp > now() - INTERVAL 7 DAY " +
    "GROUP BY type ORDER BY occurrences DESC LIMIT 25";
  const data = await posthogFetch<PosthogQueryResponse>(base, token, `/api/projects/${encodeURIComponent(projectId)}/query/`, {
    method: "POST",
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  const rows = data.results ?? [];
  return rows.map((row) => {
    const [type, message, occurrences, lastSeen, firstSeen] = row as [string, string, number, string, string];
    const when = lastSeen || new Date().toISOString();
    const label = type || "Exception";
    return {
      uid: `${accountId}:posthog-exception:${label}`,
      accountId,
      provider: "posthog",
      kind: "posthog-exception",
      category: "issue",
      title: label,
      subtitle: [message, occurrences != null ? `${occurrences} occurrences` : undefined].filter(Boolean).join(" · "),
      status: "failure",
      conclusion: "exception",
      createdAt: firstSeen || when,
      updatedAt: when,
      url: `${base}/project/${encodeURIComponent(projectId)}/error_tracking`,
    } satisfies MonitorItem;
  });
}

export const posthogProvider: ProviderDefinition = {
  id: "posthog",
  label: "PostHog",
  scopeHint: "Personal API key (phx_…) with project read access. Project ID and region (us/eu) are required.",
  fields: [
    { key: "token", label: "Personal API key", type: "password", placeholder: "phx_…", required: true, secret: true },
    { key: "region", label: "Region", type: "text", placeholder: "us or eu", required: true, secret: false, defaultValue: "us" },
    { key: "projectId", label: "Project ID", type: "text", placeholder: "12345", required: true, secret: false },
  ],
  async validate(creds) {
    const base = baseUrl(creds.region);
    const me = await posthogFetch<PosthogUser>(base, creds.token, "/api/users/@me/");
    return { identity: me.organization?.name || me.email || me.first_name || me.distinct_id || "PostHog" };
  },
  async fetch(account, creds) {
    const base = baseUrl(creds.region);
    try {
      return await fetchIssues(base, creds.token, creds.projectId, account.id);
    } catch {
      // Error-tracking issues API not available on this instance → aggregate exceptions via HogQL.
      return fetchExceptionAggregation(base, creds.token, creds.projectId, account.id);
    }
  },
  async fetchIncidents(_account, _creds, items) {
    return items
      .filter((item) => item.status === "failure")
      .map((item) => ({
        uid: `${item.uid}:incident`,
        accountId: item.accountId,
        provider: "posthog",
        title: item.title,
        subtitle: item.subtitle,
        status: "open",
        severity: "high",
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        url: item.url,
        sourceItemUid: item.uid,
      } satisfies ObservabilityIncident));
  },
  async fetchSignals(_account, _creds, items) {
    return items.map((item) => ({
      uid: `${item.uid}:signal`,
      accountId: item.accountId,
      provider: "posthog",
      kind: "issue",
      category: "issue",
      title: item.title,
      subtitle: item.subtitle,
      status: item.status,
      severity: item.status === "failure" ? "high" : "low",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      url: item.url,
      sourceItemUid: item.uid,
    } satisfies ObservabilitySignal));
  },
};
