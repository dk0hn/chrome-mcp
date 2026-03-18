import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionManager } from "../lib/session.js";
import { CDPClient } from "../lib/cdp.js";
import { defineTool, textResult, errorResult } from "../lib/tool-helper.js";

export function registerNetworkTools(
  server: McpServer,
  sessions: SessionManager,
  cdp: CDPClient
): void {
  defineTool(
    server,
    "list_requests",
    "List HTTP requests made by the selected tab. Collected since attachment.",
    {
      urlPattern: z.string().optional().describe("Filter requests by URL substring"),
      limit: z.number().optional().describe("Max results (default: 50, most recent first)"),
    },
    async ({ urlPattern, limit }) => {
      const session = await sessions.getSelectedSession();
      let requests = sessions.getNetworkRequests(session.targetId);

      if (urlPattern) {
        const pattern = urlPattern.toLowerCase();
        requests = requests.filter((r) => r.url.toLowerCase().includes(pattern));
      }

      requests = requests.slice().reverse().slice(0, limit ?? 50);

      if (requests.length === 0) {
        return textResult("No network requests found.");
      }

      const lines = requests.map((r) =>
        `${r.status} ${r.method} ${r.url.slice(0, 120)} [${r.mimeType}]`
      );

      return textResult(`${requests.length} request(s):\n${lines.join("\n")}`);
    }
  );

  defineTool(
    server,
    "get_request",
    "Get full details of a network request including headers and response body.",
    {
      requestId: z.string().describe("Request ID from list_requests"),
    },
    async ({ requestId }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      try {
        const body = await cdp.send<{ body: string; base64Encoded: boolean }>(
          "Network.getResponseBody",
          { requestId },
          sid
        );

        let bodyText = body.base64Encoded
          ? `[base64 encoded, ${body.body.length} chars]`
          : body.body;

        if (bodyText.length > 10000) {
          bodyText = bodyText.slice(0, 10000) + "\n\n... [truncated at 10000 chars]";
        }

        return textResult(`Response body:\n${bodyText}`);
      } catch (err) {
        return errorResult(`Could not get request body: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  defineTool(
    server,
    "intercept_request",
    "Enable request interception using the Fetch domain. Matching requests will be paused and can be mocked or modified.",
    {
      urlPattern: z.string().describe("URL pattern to intercept (e.g., '*/api/*')"),
      resourceType: z.string().optional().describe("Resource type filter (Document, Stylesheet, Script, XHR, Fetch, etc.)"),
      stage: z.enum(["Request", "Response"]).optional().describe("Intercept at request or response stage (default: Request)"),
    },
    async ({ urlPattern, resourceType, stage }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      const patterns: Record<string, unknown>[] = [{
        urlPattern,
        requestStage: stage ?? "Request",
      }];
      if (resourceType) {
        patterns[0].resourceType = resourceType;
      }

      await cdp.send("Fetch.enable", { patterns }, sid);

      return textResult(`Intercepting requests matching: ${urlPattern}`);
    }
  );

  defineTool(
    server,
    "mock_response",
    "Respond to an intercepted request with a mock response. Must have interception enabled via intercept_request first.",
    {
      requestId: z.string().describe("Intercepted request ID (from Fetch.requestPaused event)"),
      status: z.number().optional().describe("HTTP status code (default: 200)"),
      headers: z.array(z.object({
        name: z.string(),
        value: z.string(),
      })).optional().describe("Response headers"),
      body: z.string().optional().describe("Response body"),
    },
    async ({ requestId, status, headers, body }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      const params: Record<string, unknown> = {
        requestId,
        responseCode: status ?? 200,
      };

      if (headers) params.responseHeaders = headers;
      if (body) params.body = Buffer.from(body).toString("base64");

      await cdp.send("Fetch.fulfillRequest", params, sid);

      return textResult(`Responded to intercepted request with status ${status ?? 200}`);
    }
  );

  defineTool(
    server,
    "block_url",
    "Block requests matching a URL pattern.",
    {
      patterns: z.array(z.string()).describe("URL patterns to block (e.g., ['*.ads.com/*', '*/tracking/*'])"),
    },
    async ({ patterns }) => {
      const session = await sessions.getSelectedSession();
      await cdp.send("Network.setBlockedURLs", { urls: patterns }, session.sessionId);

      return textResult(`Blocking ${patterns.length} URL pattern(s): ${patterns.join(", ")}`);
    }
  );

  defineTool(
    server,
    "set_extra_headers",
    "Set additional HTTP headers to send with every request from this tab.",
    {
      headers: z.record(z.string()).describe("Headers as key-value pairs (e.g., {\"Authorization\": \"Bearer xxx\"})"),
    },
    async ({ headers }) => {
      const session = await sessions.getSelectedSession();
      await cdp.send("Network.setExtraHTTPHeaders", { headers }, session.sessionId);

      return textResult(`Set ${Object.keys(headers).length} extra header(s): ${Object.keys(headers).join(", ")}`);
    }
  );
}
