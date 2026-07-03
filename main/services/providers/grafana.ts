/**
 * Grafana adapter. Surfaces currently firing/pending alert rules.
 * Credentials: instance base URL + service account token (or API key).
 */

import type { MonitorItem, NormalizedStatus } from "../types.js";
import type { ProviderDefinition } from "./registry.js";

function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function grafanaFetch<T>(baseUrl: string, token: string, path: string): Promise<T> {
  const res = await fetch(`${normalizeBase(baseUrl)}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Grafana ${res.status} on ${path}: ${res.statusText}${body ? ` — ${body.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as T;
}

interface GrafanaHealth {
  database?: string;
  version?: string;
}

interface GrafanaRulesResponse {
  data?: {
    groups?: {
      name: string;
      file?: string;
      rules?: { name: string; state?: string; lastEvaluation?: string; labels?: Record<string, string> }[];
    }[];
  };
}

function mapRuleState(state: string | undefined): NormalizedStatus {
  switch (state) {
    case "firing":
      return "failure";
    case "pending":
      return "warning";
    case "inactive":
    case "normal":
      return "success";
    default:
      return "unknown";
  }
}

export const grafanaProvider: ProviderDefinition = {
  id: "grafana",
  label: "Grafana",
  scopeHint: "Instance URL (e.g. https://you.grafana.net) + a service account token with Viewer access to alerting.",
  fields: [
    { key: "baseUrl", label: "Instance URL", type: "text", placeholder: "https://you.grafana.net", required: true, secret: false },
    { key: "token", label: "Service account token", type: "password", placeholder: "glsa_… / API key", required: true, secret: true },
  ],
  async validate(creds) {
    const health = await grafanaFetch<GrafanaHealth>(creds.baseUrl, creds.token, "/api/health");
    return { identity: health.version ? `Grafana ${health.version}` : normalizeBase(creds.baseUrl) };
  },
  async fetch(account, creds) {
    const base = normalizeBase(creds.baseUrl);
    const rules = await grafanaFetch<GrafanaRulesResponse>(
      creds.baseUrl,
      creds.token,
      "/api/prometheus/grafana/api/v1/rules",
    );

    const items: MonitorItem[] = [];
    const now = new Date().toISOString();
    for (const group of rules.data?.groups ?? []) {
      for (const rule of group.rules ?? []) {
        // Only surface alerts that need attention; healthy rules stay quiet.
        if (rule.state !== "firing" && rule.state !== "pending") continue;
        items.push({
          uid: `${account.id}:grafana-alert:${group.name}:${rule.name}`,
          accountId: account.id,
          provider: "grafana",
          kind: "grafana-alert",
          category: "alert",
          title: rule.name,
          subtitle: `${group.name} · ${rule.state}`,
          status: mapRuleState(rule.state),
          conclusion: rule.state,
          createdAt: rule.lastEvaluation || now,
          updatedAt: rule.lastEvaluation || now,
          url: `${base}/alerting/list`,
        });
      }
    }

    // No firing/pending alerts → show a single healthy summary item.
    if (items.length === 0) {
      items.push({
        uid: `${account.id}:grafana-alert:ok`,
        accountId: account.id,
        provider: "grafana",
        kind: "grafana-alert",
        category: "alert",
        title: "All alerts normal",
        subtitle: "No firing or pending alerts",
        status: "success",
        conclusion: "normal",
        createdAt: now,
        updatedAt: now,
        url: `${base}/alerting/list`,
      });
    }
    return items;
  },
};
