import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionManager } from "../lib/session.js";
import { CDPClient } from "../lib/cdp.js";
import { defineTool, defineSimpleTool, textResult, errorResult } from "../lib/tool-helper.js";

export function registerServiceWorkerTools(
  server: McpServer,
  sessions: SessionManager,
  cdp: CDPClient
): void {
  defineSimpleTool(
    server,
    "list_service_workers",
    "List all registered service workers.",
    async () => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      const result = await cdp.send<{
        result: {
          value: Array<{
            scope: string;
            scriptURL: string;
            state: string;
          }> | null;
        };
      }>(
        "Runtime.evaluate",
        {
          expression: `(async () => {
            const registrations = await navigator.serviceWorker.getRegistrations();
            return registrations.map(r => ({
              scope: r.scope,
              scriptURL: (r.active || r.waiting || r.installing)?.scriptURL || 'unknown',
              state: r.active ? 'active' : r.waiting ? 'waiting' : r.installing ? 'installing' : 'unknown'
            }));
          })()`,
          returnByValue: true,
          awaitPromise: true,
        },
        sid
      );

      const workers = result.result.value;
      if (!workers || workers.length === 0) {
        return textResult("No service workers registered.");
      }

      const lines = workers.map(
        (w) => `${w.state}: ${w.scriptURL} (scope: ${w.scope})`
      );

      return textResult(`${workers.length} service worker(s):\n${lines.join("\n")}`);
    }
  );

  defineTool(
    server,
    "unregister_sw",
    "Unregister a service worker by its scope URL.",
    {
      scope: z.string().describe("Service worker scope URL to unregister"),
    },
    async ({ scope }) => {
      const session = await sessions.getSelectedSession();

      const result = await cdp.send<{ result: { value: boolean } }>(
        "Runtime.evaluate",
        {
          expression: `(async () => {
            const registrations = await navigator.serviceWorker.getRegistrations();
            const reg = registrations.find(r => r.scope === ${JSON.stringify(scope)});
            if (!reg) return false;
            return await reg.unregister();
          })()`,
          returnByValue: true,
          awaitPromise: true,
        },
        session.sessionId
      );

      return result.result.value
        ? textResult(`Unregistered service worker: ${scope}`)
        : errorResult(`No service worker found with scope: ${scope}`);
    }
  );

  defineTool(
    server,
    "push_message",
    "Send a push message to a service worker via the ServiceWorker CDP domain.",
    {
      origin: z.string().describe("Origin of the service worker"),
      registrationId: z.string().describe("Registration ID"),
      data: z.string().describe("Push message data (string)"),
    },
    async ({ origin, registrationId, data }) => {
      const session = await sessions.getSelectedSession();

      try {
        await cdp.send(
          "ServiceWorker.deliverPushMessage",
          { origin, registrationId, data },
          session.sessionId
        );
        return textResult(`Push message sent to SW at ${origin}`);
      } catch (err) {
        return errorResult(`Failed to send push: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  defineSimpleTool(
    server,
    "skip_waiting",
    "Force a waiting service worker to activate immediately.",
    async () => {
      const session = await sessions.getSelectedSession();

      const result = await cdp.send<{ result: { value: boolean } }>(
        "Runtime.evaluate",
        {
          expression: `(async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg?.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
              return true;
            }
            return false;
          })()`,
          returnByValue: true,
          awaitPromise: true,
        },
        session.sessionId
      );

      return result.result.value
        ? textResult("Sent SKIP_WAITING to waiting service worker.")
        : textResult("No waiting service worker found.");
    }
  );
}
