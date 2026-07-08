import * as React from "react";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { DashboardView } from "./dashboard-view";
import { CommandCenterView } from "./command-center-view";
import { RootView } from "./root-view";
import { QueryClient } from "@tanstack/react-query";
import { ErrorBoundaryView } from "@glaze/core/components";

// Secondary data-heavy views are code-split so the main dashboard stays light.
const AccountsView = React.lazy(() => import("./accounts-view").then((m) => ({ default: m.AccountsView })));
const AlertsView = React.lazy(() => import("./alerts-view").then((m) => ({ default: m.AlertsView })));
const AppsView = React.lazy(() => import("./apps-view").then((m) => ({ default: m.AppsView })));
const InsightsView = React.lazy(() => import("./insights-view").then((m) => ({ default: m.InsightsView })));
const IncidentsView = React.lazy(() => import("./incidents-view").then((m) => ({ default: m.IncidentsView })));
const PipelinesView = React.lazy(() => import("./pipelines-view").then((m) => ({ default: m.PipelinesView })));
const ProviderWorkspaceView = React.lazy(() => import("./provider-workspace-view").then((m) => ({ default: m.ProviderWorkspaceView })));
const TimelineView = React.lazy(() => import("./timeline-view").then((m) => ({ default: m.TimelineView })));
const DashboardsView = React.lazy(() => import("./dashboards-view").then((m) => ({ default: m.DashboardsView })));
const HelpView = React.lazy(() => import("./help-view").then((m) => ({ default: m.HelpView })));
const UptimeView = React.lazy(() => import("./uptime-view").then((m) => ({ default: m.UptimeView })));

function RouteFallback() {
  return <div className="flex h-full items-center justify-center text-tertiary">Loading…</div>;
}

function withSuspense(Component: React.ComponentType) {
  return function SuspendedRoute() {
    return (
      <React.Suspense fallback={<RouteFallback />}>
        <Component />
      </React.Suspense>
    );
  };
}

const rootRoute = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootView,
  errorComponent: ErrorBoundaryView,
  notFoundComponent: () => {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <div className="drag-region fixed top-0 left-0 right-0 h-13" />
        <p className="text-secondary">Route not found</p>
      </div>
    );
  },
});

const commandCenterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: CommandCenterView,
  staticData: {
    title: "Command Center",
  },
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  component: DashboardView,
  staticData: {
    title: "Dashboard",
  },
});

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts",
  component: withSuspense(AccountsView),
  staticData: {
    title: "Accounts",
  },
});

const appsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps",
  component: withSuspense(AppsView),
  staticData: {
    title: "Services",
  },
});

const pipelinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pipelines",
  component: withSuspense(PipelinesView),
  staticData: {
    title: "Pipelines",
  },
});

const providersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/providers",
  component: withSuspense(ProviderWorkspaceView),
  staticData: {
    title: "Providers",
  },
});

const dashboardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboards",
  component: withSuspense(DashboardsView),
  staticData: {
    title: "Dashboards",
  },
});

const insightsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/insights",
  component: withSuspense(InsightsView),
  staticData: {
    title: "Insights",
  },
});

const incidentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/incidents",
  component: withSuspense(IncidentsView),
  staticData: {
    title: "Incidents",
  },
});

const timelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/timeline",
  component: withSuspense(TimelineView),
  staticData: {
    title: "Timeline",
  },
});

const uptimeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/uptime",
  component: withSuspense(UptimeView),
  staticData: {
    title: "Uptime",
  },
});

const alertsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/alerts",
  component: withSuspense(AlertsView),
  staticData: {
    title: "Alert rules",
  },
});

const helpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/help",
  component: withSuspense(HelpView),
  staticData: {
    title: "Help",
  },
});

const routeTree = rootRoute.addChildren([
  commandCenterRoute,
  dashboardRoute,
  appsRoute,
  pipelinesRoute,
  providersRoute,
  insightsRoute,
  incidentsRoute,
  timelineRoute,
  uptimeRoute,
  alertsRoute,
  dashboardsRoute,
  accountsRoute,
  helpRoute,
]);

const queryClient = new QueryClient();

const router = createRouter({
  routeTree,
  history: createMemoryHistory(),
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  context: {
    queryClient,
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    title?: string;
    component?: any;
  }
}

export { router, queryClient };
