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
}: {
  account: Account;
  status: PerAccountStatus | undefined;
  items: MonitorItem[];
  onOpen: (item: MonitorItem) => void;
  onViewLogs: (item: MonitorItem) => void;
}) {
  const Icon = providerIcon(account.provider);

  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-center gap-2 px-2 pt-2">
        <Icon className="size-4 text-secondary shrink-0" />
        <Text variant="strong">{account.label}</Text>
        <Text variant="small" color="tertiary">
          {accountIdentity(account)}
        </Text>
        <div className="ml-auto flex items-center gap-2">
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
        <div className="flex items-center gap-2 px-2 py-2">
          <AlertCircle className="size-4 text-support-red shrink-0" />
          <Text variant="small" color="secondary">
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
            <RunRow key={item.uid} item={item} onOpen={onOpen} onViewLogs={onViewLogs} />
          ))}
        </div>
      )}
    </section>
  );
}
