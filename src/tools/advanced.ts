import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionManager } from "../lib/session.js";
import { CDPClient } from "../lib/cdp.js";
import { defineTool, textResult, errorResult } from "../lib/tool-helper.js";

export function registerAdvancedTools(
  server: McpServer,
  sessions: SessionManager,
  cdp: CDPClient
): void {
  defineTool(
    server,
    "raw_cdp",
    "Send any raw Chrome DevTools Protocol command. This is the escape hatch for any CDP capability not covered by other tools. See https://chromedevtools.github.io/devtools-protocol/ for the full protocol reference.",
    {
      method: z.string().describe("CDP method (e.g., 'Browser.getVersion', 'DOM.getDocument')"),
      params: z.record(z.unknown()).optional().describe("CDP command parameters as JSON object"),
      useSession: z.boolean().optional().describe("Send via the selected tab session (default: true). Set false for browser-level commands."),
    },
    async ({ method, params, useSession }) => {
      const sendToSession = useSession ?? true;

      let sessionId: string | undefined;
      if (sendToSession) {
        const session = await sessions.getSelectedSession();
        sessionId = session.sessionId;
      }

      try {
        const result = await cdp.send(
          method,
          params ?? {},
          sessionId
        );
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return errorResult(
          `CDP command failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  defineTool(
    server,
    "get_computed_styles",
    "Get the computed CSS styles for an element.",
    {
      selector: z.string().describe("CSS selector of the element"),
      properties: z.array(z.string()).optional().describe(
        "Specific CSS properties to return (default: all)"
      ),
    },
    async ({ selector, properties }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      const expression = properties
        ? `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            const cs = getComputedStyle(el);
            return Object.fromEntries(${JSON.stringify(properties)}.map(p => [p, cs.getPropertyValue(p)]));
          })()`
        : `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            const cs = getComputedStyle(el);
            const result = {};
            for (const prop of cs) {
              const val = cs.getPropertyValue(prop);
              if (val && val !== 'initial' && val !== 'none' && val !== 'normal' && val !== '0px' && val !== 'auto') {
                result[prop] = val;
              }
            }
            return result;
          })()`;

      const result = await cdp.send<{
        result: { value: Record<string, string> | null };
      }>(
        "Runtime.evaluate",
        { expression, returnByValue: true },
        sid
      );

      if (!result.result.value) {
        return errorResult(`Element not found: ${selector}`);
      }

      const styles = result.result.value;
      const lines = Object.entries(styles).map(([k, v]) => `${k}: ${v}`);

      return textResult(
        lines.length > 0
          ? `Computed styles for "${selector}":\n${lines.join("\n")}`
          : "No significant computed styles found."
      );
    }
  );

  defineTool(
    server,
    "get_security_info",
    "Get TLS/SSL certificate and security information for the current page.",
    {},
    async () => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      // Get security state via the page's Security domain
      try {
        await cdp.send("Security.enable", {}, sid);
        const state = await cdp.send<{
          result: {
            value: {
              protocol: string;
              host: string;
              isSecure: boolean;
            };
          };
        }>(
          "Runtime.evaluate",
          {
            expression: `({
              protocol: location.protocol,
              host: location.host,
              isSecure: location.protocol === 'https:',
            })`,
            returnByValue: true,
          },
          sid
        );

        const info = state.result.value;

        // Try to get certificate details via Network domain
        const certInfo = await cdp.send<{
          result: {
            value: {
              serverCert: string;
            } | null;
          };
        }>(
          "Runtime.evaluate",
          {
            expression: `(async () => {
              try {
                const r = await fetch(location.href, { method: 'HEAD' });
                return { serverCert: r.headers.get('strict-transport-security') || 'none' };
              } catch { return null; }
            })()`,
            returnByValue: true,
            awaitPromise: true,
          },
          sid
        );

        const lines = [
          `Protocol: ${info.protocol}`,
          `Host: ${info.host}`,
          `Secure: ${info.isSecure ? "Yes (HTTPS)" : "No (HTTP)"}`,
        ];

        if (certInfo.result.value) {
          lines.push(`HSTS: ${certInfo.result.value.serverCert}`);
        }

        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult(`Failed to get security info: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  defineTool(
    server,
    "list_websocket_frames",
    "List WebSocket connections and recent frames for the selected tab.",
    {
      urlFilter: z.string().optional().describe("Filter WebSocket connections by URL"),
    },
    async ({ urlFilter }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      // WebSocket frames are captured via Network domain events
      // We need to evaluate in the page context to find active connections
      const result = await cdp.send<{
        result: { value: string };
      }>(
        "Runtime.evaluate",
        {
          expression: `(() => {
            // Check for performance entries of type "resource" with initiatorType "websocket"
            const wsEntries = performance.getEntriesByType('resource')
              .filter(e => e.name.startsWith('ws://') || e.name.startsWith('wss://'));
            return JSON.stringify(wsEntries.map(e => ({
              url: e.name,
              startTime: e.startTime,
              duration: e.duration,
            })));
          })()`,
          returnByValue: true,
        },
        sid
      );

      const entries = JSON.parse(result.result.value) as Array<{
        url: string;
        startTime: number;
        duration: number;
      }>;

      let filtered = entries;
      if (urlFilter) {
        const pattern = urlFilter.toLowerCase();
        filtered = entries.filter((e) => e.url.toLowerCase().includes(pattern));
      }

      if (filtered.length === 0) {
        return textResult("No WebSocket connections found.");
      }

      const lines = filtered.map(
        (e) => `${e.url} (started: ${e.startTime.toFixed(0)}ms, duration: ${e.duration.toFixed(0)}ms)`
      );

      return textResult(`${filtered.length} WebSocket connection(s):\n${lines.join("\n")}`);
    }
  );
}
