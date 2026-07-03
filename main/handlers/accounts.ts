/**
 * Account CRUD + credential validation IPC handlers, driven by the provider
 * registry. Credentials arrive as a flat `creds` map keyed by each provider's
 * CredentialField keys. The one secret field is encrypted into the token-store;
 * non-secret fields are persisted in `account.config`. Secrets are NEVER
 * returned by accounts:list.
 */

import { randomUUID } from "crypto";

import { ipcMain, logger } from "@glaze/core/backend";

import { addAccount, getAccount, listAccounts, removeAccount, updateAccount } from "../services/accounts-store.js";
import * as registry from "../services/providers/index.js";
import * as poller from "../services/poller.js";
import { getToken, removeToken, setToken } from "../services/token-store.js";
import { pushSnapshot } from "../services/push.js";
import * as aggregator from "../services/aggregator.js";
import type { Account, Provider } from "../services/types.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request payload.");
  }
  return value as Record<string, unknown>;
}

function asProvider(value: unknown): Provider {
  if (typeof value === "string" && registry.has(value)) return value;
  throw new Error(`Unknown provider: ${String(value)}`);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid "${field}".`);
  }
  return value.trim();
}

function asCreds(value: unknown): Record<string, string> {
  const rec = asRecord(value);
  const creds: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (typeof v === "string") creds[k] = v;
  }
  return creds;
}

/** Split a creds map into the encrypted secret value + persisted non-secret config. */
function splitCreds(provider: Provider, creds: Record<string, string>): { secret?: string; config: Record<string, string> } {
  const def = registry.get(provider);
  let secret: string | undefined;
  const config: Record<string, string> = {};
  for (const field of def.fields) {
    const value = creds[field.key]?.trim();
    if (value === undefined || value === "") continue;
    if (field.secret) secret = value;
    else config[field.key] = value;
  }
  return { secret, config };
}

/** Ensure all required fields are present in the effective credential set. */
function assertRequired(provider: Provider, secret: string | undefined, config: Record<string, string>): void {
  const def = registry.get(provider);
  for (const field of def.fields) {
    if (!field.required) continue;
    const present = field.secret ? Boolean(secret) : Boolean(config[field.key]);
    if (!present) throw new Error(`Missing required field "${field.label}".`);
  }
}

export function registerAccountHandlers(): void {
  ipcMain.handle("accounts:list", async (): Promise<Account[]> => {
    return await listAccounts();
  });

  ipcMain.handle("accounts:test", async (_event, payload: unknown) => {
    const req = asRecord(payload);
    const provider = asProvider(req.provider);
    const creds = asCreds(req.creds);
    try {
      const { secret, config } = splitCreds(provider, creds);
      assertRequired(provider, secret, config);
      const { identity } = await registry.get(provider).validate({ ...config, ...(secret ? { [registry.secretField(provider).key]: secret } : {}) });
      return { ok: true, identity };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("accounts:add", async (_event, payload: unknown): Promise<{ account: Account }> => {
    const req = asRecord(payload);
    const provider = asProvider(req.provider);
    const label = asString(req.label, "label");
    const creds = asCreds(req.creds);

    const { secret, config } = splitCreds(provider, creds);
    assertRequired(provider, secret, config);

    const secretKey = registry.secretField(provider).key;
    const { identity } = await registry.get(provider).validate({ ...config, ...(secret ? { [secretKey]: secret } : {}) });

    const account: Account = {
      id: randomUUID(),
      provider,
      label,
      createdAt: new Date().toISOString(),
      enabled: true,
      identity,
      config,
    };

    if (secret) await setToken(account.id, secret);
    await addAccount(account);
    logger.info("accounts", "Account added", { id: account.id, provider });

    void poller.refresh(account.id);
    return { account };
  });

  ipcMain.handle("accounts:update", async (_event, payload: unknown): Promise<{ account: Account }> => {
    const req = asRecord(payload);
    const id = asString(req.id, "id");
    const existing = await getAccount(id);
    if (!existing) throw new Error(`Account not found: ${id}`);
    const provider = existing.provider;
    const secretKey = registry.secretField(provider).key;

    const patch: Partial<Account> = {};
    if (typeof req.label === "string") patch.label = req.label.trim();
    if (typeof req.enabled === "boolean") patch.enabled = req.enabled;

    if (req.creds !== undefined) {
      const { secret, config } = splitCreds(provider, asCreds(req.creds));
      // Merge non-secret config over the existing config.
      const mergedConfig = { ...(existing.config ?? {}), ...config };
      // Re-validate with the new secret (if provided) or the stored one.
      const effectiveSecret = secret ?? (await getToken(id)) ?? undefined;
      assertRequired(provider, effectiveSecret, mergedConfig);
      const { identity } = await registry
        .get(provider)
        .validate({ ...mergedConfig, ...(effectiveSecret ? { [secretKey]: effectiveSecret } : {}) });
      patch.config = mergedConfig;
      patch.identity = identity;
      if (secret) await setToken(id, secret);
    }

    const account = await updateAccount(id, patch);
    void poller.refresh(account.id);
    return { account };
  });

  ipcMain.handle("accounts:remove", async (_event, payload: unknown): Promise<{ ok: true }> => {
    const req = asRecord(payload);
    const id = asString(req.id, "id");
    await removeToken(id);
    await removeAccount(id);
    poller.dropAccount(id);
    logger.info("accounts", "Account removed", { id });
    aggregator.removeAccount(id);
    pushSnapshot(aggregator.buildSnapshot());
    return { ok: true };
  });

  logger.info("accounts", "✓ Account handlers registered");
}
