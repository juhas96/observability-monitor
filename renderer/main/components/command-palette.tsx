import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@glaze/core/components";

import { providerIcon, providerLabel } from "./provider-meta";
import { useAccounts } from "../hooks/use-accounts";
import { useChecks } from "../hooks/use-checks";
import { useMonitorData } from "../hooks/use-monitor-data";
import { useRules } from "../hooks/use-rules";
import { monitorApi } from "../ipc";

const NAV_ITEMS: { path: string; label: string }[] = [
  { path: "/", label: "Dashboard" },
  { path: "/apps", label: "Apps" },
  { path: "/insights", label: "Insights" },
  { path: "/incidents", label: "Incidents" },
  { path: "/timeline", label: "Timeline" },
  { path: "/uptime", label: "Uptime" },
  { path: "/alerts", label: "Alert rules" },
  { path: "/grafana", label: "Grafana" },
  { path: "/accounts", label: "Accounts" },
];

const MAX_ITEMS = 25;

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const snapshotQuery = useMonitorData();
  const accountsQuery = useAccounts();
  const checksQuery = useChecks();
  const rulesQuery = useRules();

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };
  const go = (path: string) => run(() => void navigate({ to: path }));
  const openUrl = (url: string) =>
    run(() => void monitorApi.openExternal(url).catch(() => undefined));

  const snapshot = snapshotQuery.data;
  const items = (snapshot?.items ?? []).slice(0, MAX_ITEMS);
  const incidents = (snapshot?.incidents ?? []).filter((i) => i.status !== "resolved").slice(0, MAX_ITEMS);
  const accounts = accountsQuery.data ?? [];
  const checks = checksQuery.data ?? [];
  const rules = rulesQuery.data ?? [];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Jump to anything">
      <CommandInput placeholder="Search views, accounts, items, checks, rules…" showIcon />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Go to">
          {NAV_ITEMS.map((nav) => (
            <CommandItem key={nav.path} value={`go ${nav.label}`} onSelect={() => go(nav.path)}>
              {nav.label}
            </CommandItem>
          ))}
        </CommandGroup>

        {accounts.length > 0 ? (
          <CommandGroup heading="Accounts">
            {accounts.map((account) => {
              const Icon = providerIcon(account.provider);
              return (
                <CommandItem
                  key={account.id}
                  value={`account ${account.label} ${account.identity ?? ""} ${providerLabel(account.provider)}`}
                  onSelect={() => go("/accounts")}
                >
                  <Icon className="size-4" />
                  {account.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {checks.length > 0 ? (
          <CommandGroup heading="Uptime checks">
            {checks.map((check) => (
              <CommandItem key={check.id} value={`check ${check.name} ${check.url}`} onSelect={() => go("/uptime")}>
                {check.name}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {rules.length > 0 ? (
          <CommandGroup heading="Alert rules">
            {rules.map((rule) => (
              <CommandItem key={rule.id} value={`rule ${rule.name}`} onSelect={() => go("/alerts")}>
                {rule.name}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {incidents.length > 0 ? (
          <CommandGroup heading="Incidents">
            {incidents.map((incident) => {
              const Icon = providerIcon(incident.provider);
              return (
                <CommandItem
                  key={incident.uid}
                  value={`incident ${incident.title} ${incident.subtitle}`}
                  onSelect={() => openUrl(incident.url)}
                >
                  <Icon className="size-4" />
                  {incident.title}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {items.length > 0 ? (
          <CommandGroup heading="Recent items">
            {items.map((item) => {
              const Icon = providerIcon(item.provider);
              return (
                <CommandItem
                  key={item.uid}
                  value={`item ${item.title} ${item.subtitle}`}
                  onSelect={() => openUrl(item.url)}
                >
                  <Icon className="size-4" />
                  {item.title}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
