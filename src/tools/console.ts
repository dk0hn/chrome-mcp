import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionManager } from "../lib/session.js";
import { CDPClient } from "../lib/cdp.js";
import { defineTool, defineSimpleTool, textResult } from "../lib/tool-helper.js";

export function registerConsoleTools(
  server: McpServer,
  sessions: SessionManager,
  _cdp: CDPClient
): void {
  defineTool(
    server,
    "list_console",
    "List console messages from the selected tab. Collected since the tab was attached.",
    {
      level: z.enum(["log", "warn", "error", "info", "debug"]).optional()
        .describe("Filter by log level"),
      pattern: z.string().optional()
        .describe("Filter by regex pattern matching the message text"),
      limit: z.number().optional()
        .describe("Max messages to return (default: 50, most recent first)"),
    },
    async ({ level, pattern, limit }) => {
      const session = await sessions.getSelectedSession();
      let messages = sessions.getConsoleMessages(session.targetId);

      if (level) {
        messages = messages.filter((m) => m.type === level);
      }

      if (pattern) {
        const re = new RegExp(pattern, "i");
        messages = messages.filter((m) => re.test(m.text));
      }

      // Most recent first
      messages = messages.slice().reverse().slice(0, limit ?? 50);

      if (messages.length === 0) {
        return textResult("No console messages found.");
      }

      const lines = messages.map((m) => {
        const time = new Date(m.timestamp).toISOString().split("T")[1].replace("Z", "");
        return `[${time}] ${m.type.toUpperCase()}: ${m.text}`;
      });

      return textResult(`${messages.length} console message(s):\n${lines.join("\n")}`);
    }
  );

  defineTool(
    server,
    "get_console_message",
    "Get a specific console message by index (0 = most recent).",
    {
      index: z.number().describe("Message index (0 = most recent)"),
    },
    async ({ index }) => {
      const session = await sessions.getSelectedSession();
      const messages = sessions.getConsoleMessages(session.targetId);
      const reversed = messages.slice().reverse();

      if (index < 0 || index >= reversed.length) {
        return textResult(`Index ${index} out of range. ${reversed.length} messages available.`);
      }

      const m = reversed[index];
      return textResult(
        `Type: ${m.type}\nTime: ${new Date(m.timestamp).toISOString()}\nMessage: ${m.text}`
      );
    }
  );

  defineSimpleTool(
    server,
    "clear_console",
    "Clear collected console messages for the selected tab.",
    async () => {
      const session = await sessions.getSelectedSession();
      sessions.clearConsoleMessages(session.targetId);
      return textResult("Console messages cleared.");
    }
  );
}
