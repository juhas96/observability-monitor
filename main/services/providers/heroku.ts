/**
 * Heroku adapter. Shows the latest release status per app.
 * Credential: Heroku API key (Account settings → API Key, or `heroku auth:token`).
 */

import type {
  DashboardPanelResult,
  DashboardProviderQuery,
  DashboardQueryCapability,
  DashboardTableRow,
  MonitorItem,
  MonitorLogResponse,
  NormalizedStatus,
} from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const API_BASE = "https://api.heroku.com";
const MAX_APPS = 15;
const DASHBOARD_RELEASES_PER_APP = 5;
const DEFAULT_RELEASE_LIMIT = "50";

function headers(token: string, range?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.heroku+json; version=3",
  };
  if (range) h.Range = range;
  return h;
}

async function herokuFetch<T>(token: string, path: string, range?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: headers(token, range) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Heroku ${res.status} on ${path}: ${res.statusText}${body ? ` — ${body.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as T;
}

interface HkAccount {
  email?: string;
}

interface HkApp {
  id: string;
  name: string;
}

interface HkRelease {
  id: string;
  version: number;
  status: string; // succeeded | failed | pending
  created_at: string;
  updated_at?: string;
  description?: string;
  user?: { email?: string };
  output_stream_url?: string | null;
}

interface HkAppRelease {
  app: HkApp;
  release: HkRelease;
}

function boundedLimit(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(DEFAULT_RELEASE_LIMIT);
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

function mapStatus(status: string): NormalizedStatus {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
      return "failure";
    case "pending":
      return "running";
    default:
      return "unknown";
  }
}

async function fetchAppReleases(token: string, query?: DashboardProviderQuery): Promise<HkAppRelease[]> {
  const apps = await herokuFetch<HkApp[]>(token, "/apps");
  const appName = query?.params?.appName?.trim().toLowerCase();
  const selectedApps = apps
    .slice(0, MAX_APPS)
    .filter((app) => !appName || app.name.toLowerCase().includes(appName));
  const perApp = query ? DASHBOARD_RELEASES_PER_APP : 3;
  const results = await Promise.allSettled(
    selectedApps.map((app) =>
      herokuFetch<HkRelease[]>(token, `/apps/${app.id}/releases`, `version ..; order=desc,max=${perApp}`).then(
        (releases) => ({ app, releases }),
      ),
    ),
  );
  const releases: HkAppRelease[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const release of result.value.releases) releases.push({ app: result.value.app, release });
  }
  releases.sort((a, b) =>
    new Date(b.release.updated_at || b.release.created_at).getTime() - new Date(a.release.updated_at || a.release.created_at).getTime(),
  );
  const state = query?.params?.state?.trim();
  return releases
    .filter(({ release }) => !state || state === "all" || release.status === state)
    .slice(0, boundedLimit(query?.params?.limit));
}

function releaseRows(releases: HkAppRelease[]): DashboardTableRow[] {
  return releases.map(({ app, release }) => ({
    app: app.name,
    version: release.version,
    status: release.status,
    description: release.description ?? "",
    actor: release.user?.email ?? "",
    created: new Date(release.created_at).toLocaleString(),
    updated: release.updated_at ? new Date(release.updated_at).toLocaleString() : "",
    __url: `https://dashboard.heroku.com/apps/${app.name}/activity`,
    __urlLabel: "Open activity",
  }));
}

function textToLines(text: string) {
  return text.split(/\r?\n/).filter((line) => line.trim() !== "").map((line) => ({ section: "Release output", message: line }));
}

async function fetchReleaseOutput(token: string, item: MonitorItem): Promise<MonitorLogResponse> {
  const ref = item.logRef ?? {};
  const appId = typeof ref.appId === "string" ? ref.appId : "";
  const releaseId = typeof ref.releaseId === "string" ? ref.releaseId : "";
  if (!appId || !releaseId) throw new Error("Heroku release metadata is missing from this item.");

  const release = await herokuFetch<HkRelease>(token, `/apps/${appId}/releases/${releaseId}`);
  const outputUrl = release.output_stream_url;
  if (!outputUrl) {
    return {
      itemUid: item.uid,
      title: item.title,
      subtitle: `v${release.version} release output`,
      provider: "heroku",
      fetchedAt: new Date().toISOString(),
      fallbackUrl: item.logFallbackUrl ?? item.url,
      lines: [{ section: "Release output", message: "No release phase output is available for this release." }],
    };
  }

  const res = await fetch(outputUrl);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Heroku release output ${res.status}: ${res.statusText}${body ? ` - ${body.slice(0, 160)}` : ""}`);
  }
  const text = await res.text();
  return {
    itemUid: item.uid,
    title: item.title,
    subtitle: `v${release.version} release output`,
    provider: "heroku",
    fetchedAt: new Date().toISOString(),
    fallbackUrl: item.logFallbackUrl ?? item.url,
    lines: text.trim() ? textToLines(text) : [{ section: "Release output", message: "Release output was empty." }],
  };
}

export const herokuProvider: ProviderDefinition = {
  id: "heroku",
  label: "Heroku",
  scopeHint: "Use your Heroku API key (Account Settings → API Key) or a token from `heroku authorizations:create`.",
  fields: [{ key: "token", label: "API key", type: "password", placeholder: "Heroku API key", required: true, secret: true }],
  async validate(creds) {
    const account = await herokuFetch<HkAccount>(creds.token, "/account");
    return { identity: account.email };
  },
  async fetch(account, creds) {
    const token = creds.token;
    const items: MonitorItem[] = [];

    for (const { app, release: rel } of await fetchAppReleases(token)) {
      items.push({
        uid: `${account.id}:heroku-release:${rel.id}`,
        accountId: account.id,
        provider: "heroku",
        kind: "heroku-release",
        category: "release",
        title: app.name,
        subtitle: `v${rel.version} · ${rel.description || "release"}`,
        status: mapStatus(rel.status),
        conclusion: rel.status,
        createdAt: rel.created_at,
        updatedAt: rel.updated_at || rel.created_at,
        url: `https://dashboard.heroku.com/apps/${app.name}`,
        actor: rel.user?.email,
        logAvailable: true,
        logLabel: "View output",
        logFallbackUrl: `https://dashboard.heroku.com/apps/${app.name}/activity`,
        logRef: { appId: app.id, releaseId: rel.id, version: rel.version },
        liveLogAvailable: mapStatus(rel.status) === "running",
        liveLogPollSeconds: 10,
        liveLogLabel: "Follow",
      });
    }
    return items;
  },
  async fetchLogs(_account, creds, item) {
    return await fetchReleaseOutput(creds.token, item);
  },
  async getDashboardQueryCapabilities(account): Promise<DashboardQueryCapability[]> {
    return [{
      id: "heroku.releases",
      label: `${account.label} releases`,
      description: "List recent Heroku releases across accessible apps with optional app, state, and limit filters.",
      requiresQuery: false,
      resultKind: "table",
      defaultVisualization: "table",
      defaultPanel: {
        title: "Heroku releases",
        source: {
          kind: "provider",
          accountId: account.id,
          capabilityId: "heroku.releases",
          params: { appName: "", state: "all", limit: DEFAULT_RELEASE_LIMIT },
        },
        visualization: "table",
        width: "full",
        height: "medium",
      },
      params: [
        { key: "appName", label: "App name", required: false, placeholder: "api" },
        { key: "state", label: "State", required: false, placeholder: "all / succeeded / failed / pending", defaultValue: "all" },
        { key: "limit", label: "Limit", required: false, placeholder: DEFAULT_RELEASE_LIMIT, defaultValue: DEFAULT_RELEASE_LIMIT },
      ],
    }];
  },
  async runDashboardQuery(account, creds, query: DashboardProviderQuery): Promise<DashboardPanelResult> {
    if (query.capabilityId !== "heroku.releases") throw new Error(`Unsupported Heroku dashboard query: ${query.capabilityId}`);
    const releases = await fetchAppReleases(creds.token, query);
    const failed = releases.filter(({ release }) => release.status === "failed").length;
    return {
      kind: "table",
      generatedAt: new Date().toISOString(),
      rows: releaseRows(releases),
      columns: ["app", "version", "status", "description", "actor", "created", "updated"],
      provider: "heroku",
      accountId: account.id,
      warnings: failed > 0 ? [`${failed} failed Heroku releases returned.`] : undefined,
    };
  },
};
