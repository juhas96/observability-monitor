/**
 * Atlassian Statuspage adapter. Surfaces unresolved incidents and component
 * degradation for a managed status page.
 */

import type { MonitorItem, NormalizedStatus, ObservabilityIncident } from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const API_BASE = "https://api.statuspage.io/v1";

async function spFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `OAuth ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Statuspage ${res.status} on ${path}: ${res.statusText}${body ? ` - ${body.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as T;
}

interface StatuspagePage {
  id?: string;
  name?: string;
  subdomain?: string;
}

interface StatuspageIncident {
  id: string;
  name?: string;
  status?: string;
  impact?: string;
  shortlink?: string;
  created_at?: string;
  updated_at?: string;
}

interface StatuspageComponent {
  id: string;
  name?: string;
  status?: string;
  updated_at?: string;
}

function mapComponentStatus(status: string | undefined): NormalizedStatus {
  switch (status) {
    case "operational":
      return "success";
    case "degraded_performance":
    case "partial_outage":
    case "under_maintenance":
      return "warning";
    case "major_outage":
      return "failure";
    default:
      return "unknown";
  }
}

function severityForImpact(impact: string | undefined): ObservabilityIncident["severity"] {
  switch (impact) {
    case "critical":
      return "critical";
    case "major":
      return "high";
    case "minor":
      return "medium";
    default:
      return "low";
  }
}

export const statuspageProvider: ProviderDefinition = {
  id: "statuspage",
  label: "Statuspage",
  scopeHint: "Statuspage API key plus Page ID from the page API settings.",
  fields: [
    { key: "token", label: "API key", type: "password", placeholder: "Statuspage API key", required: true, secret: true },
    { key: "pageId", label: "Page ID", type: "text", placeholder: "page id", required: true, secret: false },
  ],
  async validate(creds) {
    const page = await spFetch<StatuspagePage>(creds.token, `/pages/${encodeURIComponent(creds.pageId)}`);
    return { identity: page.name || page.subdomain || page.id };
  },
  async fetch(account, creds) {
    const [incidents, components] = await Promise.all([
      spFetch<StatuspageIncident[]>(creds.token, `/pages/${encodeURIComponent(creds.pageId)}/incidents/unresolved`),
      spFetch<StatuspageComponent[]>(creds.token, `/pages/${encodeURIComponent(creds.pageId)}/components`),
    ]);
    const now = new Date().toISOString();
    const incidentItems: MonitorItem[] = incidents.map((incident) => {
      const when = incident.updated_at || incident.created_at || now;
      return {
        uid: `${account.id}:statuspage-incident:${incident.id}`,
        accountId: account.id,
        provider: "statuspage",
        kind: "statuspage-incident",
        category: "incident",
        title: incident.name || "Statuspage incident",
        subtitle: [incident.status, incident.impact].filter(Boolean).join(" · "),
        status: incident.status === "resolved" ? "success" : "failure",
        conclusion: incident.status,
        createdAt: incident.created_at || when,
        updatedAt: when,
        url: incident.shortlink || `https://manage.statuspage.io/pages/${creds.pageId}/incidents/${incident.id}`,
      };
    });
    const componentItems = components
      .filter((component) => component.status !== "operational")
      .map((component) => ({
        uid: `${account.id}:statuspage-component:${component.id}`,
        accountId: account.id,
        provider: "statuspage" as const,
        kind: "statuspage-component",
        category: "statuspage" as const,
        title: component.name || "Statuspage component",
        subtitle: `Component · ${component.status ?? "unknown"}`,
        status: mapComponentStatus(component.status),
        conclusion: component.status,
        createdAt: component.updated_at || now,
        updatedAt: component.updated_at || now,
        url: `https://manage.statuspage.io/pages/${creds.pageId}/components/${component.id}`,
      }));
    return [...incidentItems, ...componentItems];
  },
  async fetchIncidents(_account, _creds, items) {
    return items.filter((item) => item.category === "incident").map((item) => ({
      uid: `${item.uid}:incident`,
      accountId: item.accountId,
      provider: "statuspage",
      title: item.title,
      subtitle: item.subtitle,
      status: item.status === "success" ? "resolved" : "open",
      severity: severityForImpact(item.subtitle.includes("critical") ? "critical" : item.subtitle.includes("major") ? "major" : undefined),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      url: item.url,
      sourceItemUid: item.uid,
    }));
  },
};
