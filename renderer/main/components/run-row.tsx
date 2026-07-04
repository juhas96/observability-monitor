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
    <div className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-control-subtle group">
      <Icon className="size-4 text-tertiary shrink-0" />
      <div className="flex flex-col min-w-0 flex-1">
        <Text variant="strong" truncate>
          {item.title}
        </Text>
        <Text variant="small" color="secondary" truncate>
          {item.subtitle}
          {item.commitMessage ? ` — ${item.commitMessage}` : ""}
        </Text>
      </div>
      <Text variant="small" color="tertiary" className="shrink-0 tabular-nums">
        {formatRelativeTime(item.updatedAt)}
      </Text>
      <div className="shrink-0 w-24 flex justify-end">
        <StatusBadge status={item.status} />
      </div>
      {hasLogsAction ? (
        <Button
          variant="transparent"
          size="small"
          iconOnly
          aria-label={item.logLabel ?? "View logs"}
          title={item.logLabel ?? "View logs"}
          className="shrink-0 opacity-0 group-hover:opacity-100"
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
          className="shrink-0 opacity-0 group-hover:opacity-100"
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
          className="shrink-0 opacity-0 group-hover:opacity-100"
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
        className="shrink-0 opacity-0 group-hover:opacity-100"
        onClick={() => onOpen(item)}
      >
        <ExternalLink className="size-4" />
      </Button>
    </div>
  );
}
