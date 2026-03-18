import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionManager } from "../lib/session.js";
import { CDPClient } from "../lib/cdp.js";
import { defineTool, textResult, errorResult } from "../lib/tool-helper.js";

export function registerTabTools(
  server: McpServer,
  sessions: SessionManager,
  cdp: CDPClient
): void {
  defineTool(
    server,
    "list_tabs",
    "List open browser tabs. Returns tab ID, title, and URL. Use filter to search by title or URL pattern.",
    {
      filter: z.string().optional().describe("Filter by title or URL (case-insensitive)"),
      limit: z.number().optional().describe("Max tabs to return (default: 20)"),
      offset: z.number().optional().describe("Skip N tabs for pagination"),
    },
    async ({ filter, limit, offset }) => {
      const tabs = await sessions.listTabs({
        filter,
        limit: limit ?? 20,
        offset,
      });

      const selected = sessions.getSelectedTabId();
      const lines = tabs.map((t) => {
        const marker = t.targetId === selected ? " [SELECTED]" : "";
        return `${t.targetId.slice(0, 8)}  ${t.title}  ${t.url}${marker}`;
      });

      return textResult(
        lines.length > 0
          ? `${lines.length} tab(s):\n${lines.join("\n")}`
          : "No tabs found matching filter."
      );
    }
  );

  defineTool(
    server,
    "select_tab",
    "Select a tab to work with. All subsequent commands target this tab.",
    {
      targetId: z.string().describe("Tab target ID (or prefix from list_tabs)"),
    },
    async ({ targetId }) => {
      const tabs = await sessions.listTabs();
      const match = tabs.find((t) => t.targetId.startsWith(targetId));
      if (!match) {
        return errorResult(`No tab found matching "${targetId}". Use list_tabs first.`);
      }

      sessions.selectTab(match.targetId);
      await sessions.getSession(match.targetId);

      return textResult(`Selected tab: ${match.title} (${match.url})`);
    }
  );

  defineTool(
    server,
    "new_tab",
    "Open a new browser tab, optionally navigating to a URL.",
    {
      url: z.string().optional().describe("URL to navigate to (default: about:blank)"),
    },
    async ({ url }) => {
      const result = await cdp.send<{ targetId: string }>(
        "Target.createTarget",
        { url: url ?? "about:blank" }
      );

      sessions.selectTab(result.targetId);
      await sessions.getSession(result.targetId);

      return textResult(`Opened new tab: ${result.targetId.slice(0, 8)} → ${url ?? "about:blank"}`);
    }
  );

  defineTool(
    server,
    "close_tab",
    "Close a browser tab by its target ID.",
    {
      targetId: z.string().describe("Tab target ID to close (or prefix)"),
    },
    async ({ targetId }) => {
      const tabs = await sessions.listTabs();
      const match = tabs.find((t) => t.targetId.startsWith(targetId));
      if (!match) return errorResult(`No tab found matching "${targetId}".`);
      if (tabs.length <= 1) return errorResult("Cannot close the last remaining tab.");

      await sessions.detach(match.targetId);
      await cdp.send("Target.closeTarget", { targetId: match.targetId });

      return textResult(`Closed tab: ${match.title}`);
    }
  );
}
