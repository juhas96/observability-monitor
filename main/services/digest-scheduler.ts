/**
 * Scheduled health digest. At the configured daily/weekly time it builds a
 * summary from history and delivers it as a native notification + channel
 * dispatch (kind "digest"). Timer lifecycle mirrors the poller.
 */

import { Notification, logger } from "@glaze/core/backend";

import { dispatch } from "./dispatch.js";
import { getEvents, getSeries, getSloStatus } from "./history-store.js";
import { getSettings } from "./settings-store.js";
import type { DigestSettings, HistoryEventType } from "./types.js";

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

function nextRun(cadence: DigestSettings["cadence"], hour: number, from = new Date()): Date {
  const next = new Date(from);
  next.setHours(Math.max(0, Math.min(23, Math.round(hour))), 0, 0, 0);
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
  if (cadence === "weekly") {
    // Deliver weekly digests on Mondays.
    while (next.getDay() !== 1) next.setDate(next.getDate() + 1);
  }
  return next;
}

async function buildDigestText(): Promise<string> {
  const [events, series, slos] = await Promise.all([
    getEvents({ range: "24h" }),
    getSeries("24h"),
    getSloStatus(),
  ]);
  const count = (type: HistoryEventType) => events.filter((event) => event.type === type).length;
  const openIncidents = series[series.length - 1]?.openIncidentCount ?? 0;
  const atRisk = slos.filter((slo) => slo.atRisk).map((slo) => slo.slo.name);

  const lines = [
    `Deploys: ${count("deploy")}`,
    `Failures: ${count("failure")} · Recoveries: ${count("recovery")}`,
    `Alerts: ${count("alert")} · Open incidents: ${openIncidents}`,
  ];
  if (atRisk.length > 0) lines.push(`SLOs at risk: ${atRisk.join(", ")}`);
  return lines.join("\n");
}

async function fireDigest(): Promise<void> {
  const body = await buildDigestText();
  const title = "Observability digest";
  if (Notification.isSupported()) {
    try {
      new Notification({ title, subtitle: "Last 24 hours", body }).show();
    } catch (err) {
      logger.warn("digest", "Failed to show digest notification", { err: String(err) });
    }
  }
  void dispatch({ kind: "digest", title, body });
}

function schedule(settings: DigestSettings): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!settings.enabled) return;
  const delay = Math.max(1000, nextRun(settings.cadence, settings.hour).getTime() - Date.now());
  timer = setTimeout(async () => {
    if (!running) return;
    try {
      await fireDigest();
    } catch (err) {
      logger.error("digest", "Digest delivery failed", { err: String(err) });
    }
    const settingsNow = await getSettings();
    schedule(settingsNow.digest);
  }, delay);
}

export async function start(): Promise<void> {
  running = true;
  const settings = await getSettings();
  schedule(settings.digest);
}

export function stop(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Re-arm the timer after a settings change. */
export async function reschedule(): Promise<void> {
  if (!running) return;
  const settings = await getSettings();
  schedule(settings.digest);
}
