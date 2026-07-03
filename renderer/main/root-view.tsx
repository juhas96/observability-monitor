import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import * as React from "react";
import { BellPlus, BellRing, GitCommitHorizontal, LayoutDashboard, LineChart, PanelsTopLeft, Plug, Radio, Siren } from "lucide-react";
import { SplitView, Sidebar, SidebarList, SidebarListItem, Status } from "@glaze/core/components";
import { useTheme, useConnection, useEnvironment } from "@glaze/core/hooks";
import { CommandPalette } from "./components/command-palette";

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
  { path: "/apps", label: "Apps", icon: <PanelsTopLeft className="size-4" /> },
  { path: "/insights", label: "Insights", icon: <LineChart className="size-4" /> },
  { path: "/incidents", label: "Incidents", icon: <Siren className="size-4" /> },
  { path: "/timeline", label: "Timeline", icon: <GitCommitHorizontal className="size-4" /> },
  { path: "/uptime", label: "Uptime", icon: <Radio className="size-4" /> },
  { path: "/alerts", label: "Alert rules", icon: <BellPlus className="size-4" /> },
  { path: "/grafana", label: "Grafana", icon: <BellRing className="size-4" /> },
  { path: "/accounts", label: "Accounts", icon: <Plug className="size-4" /> },
];

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
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
