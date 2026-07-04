/**
 * Netlify adapter. Shows recent deploy/build status per site.
 * Credential: personal access token (Netlify user settings → Applications).
 */

import type {
  DashboardPanelResult,
  DashboardProviderQuery,
  DashboardQueryCapability,
  DashboardTableRow,
  MonitorItem,
  NormalizedStatus,
} from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const API_BASE = "https://api.netlify.com/api/v1";
const MAX_SITES = 15;
const DEPLOYS_PER_SITE = 3;
const DASHBOARD_DEPLOYS_PER_SITE = 5;
const DEFAULT_DEPLOY_LIMIT = "50";

async function nfFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Netlify ${res.status} on ${path}: ${res.statusText}${body ? ` — ${body.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as T;
}

interface NfUser {
  email?: string;
  full_name?: string;
}

interface NfSite {
  id: string;
  name: string;
  admin_url?: string;
}

interface NfDeploy {
  id: string;
  state: string; // ready | error | building | enqueued | new | processing | ...
  created_at: string;
  updated_at?: string;
  branch?: string;
  context?: string;
  title?: string;
  error_message?: string;
  admin_url?: string;
  deploy_ssl_url?: string;
}

interface NfSiteDeploy {
  site: NfSite;
  deploy: NfDeploy;
}

function boundedLimit(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(DEFAULT_DEPLOY_LIMIT);
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

function mapState(state: string): NormalizedStatus {
  switch (state) {
    case "ready":
      return "success";
    case "error":
      return "failure";
    case "building":
    case "enqueued":
    case "new":
    case "processing":
    case "uploading":
    case "uploaded":
    case "preparing":
      return "running";
    default:
      return "unknown";
  }
}

async function fetchSiteDeploys(token: string, query?: DashboardProviderQuery): Promise<NfSiteDeploy[]> {
  const sites = await nfFetch<NfSite[]>(token, `/sites?per_page=${MAX_SITES}`);
  const siteName = query?.params?.siteName?.trim().toLowerCase();
  const selectedSites = sites
    .slice(0, MAX_SITES)
    .filter((site) => !siteName || site.name.toLowerCase().includes(siteName));
  const perSite = query ? DASHBOARD_DEPLOYS_PER_SITE : DEPLOYS_PER_SITE;
  const results = await Promise.allSettled(
    selectedSites.map((site) =>
      nfFetch<NfDeploy[]>(token, `/sites/${site.id}/deploys?per_page=${perSite}`).then((deploys) => ({
        site,
        deploys,
      })),
    ),
  );
  const deploys: NfSiteDeploy[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const deploy of result.value.deploys) deploys.push({ site: result.value.site, deploy });
  }
  deploys.sort((a, b) =>
    new Date(b.deploy.updated_at || b.deploy.created_at).getTime() - new Date(a.deploy.updated_at || a.deploy.created_at).getTime(),
  );
  const state = query?.params?.state?.trim();
  return deploys
    .filter(({ deploy }) => !state || state === "all" || deploy.state === state)
    .slice(0, boundedLimit(query?.params?.limit));
}

function deployRows(deploys: NfSiteDeploy[]): DashboardTableRow[] {
  return deploys.map(({ site, deploy }) => ({
    site: site.name,
    state: deploy.state,
    branch: deploy.branch ?? "",
    context: deploy.context ?? "",
    title: deploy.title ?? "",
    error: deploy.error_message ?? "",
    created: new Date(deploy.created_at).toLocaleString(),
    updated: deploy.updated_at ? new Date(deploy.updated_at).toLocaleString() : "",
    __url: deploy.admin_url || site.admin_url || `https://app.netlify.com/sites/${site.name}/deploys/${deploy.id}`,
    __urlLabel: "Open deploy",
  }));
}

export const netlifyProvider: ProviderDefinition = {
  id: "netlify",
  label: "Netlify",
  scopeHint: "Create a personal access token at app.netlify.com/user/applications (Personal access tokens).",
  fields: [{ key: "token", label: "Access token", type: "password", placeholder: "Netlify PAT", required: true, secret: true }],
  async validate(creds) {
    const user = await nfFetch<NfUser>(creds.token, "/user");
    return { identity: user.full_name || user.email };
  },
  async fetch(account, creds) {
    const token = creds.token;
    const items: MonitorItem[] = [];

    for (const { site, deploy: dep } of await fetchSiteDeploys(token)) {
      const url = dep.admin_url || site.admin_url || `https://app.netlify.com/sites/${site.name}/deploys`;
      items.push({
        uid: `${account.id}:netlify-deploy:${dep.id}`,
        accountId: account.id,
        provider: "netlify",
        kind: "netlify-deploy",
        category: "deploy",
        title: site.name,
        subtitle: [dep.context || dep.branch, dep.title].filter(Boolean).join(" · ") || "Deploy",
        status: mapState(dep.state),
        conclusion: dep.error_message || dep.state,
        createdAt: dep.created_at,
        updatedAt: dep.updated_at || dep.created_at,
        url,
        logAvailable: false,
        logLabel: "Open logs",
        logFallbackUrl: url,
      });
    }
    return items;
  },
  async getDashboardQueryCapabilities(account): Promise<DashboardQueryCapability[]> {
    return [{
      id: "netlify.deploys",
      label: `${account.label} deploys`,
      description: "List recent Netlify deploys across accessible sites with optional site, state, and limit filters.",
      requiresQuery: false,
      resultKind: "table",
      defaultVisualization: "table",
      defaultPanel: {
        title: "Netlify deploys",
        source: {
          kind: "provider",
          accountId: account.id,
          capabilityId: "netlify.deploys",
          params: { siteName: "", state: "all", limit: DEFAULT_DEPLOY_LIMIT },
        },
        visualization: "table",
        width: "full",
        height: "medium",
      },
      params: [
        { key: "siteName", label: "Site name", required: false, placeholder: "web" },
        { key: "state", label: "State", required: false, placeholder: "all / ready / error / building", defaultValue: "all" },
        { key: "limit", label: "Limit", required: false, placeholder: DEFAULT_DEPLOY_LIMIT, defaultValue: DEFAULT_DEPLOY_LIMIT },
      ],
    }];
  },
  async runDashboardQuery(account, creds, query: DashboardProviderQuery): Promise<DashboardPanelResult> {
    if (query.capabilityId !== "netlify.deploys") throw new Error(`Unsupported Netlify dashboard query: ${query.capabilityId}`);
    const deploys = await fetchSiteDeploys(creds.token, query);
    const failed = deploys.filter(({ deploy }) => deploy.state === "error").length;
    return {
      kind: "table",
      generatedAt: new Date().toISOString(),
      rows: deployRows(deploys),
      columns: ["site", "state", "branch", "context", "title", "error", "created", "updated"],
      provider: "netlify",
      accountId: account.id,
      warnings: failed > 0 ? [`${failed} failed Netlify deploys returned.`] : undefined,
    };
  },
};
