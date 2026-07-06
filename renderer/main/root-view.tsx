import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import * as React from "react";
import { BellPlus, CircleHelp, Gauge, GitCommitHorizontal, LayoutDashboard, LineChart, PanelsTopLeft, Plug, Radio, Siren } from "lucide-react";
import { SplitView, Sidebar, SidebarList, SidebarListItem, Status } from "@glaze/core/components";
import { useTheme, useConnection, useEnvironment } from "@glaze/core/hooks";
import { CommandPalette } from "./components/command-palette";

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Command Center", icon: <Gauge className="size-4" />, shortcut: "1" },
  { path: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" />, shortcut: "2" },
  { path: "/apps", label: "Apps", icon: <PanelsTopLeft className="size-4" />, shortcut: "3" },
  { path: "/insights", label: "Insights", icon: <LineChart className="size-4" />, shortcut: "4" },
  { path: "/incidents", label: "Incidents", icon: <Siren className="size-4" />, shortcut: "5" },
  { path: "/timeline", label: "Timeline", icon: <GitCommitHorizontal className="size-4" />, shortcut: "6" },
  { path: "/uptime", label: "Uptime", icon: <Radio className="size-4" />, shortcut: "7" },
  { path: "/alerts", label: "Alert rules", icon: <BellPlus className="size-4" />, shortcut: "8" },
  { path: "/dashboards", label: "Dashboards", icon: <LayoutDashboard className="size-4" />, shortcut: "9" },
  { path: "/accounts", label: "Accounts", icon: <Plug className="size-4" />, shortcut: "0" },
  { path: "/help", label: "Help", icon: <CircleHelp className="size-4" /> },
];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function AppSidebar() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar>
      <SidebarList items={NAV_ITEMS} getItemKey={(item) => item.path}>
        {NAV_ITEMS.map((item) => (
          <SidebarListItem
            key={item.path}
            item={item}
            icon={item.icon}
            title={item.label}
            selected={pathname === item.path}
            onClick={() => navigate({ to: item.path })}
          />
        ))}
      </SidebarList>
    </Sidebar>
  );
}

export function RootView() {
  useTheme();

  const navigate = useNavigate();
  const connectionQuery = useConnection();
  const environmentQuery = useEnvironment();
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  React.useEffect(() => {
    return () => {
      window.glazeAPI?.glaze?.ipc?.disconnect();
    };
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && !isEditableTarget(event.target)) {
        const target = NAV_ITEMS.find((item) => item.shortcut === event.key);
        if (target) {
          event.preventDefault();
          void navigate({ to: target.path });
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return (
    <div className="h-full relative">
      <SplitView className="h-full" sidebar={<AppSidebar />} storageKey="cicd-monitor">
        <Outlet />
      </SplitView>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      <div className="flex flex-col items-end gap-1 mt-2 fixed bottom-12 right-2">
        {import.meta.env.DEV ? (
          <>
            {connectionQuery.error ? <Status variant="error">Backend disconnected</Status> : null}
            {environmentQuery.data ? null : <Status variant="error">Dev Server not found</Status>}
          </>
        ) : null}
      </div>
    </div>
  );
}
