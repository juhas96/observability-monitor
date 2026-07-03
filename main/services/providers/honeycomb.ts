/**
 * Honeycomb adapter. Surfaces trigger and SLO summaries for one dataset.
 * Credential: Honeycomb API key.
 */

import type { MetricsSummary, MonitorItem, NormalizedStatus, ObservabilitySignal } from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const API_BASE = "https://api.honeycomb.io";

function headers(token: string, environment?: string): Record<string, string> {
  return {
    "X-Honeycomb-Team": token,
    ...(environment ? { "X-Honeycomb-Environment": environment } : {}),
    Accept: "application/json",
  };
}

async function hcFetch<T>(token: string, environment: string | undefined, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: headers(token, environment) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Honeycomb ${res.status} on ${path}: ${res.statusText}${body ? ` - ${body.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as T;
}

interface HoneycombAuth {
  team?: { name?: string };
  environment?: { name?: string };
}

interface HoneycombTrigger {
  id?: string;
  name?: string;
  description?: string;
  disabled?: boolean;
  triggered?: boolean;
  updated_at?: string;
}

interface HoneycombSlo {
  id?: string;
  name?: string;
  description?: string;
  target_per_million?: number;
  updated_at?: string;
}

function mapTrigger(trigger: HoneycombTrigger): NormalizedStatus {
  if (trigger.disabled) return "info";
  return trigger.triggered ? "failure" : "success";
}

export const honeycombProvider: ProviderDefinition = {
  id: "honeycomb",
  label: "Honeycomb",
  scopeHint: "API key with read access. Dataset is required for triggers/SLO summaries.",
  fields: [
    { key: "token", label: "API key", type: "password", placeholder: "Honeycomb API key", required: true, secret: true },
    { key: "environment", label: "Environment (optional)", type: "text", placeholder: "production", required: false, secret: false },
    { key: "dataset", label: "Dataset", type: "text", placeholder: "api-prod", required: false, secret: false },
  ],
  async validate(creds) {
    const auth = await hcFetch<HoneycombAuth>(creds.token, creds.environment, "/1/auth");
    return { identity: [auth.team?.name, auth.environment?.name].filter(Boolean).join(" · ") || "Honeycomb" };
  },
  async fetch(account, creds) {
    const now = new Date().toISOString();
    if (!creds.dataset) {
      return [{
        uid: `${account.id}:honeycomb-config:no-dataset`,
        accountId: account.id,
        provider: "honeycomb",
        kind: "honeycomb-config",
        category: "slo",
        title: "Honeycomb dataset not configured",
        subtitle: "Add a dataset to poll triggers and SLOs",
        status: "info",
        conclusion: "configuration",
        createdAt: now,
        updatedAt: now,
        url: "https://ui.honeycomb.io/",
      }];
    }

    const [triggers, slos] = await Promise.all([
      hcFetch<HoneycombTrigger[]>(creds.token, creds.environment, `/1/triggers/${encodeURIComponent(creds.dataset)}`).catch(() => []),
      hcFetch<HoneycombSlo[]>(creds.token, creds.environment, `/1/slos/${encodeURIComponent(creds.dataset)}`).catch(() => []),
    ]);

    const triggerItems: MonitorItem[] = triggers.map((trigger) => {
      const when = trigger.updated_at || now;
      return {
        uid: `${account.id}:honeycomb-trigger:${trigger.id ?? trigger.name}`,
        accountId: account.id,
        provider: "honeycomb",
        kind: "honeycomb-trigger",
        category: "monitor",
        title: trigger.name || "Honeycomb trigger",
        subtitle: trigger.description || (trigger.disabled ? "Disabled trigger" : trigger.triggered ? "Triggered" : "OK"),
        status: mapTrigger(trigger),
        conclusion: trigger.disabled ? "disabled" : trigger.triggered ? "triggered" : "ok",
        createdAt: when,
        updatedAt: when,
        url: "https://ui.honeycomb.io/",
      };
    });

    const sloItems: MonitorItem[] = slos.slice(0, 10).map((slo) => {
      const when = slo.updated_at || now;
      return {
        uid: `${account.id}:honeycomb-slo:${slo.id ?? slo.name}`,
        accountId: account.id,
        provider: "honeycomb",
        kind: "honeycomb-slo",
        category: "slo",
        title: slo.name || "Honeycomb SLO",
        subtitle: slo.description || "SLO",
        status: "info",
        conclusion: slo.target_per_million !== undefined ? `${slo.target_per_million} ppm target` : "slo",
        createdAt: when,
        updatedAt: when,
        url: "https://ui.honeycomb.io/",
      };
    });

    return [...triggerItems, ...sloItems];
  },
  async fetchSignals(_account, _creds, items) {
    return items.filter((item) => item.status === "failure" || item.category === "slo").map((item) => ({
      uid: `${item.uid}:signal`,
      accountId: item.accountId,
      provider: "honeycomb",
      kind: item.category === "slo" ? "slo" : "alert",
      category: item.category,
      title: item.title,
      subtitle: item.subtitle,
      status: item.status,
      severity: item.status === "failure" ? "high" : "info",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      url: item.url,
      sourceItemUid: item.uid,
    } satisfies ObservabilitySignal));
  },
  async fetchMetricsSummary(account, _creds, items) {
    const triggered = items.filter((item) => item.status === "failure").length;
    const slos = items.filter((item) => item.category === "slo").length;
    return [{
      uid: `${account.id}:honeycomb-summary`,
      accountId: account.id,
      provider: "honeycomb",
      title: "Honeycomb telemetry",
      status: triggered > 0 ? "failure" : "success",
      updatedAt: new Date().toISOString(),
      metrics: [
        { label: "Triggered", value: String(triggered), status: triggered > 0 ? "failure" : "success" },
        { label: "SLOs", value: String(slos), status: "info" },
      ],
      url: "https://ui.honeycomb.io/",
    } satisfies MetricsSummary];
  },
};
