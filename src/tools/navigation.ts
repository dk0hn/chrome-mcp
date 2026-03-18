import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionManager } from "../lib/session.js";
import { CDPClient } from "../lib/cdp.js";
import { defineTool, defineSimpleTool, textResult, errorResult } from "../lib/tool-helper.js";

export function registerNavigationTools(
  server: McpServer,
  sessions: SessionManager,
  cdp: CDPClient
): void {
  defineTool(
    server,
    "navigate",
    "Navigate the selected tab to a URL. Waits for the page to load.",
    {
      url: z.string().describe("URL to navigate to"),
      waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional()
        .describe("When to consider navigation complete (default: load)"),
    },
    async ({ url, waitUntil }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      const navPromise = cdp.send<{ frameId: string }>("Page.navigate", { url }, sid);

      if (waitUntil === "networkidle") {
        await navPromise;
        await waitForNetworkIdle(cdp, 30000);
      } else {
        const eventName = waitUntil === "domcontentloaded"
          ? "Page.domContentEventFired"
          : "Page.loadEventFired";
        await Promise.all([navPromise, waitForEvent(cdp, eventName, 30000)]);
      }

      return textResult(`Navigated to: ${url}`);
    }
  );

  defineSimpleTool(server, "go_back", "Navigate back in browser history.", async () => {
    const session = await sessions.getSelectedSession();
    const history = await cdp.send<{
      currentIndex: number;
      entries: Array<{ id: number; url: string; title: string }>;
    }>("Page.getNavigationHistory", {}, session.sessionId);

    if (history.currentIndex <= 0) return errorResult("No previous page in history.");

    const entry = history.entries[history.currentIndex - 1];
    await cdp.send("Page.navigateToHistoryEntry", { entryId: entry.id }, session.sessionId);
    await waitForEvent(cdp, "Page.loadEventFired", 30000);

    return textResult(`Went back to: ${entry.title} (${entry.url})`);
  });

  defineSimpleTool(server, "go_forward", "Navigate forward in browser history.", async () => {
    const session = await sessions.getSelectedSession();
    const history = await cdp.send<{
      currentIndex: number;
      entries: Array<{ id: number; url: string; title: string }>;
    }>("Page.getNavigationHistory", {}, session.sessionId);

    if (history.currentIndex >= history.entries.length - 1) {
      return errorResult("No next page in history.");
    }

    const entry = history.entries[history.currentIndex + 1];
    await cdp.send("Page.navigateToHistoryEntry", { entryId: entry.id }, session.sessionId);
    await waitForEvent(cdp, "Page.loadEventFired", 30000);

    return textResult(`Went forward to: ${entry.title} (${entry.url})`);
  });

  defineTool(
    server,
    "reload",
    "Reload the selected tab.",
    {
      ignoreCache: z.boolean().optional().describe("Bypass cache (hard reload)"),
    },
    async ({ ignoreCache }) => {
      const session = await sessions.getSelectedSession();
      await cdp.send("Page.reload", { ignoreCache: ignoreCache ?? false }, session.sessionId);
      await waitForEvent(cdp, "Page.loadEventFired", 30000);
      return textResult("Page reloaded.");
    }
  );

  defineTool(
    server,
    "wait_for",
    "Wait for a condition: text appearing, a CSS selector existing, or network idle.",
    {
      text: z.string().optional().describe("Wait until this text appears on the page"),
      selector: z.string().optional().describe("Wait until this CSS selector matches an element"),
      networkIdle: z.boolean().optional().describe("Wait until no network requests for 500ms"),
      timeout: z.number().optional().describe("Max wait time in ms (default: 10000)"),
    },
    async ({ text, selector, networkIdle, timeout }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;
      const maxWait = timeout ?? 10000;

      if (networkIdle) {
        await waitForNetworkIdle(cdp, maxWait);
        return textResult("Network is idle.");
      }

      if (text || selector) {
        const startTime = Date.now();
        while (Date.now() - startTime < maxWait) {
          const js = text
            ? `document.body?.innerText?.includes(${JSON.stringify(text)}) ?? false`
            : `!!document.querySelector(${JSON.stringify(selector)})`;

          const result = await cdp.send<{ result: { value: boolean } }>(
            "Runtime.evaluate", { expression: js, returnByValue: true }, sid
          );

          if (result.result.value) {
            return textResult(text ? `Text "${text}" found.` : `Selector "${selector}" found.`);
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        return errorResult(`Timed out after ${maxWait}ms.`);
      }

      return errorResult("Specify text, selector, or networkIdle.");
    }
  );
}

function waitForEvent(cdp: CDPClient, eventName: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cdp.off(eventName, handler);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeout);

    const handler = () => {
      clearTimeout(timer);
      cdp.off(eventName, handler);
      resolve();
    };

    cdp.on(eventName, handler);
  });
}

async function waitForNetworkIdle(cdp: CDPClient, timeout = 30000): Promise<void> {
  return new Promise((resolve) => {
    let inflight = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const maxTimer = setTimeout(() => { cleanup(); resolve(); }, timeout);

    const onRequest = () => {
      inflight++;
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    };

    const onDone = () => {
      inflight = Math.max(0, inflight - 1);
      if (inflight === 0) {
        idleTimer = setTimeout(() => { cleanup(); resolve(); }, 500);
      }
    };

    const cleanup = () => {
      clearTimeout(maxTimer);
      if (idleTimer) clearTimeout(idleTimer);
      cdp.off("Network.requestWillBeSent", onRequest);
      cdp.off("Network.loadingFinished", onDone);
      cdp.off("Network.loadingFailed", onDone);
    };

    cdp.on("Network.requestWillBeSent", onRequest);
    cdp.on("Network.loadingFinished", onDone);
    cdp.on("Network.loadingFailed", onDone);

    idleTimer = setTimeout(() => { cleanup(); resolve(); }, 500);
  });
}
