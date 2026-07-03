/**
 * Sentry adapter. Surfaces unresolved issues as both feed rows and incidents.
 * Credential: auth token + organization slug.
 */

import type { MonitorItem, ObservabilityIncident, ObservabilitySignal } from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const API_BASE = "https://sentry.io";

async function sentryFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sentry ${res.status} on ${path}: ${res.statusText}${body ? ` - ${body.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as T;
}

interface SentryOrganization {
  slug?: string;
  name?: string;
}

interface SentryIssue {
  id: string;
  shortId?: string;
  title?: string;
  culprit?: string;
  level?: string;
  status?: string;
  count?: string;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  permalink?: string;
  project?: { slug?: string; name?: string };
}

function statusForIssue(issue: SentryIssue): MonitorItem["status"] {
  if (issue.status === "resolved") return "success";
  if (issue.level === "fatal" || issue.level === "error") return "failure";
  return "warning";
}

function severityForIssue(issue: Pick<SentryIssue, "level">): ObservabilityIncident["severity"] {
  if (issue.level === "fatal") return "critical";
  if (issue.level === "error") return "high";
  if (issue.level === "warning") return "medium";
  return "low";
}

export const sentryProvider: ProviderDefinition = {
  id: "sentry",
  label: "Sentry",
  scopeHint: "Auth token with org/project read access. Organization slug is required; project slug is optional.",
  fields: [
    { key: "token", label: "Auth token", type: "password", placeholder: "sntrys_…", required: true, secret: true },
    { key: "orgSlug", label: "Organization slug", type: "text", placeholder: "my-org", required: true, secret: false },
    { key: "projectSlug", label: "Project slug (optional)", type: "text", placeholder: "api", required: false, secret: false },
  ],
  async validate(creds) {
    const org = await sentryFetch<SentryOrganization>(creds.token, `/api/0/organizations/${encodeURIComponent(creds.orgSlug)}/`);
    return { identity: org.name || org.slug || creds.orgSlug };
  },
  async fetch(account, creds) {
    const projectQuery = creds.projectSlug ? ` project:${creds.projectSlug}` : "";
    const params = new URLSearchParams({
      query: `is:unresolved${projectQuery}`,
      sort: "date",
      limit: "25",
    });
    const issues = await sentryFetch<SentryIssue[]>(
      creds.token,
      `/api/0/organizations/${encodeURIComponent(creds.orgSlug)}/issues/?${params}`,
    );
    return issues.map((issue) => {
      const when = issue.lastSeen || issue.firstSeen || new Date().toISOString();
      return {
        uid: `${account.id}:sentry-issue:${issue.id}`,
        accountId: account.id,
        provider: "sentry",
        kind: "sentry-issue",
        category: "issue",
        title: issue.shortId || issue.title || "Sentry issue",
        subtitle: [issue.project?.slug, issue.level, issue.culprit, issue.count ? `${issue.count} events` : undefined].filter(Boolean).join(" · "),
        status: statusForIssue(issue),
        conclusion: issue.status || issue.level,
        createdAt: issue.firstSeen || when,
        updatedAt: when,
        url: issue.permalink || `${API_BASE}/organizations/${creds.orgSlug}/issues/${issue.id}/`,
      } satisfies MonitorItem;
    });
  },
  async fetchIncidents(_account, _creds, items) {
    return items.filter((item) => item.status !== "success").map((item) => ({
      uid: `${item.uid}:incident`,
      accountId: item.accountId,
      provider: "sentry",
      title: item.title,
      subtitle: item.subtitle,
      status: "open",
      severity: item.conclusion === "fatal" ? "critical" : item.status === "failure" ? "high" : "medium",
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
      provider: "sentry",
      kind: "issue",
      category: "issue",
      title: item.title,
      subtitle: item.subtitle,
      status: item.status,
      severity: severityForIssue({ level: item.conclusion }),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      url: item.url,
      sourceItemUid: item.uid,
    } satisfies ObservabilitySignal));
  },
};
