import { AlertCircle } from "lucide-react";
import { Text, Badge, Separator } from "@glaze/core/components";

import { RunRow } from "./run-row";
import { providerIcon, providerLabel } from "./provider-meta";
import { formatRelativeTime } from "./relative-time";
import type { Account, MonitorItem, PerAccountStatus } from "../types";

function accountIdentity(account: Account): string {
  return account.identity ?? providerLabel(account.provider);
}

export function AccountSection({
  account,
  status,
  items,
  onOpen,
  onViewLogs,
  onInvestigate,
  onCreateAlertRule,
}: {
  account: Account;
  status: PerAccountStatus | undefined;
  items: MonitorItem[];
  onOpen: (item: MonitorItem) => void;
  onViewLogs: (item: MonitorItem) => void;
  onInvestigate?: (item: MonitorItem) => void;
  onCreateAlertRule?: (item: MonitorItem) => void;
}) {
  const Icon = providerIcon(account.provider);

  return (
    <section className="flex flex-col gap-1">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2 pt-2">
        <Icon className="size-4 shrink-0 text-secondary" />
        <div className="min-w-0">
          <Text variant="strong" truncate className="block">{account.label}</Text>
          <Text variant="small" color="tertiary" truncate className="block">
            {accountIdentity(account)}
          </Text>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status?.lastSyncAt ? (
            <Text variant="small" color="tertiary" className="tabular-nums">
              {formatRelativeTime(status.lastSyncAt)}
            </Text>
          ) : null}
          <Badge color="secondary">{items.length}</Badge>
        </div>
      </div>
      <Separator />

      {status?.lastError ? (
        <div className="flex min-w-0 items-center gap-2 px-2 py-2">
          <AlertCircle className="size-4 shrink-0 text-support-red" />
          <Text variant="small" color="secondary" truncate className="block">
            {status.lastError}
          </Text>
        </div>
      ) : items.length === 0 ? (
        <Text variant="small" color="tertiary" className="px-2 py-2">
          No recent activity.
        </Text>
      ) : (
        <div className="flex flex-col">
          {items.map((item) => (
            <RunRow
              key={item.uid}
              item={item}
              onOpen={onOpen}
              onViewLogs={onViewLogs}
              onInvestigate={onInvestigate}
              onCreateAlertRule={onCreateAlertRule}
            />
          ))}
        </div>
      )}
    </section>
  );
}
