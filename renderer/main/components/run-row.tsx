import { Bell, ExternalLink, Search, ScrollText } from "lucide-react";
import { Button, Text } from "@glaze/core/components";

import { StatusBadge } from "./status-badge";
import { categoryIcon } from "./provider-meta";
import { formatRelativeTime } from "./relative-time";
import type { MonitorItem } from "../types";

export function RunRow({
  item,
  onOpen,
  onViewLogs,
  onInvestigate,
  onCreateAlertRule,
}: {
  item: MonitorItem;
  onOpen: (item: MonitorItem) => void;
  onViewLogs: (item: MonitorItem) => void;
  onInvestigate?: (item: MonitorItem) => void;
  onCreateAlertRule?: (item: MonitorItem) => void;
}) {
  const Icon = categoryIcon(item.category, item.provider);
  const hasLogsAction = item.logAvailable || item.logFallbackUrl;
  const canCreateAlertRule = Boolean(onCreateAlertRule && item.status !== "success");
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-md px-2 py-2 hover:bg-control-subtle sm:grid-cols-[auto_minmax(0,1fr)_auto] group">
      <Icon className="size-4 shrink-0 text-tertiary" />
      <div className="min-w-0">
        <Text variant="strong" truncate className="block">
          {item.title}
        </Text>
        <Text variant="small" color="secondary" truncate className="block">
          {item.subtitle}
          {item.commitMessage ? ` — ${item.commitMessage}` : ""}
        </Text>
      </div>
      <div className="col-start-2 flex min-w-0 flex-wrap items-center justify-end gap-2 sm:col-start-auto sm:flex-nowrap">
        <Text variant="small" color="tertiary" className="shrink-0 tabular-nums">
          {formatRelativeTime(item.updatedAt)}
        </Text>
        <div className="shrink-0">
          <StatusBadge status={item.status} />
        </div>
        {hasLogsAction ? (
          <Button
            variant="transparent"
            size="small"
            iconOnly
            aria-label={item.logLabel ?? "View logs"}
            title={item.logLabel ?? "View logs"}
            className="shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
            onClick={() => onViewLogs(item)}
          >
            <ScrollText className="size-4" />
          </Button>
        ) : null}
        {onInvestigate ? (
          <Button
            variant="transparent"
            size="small"
            iconOnly
            aria-label="Start investigation"
            title="Start investigation"
            className="shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
            onClick={() => onInvestigate(item)}
          >
            <Search className="size-4" />
          </Button>
        ) : null}
        {canCreateAlertRule ? (
          <Button
            variant="transparent"
            size="small"
            iconOnly
            aria-label="Create alert rule"
            title="Create alert rule"
            className="shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
            onClick={() => onCreateAlertRule?.(item)}
          >
            <Bell className="size-4" />
          </Button>
        ) : null}
        <Button
          variant="transparent"
          size="small"
          iconOnly
          aria-label="Open in browser"
          className="shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
          onClick={() => onOpen(item)}
        >
          <ExternalLink className="size-4" />
        </Button>
      </div>
    </div>
  );
}
