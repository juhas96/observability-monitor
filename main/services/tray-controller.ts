/**
 * Menu bar (tray) controller. Reflects aggregate status via the icon color,
 * and renders a dropdown of recent items plus quick actions.
 */

import { Tray, Menu, shell, logger } from "@glaze/core/backend";

import type { AggregateSnapshot, MonitorItem, NormalizedStatus } from "./types.js";

// Mirror of the SDK's non-exported MenuItemColor palette token union.
type MenuItemColor = "red" | "orange" | "yellow" | "green" | "blue" | "gray";

export interface TrayCallbacks {
  onRefresh: () => void;
  onOpenDashboard: () => void;
  onOpenSettings: () => void;
}

const TRAY_SYMBOL = "bolt.horizontal.circle.fill";
const MAX_MENU_ITEMS = 8;

let tray: Tray | null = null;
let callbacks: TrayCallbacks | null = null;
let lastSnapshot: AggregateSnapshot | null = null;

function statusColor(status: NormalizedStatus): MenuItemColor | undefined {
  switch (status) {
    case "failure":
      return "red";
    case "running":
    case "queued":
      return "blue";
    case "success":
      return "green";
    default:
      return undefined; // render as adaptive template glyph
  }
}

function statusGlyph(status: NormalizedStatus): string {
  switch (status) {
    case "failure":
      return "✗";
    case "success":
      return "✓";
    case "running":
    case "queued":
      return "•";
    case "cancelled":
      return "⊘";
    default:
      return "–";
  }
}

function buildMenu(snapshot: AggregateSnapshot | null): Menu {
  const items = snapshot?.items.slice(0, MAX_MENU_ITEMS) ?? [];
  const failing = snapshot?.items.filter((i) => i.status === "failure").length ?? 0;

  const template: Parameters<typeof Menu.buildFromTemplate>[0] = [
    {
      label: snapshot
        ? `CI/CD Monitor — ${failing > 0 ? `${failing} failing` : "all clear"}`
        : "CI/CD Monitor — starting…",
      enabled: false,
    },
    { type: "separator" },
  ];

  if (items.length === 0) {
    template.push({ label: "No recent activity", enabled: false });
  } else {
    for (const item of items) {
      template.push({
        label: `${statusGlyph(item.status)}  ${item.title} — ${item.subtitle}`.slice(0, 80),
        click: () => openItem(item),
      });
    }
  }

  template.push(
    { type: "separator" },
    { label: "Open Dashboard", click: () => callbacks?.onOpenDashboard() },
    { label: "Refresh Now", click: () => callbacks?.onRefresh() },
    { label: "Settings…", click: () => callbacks?.onOpenSettings() },
    { type: "separator" },
    { label: "Quit", role: "quit" },
  );

  return Menu.buildFromTemplate(template);
}

function openItem(item: MonitorItem): void {
  void shell.openExternal(item.url).catch((err) => {
    logger.warn("tray", "Failed to open item URL", { err: String(err) });
  });
}

export function initTray(cbs: TrayCallbacks): void {
  callbacks = cbs;
  if (tray) return;
  try {
    tray = new Tray(TRAY_SYMBOL);
    tray.setToolTip("CI/CD Monitor");
    tray.setContextMenu(buildMenu(null));
  } catch (err) {
    logger.error("tray", "Failed to create tray", { err: String(err) });
  }
}

export function updateTray(snapshot: AggregateSnapshot): void {
  lastSnapshot = snapshot;
  if (!tray) return;
  const color = statusColor(snapshot.aggregateStatus);
  try {
    tray.setImage(TRAY_SYMBOL, color ? { color } : undefined);
    const failing = snapshot.items.filter((i) => i.status === "failure").length;
    tray.setTitle(failing > 0 ? String(failing) : "");
    tray.setToolTip(failing > 0 ? `CI/CD Monitor — ${failing} failing` : "CI/CD Monitor — all clear");
    tray.setContextMenu(buildMenu(snapshot));
  } catch (err) {
    logger.warn("tray", "Failed to update tray", { err: String(err) });
  }
}

export function getLastSnapshot(): AggregateSnapshot | null {
  return lastSnapshot;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
