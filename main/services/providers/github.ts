import { fetchGitHubItems, fetchGitHubLogs, validateGitHubToken } from "../github-api.js";
import type { ProviderDefinition } from "./registry.js";

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
};
