import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import * as React from "react";
import { LayoutDashboard, Plug } from "lucide-react";
import { SplitView, Sidebar, SidebarList, SidebarListItem, Status } from "@glaze/core/components";
import { useTheme, useConnection, useEnvironment } from "@glaze/core/hooks";

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
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

  React.useEffect(() => {
    return () => {
      window.glazeAPI?.glaze?.ipc?.disconnect();
    };
  }, []);

  return (
    <div className="h-full relative">
      <SplitView className="h-full" sidebar={<AppSidebar />} storageKey="cicd-monitor">
        <Outlet />
      </SplitView>

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
