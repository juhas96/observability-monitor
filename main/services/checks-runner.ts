/**
 * Runs the enabled HTTP checks each poll cycle, measuring latency and up/down.
 * Results feed the snapshot (aggregator) and history (latency series + events).
 */

import { logger } from "@glaze/core/backend";

import { listChecks } from "./checks-store.js";
import type { HttpCheck, HttpCheckResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const CONCURRENCY = 4;

function isUp(check: HttpCheck, statusCode: number): boolean {
  if (check.expectedStatus) return statusCode === check.expectedStatus;
  return statusCode > 0 && statusCode < 400;
}

async function runOne(check: HttpCheck): Promise<HttpCheckResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = Math.max(1000, Math.min(60_000, check.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const timer = setTimeout(() => controller.abort(), timeout);
  const base: Pick<HttpCheckResult, "checkId" | "name" | "url" | "groupId"> = {
    checkId: check.id,
    name: check.name,
    url: check.url,
    groupId: check.groupId,
  };
  try {
    const res = await fetch(check.url, { method: check.method, signal: controller.signal, redirect: "follow" });
    const latencyMs = Date.now() - startedAt;
    return { ...base, ok: isUp(check, res.status), statusCode: res.status, latencyMs, checkedAt: new Date().toISOString() };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const error = err instanceof Error ? (err.name === "AbortError" ? `Timed out after ${timeout}ms` : err.message) : String(err);
    return { ...base, ok: false, latencyMs, error, checkedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe every enabled check (bounded concurrency). Returns [] when no checks are configured. */
export async function runChecks(): Promise<HttpCheckResult[]> {
  let checks: HttpCheck[];
  try {
    checks = (await listChecks()).filter((c) => c.enabled);
  } catch (err) {
    logger.warn("checks", "Failed to load checks", { err: String(err) });
    return [];
  }
  if (checks.length === 0) return [];

  const results: HttpCheckResult[] = [];
  for (let i = 0; i < checks.length; i += CONCURRENCY) {
    const batch = checks.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(batch.map(runOne))));
  }
  return results;
}
