/**
 * Uptime / synthetic HTTP check definitions. Plain JSON in userData/checks.json;
 * no secrets (checks probe public or user-reachable endpoints).
 */

import { randomUUID } from "crypto";

import { DataStore } from "./data-store.js";
import type { HttpCheck, HttpCheckInput } from "./types.js";

interface ChecksFile {
  checks: HttpCheck[];
}

const store = new DataStore<ChecksFile>("checks.json", { checks: [] });

const ALLOWED_METHODS = ["GET", "HEAD", "POST"];

function normalizeMethod(method: string | undefined): string {
  const upper = (method ?? "GET").toUpperCase();
  return ALLOWED_METHODS.includes(upper) ? upper : "GET";
}

export async function listChecks(): Promise<HttpCheck[]> {
  return (await store.load()).checks;
}

export async function saveCheck(input: HttpCheckInput): Promise<HttpCheck> {
  const url = input.url.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("Check URL must start with http:// or https://");
  const name = input.name.trim();
  if (name === "") throw new Error("Check name is required.");

  const file = await store.load();
  const checks = [...file.checks];
  const now = new Date().toISOString();

  let check: HttpCheck;
  if (input.id) {
    const idx = checks.findIndex((c) => c.id === input.id);
    if (idx === -1) throw new Error("Check not found.");
    check = {
      ...checks[idx],
      name,
      url,
      method: normalizeMethod(input.method ?? checks[idx].method),
      expectedStatus: input.expectedStatus,
      timeoutMs: input.timeoutMs,
      groupId: input.groupId,
      enabled: input.enabled ?? checks[idx].enabled,
    };
    checks[idx] = check;
  } else {
    check = {
      id: randomUUID(),
      name,
      url,
      method: normalizeMethod(input.method),
      expectedStatus: input.expectedStatus,
      timeoutMs: input.timeoutMs,
      groupId: input.groupId,
      enabled: input.enabled ?? true,
      createdAt: now,
    };
    checks.push(check);
  }

  await store.save({ checks });
  return check;
}

export async function deleteCheck(id: string): Promise<void> {
  const file = await store.load();
  await store.save({ checks: file.checks.filter((c) => c.id !== id) });
}
