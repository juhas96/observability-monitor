/**
 * Sentry adapter. Surfaces unresolved issues as both feed rows and incidents.
 * Credential: auth token + organization slug.
 */

import type {
  DashboardPanelResult,
  DashboardProviderQuery,
  DashboardQueryCapability,
  DashboardTableRow,
  MonitorItem,
  MonitorLogLine,
  MonitorLogResponse,
  ObservabilityIncident,
  ObservabilitySignal,
} from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const API_BASE = "https://sentry.io";
const DEFAULT_ISSUE_QUERY = "is:unresolved";
const DEFAULT_ISSUE_LIMIT = "25";

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

interface SentryIssueEvent {
  id?: string;
  eventID?: string;
  title?: string;
  message?: string;
  culprit?: string;
  dateCreated?: string;
  entries?: { type?: string; data?: unknown }[];
  tags?: { key?: string; value?: string }[];
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

function boundedIssueLimit(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(DEFAULT_ISSUE_LIMIT);
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

function issueSearchQuery(creds: Record<string, string>, query: DashboardProviderQuery | undefined): string {
  const raw = query?.query?.trim() || DEFAULT_ISSUE_QUERY;
  const projectQuery = creds.projectSlug && !/\bproject:/i.test(raw) ? ` project:${creds.projectSlug}` : "";
  return `${raw}${projectQuery}`;
}

async function fetchIssues(creds: Record<string, string>, query?: DashboardProviderQuery): Promise<SentryIssue[]> {
  const params = new URLSearchParams({
    query: issueSearchQuery(creds, query),
    sort: query?.params?.sort || "date",
    limit: String(boundedIssueLimit(query?.params?.limit)),
  });
  return await sentryFetch<SentryIssue[]>(
    creds.token,
    `/api/0/organizations/${encodeURIComponent(creds.orgSlug)}/issues/?${params}`,
  );
}

function issueRows(issues: SentryIssue[], orgSlug: string): DashboardTableRow[] {
  return issues.map((issue) => ({
    shortId: issue.shortId ?? issue.id,
    title: issue.title ?? "Sentry issue",
    project: issue.project?.slug ?? issue.project?.name ?? "",
    level: issue.level ?? "",
    status: issue.status ?? "",
    events: issue.count ? Number(issue.count) : null,
    users: issue.userCount ?? null,
    firstSeen: issue.firstSeen ? new Date(issue.firstSeen).toLocaleString() : "",
    lastSeen: issue.lastSeen ? new Date(issue.lastSeen).toLocaleString() : "",
    culprit: issue.culprit ?? "",
    __url: issue.permalink || `${API_BASE}/organizations/${orgSlug}/issues/${issue.id}/`,
    __urlLabel: "Open issue",
  }));
}

function issueIdFromItem(item: MonitorItem): string {
  const fromRef = item.logRef?.issueId;
  if (typeof fromRef === "string" && fromRef.trim() !== "") return fromRef;
  const parts = item.uid.split(":sentry-issue:");
  return parts[1] ?? "";
}

function eventToLines(event: SentryIssueEvent): MonitorLogLine[] {
  const timestamp = event.dateCreated;
  const lines: MonitorLogLine[] = [
    {
      timestamp,
      section: "event",
      level: "info",
      message: event.title || event.message || event.culprit || `Sentry event ${event.eventID ?? event.id ?? ""}`.trim(),
    },
  ];
  if (event.culprit) {
    lines.push({ timestamp, section: "culprit", level: "info", message: event.culprit });
  }
  for (const tag of event.tags ?? []) {
    if (!tag.key) continue;
    lines.push({ timestamp, section: "tag", level: "info", message: `${tag.key}: ${tag.value ?? ""}` });
  }
  for (const entry of event.entries ?? []) {
    if (!entry.type) continue;
    const body = typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data, null, 2);
    lines.push({
      timestamp,
      section: entry.type,
      level: entry.type === "exception" ? "error" : "info",
      message: body.length > 4000 ? `${body.slice(0, 4000)}…` : body,
    });
  }
  return lines;
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
    const issues = await fetchIssues(creds);
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
        logAvailable: true,
        logLabel: "Event",
        logFallbackUrl: issue.permalink || `${API_BASE}/organizations/${creds.orgSlug}/issues/${issue.id}/`,
        logRef: { issueId: issue.id },
      } satisfies MonitorItem;
    });
  },
  async fetchLogs(_account, creds, item): Promise<MonitorLogResponse> {
    const issueId = issueIdFromItem(item);
    if (!issueId) throw new Error("Sentry issue id is missing.");
    const event = await sentryFetch<SentryIssueEvent>(creds.token, `/api/0/issues/${encodeURIComponent(issueId)}/events/latest/`);
    return {
      itemUid: item.uid,
      title: item.title,
      subtitle: "Latest Sentry issue event",
      provider: "sentry",
      fetchedAt: new Date().toISOString(),
      fallbackUrl: item.logFallbackUrl ?? item.url,
      lines: eventToLines(event),
    };
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
  async getDashboardQueryCapabilities(account): Promise<DashboardQueryCapability[]> {
    return [{
      id: "sentry.issues",
      label: `${account.label} issues`,
      description: "Search Sentry issues with a read-only issue query.",
      queryLanguage: "Sentry issue search",
      requiresQuery: true,
      resultKind: "table",
      defaultVisualization: "table",
      defaultPanel: {
        title: "Unresolved Sentry issues",
        source: {
          kind: "provider",
          accountId: account.id,
          capabilityId: "sentry.issues",
          query: DEFAULT_ISSUE_QUERY,
          params: { limit: DEFAULT_ISSUE_LIMIT, sort: "date" },
        },
        visualization: "table",
        width: "full",
        height: "medium",
      },
      params: [
        { key: "limit", label: "Limit", required: false, placeholder: "25", defaultValue: DEFAULT_ISSUE_LIMIT },
        { key: "sort", label: "Sort", required: false, placeholder: "date", defaultValue: "date" },
      ],
    }];
  },
  async runDashboardQuery(_account, creds, query: DashboardProviderQuery): Promise<DashboardPanelResult> {
    if (query.capabilityId !== "sentry.issues") throw new Error(`Unsupported Sentry dashboard query: ${query.capabilityId}`);
    const issues = await fetchIssues(creds, query);
    return {
      kind: "table",
      generatedAt: new Date().toISOString(),
      rows: issueRows(issues, creds.orgSlug),
      columns: ["shortId", "title", "project", "level", "status", "events", "users", "lastSeen", "culprit"],
      provider: "sentry",
    };
  },
};
