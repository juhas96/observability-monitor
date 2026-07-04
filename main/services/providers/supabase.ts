/**
 * Supabase adapter (Management API). Shows the latest applied migration per
 * project plus a rolled-up count of recent error logs.
 *
 * Credential: personal access token (sbp_…) + project ref.
 */

import type {
  Account,
  DashboardPanelResult,
  DashboardProviderQuery,
  DashboardQueryCapability,
  DashboardSeriesPoint,
  DashboardTableRow,
  MonitorItem,
  MonitorLogLine,
  MonitorLogResponse,
} from "../types.js";
import type { ProviderDefinition } from "./registry.js";

const API_BASE = "https://api.supabase.com";

async function sbFetch<T>(token: string, path: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (res.status === 404 || res.status === 403 || res.status === 501) {
    return { ok: false, status: res.status };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase ${res.status} on ${path}: ${res.statusText}${body ? ` — ${body.slice(0, 160)}` : ""}`);
  }
  return { ok: true, data: (await res.json()) as T };
}

interface SbProject {
  id: string;
  ref: string;
  name: string;
}

interface SbMigration {
  version: string; // YYYYMMDDHHMMSS
  name: string;
}

/** Parse a Supabase migration version (YYYYMMDDHHMMSS) into an ISO timestamp. */
function versionToIso(version: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(version);
  if (!m) return new Date().toISOString();
  const [, y, mo, d, h, mi, s] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString();
}

async function fetchMigration(account: Account, token: string, ref: string): Promise<MonitorItem | null> {
  const res = await sbFetch<SbMigration[] | { migrations: SbMigration[] }>(
    token,
    `/v1/projects/${ref}/database/migrations`,
  );
  if (!res.ok) return null;
  const list = Array.isArray(res.data) ? res.data : (res.data.migrations ?? []);
  if (list.length === 0) return null;
  // The API returns migrations in ascending order; the newest is last.
  const latest = list[list.length - 1];
  const iso = versionToIso(latest.version);
  return {
    uid: `${account.id}:supabase-migration:${latest.version}`,
    accountId: account.id,
    provider: "supabase",
    kind: "supabase-migration",
    category: "migration",
    title: account.identity || ref,
    subtitle: `Migration ${latest.version} · ${latest.name}`,
    status: "info",
    conclusion: "applied",
    createdAt: iso,
    updatedAt: iso,
    url: `https://supabase.com/dashboard/project/${ref}/database/migrations`,
    logAvailable: false,
    logLabel: "Open logs",
    logFallbackUrl: `https://supabase.com/dashboard/project/${ref}/database/migrations`,
  };
}

interface SbLogResult {
  result?: { count?: number }[];
}

async function fetchErrorLogs(account: Account, token: string, ref: string): Promise<MonitorItem | null> {
  // Count error-severity postgres logs in the last hour. Analytics endpoint is
  // query-based and gated; treat any failure as "logs unavailable".
  const sql =
    "select count(*) as count from postgres_logs cross join unnest(metadata) as m where m.parsed.error_severity in ('ERROR','FATAL','PANIC')";
  const res = await sbFetch<SbLogResult>(
    token,
    `/v1/projects/${ref}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}`,
  ).catch(() => ({ ok: false as const, status: 0 }));
  if (!res.ok) return null;
  const count = res.data.result?.[0]?.count ?? 0;
  const now = new Date().toISOString();
  return {
    uid: `${account.id}:supabase-log:errors`,
    accountId: account.id,
    provider: "supabase",
    kind: "supabase-log",
    category: "log",
    title: account.identity || ref,
    subtitle: count > 0 ? `${count} error logs (last hour)` : "No recent error logs",
    status: count > 0 ? "warning" : "success",
    conclusion: `${count} errors`,
    createdAt: now,
    updatedAt: now,
    url: `https://supabase.com/dashboard/project/${ref}/logs/postgres-logs`,
    logAvailable: true,
    logLabel: "View logs",
    logFallbackUrl: `https://supabase.com/dashboard/project/${ref}/logs/postgres-logs`,
    logRef: { projectRef: ref, source: "postgres_logs" },
    liveLogAvailable: true,
    liveLogPollSeconds: 5,
    liveLogLabel: "Live",
  };
}

interface SbLogRowsResult {
  result?: Record<string, unknown>[];
}

const RECENT_ERROR_LOGS_SQL = [
  "select timestamp, event_message, m.parsed.error_severity as level",
  "from postgres_logs cross join unnest(metadata) as m",
  "where m.parsed.error_severity in ('ERROR','FATAL','PANIC')",
  "order by timestamp desc",
  "limit 100",
].join(" ");

const DASHBOARD_QUERY_LIMIT = 100;

function withResultLimit(query: string, maxLimit: number): string {
  return /\blimit\s+\d+\b/i.test(query)
    ? query.replace(/\blimit\s+(\d+)\b/ig, (_match, raw: string) => `limit ${Math.min(Math.max(Number(raw) || maxLimit, 1), maxLimit)}`)
    : `${query} limit ${maxLimit}`;
}

function ensureReadOnlySql(query: string | undefined): string {
  const trimmed = query?.trim() ?? "";
  if (!/^select\b/i.test(trimmed)) throw new Error("Supabase dashboard SQL must start with SELECT.");
  if (trimmed.includes(";")) throw new Error("Supabase dashboard SQL cannot contain semicolons.");
  return withResultLimit(trimmed, DASHBOARD_QUERY_LIMIT);
}

function dashboardRows(rows: Record<string, unknown>[]): { rows: DashboardTableRow[]; columns: string[] } {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    columns,
    rows: rows.map((row) => {
      const out: DashboardTableRow = {};
      for (const [key, value] of Object.entries(row)) {
        out[key] = value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? value
          : JSON.stringify(value);
      }
      return out;
    }),
  };
}

function dashboardPoints(rows: DashboardTableRow[], xField: string | undefined, yField: string | undefined): DashboardSeriesPoint[] {
  if (!xField || !yField) return [];
  return rows
    .map((row): DashboardSeriesPoint | null => {
      const value = Number(row[yField]);
      const rawTs = row[xField];
      const ts = typeof rawTs === "string" || typeof rawTs === "number" ? new Date(rawTs).toISOString() : "";
      if (!ts || !Number.isFinite(value)) return null;
      return { ts, label: new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), series: yField, value };
    })
    .filter((point): point is DashboardSeriesPoint => point !== null);
}

function logRowToLine(row: Record<string, unknown>): MonitorLogLine {
  const timestamp = typeof row.timestamp === "string" ? row.timestamp : undefined;
  const level = typeof row.level === "string" ? row.level : undefined;
  const message = typeof row.event_message === "string" && row.event_message.trim() !== ""
    ? row.event_message
    : JSON.stringify(row);
  return { timestamp, level, section: "Postgres logs", message };
}

async function fetchProjectLogs(account: Account, token: string, ref: string, item: MonitorItem): Promise<MonitorLogResponse> {
  const sql = [
    "select timestamp, event_message, m.parsed.error_severity as level",
    "from postgres_logs cross join unnest(metadata) as m",
    "where m.parsed.error_severity in ('ERROR','FATAL','PANIC')",
    "order by timestamp desc",
    "limit 100",
  ].join(" ");
  const res = await sbFetch<SbLogRowsResult>(
    token,
    `/v1/projects/${ref}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}`,
  );
  if (!res.ok) throw new Error(`Supabase logs are unavailable for this project (status ${res.status}).`);
  const lines = (res.data.result ?? []).map(logRowToLine);
  return {
    itemUid: item.uid,
    title: account.identity || ref,
    subtitle: "Recent Postgres error logs",
    provider: "supabase",
    fetchedAt: new Date().toISOString(),
    fallbackUrl: `https://supabase.com/dashboard/project/${ref}/logs/postgres-logs`,
    lines: lines.length > 0 ? lines : [{ section: "Postgres logs", message: "No recent error logs were returned." }],
  };
}

export const supabaseProvider: ProviderDefinition = {
  id: "supabase",
  label: "Supabase",
  scopeHint: "Create a personal access token at supabase.com/dashboard/account/tokens. Project ref is in your project's URL/settings.",
  fields: [
    { key: "token", label: "Access token", type: "password", placeholder: "sbp_…", required: true, secret: true },
    { key: "projectRef", label: "Project ref", type: "text", placeholder: "e.g. abcdefghijklmnop", required: true, secret: false },
  ],
  async validate(creds) {
    const res = await sbFetch<SbProject[]>(creds.token, "/v1/projects");
    if (!res.ok) throw new Error(`Supabase token rejected (status ${res.status}).`);
    const project = res.data.find((p) => p.ref === creds.projectRef);
    if (!project) throw new Error(`Project ref "${creds.projectRef}" not found for this token.`);
    return { identity: project.name };
  },
  async fetch(account, creds) {
    const ref = creds.projectRef;
    const [migration, logs] = await Promise.all([
      fetchMigration(account, creds.token, ref),
      fetchErrorLogs(account, creds.token, ref),
    ]);
    return [migration, logs].filter((i): i is MonitorItem => i !== null);
  },
  async fetchLogs(account, creds, item) {
    const ref = typeof item.logRef?.projectRef === "string" ? item.logRef.projectRef : creds.projectRef;
    if (!ref) throw new Error("Supabase project ref is missing from this item.");
    return await fetchProjectLogs(account, creds.token, ref, item);
  },
  async getDashboardQueryCapabilities(account): Promise<DashboardQueryCapability[]> {
    return [{
      id: "supabase.logs-sql",
      label: `${account.label} logs SQL`,
      description: "Run a read-only SELECT query against Supabase analytics logs for this project.",
      queryLanguage: "SQL",
      requiresQuery: true,
      resultKind: "table",
      defaultVisualization: "table",
      defaultPanel: {
        title: "Recent Supabase error logs",
        source: {
          kind: "provider",
          accountId: account.id,
          capabilityId: "supabase.logs-sql",
          query: RECENT_ERROR_LOGS_SQL,
        },
        visualization: "table",
        width: "full",
        height: "medium",
      },
      params: [
        { key: "xField", label: "X field", required: false, placeholder: "timestamp" },
        { key: "yField", label: "Y field", required: false, placeholder: "count" },
      ],
    }];
  },
  async runDashboardQuery(_account, creds, query: DashboardProviderQuery): Promise<DashboardPanelResult> {
    if (query.capabilityId !== "supabase.logs-sql") throw new Error(`Unsupported Supabase dashboard query: ${query.capabilityId}`);
    const sql = ensureReadOnlySql(query.query);
    const res = await sbFetch<SbLogRowsResult>(
      creds.token,
      `/v1/projects/${creds.projectRef}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}`,
    );
    if (!res.ok) throw new Error(`Supabase analytics query unavailable (status ${res.status}).`);
    const { rows, columns } = dashboardRows(res.data.result ?? []);
    const points = dashboardPoints(rows, query.xField ?? query.params?.xField, query.yField ?? query.params?.yField);
    return points.length > 0
      ? { kind: "timeseries", generatedAt: new Date().toISOString(), points, rows, columns }
      : { kind: "table", generatedAt: new Date().toISOString(), rows, columns };
  },
};
