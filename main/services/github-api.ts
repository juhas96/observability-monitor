/**
 * GitHub Actions REST client (per Personal Access Token).
 *
 * Scopes: classic PAT needs `repo` + `workflow` (or `public_repo` for public
 * only); fine-grained PAT needs Actions: Read + Metadata: Read.
 */

import type { Account, MonitorItem, NormalizedStatus } from "./types.js";

const API_BASE = "https://api.github.com";
const USER_AGENT = "Glaze-CICD-Monitor";
const MAX_REPOS = 12;
const RUNS_PER_REPO = 5;

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
  };
}

async function ghFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: headers(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status} on ${path}: ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}

interface GhUser {
  login: string;
}

interface GhRepo {
  full_name: string;
  owner: { login: string };
  name: string;
}

interface GhRun {
  id: number;
  name: string | null;
  display_title: string;
  head_branch: string | null;
  head_sha: string;
  status: string | null; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | ...
  html_url: string;
  created_at: string;
  updated_at: string;
  actor?: { login: string };
}

/** Validate a token and resolve the authenticated login. */
export async function validateGitHubToken(token: string): Promise<{ login: string }> {
  const user = await ghFetch<GhUser>(token, "/user");
  return { login: user.login };
}

function mapStatus(status: string | null, conclusion: string | null): NormalizedStatus {
  if (status === "queued") return "queued";
  if (status === "in_progress") return "running";
  if (status === "completed") {
    switch (conclusion) {
      case "success":
        return "success";
      case "failure":
      case "timed_out":
      case "startup_failure":
        return "failure";
      case "cancelled":
        return "cancelled";
      default:
        return conclusion ? "unknown" : "success";
    }
  }
  return "unknown";
}

async function resolveRepos(account: Account, token: string): Promise<{ owner: string; repo: string }[]> {
  const repoFilter = (account.config?.repos ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (repoFilter.length > 0) {
    return repoFilter
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [owner, repo] = entry.split("/");
        return owner && repo ? { owner, repo } : null;
      })
      .filter((v): v is { owner: string; repo: string } => v !== null)
      .slice(0, MAX_REPOS);
  }

  const repos = await ghFetch<GhRepo[]>(
    token,
    "/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=" + MAX_REPOS,
  );
  return repos.map((r) => ({ owner: r.owner.login, repo: r.name }));
}

/** Fetch recent workflow runs across the account's repos as normalized items. */
export async function fetchGitHubItems(account: Account, token: string): Promise<MonitorItem[]> {
  const repos = await resolveRepos(account, token);
  const items: MonitorItem[] = [];

  const results = await Promise.allSettled(
    repos.map((r) =>
      ghFetch<{ workflow_runs: GhRun[] }>(
        token,
        `/repos/${r.owner}/${r.repo}/actions/runs?per_page=${RUNS_PER_REPO}`,
      ).then((data) => ({ repo: r, runs: data.workflow_runs ?? [] })),
    ),
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { repo, runs } = result.value;
    for (const run of runs) {
      items.push({
        uid: `${account.id}:github-run:${run.id}`,
        accountId: account.id,
        provider: "github",
        kind: "github-run",
        category: "run",
        title: `${repo.owner}/${repo.repo}`,
        subtitle: [run.name || run.display_title, run.head_branch].filter(Boolean).join(" · "),
        status: mapStatus(run.status, run.conclusion),
        conclusion: run.conclusion ?? run.status ?? undefined,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        url: run.html_url,
        commitSha: run.head_sha,
        commitMessage: run.display_title,
        actor: run.actor?.login,
      });
    }
  }

  return items;
}
