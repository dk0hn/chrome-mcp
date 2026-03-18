import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CDPClient } from "./lib/cdp.js";
import { SessionManager } from "./lib/session.js";
import { findDevToolsActivePort } from "./lib/connection.js";
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

export async function createServer(): Promise<McpServer> {
  const server = new McpServer({
    name: "chrome-mcp",
    version: "0.1.0",
  });

  // Connect to Chrome
  const connection = findDevToolsActivePort();
  console.error(`[chrome-mcp] Connecting to Chrome at ${connection.wsUrl}`);

  const cdp = new CDPClient();
  await cdp.connect(connection.wsUrl);
  console.error("[chrome-mcp] Connected to Chrome");

  // Set up session manager
  const sessions = new SessionManager(cdp);
  await sessions.init();
  console.error("[chrome-mcp] Session manager initialized");

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

  console.error("[chrome-mcp] All tools registered");

  // Handle cleanup
  process.on("SIGINT", () => {
    console.error("[chrome-mcp] Shutting down...");
    cdp.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cdp.disconnect();
    process.exit(0);
  });

  return server;
}
