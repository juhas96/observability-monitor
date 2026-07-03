/**
 * Netlify adapter. Shows recent deploy/build status per site.
 * Credential: personal access token (Netlify user settings → Applications).
 */

import type { MonitorItem, NormalizedStatus } from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const API_BASE = "https://api.netlify.com/api/v1";
const MAX_SITES = 15;
const DEPLOYS_PER_SITE = 3;

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
    const sites = await nfFetch<NfSite[]>(token, `/sites?per_page=${MAX_SITES}`);
    const items: MonitorItem[] = [];

    const results = await Promise.allSettled(
      sites.slice(0, MAX_SITES).map((site) =>
        nfFetch<NfDeploy[]>(token, `/sites/${site.id}/deploys?per_page=${DEPLOYS_PER_SITE}`).then((deploys) => ({
          site,
          deploys,
        })),
      ),
    );

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { site, deploys } = result.value;
      for (const dep of deploys) {
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
          url: dep.admin_url || site.admin_url || `https://app.netlify.com/sites/${site.name}/deploys`,
        });
      }
    }
    return items;
  },
};
