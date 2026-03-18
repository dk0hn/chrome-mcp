import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionManager } from "../lib/session.js";
import { CDPClient } from "../lib/cdp.js";
import { defineTool, textResult } from "../lib/tool-helper.js";

export function registerStorageTools(
  server: McpServer,
  sessions: SessionManager,
  cdp: CDPClient
): void {
  // --- Cookies ---

  defineTool(
    server,
    "get_cookies",
    "Get cookies for the selected tab's domain, or all cookies.",
    {
      urls: z.array(z.string()).optional().describe("Specific URLs to get cookies for (default: current page URL)"),
    },
    async ({ urls }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      const params: Record<string, unknown> = {};
      if (urls) params.urls = urls;

      const result = await cdp.send<{
        cookies: Array<{
          name: string;
          value: string;
          domain: string;
          path: string;
          expires: number;
          httpOnly: boolean;
          secure: boolean;
          sameSite: string;
        }>;
      }>("Network.getCookies", params, sid);

      if (result.cookies.length === 0) {
        return textResult("No cookies found.");
      }

      const lines = result.cookies.map((c) => {
        const flags = [
          c.httpOnly ? "HttpOnly" : "",
          c.secure ? "Secure" : "",
          c.sameSite !== "None" ? `SameSite=${c.sameSite}` : "",
        ].filter(Boolean).join(", ");
        const val = c.value.length > 60 ? c.value.slice(0, 60) + "..." : c.value;
        return `${c.name}=${val}  (${c.domain}${c.path}) [${flags}]`;
      });

      return textResult(`${result.cookies.length} cookie(s):\n${lines.join("\n")}`);
    }
  );

  defineTool(
    server,
    "set_cookie",
    "Set a cookie.",
    {
      name: z.string().describe("Cookie name"),
      value: z.string().describe("Cookie value"),
      domain: z.string().optional().describe("Cookie domain (default: current page domain)"),
      path: z.string().optional().describe("Cookie path (default: /)"),
      httpOnly: z.boolean().optional().describe("HttpOnly flag"),
      secure: z.boolean().optional().describe("Secure flag"),
      sameSite: z.enum(["Strict", "Lax", "None"]).optional().describe("SameSite attribute"),
      expires: z.number().optional().describe("Expiration timestamp (seconds since epoch)"),
    },
    async ({ name, value, domain, path, httpOnly, secure, sameSite, expires }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      // Get current URL for default domain
      if (!domain) {
        const evalResult = await cdp.send<{ result: { value: string } }>(
          "Runtime.evaluate",
          { expression: "window.location.hostname", returnByValue: true },
          sid
        );
        domain = evalResult.result.value;
      }

      const params: Record<string, unknown> = {
        name,
        value,
        domain,
        path: path ?? "/",
      };
      if (httpOnly !== undefined) params.httpOnly = httpOnly;
      if (secure !== undefined) params.secure = secure;
      if (sameSite) params.sameSite = sameSite;
      if (expires) params.expires = expires;

      await cdp.send("Network.setCookie", params, sid);

      return textResult(`Cookie set: ${name}=${value.slice(0, 30)}${value.length > 30 ? "..." : ""}`);
    }
  );

  defineTool(
    server,
    "delete_cookies",
    "Delete cookies by name and optional domain.",
    {
      name: z.string().describe("Cookie name to delete"),
      domain: z.string().optional().describe("Cookie domain (default: current page domain)"),
    },
    async ({ name, domain }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      if (!domain) {
        const evalResult = await cdp.send<{ result: { value: string } }>(
          "Runtime.evaluate",
          { expression: "window.location.hostname", returnByValue: true },
          sid
        );
        domain = evalResult.result.value;
      }

      await cdp.send("Network.deleteCookies", { name, domain }, sid);

      return textResult(`Deleted cookie: ${name} (${domain})`);
    }
  );

  // --- localStorage ---

  defineTool(
    server,
    "get_local_storage",
    "Read localStorage keys and values for the selected tab.",
    {
      key: z.string().optional().describe("Specific key to read (default: all keys)"),
    },
    async ({ key }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      const expression = key
        ? `JSON.stringify({ [${JSON.stringify(key)}]: localStorage.getItem(${JSON.stringify(key)}) })`
        : `JSON.stringify(Object.fromEntries(Object.entries(localStorage)))`;

      const result = await cdp.send<{ result: { value: string } }>(
        "Runtime.evaluate",
        { expression, returnByValue: true },
        sid
      );

      return textResult(result.result.value);
    }
  );

  defineTool(
    server,
    "set_local_storage",
    "Write a key-value pair to localStorage.",
    {
      key: z.string().describe("Storage key"),
      value: z.string().describe("Storage value"),
    },
    async ({ key, value }) => {
      const session = await sessions.getSelectedSession();
      await cdp.send(
        "Runtime.evaluate",
        {
          expression: `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`,
        },
        session.sessionId
      );

      return textResult(`localStorage: ${key} = ${value.slice(0, 50)}${value.length > 50 ? "..." : ""}`);
    }
  );

  // --- sessionStorage ---

  defineTool(
    server,
    "get_session_storage",
    "Read sessionStorage keys and values for the selected tab.",
    {
      key: z.string().optional().describe("Specific key to read (default: all keys)"),
    },
    async ({ key }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      const expression = key
        ? `JSON.stringify({ [${JSON.stringify(key)}]: sessionStorage.getItem(${JSON.stringify(key)}) })`
        : `JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))`;

      const result = await cdp.send<{ result: { value: string } }>(
        "Runtime.evaluate",
        { expression, returnByValue: true },
        sid
      );

      return textResult(result.result.value);
    }
  );

  defineTool(
    server,
    "set_session_storage",
    "Write a key-value pair to sessionStorage.",
    {
      key: z.string().describe("Storage key"),
      value: z.string().describe("Storage value"),
    },
    async ({ key, value }) => {
      const session = await sessions.getSelectedSession();
      await cdp.send(
        "Runtime.evaluate",
        {
          expression: `sessionStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`,
        },
        session.sessionId
      );

      return textResult(`sessionStorage: ${key} = ${value.slice(0, 50)}${value.length > 50 ? "..." : ""}`);
    }
  );

  // --- Clear all ---

  defineTool(
    server,
    "clear_site_data",
    "Clear all storage (cookies, localStorage, sessionStorage, cache, indexedDB) for a given origin.",
    {
      origin: z.string().optional().describe("Origin to clear (default: current page origin)"),
    },
    async ({ origin }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      if (!origin) {
        const evalResult = await cdp.send<{ result: { value: string } }>(
          "Runtime.evaluate",
          { expression: "window.location.origin", returnByValue: true },
          sid
        );
        origin = evalResult.result.value;
      }

      await cdp.send(
        "Storage.clearDataForOrigin",
        {
          origin,
          storageTypes: "cookies,local_storage,session_storage,indexeddb,cache_storage",
        },
        sid
      );

      return textResult(`Cleared all site data for: ${origin}`);
    }
  );
}
