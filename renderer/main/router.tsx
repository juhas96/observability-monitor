import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { DashboardView } from "./dashboard-view";
import { AccountsView } from "./accounts-view";
import { RootView } from "./root-view";
import { QueryClient } from "@tanstack/react-query";
import { ErrorBoundaryView } from "@glaze/core/components";

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

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardView,
  staticData: {
    title: "Dashboard",
  },
});

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts",
  component: AccountsView,
  staticData: {
    title: "Accounts",
  },
});

const routeTree = rootRoute.addChildren([dashboardRoute, accountsRoute]);

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
