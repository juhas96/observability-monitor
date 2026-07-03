import { fetchCloudflareItems, fetchCloudflareLogs, validateCloudflareToken } from "../cloudflare-api.js";
import type { ProviderDefinition } from "./registry.js";

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
};
