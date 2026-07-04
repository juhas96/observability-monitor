import { fetchGitHubItems, fetchGitHubLogs, validateGitHubToken } from "../github-api.js";
import type {
  Account,
  DashboardPanelResult,
  DashboardProviderQuery,
  DashboardQueryCapability,
  DashboardTableRow,
  MonitorItem,
} from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const DEFAULT_RUN_LIMIT = "50";

function boundedLimit(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(DEFAULT_RUN_LIMIT);
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

function filteredRuns(items: MonitorItem[], query?: DashboardProviderQuery): MonitorItem[] {
  const repo = query?.params?.repo?.trim().toLowerCase();
  const status = query?.params?.status?.trim();
  return items
    .filter((item) => item.category === "run")
    .filter((item) => !repo || item.title.toLowerCase().includes(repo))
    .filter((item) => !status || status === "all" || item.status === status)
    .slice(0, boundedLimit(query?.params?.limit));
}

function runRows(items: MonitorItem[]): DashboardTableRow[] {
  return items.map((item) => ({
    repo: item.title,
    workflow: item.subtitle.split(" · ")[0] ?? "",
    branch: item.subtitle.split(" · ")[1] ?? "",
    status: item.status,
    conclusion: item.conclusion ?? "",
    actor: item.actor ?? "",
    commit: item.commitSha ? item.commitSha.slice(0, 7) : "",
    updated: new Date(item.updatedAt).toLocaleString(),
    __url: item.url,
    __urlLabel: "Open run",
  }));
}

export const githubProvider: ProviderDefinition = {
  id: "github",
  label: "GitHub",
  scopeHint:
    "Fine-grained PAT: Actions (Read) + Metadata (Read). Classic PAT: repo + workflow (or public_repo for public repos only).",
  fields: [
    { key: "token", label: "Personal access token", type: "password", placeholder: "ghp_… / github_pat_…", required: true, secret: true },
    { key: "repos", label: "Repo filter (optional)", type: "text", placeholder: "owner/repo, owner/repo2 — blank = auto", required: false, secret: false },
  ],
  async validate(creds) {
    const { login } = await validateGitHubToken(creds.token);
    return { identity: login };
  },
  fetch(account, creds) {
    return fetchGitHubItems(account, creds.token);
  },
  fetchLogs(account, creds, item) {
    return fetchGitHubLogs(account, creds.token, item);
  },
  async getDashboardQueryCapabilities(account): Promise<DashboardQueryCapability[]> {
    return [{
      id: "github.runs",
      label: `${account.label} workflow runs`,
      description: "List recent GitHub Actions workflow runs with optional repo, status, and limit filters.",
      requiresQuery: false,
      resultKind: "table",
      defaultVisualization: "table",
      defaultPanel: {
        title: "GitHub workflow runs",
        source: {
          kind: "provider",
          accountId: account.id,
          capabilityId: "github.runs",
          params: { repo: "", status: "all", limit: DEFAULT_RUN_LIMIT },
        },
        visualization: "table",
        width: "full",
        height: "medium",
      },
      params: [
        { key: "repo", label: "Repo contains", required: false, placeholder: "owner/repo" },
        { key: "status", label: "Status", required: false, placeholder: "all / success / failure / running / queued", defaultValue: "all" },
        { key: "limit", label: "Limit", required: false, placeholder: DEFAULT_RUN_LIMIT, defaultValue: DEFAULT_RUN_LIMIT },
      ],
    }];
  },
  async runDashboardQuery(account: Account, creds, query: DashboardProviderQuery): Promise<DashboardPanelResult> {
    if (query.capabilityId !== "github.runs") throw new Error(`Unsupported GitHub dashboard query: ${query.capabilityId}`);
    const runs = filteredRuns(await fetchGitHubItems(account, creds.token), query);
    const failed = runs.filter((item) => item.status === "failure").length;
    return {
      kind: "table",
      generatedAt: new Date().toISOString(),
      rows: runRows(runs),
      columns: ["repo", "workflow", "branch", "status", "conclusion", "actor", "commit", "updated"],
      provider: "github",
      accountId: account.id,
      warnings: failed > 0 ? [`${failed} failed GitHub workflow runs returned.`] : undefined,
    };
  },
};
