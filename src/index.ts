#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[chrome-mcp] MCP server running on stdio");
}

main().catch((err) => {
  console.error("[chrome-mcp] Fatal error:", err);
  process.exit(1);
});
