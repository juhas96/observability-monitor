/**
 * Better Stack Telemetry logs adapter. Uses the SQL Query API over HTTPS with
 * ClickHouse connection credentials. The connection password is the single
 * encrypted account secret; host, username, and table name are non-secret.
 */

import type {
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

const DEFAULT_WINDOW_MINUTES = 15;
const DEFAULT_LOG_LIMIT = 200;
const DASH_URL = "https://telemetry.betterstack.com";

function normalizeHost(host: string): string {
  return host.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function endpoint(host: string): string {
  return `https://${normalizeHost(host)}?output_format_pretty_row_numbers=0`;
}

function authHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function tableName(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_]+$/.test(trimmed)) {
    throw new Error("Better Stack logs table must contain only letters, numbers, and underscores.");
  }
  return trimmed;
}

function withJsonEachRow(query: string): string {
  return /\bformat\s+jsoneachrow\b/i.test(query) ? query : `${query.replace(/\s+$/u, "")} FORMAT JSONEachRow`;
}

function boundedSelect(query: string | undefined): string {
  const trimmed = query?.trim() ?? "";
  if (!/^select\b/i.test(trimmed)) throw new Error("Better Stack SQL must start with SELECT.");
  if (trimmed.includes(";")) throw new Error("Better Stack SQL cannot contain semicolons.");
  const withoutFormat = trimmed.replace(/\s+format\s+\w+\s*$/iu, "");
  const limited = /\blimit\s+\d+\b/i.test(withoutFormat)
    ? withoutFormat.replace(/\blimit\s+(\d+)\b/ig, (_match, raw: string) => `LIMIT ${Math.min(Math.max(Number(raw) || DEFAULT_LOG_LIMIT, 1), DEFAULT_LOG_LIMIT)}`)
    : `${withoutFormat} LIMIT ${DEFAULT_LOG_LIMIT}`;
  return withJsonEachRow(limited);
}

async function bsQueryRows(creds: Record<string, string>, query: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(endpoint(creds.host), {
    method: "POST",
    headers: {
      Authorization: authHeader(creds.username, creds.password),
      "Content-Type": "plain/text",
      Accept: "application/json",
    },
    body: query,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Better Stack SQL ${res.status}: ${res.statusText}${body ? ` - ${body.slice(0, 180)}` : ""}`);
  }
  const text = await res.text();
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function recentLogsQuery(logsTable: string, limit = DEFAULT_LOG_LIMIT): string {
  const table = tableName(logsTable);
  return withJsonEachRow([
    "SELECT dt, raw",
    `FROM remote(${table})`,
    `WHERE dt >= now() - INTERVAL ${DEFAULT_WINDOW_MINUTES} MINUTE`,
    "ORDER BY dt DESC",
    `LIMIT ${limit}`,
  ].join(" "));
}

function recentCountQuery(logsTable: string): string {
  const table = tableName(logsTable);
  return withJsonEachRow([
    "SELECT count() AS count, max(dt) AS latest",
    `FROM remote(${table})`,
    `WHERE dt >= now() - INTERVAL ${DEFAULT_WINDOW_MINUTES} MINUTE`,
  ].join(" "));
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function rowMessage(row: Record<string, unknown>): string {
  const raw = row.raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        return asString(parsed.message) ?? asString(parsed.msg) ?? trimmed;
      } catch {
        return raw;
      }
    }
    return raw;
  }
  return JSON.stringify(row);
}

function rowLevel(row: Record<string, unknown>): string | undefined {
  return asString(row.level) ?? asString(row.severity) ?? asString(row.status);
}

function rowsToLines(rows: Record<string, unknown>[]): MonitorLogLine[] {
  return rows.map((row) => ({
    timestamp: asString(row.dt) ?? asString(row.timestamp),
    section: "Better Stack logs",
    level: rowLevel(row),
    message: rowMessage(row),
  }));
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
      out.__url = DASH_URL;
      out.__urlLabel = "Open Better Stack";
      return out;
    }),
  };
}

function dashboardPoints(rows: DashboardTableRow[], xField: string | undefined, yField: string | undefined): DashboardSeriesPoint[] {
  if (!xField || !yField) return [];
  return rows.map((row): DashboardSeriesPoint | null => {
    const rawTs = row[xField];
    const value = Number(row[yField]);
    const ts = typeof rawTs === "string" || typeof rawTs === "number" ? new Date(rawTs).toISOString() : "";
    if (!ts || !Number.isFinite(value)) return null;
    return { ts, label: new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), series: yField, value };
  }).filter((point): point is DashboardSeriesPoint => point !== null);
}

export const betterstackProvider: ProviderDefinition = {
  id: "betterstack",
  label: "Better Stack",
  scopeHint:
    "Use Better Stack Telemetry SQL Query API connection credentials. Host and username are from a ClickHouse connection; password is stored encrypted.",
  fields: [
    { key: "host", label: "SQL host", type: "text", placeholder: "eu-nbg-2-connect.betterstackdata.com", required: true, secret: false },
    { key: "username", label: "SQL username", type: "text", placeholder: "ClickHouse username", required: true, secret: false },
    { key: "password", label: "SQL password", type: "password", placeholder: "ClickHouse password", required: true, secret: true },
    { key: "logsTable", label: "Logs table", type: "text", placeholder: "t123456_source_logs", required: true, secret: false },
  ],
  async validate(creds) {
    await bsQueryRows(creds, withJsonEachRow(`SELECT dt FROM remote(${tableName(creds.logsTable)}) LIMIT 1`));
    return { identity: `${normalizeHost(creds.host)} · ${creds.logsTable}` };
  },
  async fetch(account, creds): Promise<MonitorItem[]> {
    const rows = await bsQueryRows(creds, recentCountQuery(creds.logsTable));
    const count = Number(rows[0]?.count ?? 0);
    const latest = asString(rows[0]?.latest);
    const now = new Date().toISOString();
    return [{
      uid: `${account.id}:betterstack-log:recent`,
      accountId: account.id,
      provider: "betterstack",
      kind: "betterstack-log",
      category: "log",
      title: account.identity || account.label,
      subtitle: count > 0 ? `${count} logs in the last ${DEFAULT_WINDOW_MINUTES}m` : `No logs in the last ${DEFAULT_WINDOW_MINUTES}m`,
      status: count > 0 ? "success" : "info",
      conclusion: `${count} logs`,
      createdAt: latest ? new Date(latest).toISOString() : now,
      updatedAt: latest ? new Date(latest).toISOString() : now,
      url: DASH_URL,
      logAvailable: true,
      logLabel: "View live logs",
      logFallbackUrl: DASH_URL,
      logRef: { logsTable: creds.logsTable },
      liveLogAvailable: true,
      liveLogPollSeconds: 5,
      liveLogLabel: "Live",
    }];
  },
  async fetchLogs(account, creds, item): Promise<MonitorLogResponse> {
    const logsTable = typeof item.logRef?.logsTable === "string" ? item.logRef.logsTable : creds.logsTable;
    const rows = await bsQueryRows(creds, recentLogsQuery(logsTable));
    const lines = rowsToLines(rows);
    return {
      itemUid: item.uid,
      title: account.identity || account.label,
      subtitle: `Recent Better Stack logs · last ${DEFAULT_WINDOW_MINUTES}m`,
      provider: "betterstack",
      fetchedAt: new Date().toISOString(),
      fallbackUrl: item.logFallbackUrl ?? DASH_URL,
      lines: lines.length > 0 ? lines : [{ section: "Better Stack logs", message: "No recent logs were returned." }],
    };
  },
  async getDashboardQueryCapabilities(account): Promise<DashboardQueryCapability[]> {
    return [{
      id: "betterstack.sql",
      label: `${account.label} Better Stack SQL`,
      description: "Run a bounded read-only SELECT query against Better Stack Telemetry logs.",
      queryLanguage: "SQL",
      requiresQuery: true,
      resultKind: "logs",
      defaultVisualization: "logs",
      defaultPanel: {
        title: "Recent Better Stack logs",
        source: {
          kind: "provider",
          accountId: account.id,
          capabilityId: "betterstack.sql",
          query: recentLogsQuery(account.config?.logsTable ?? "", DEFAULT_LOG_LIMIT),
        },
        visualization: "logs",
        width: "full",
        height: "medium",
      },
      params: [
        { key: "xField", label: "X field", required: false, placeholder: "dt" },
        { key: "yField", label: "Y field", required: false, placeholder: "count" },
      ],
    }];
  },
  async runDashboardQuery(_account, creds, query: DashboardProviderQuery): Promise<DashboardPanelResult> {
    if (query.capabilityId !== "betterstack.sql") throw new Error(`Unsupported Better Stack dashboard query: ${query.capabilityId}`);
    const rows = await bsQueryRows(creds, boundedSelect(query.query));
    const { rows: tableRows, columns } = dashboardRows(rows);
    const points = dashboardPoints(tableRows, query.xField ?? query.params?.xField, query.yField ?? query.params?.yField);
    if (points.length > 0) return { kind: "timeseries", generatedAt: new Date().toISOString(), points, rows: tableRows, columns };
    return { kind: "logs", generatedAt: new Date().toISOString(), rows: tableRows, columns };
  },
};
