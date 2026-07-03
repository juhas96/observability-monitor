import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, AlertCircle } from "lucide-react";
import {
  ScrollArea,
  Button,
  List,
  Switch,
  Text,
  EmptyState,
  Callout,
  AlertDialog,
  toast,
} from "@glaze/core/components";

import { AddAccountDialog } from "./components/add-account-dialog";
import { providerIcon, providerLabel } from "./components/provider-meta";
import { useAccounts, useAccountMutations, useGroups } from "./hooks/use-accounts";
import { monitorApi } from "./ipc";
import type { Account, ProjectGroup } from "./types";

function identity(account: Account): string {
  return account.identity ?? `${providerLabel(account.provider)} account`;
}

function accountDescription(account: Account, groupsById: Map<string, ProjectGroup>): string {
  const parts = [identity(account)];
  const group = account.groupId ? groupsById.get(account.groupId) : undefined;
  if (group) parts.push(`Project: ${group.name}`);
  if (account.lastError) parts.push(account.lastError);
  return parts.join(" · ");
}

export function AccountsView() {
  const accountsQuery = useAccounts();
  const groupsQuery = useGroups();
  const { update, remove } = useAccountMutations();
  const statusQuery = useQuery({ queryKey: ["monitor", "status"], queryFn: () => monitorApi.getStatus() });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [removing, setRemoving] = useState<Account | null>(null);

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (account: Account) => {
    setEditing(account);
    setDialogOpen(true);
  };

  const accounts = accountsQuery.data ?? [];
  const groupsById = new Map((groupsQuery.data ?? []).map((group) => [group.id, group]));
  const encryptionUnavailable = statusQuery.data?.encryptionAvailable === false;

  return (
    <ScrollArea
      title="Accounts"
      actions={
        <Button variant="glass" size="large" onClick={openAdd}>
          <Plus className="size-4.5" />
          Add account
        </Button>
      }
      className="h-full"
    >
      <div className="px-2 pb-8 flex flex-col gap-3">
        {encryptionUnavailable ? (
          <Callout color="red" icon={<AlertCircle />}>
            Secure token storage is unavailable on this system, so accounts can't be saved safely.
          </Callout>
        ) : null}

        {accounts.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            description="Connect CI/CD, incident, status, and observability providers to monitor their activity."
            actions={<Button variant="accent" onClick={openAdd}>Add account</Button>}
          />
        ) : (
          <List.Root items={accounts} getItemKey={(a) => a.id}>
            {accounts.map((account) => (
              <List.Item key={account.id} item={account}>
                <List.ItemIcon>
                  {(() => {
                    const Icon = providerIcon(account.provider);
                    return <Icon className="size-5" />;
                  })()}
                </List.ItemIcon>
                <List.ItemContent>
                  <List.ItemTitle>{account.label}</List.ItemTitle>
                  <List.ItemDescription>{accountDescription(account, groupsById)}</List.ItemDescription>
                </List.ItemContent>
                <List.ItemAccessory>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={account.enabled}
                      onCheckedChange={(checked) => update.mutate({ id: account.id, enabled: checked })}
                      aria-label="Enable monitoring"
                    />
                    <Button variant="transparent" size="small" iconOnly aria-label="Edit" onClick={() => openEdit(account)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="transparent"
                      size="small"
                      iconOnly
                      aria-label="Remove"
                      onClick={() => setRemoving(account)}
                    >
                      <Trash2 className="size-4 text-support-red" />
                    </Button>
                  </div>
                </List.ItemAccessory>
              </List.Item>
            ))}
          </List.Root>
        )}

        {accounts.length > 0 ? (
          <Text variant="small" color="tertiary" className="px-2">
            Disabled accounts are skipped during polling but keep their stored token.
          </Text>
        ) : null}
      </div>

      <AddAccountDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? `Remove "${removing.label}"?` : ""}
        description="This deletes the stored API token and stops monitoring this account. You can add it again later."
        confirmLabel="Remove"
        confirmVariant="destructive"
        onConfirm={async () => {
          if (!removing) return;
          await remove.mutateAsync(removing.id);
          toast.success("Account removed");
          setRemoving(null);
        }}
      />
    </ScrollArea>
  );
}
