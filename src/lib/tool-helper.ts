/**
 * Thin wrapper around McpServer.registerTool to reduce boilerplate.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";

export function defineTool<T extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: T,
  cb: ToolCallback<T>
): void {
  server.registerTool(name, { description, inputSchema }, cb);
}

export function defineSimpleTool(
  server: McpServer,
  name: string,
  description: string,
  cb: ToolCallback
): void {
  server.registerTool(name, { description }, cb);
}

export function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

export function errorResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    isError: true,
  };
}

export function imageResult(data: string, mimeType = "image/png") {
  return {
    content: [{ type: "image" as const, data, mimeType }],
  };
}
