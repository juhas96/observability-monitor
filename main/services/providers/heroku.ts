/**
 * Heroku adapter. Shows the latest release status per app.
 * Credential: Heroku API key (Account settings → API Key, or `heroku auth:token`).
 */

import type { MonitorItem, NormalizedStatus } from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const API_BASE = "https://api.heroku.com";
const MAX_APPS = 15;

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
    const apps = await herokuFetch<HkApp[]>(token, "/apps");
    const items: MonitorItem[] = [];

    const results = await Promise.allSettled(
      apps.slice(0, MAX_APPS).map((app) =>
        herokuFetch<HkRelease[]>(token, `/apps/${app.id}/releases`, "version ..; order=desc,max=3").then(
          (releases) => ({ app, releases }),
        ),
      ),
    );

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { app, releases } = result.value;
      for (const rel of releases) {
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
        });
      }
    }
    return items;
  },
};
