/**
 * PagerDuty adapter. Surfaces triggered/acknowledged incidents.
 * Credential: REST API key.
 */

import type { MonitorItem, NormalizedStatus, ObservabilityIncident } from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const API_BASE = "https://api.pagerduty.com";

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
    const params = new URLSearchParams({ limit: "25", sort_by: "updated_at:desc" });
    params.append("statuses[]", "triggered");
    params.append("statuses[]", "acknowledged");
    for (const id of (creds.serviceIds ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
      params.append("service_ids[]", id);
    }
    const response = await pdFetch<PagerDutyIncidentsResponse>(creds.token, `/incidents?${params}`);
    return (response.incidents ?? []).map((incident) => {
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
};
