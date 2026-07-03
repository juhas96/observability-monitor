/**
 * Encrypted token vault. Each account's API token is encrypted with the
 * native safeStorage backend and stored as base64 in tokens.bin.json, keyed
 * by account id. Plaintext tokens never touch disk.
 */

import { safeStorage } from "@glaze/core/backend";

import { DataStore } from "./data-store.js";

interface TokenVaultFile {
  version: 1;
  tokens: Record<string, string>; // accountId -> base64(encryptedBuffer)
}

const store = new DataStore<TokenVaultFile>("tokens.bin.json", { version: 1, tokens: {} });

export async function isEncryptionAvailable(): Promise<boolean> {
  try {
    return await safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export async function setToken(accountId: string, plaintext: string): Promise<void> {
  if (!(await isEncryptionAvailable())) {
    throw new Error("Secure token storage is unavailable on this system (safeStorage not ready).");
  }
  const encrypted = await safeStorage.encryptString(plaintext);
  const file = await store.load();
  const next: TokenVaultFile = {
    version: 1,
    tokens: { ...file.tokens, [accountId]: encrypted.toString("base64") },
  };
  await store.save(next);
}

export async function getToken(accountId: string): Promise<string | null> {
  const file = await store.load();
  const b64 = file.tokens[accountId];
  if (!b64) return null;
  try {
    return await safeStorage.decryptString(Buffer.from(b64, "base64"));
  } catch {
    return null;
  }
}

export async function removeToken(accountId: string): Promise<void> {
  const file = await store.load();
  if (!(accountId in file.tokens)) return;
  const tokens = { ...file.tokens };
  delete tokens[accountId];
  await store.save({ version: 1, tokens });
}
