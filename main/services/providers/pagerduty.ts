/**
 * PagerDuty adapter. Surfaces triggered/acknowledged incidents.
 * Credential: REST API key.
 */

import type {
  DashboardPanelResult,
  DashboardProviderQuery,
  DashboardQueryCapability,
  DashboardTableRow,
  MonitorItem,
  NormalizedStatus,
  ObservabilityIncident,
} from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const API_BASE = "https://api.pagerduty.com";
const DEFAULT_INCIDENT_LIMIT = "25";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Token token=${token}`,
    Accept: "application/vnd.pagerduty+json;version=2",
  };
}

async function pdFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: headers(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PagerDuty ${res.status} on ${path}: ${res.statusText}${body ? ` - ${body.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as T;
}

interface PagerDutyUserResponse {
  user?: { name?: string; email?: string };
}

interface PagerDutyIncidentsResponse {
  incidents?: PagerDutyIncident[];
}

interface PagerDutyIncident {
  id: string;
  incident_number?: number;
  title?: string;
  status?: string;
  urgency?: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  service?: { id?: string; summary?: string };
  assignments?: { assignee?: { summary?: string } }[];
}

function boundedLimit(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(DEFAULT_INCIDENT_LIMIT);
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

function splitList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

function incidentParams(creds: Record<string, string>, query?: DashboardProviderQuery): URLSearchParams {
  const params = new URLSearchParams({
    limit: String(boundedLimit(query?.params?.limit)),
    sort_by: query?.params?.sortBy?.trim() || "updated_at:desc",
  });
  const statuses = splitList(query?.params?.statuses).length > 0 ? splitList(query?.params?.statuses) : ["triggered", "acknowledged"];
  for (const status of statuses) params.append("statuses[]", status);
  const serviceIds = splitList(query?.params?.serviceIds ?? creds.serviceIds);
  for (const id of serviceIds) params.append("service_ids[]", id);
  return params;
}

async function fetchIncidents(creds: Record<string, string>, query?: DashboardProviderQuery): Promise<PagerDutyIncident[]> {
  const response = await pdFetch<PagerDutyIncidentsResponse>(creds.token, `/incidents?${incidentParams(creds, query)}`);
  return response.incidents ?? [];
}

function incidentRows(incidents: PagerDutyIncident[]): DashboardTableRow[] {
  return incidents.map((incident) => ({
    number: incident.incident_number ?? "",
    title: incident.title ?? `Incident ${incident.id}`,
    status: incident.status ?? "",
    urgency: incident.urgency ?? "",
    service: incident.service?.summary ?? "",
    assignee: incident.assignments?.[0]?.assignee?.summary ?? "",
    created: incident.created_at ? new Date(incident.created_at).toLocaleString() : "",
    updated: incident.updated_at ? new Date(incident.updated_at).toLocaleString() : "",
    __url: incident.html_url || "https://app.pagerduty.com/incidents",
    __urlLabel: "Open incident",
  }));
}

function mapStatus(status: string | undefined): NormalizedStatus {
  switch (status) {
    case "triggered":
      return "failure";
    case "acknowledged":
      return "warning";
    case "resolved":
      return "success";
    default:
      return "unknown";
  }
}

function incidentStatus(status: string | undefined): ObservabilityIncident["status"] {
  switch (status) {
    case "triggered":
      return "open";
    case "acknowledged":
      return "acknowledged";
    case "resolved":
      return "resolved";
    default:
      return "unknown";
  }
}

export const pagerdutyProvider: ProviderDefinition = {
  id: "pagerduty",
  label: "PagerDuty",
  scopeHint: "REST API key with incident read access. Optionally filter by comma-separated service IDs.",
  fields: [
    { key: "token", label: "REST API key", type: "password", placeholder: "PagerDuty REST API key", required: true, secret: true },
    { key: "serviceIds", label: "Service IDs (optional)", type: "text", placeholder: "PABC123, PDEF456", required: false, secret: false },
  ],
  async validate(creds) {
    const response = await pdFetch<PagerDutyUserResponse>(creds.token, "/users/me");
    return { identity: response.user?.name || response.user?.email || "PagerDuty" };
  },
  async fetch(account, creds) {
    const incidents = await fetchIncidents(creds);
    return incidents.map((incident) => {
      const when = incident.updated_at || incident.created_at || new Date().toISOString();
      return {
        uid: `${account.id}:pagerduty-incident:${incident.id}`,
        accountId: account.id,
        provider: "pagerduty",
        kind: "pagerduty-incident",
        category: "incident",
        title: incident.title || `Incident ${incident.incident_number ?? incident.id}`,
        subtitle: [incident.service?.summary, incident.status, incident.assignments?.[0]?.assignee?.summary].filter(Boolean).join(" · "),
        status: mapStatus(incident.status),
        conclusion: incident.status,
        createdAt: incident.created_at || when,
        updatedAt: when,
        url: incident.html_url || "https://app.pagerduty.com/incidents",
      } satisfies MonitorItem;
    });
  },
  async fetchIncidents(_account, _creds, items) {
    return items.map((item) => ({
      uid: `${item.uid}:incident`,
      accountId: item.accountId,
      provider: "pagerduty",
      title: item.title,
      subtitle: item.subtitle,
      status: incidentStatus(item.conclusion),
      severity: item.status === "failure" ? "critical" : "high",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      url: item.url,
      sourceItemUid: item.uid,
    }));
  },
  async getDashboardQueryCapabilities(account, creds): Promise<DashboardQueryCapability[]> {
    return [{
      id: "pagerduty.incidents",
      label: `${account.label} incidents`,
      description: "List PagerDuty incidents with optional status, service, sort, and limit filters.",
      requiresQuery: false,
      resultKind: "table",
      defaultVisualization: "table",
      defaultPanel: {
        title: "PagerDuty incidents",
        source: {
          kind: "provider",
          accountId: account.id,
          capabilityId: "pagerduty.incidents",
          params: {
            statuses: "triggered,acknowledged",
            serviceIds: creds.serviceIds ?? "",
            sortBy: "updated_at:desc",
            limit: DEFAULT_INCIDENT_LIMIT,
          },
        },
        visualization: "table",
        width: "full",
        height: "medium",
      },
      params: [
        { key: "statuses", label: "Statuses", required: false, placeholder: "triggered,acknowledged,resolved", defaultValue: "triggered,acknowledged" },
        { key: "serviceIds", label: "Service IDs", required: false, placeholder: "PABC123, PDEF456", defaultValue: creds.serviceIds ?? "" },
        { key: "sortBy", label: "Sort", required: false, placeholder: "updated_at:desc", defaultValue: "updated_at:desc" },
        { key: "limit", label: "Limit", required: false, placeholder: DEFAULT_INCIDENT_LIMIT, defaultValue: DEFAULT_INCIDENT_LIMIT },
      ],
    }];
  },
  async runDashboardQuery(account, creds, query: DashboardProviderQuery): Promise<DashboardPanelResult> {
    if (query.capabilityId !== "pagerduty.incidents") throw new Error(`Unsupported PagerDuty dashboard query: ${query.capabilityId}`);
    const incidents = await fetchIncidents(creds, query);
    const open = incidents.filter((incident) => incident.status === "triggered" || incident.status === "acknowledged").length;
    return {
      kind: "table",
      generatedAt: new Date().toISOString(),
      rows: incidentRows(incidents),
      columns: ["number", "title", "status", "urgency", "service", "assignee", "created", "updated"],
      provider: "pagerduty",
      accountId: account.id,
      warnings: open > 0 ? [`${open} open PagerDuty incidents returned.`] : undefined,
    };
  },
};
