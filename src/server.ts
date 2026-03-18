import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CDPClient } from "./lib/cdp.js";
import { SessionManager } from "./lib/session.js";
import { findChromeConnection } from "./lib/connection.js";
import { registerTabTools } from "./tools/tabs.js";
import { registerNavigationTools } from "./tools/navigation.js";
import { registerInspectTools } from "./tools/inspect.js";
import { registerInputTools } from "./tools/input.js";
import { registerConsoleTools } from "./tools/console.js";
import { registerNetworkTools } from "./tools/network.js";
import { registerStorageTools } from "./tools/storage.js";
import { registerEmulationTools } from "./tools/emulation.js";
import { registerPerformanceTools } from "./tools/performance.js";
import { registerServiceWorkerTools } from "./tools/serviceworker.js";
import { registerAdvancedTools } from "./tools/advanced.js";
import { log, logError } from "./lib/logger.js";

export async function createServer(): Promise<McpServer> {
  const server = new McpServer({
    name: "chrome-mcp",
    version: "0.1.0",
  });

  // Connect to Chrome
  const connection = await findChromeConnection();
  log(`Connecting to Chrome at ${connection.wsUrl}`);

  const cdp = new CDPClient();
  await cdp.connect(connection.wsUrl, true);
  log("Connected to Chrome");

  // Set up session manager
  const sessions = new SessionManager(cdp);
  await sessions.init();
  log("Session manager initialized");

  // Wire up reconnection: re-init sessions when Chrome reconnects
  cdp.onReconnect = async () => {
    sessions.reset();
    await sessions.init();
    log("Reconnected and session manager re-initialized");
  };

  // Register all tools
  registerTabTools(server, sessions, cdp);
  registerNavigationTools(server, sessions, cdp);
  registerInspectTools(server, sessions, cdp);
  registerInputTools(server, sessions, cdp);
  registerConsoleTools(server, sessions, cdp);
  registerNetworkTools(server, sessions, cdp);
  registerStorageTools(server, sessions, cdp);
  registerEmulationTools(server, sessions, cdp);
  registerPerformanceTools(server, sessions, cdp);
  registerServiceWorkerTools(server, sessions, cdp);
  registerAdvancedTools(server, sessions, cdp);

  log("All tools registered");

  // Handle cleanup
  process.on("SIGINT", () => {
    log("Shutting down (SIGINT)");
    cdp.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log("Shutting down (SIGTERM)");
    cdp.disconnect();
    process.exit(0);
  });

  // Catch unhandled errors
  process.on("uncaughtException", (err) => {
    logError("Uncaught exception", err);
  });

  process.on("unhandledRejection", (err) => {
    logError("Unhandled rejection", err);
  });

  return server;
}
