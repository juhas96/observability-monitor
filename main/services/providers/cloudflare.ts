import { fetchCloudflareItems, fetchCloudflareLogs, validateCloudflareToken } from "../cloudflare-api.js";
import type {
  Account,
  DashboardPanelResult,
  DashboardProviderQuery,
  DashboardQueryCapability,
  DashboardTableRow,
  MonitorItem,
} from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const DEFAULT_DEPLOY_LIMIT = "50";

function boundedLimit(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(DEFAULT_DEPLOY_LIMIT);
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

function filteredDeploys(items: MonitorItem[], query?: DashboardProviderQuery): MonitorItem[] {
  const project = query?.params?.project?.trim().toLowerCase();
  const kind = query?.params?.kind?.trim();
  const status = query?.params?.status?.trim();
  return items
    .filter((item) => item.category === "deploy")
    .filter((item) => !project || item.title.toLowerCase().includes(project))
    .filter((item) => !kind || kind === "all" || item.kind === kind)
    .filter((item) => !status || status === "all" || item.status === status)
    .slice(0, boundedLimit(query?.params?.limit));
}

function deployRows(items: MonitorItem[]): DashboardTableRow[] {
  return items.map((item) => ({
    project: item.title,
    kind: item.kind === "cf-pages" ? "Pages" : item.kind === "cf-worker" ? "Worker" : item.kind,
    status: item.status,
    conclusion: item.conclusion ?? "",
    context: item.subtitle,
    commit: item.commitSha ? item.commitSha.slice(0, 7) : "",
    updated: new Date(item.updatedAt).toLocaleString(),
    __url: item.url,
    __urlLabel: "Open deploy",
  }));
}

export const cloudflareProvider: ProviderDefinition = {
  id: "cloudflare",
  label: "Cloudflare",
  scopeHint: "API token scopes: Cloudflare Pages (Read) and Workers Scripts (Read). Account ID is on your Cloudflare dashboard.",
  fields: [
    { key: "token", label: "API token", type: "password", placeholder: "Cloudflare API token", required: true, secret: true },
    { key: "accountId", label: "Account ID", type: "text", placeholder: "Cloudflare account ID", required: true, secret: false },
  ],
  async validate(creds) {
    const { accountName } = await validateCloudflareToken(creds.token, creds.accountId);
    return { identity: accountName };
  },
  fetch(account, creds) {
    return fetchCloudflareItems(account, creds.token, creds.accountId);
  },
  fetchLogs(account, creds, item) {
    return fetchCloudflareLogs(account, creds.token, item);
  },
  async getDashboardQueryCapabilities(account): Promise<DashboardQueryCapability[]> {
    return [{
      id: "cloudflare.deploys",
      label: `${account.label} deploys`,
      description: "List recent Cloudflare Pages and Workers deploys with optional project, kind, status, and limit filters.",
      requiresQuery: false,
      resultKind: "table",
      defaultVisualization: "table",
      defaultPanel: {
        title: "Cloudflare deploys",
        source: {
          kind: "provider",
          accountId: account.id,
          capabilityId: "cloudflare.deploys",
          params: { project: "", kind: "all", status: "all", limit: DEFAULT_DEPLOY_LIMIT },
        },
        visualization: "table",
        width: "full",
        height: "medium",
      },
      params: [
        { key: "project", label: "Project contains", required: false, placeholder: "web" },
        { key: "kind", label: "Kind", required: false, placeholder: "all / cf-pages / cf-worker", defaultValue: "all" },
        { key: "status", label: "Status", required: false, placeholder: "all / success / failure / running", defaultValue: "all" },
        { key: "limit", label: "Limit", required: false, placeholder: DEFAULT_DEPLOY_LIMIT, defaultValue: DEFAULT_DEPLOY_LIMIT },
      ],
    }];
  },
  async runDashboardQuery(account: Account, creds, query: DashboardProviderQuery): Promise<DashboardPanelResult> {
    if (query.capabilityId !== "cloudflare.deploys") throw new Error(`Unsupported Cloudflare dashboard query: ${query.capabilityId}`);
    const deploys = filteredDeploys(await fetchCloudflareItems(account, creds.token, creds.accountId), query);
    const failed = deploys.filter((item) => item.status === "failure").length;
    return {
      kind: "table",
      generatedAt: new Date().toISOString(),
      rows: deployRows(deploys),
      columns: ["project", "kind", "status", "conclusion", "context", "commit", "updated"],
      provider: "cloudflare",
      accountId: account.id,
      warnings: failed > 0 ? [`${failed} failed Cloudflare deploys returned.`] : undefined,
    };
  },
};
