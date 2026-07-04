/**
 * App-level IPC methods.
 */

import { logger } from "@glaze/core/backend";

export const appHandlers = {
  getInfo: async () => {
    logger.info("app", "App info requested");
    return {
      name: "Multi Monitor",
      packageName: "observability-monitor",
      version: "1.0.0",
      environment: process.env.NODE_ENV || "production",
    };
  },
};
