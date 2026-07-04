/**
 * Handler Registration
 *
 * Register all your IPC handlers here
 */

import * as path from "path";
import { fileURLToPath } from "url";

import { appHandlers } from "./app.js";
import { registerAccountHandlers } from "./accounts.js";
import { registerChannelHandlers } from "./channels.js";
import { registerCheckHandlers } from "./checks.js";
import { registerDashboardHandlers } from "./dashboards.js";
import { registerDiagnosticHandlers } from "./diagnostics.js";
import { registerGrafanaHandlers } from "./grafana.js";
import { registerHistoryHandlers } from "./history.js";
import { registerLocalIncidentHandlers } from "./local-incidents.js";
import { registerMonitorHandlers } from "./monitor.js";
import { registerProviderHandlers } from "./providers.js";
import { registerRuleHandlers } from "./rules.js";
import { registerServiceHandlers } from "./services.js";
import { registerSetupHandlers } from "./setup.js";
import { registerTriageHandlers } from "./triage.js";
import { registerVerificationHandlers } from "./verification.js";
import { registerProviders } from "../services/providers/index.js";
import { getSettingsWindow, openSettingsWindow } from "../windows/settings-window.js";

import { ipcMain, logger } from "@glaze/core/backend";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function registerHandlers(): void {
  logger.info("handlers", "Registering IPC handlers...");

  // Populate the provider registry before any handler or the poller runs.
  registerProviders();

  // Register app handlers using ipcMain API
  ipcMain.handle("app:getInfo", async (_event) => {
    return await appHandlers.getInfo();
  });

  // Return the .glaze project path (used for deep links back to the host)
  // __dirname = build/main, so two levels up is the app root
  ipcMain.handle("app:getProjectPath", async () => {
    return path.join(__dirname, "..", "..");
  });

  // Settings window handlers
  ipcMain.handle("window:openSettings", async (_event) => {
    await openSettingsWindow();
  });

  ipcMain.handle("window:closeSettings", async (_event) => {
    getSettingsWindow()?.close();
  });

  // CI/CD Monitor handlers
  registerAccountHandlers();
  registerChannelHandlers();
  registerCheckHandlers();
  registerDashboardHandlers();
  registerDiagnosticHandlers();
  registerGrafanaHandlers();
  registerHistoryHandlers();
  registerLocalIncidentHandlers();
  registerMonitorHandlers();
  registerProviderHandlers();
  registerRuleHandlers();
  registerServiceHandlers();
  registerSetupHandlers();
  registerTriageHandlers();
  registerVerificationHandlers();

  logger.info("handlers", "✓ IPC handlers registered");
}
