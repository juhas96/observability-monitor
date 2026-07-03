/**
 * Cloudflare REST client (per API token + account id).
 * Monitors Pages deployments and Workers deployments/builds.
 *
 * Token scopes: Account → Cloudflare Pages: Read, Account → Workers Scripts: Read
 * (+ Workers Builds: Read when available). Account ID is entered by the user.
 */

import type { Account, MonitorItem, MonitorLogResponse, NormalizedStatus } from "./types.js";

const API_BASE = "https://api.cloudflare.com/client/v4";
const MAX_PAGES_PROJECTS = 10;
const MAX_WORKERS = 10;
const DASH_BASE = "https://dash.cloudflare.com";

interface CfEnvelope<T> {
  success: boolean;
  result: T;
  errors?: { code: number; message: string }[];
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function cfFetch<T>(token: string, path: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const res = await fetch(`${API_BASE}${path}`, { headers: headers(token) });
  if (res.status === 404 || res.status === 403) {
    // Feature not enabled / not permitted — let callers feature-detect.
    return { ok: false, status: res.status };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Cloudflare ${res.status} on ${path}: ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
  }
  const envelope = (await res.json()) as CfEnvelope<T>;
  if (!envelope.success) {
    const msg = envelope.errors?.map((e) => e.message).join("; ") || "request failed";
    throw new Error(`Cloudflare API error on ${path}: ${msg}`);
  }
  return { ok: true, data: envelope.result };
}

/** Validate the token and resolve the account name. */
export async function validateCloudflareToken(
  token: string,
  accountId: string,
): Promise<{ accountName: string }> {
  // Verify token is active.
  const verify = await cfFetch<{ status: string }>(token, "/user/tokens/verify");
  if (!verify.ok || verify.data.status !== "active") {
    throw new Error("Cloudflare token is not active.");
  }
  const account = await cfFetch<{ name: string }>(token, `/accounts/${accountId}`);
  if (!account.ok) {
    throw new Error(`Cannot access Cloudflare account ${accountId} (status ${account.status}). Check the Account ID and token scopes.`);
  }
  return { accountName: account.data.name };
}

function mapPagesStatus(status: string | undefined): NormalizedStatus {
  switch (status) {
    case "success":
      return "success";
    case "failure":
      return "failure";
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "active":
    case "building":
    case "deploying":
    case "queued":
    case "initializing":
      return "running";
    default:
      return status ? "unknown" : "unknown";
  }
}

interface CfPagesProject {
  name: string;
}

interface CfPagesDeployment {
  id: string;
  short_id?: string;
  environment: string;
  created_on: string;
  modified_on?: string;
  url?: string;
  latest_stage?: { name: string; status: string };
  deployment_trigger?: { metadata?: { branch?: string; commit_hash?: string; commit_message?: string } };
}

interface CfPagesDeploymentLogs {
  data?: { line?: string; ts?: string }[];
  includes_container_logs?: boolean;
  total?: number;
}

async function fetchPagesItems(account: Account, token: string, accountId: string): Promise<MonitorItem[]> {
  const projects = await cfFetch<CfPagesProject[]>(
    token,
    `/accounts/${accountId}/pages/projects`,
  );
  if (!projects.ok) return [];

  const items: MonitorItem[] = [];
  const results = await Promise.allSettled(
    projects.data.slice(0, MAX_PAGES_PROJECTS).map((project) =>
      cfFetch<CfPagesDeployment[]>(
        token,
        `/accounts/${accountId}/pages/projects/${encodeURIComponent(project.name)}/deployments?per_page=3`,
      ).then((res) => ({ project, res })),
    ),
  );

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value.res.ok) continue;
    const { project, res } = result.value;
    for (const dep of res.data) {
      const branch = dep.deployment_trigger?.metadata?.branch;
      items.push({
        uid: `${account.id}:cf-pages:${dep.id}`,
        accountId: account.id,
        provider: "cloudflare",
        kind: "cf-pages",
        category: "deploy",
        title: project.name,
        subtitle: [dep.environment, branch].filter(Boolean).join(" · ") || "Pages",
        status: mapPagesStatus(dep.latest_stage?.status),
        conclusion: dep.latest_stage?.status,
        createdAt: dep.created_on,
        updatedAt: dep.modified_on || dep.created_on,
        url: `${DASH_BASE}/${accountId}/pages/view/${encodeURIComponent(project.name)}`,
        commitSha: dep.deployment_trigger?.metadata?.commit_hash,
        commitMessage: dep.deployment_trigger?.metadata?.commit_message,
        logAvailable: true,
        logLabel: "View logs",
        logFallbackUrl: `${DASH_BASE}/${accountId}/pages/view/${encodeURIComponent(project.name)}`,
        logRef: { accountId, projectName: project.name, deploymentId: dep.id },
      });
    }
  }
  return items;
}

interface CfWorkerScript {
  id: string;
  created_on?: string;
  modified_on?: string;
}

interface CfWorkerDeployment {
  id: string;
  created_on: string;
  author_email?: string;
}

async function fetchWorkersItems(account: Account, token: string, accountId: string): Promise<MonitorItem[]> {
  const scripts = await cfFetch<CfWorkerScript[]>(
    token,
    `/accounts/${accountId}/workers/scripts`,
  );
  if (!scripts.ok) return [];

  const items: MonitorItem[] = [];
  const results = await Promise.allSettled(
    scripts.data.slice(0, MAX_WORKERS).map((script) =>
      cfFetch<{ deployments?: CfWorkerDeployment[] } | CfWorkerDeployment[]>(
        token,
        `/accounts/${accountId}/workers/scripts/${encodeURIComponent(script.id)}/deployments`,
      ).then((res) => ({ script, res })),
    ),
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { script, res } = result.value;
    // Deployments carry no pass/fail; represent the latest as a successful deploy.
    let latest: CfWorkerDeployment | undefined;
    if (res.ok) {
      const raw = res.data;
      const deployments = Array.isArray(raw) ? raw : (raw.deployments ?? []);
      latest = deployments[0];
    }
    items.push({
      uid: `${account.id}:cf-worker:${script.id}`,
      accountId: account.id,
      provider: "cloudflare",
      kind: "cf-worker",
      category: "deploy",
      title: script.id,
      subtitle: latest?.author_email ? `deployed by ${latest.author_email}` : "Worker",
      status: "success",
      conclusion: "deployed",
      createdAt: script.created_on || latest?.created_on || new Date().toISOString(),
      updatedAt: latest?.created_on || script.modified_on || script.created_on || new Date().toISOString(),
      url: `${DASH_BASE}/${accountId}/workers/services/view/${encodeURIComponent(script.id)}`,
      logAvailable: false,
      logLabel: "Open logs",
      logFallbackUrl: `${DASH_BASE}/${accountId}/workers/services/view/${encodeURIComponent(script.id)}/logs`,
    });
  }
  return items;
}

/** Fetch Pages deployments and Workers deployments as normalized items. */
export async function fetchCloudflareItems(account: Account, token: string, accountId: string): Promise<MonitorItem[]> {
  const [pages, workers] = await Promise.allSettled([
    fetchPagesItems(account, token, accountId),
    fetchWorkersItems(account, token, accountId),
  ]);
  const items: MonitorItem[] = [];
  if (pages.status === "fulfilled") items.push(...pages.value);
  if (workers.status === "fulfilled") items.push(...workers.value);
  // If both failed, surface the first error so the account shows a message.
  if (pages.status === "rejected" && workers.status === "rejected") {
    throw pages.reason instanceof Error ? pages.reason : new Error(String(pages.reason));
  }
  return items;
}

export async function fetchCloudflareLogs(_account: Account, token: string, item: MonitorItem): Promise<MonitorLogResponse> {
  const ref = item.logRef ?? {};
  const accountId = typeof ref.accountId === "string" ? ref.accountId : "";
  const projectName = typeof ref.projectName === "string" ? ref.projectName : "";
  const deploymentId = typeof ref.deploymentId === "string" ? ref.deploymentId : "";
  if (!accountId || !projectName || !deploymentId) {
    throw new Error("Cloudflare log metadata is missing from this item.");
  }

  const res = await cfFetch<CfPagesDeploymentLogs>(
    token,
    `/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/deployments/${encodeURIComponent(deploymentId)}/history/logs`,
  );
  if (!res.ok) {
    throw new Error(`Cloudflare Pages deployment logs are unavailable for this item (status ${res.status}).`);
  }

  const lines = (res.data.data ?? []).map((entry) => ({
    timestamp: entry.ts,
    section: "Pages deploy",
    message: entry.line ?? "",
  })).filter((line) => line.message.trim() !== "");

  return {
    itemUid: item.uid,
    title: projectName,
    subtitle: `Deployment ${deploymentId}${res.data.includes_container_logs ? " · container logs included" : ""}`,
    provider: "cloudflare",
    fetchedAt: new Date().toISOString(),
    fallbackUrl: item.logFallbackUrl ?? item.url,
    lines: lines.length > 0 ? lines : [{ message: "No deployment logs were returned for this Pages deployment." }],
  };
}
