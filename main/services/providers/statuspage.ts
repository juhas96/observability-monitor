/**
 * Atlassian Statuspage adapter. Surfaces unresolved incidents and component
 * degradation for a managed status page.
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

const API_BASE = "https://api.statuspage.io/v1";
const DEFAULT_INCIDENT_LIMIT = "25";
const DEFAULT_COMPONENT_LIMIT = "50";

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

function boundedLimit(value: string | undefined, fallback: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

function splitList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

async function fetchStatuspageIncidents(creds: Record<string, string>): Promise<StatuspageIncident[]> {
  return await spFetch<StatuspageIncident[]>(creds.token, `/pages/${encodeURIComponent(creds.pageId)}/incidents/unresolved`);
}

async function fetchStatuspageComponents(creds: Record<string, string>): Promise<StatuspageComponent[]> {
  return await spFetch<StatuspageComponent[]>(creds.token, `/pages/${encodeURIComponent(creds.pageId)}/components`);
}

function filteredIncidents(incidents: StatuspageIncident[], query?: DashboardProviderQuery): StatuspageIncident[] {
  const statuses = splitList(query?.params?.statuses);
  const impacts = splitList(query?.params?.impacts);
  return incidents
    .filter((incident) => statuses.length === 0 || (incident.status && statuses.includes(incident.status)))
    .filter((incident) => impacts.length === 0 || (incident.impact && impacts.includes(incident.impact)))
    .slice(0, boundedLimit(query?.params?.limit, DEFAULT_INCIDENT_LIMIT));
}

function filteredComponents(components: StatuspageComponent[], query?: DashboardProviderQuery): StatuspageComponent[] {
  const status = query?.params?.status?.trim() || "non_operational";
  return components
    .filter((component) => {
      if (status === "all") return true;
      if (status === "non_operational") return component.status !== "operational";
      return component.status === status;
    })
    .slice(0, boundedLimit(query?.params?.limit, DEFAULT_COMPONENT_LIMIT));
}

function incidentRows(incidents: StatuspageIncident[], pageId: string): DashboardTableRow[] {
  return incidents.map((incident) => ({
    name: incident.name ?? `Incident ${incident.id}`,
    status: incident.status ?? "",
    impact: incident.impact ?? "",
    created: incident.created_at ? new Date(incident.created_at).toLocaleString() : "",
    updated: incident.updated_at ? new Date(incident.updated_at).toLocaleString() : "",
    __url: incident.shortlink || `https://manage.statuspage.io/pages/${pageId}/incidents/${incident.id}`,
    __urlLabel: "Open incident",
  }));
}

function componentRows(components: StatuspageComponent[], pageId: string): DashboardTableRow[] {
  return components.map((component) => ({
    name: component.name ?? `Component ${component.id}`,
    status: component.status ?? "",
    updated: component.updated_at ? new Date(component.updated_at).toLocaleString() : "",
    __url: `https://manage.statuspage.io/pages/${pageId}/components/${component.id}`,
    __urlLabel: "Open component",
  }));
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
      fetchStatuspageIncidents(creds),
      fetchStatuspageComponents(creds),
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
  async getDashboardQueryCapabilities(account): Promise<DashboardQueryCapability[]> {
    return [
      {
        id: "statuspage.incidents",
        label: `${account.label} incidents`,
        description: "List unresolved Statuspage incidents with optional status, impact, and limit filters.",
        requiresQuery: false,
        resultKind: "table",
        defaultVisualization: "table",
        defaultPanel: {
          title: "Statuspage incidents",
          source: {
            kind: "provider",
            accountId: account.id,
            capabilityId: "statuspage.incidents",
            params: { statuses: "", impacts: "", limit: DEFAULT_INCIDENT_LIMIT },
          },
          visualization: "table",
          width: "full",
          height: "medium",
        },
        params: [
          { key: "statuses", label: "Statuses", required: false, placeholder: "investigating,identified,monitoring" },
          { key: "impacts", label: "Impacts", required: false, placeholder: "critical,major,minor,none" },
          { key: "limit", label: "Limit", required: false, placeholder: DEFAULT_INCIDENT_LIMIT, defaultValue: DEFAULT_INCIDENT_LIMIT },
        ],
      },
      {
        id: "statuspage.components",
        label: `${account.label} components`,
        description: "List Statuspage components by current component status.",
        requiresQuery: false,
        resultKind: "table",
        defaultVisualization: "table",
        defaultPanel: {
          title: "Statuspage component health",
          source: {
            kind: "provider",
            accountId: account.id,
            capabilityId: "statuspage.components",
            params: { status: "non_operational", limit: DEFAULT_COMPONENT_LIMIT },
          },
          visualization: "table",
          width: "full",
          height: "medium",
        },
        params: [
          { key: "status", label: "Status", required: false, placeholder: "non_operational / all / operational / partial_outage", defaultValue: "non_operational" },
          { key: "limit", label: "Limit", required: false, placeholder: DEFAULT_COMPONENT_LIMIT, defaultValue: DEFAULT_COMPONENT_LIMIT },
        ],
      },
    ];
  },
  async runDashboardQuery(account, creds, query: DashboardProviderQuery): Promise<DashboardPanelResult> {
    if (query.capabilityId === "statuspage.incidents") {
      const incidents = filteredIncidents(await fetchStatuspageIncidents(creds), query);
      return {
        kind: "table",
        generatedAt: new Date().toISOString(),
        rows: incidentRows(incidents, creds.pageId),
        columns: ["name", "status", "impact", "created", "updated"],
        provider: "statuspage",
        accountId: account.id,
        warnings: incidents.length > 0 ? [`${incidents.length} unresolved Statuspage incidents returned.`] : undefined,
      };
    }
    if (query.capabilityId === "statuspage.components") {
      const components = filteredComponents(await fetchStatuspageComponents(creds), query);
      return {
        kind: "table",
        generatedAt: new Date().toISOString(),
        rows: componentRows(components, creds.pageId),
        columns: ["name", "status", "updated"],
        provider: "statuspage",
        accountId: account.id,
        warnings: components.some((component) => component.status !== "operational") ? [`${components.length} matching Statuspage components returned.`] : undefined,
      };
    }
    throw new Error(`Unsupported Statuspage dashboard query: ${query.capabilityId}`);
  },
};
