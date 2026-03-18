import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionManager } from "../lib/session.js";
import { CDPClient } from "../lib/cdp.js";
import { defineTool, textResult, errorResult, imageResult } from "../lib/tool-helper.js";

export function registerInspectTools(
  server: McpServer,
  sessions: SessionManager,
  cdp: CDPClient
): void {
  defineTool(
    server,
    "screenshot",
    "Take a screenshot of the selected tab. Returns a base64-encoded PNG image.",
    {
      fullPage: z.boolean().optional().describe("Capture the full scrollable page (default: viewport only)"),
      selector: z.string().optional().describe("CSS selector to capture a specific element"),
      quality: z.number().min(1).max(100).optional().describe("JPEG quality (1-100). If set, returns JPEG instead of PNG"),
    },
    async ({ fullPage, selector, quality }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      let clip: Record<string, number> | undefined;

      if (selector) {
        // Get element bounds
        const evalResult = await cdp.send<{
          result: { value: { x: number; y: number; width: number; height: number } | null };
        }>(
          "Runtime.evaluate",
          {
            expression: `(() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return { x: r.x, y: r.y, width: r.width, height: r.height };
            })()`,
            returnByValue: true,
          },
          sid
        );

        if (!evalResult.result.value) {
          return errorResult(`Element not found: ${selector}`);
        }
        clip = { ...evalResult.result.value, scale: 1 };
      }

      const params: Record<string, unknown> = {
        format: quality ? "jpeg" : "png",
        captureBeyondViewport: fullPage ?? false,
      };
      if (quality) params.quality = quality;
      if (clip) params.clip = clip;

      const result = await cdp.send<{ data: string }>(
        "Page.captureScreenshot",
        params,
        sid
      );

      return imageResult(result.data, quality ? "image/jpeg" : "image/png");
    }
  );

  defineTool(
    server,
    "snapshot",
    "Get the accessibility tree of the selected tab. Returns a structured text representation of all visible elements with stable UIDs that can be used for click/type operations. Much cheaper than screenshots for element identification.",
    {
      depth: z.number().optional().describe("Max tree depth (default: 8)"),
    },
    async ({ depth }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      const result = await cdp.send<{
        nodes: Array<{
          nodeId: number;
          role: { value: string };
          name: { value: string };
          properties?: Array<{ name: string; value: { value: unknown } }>;
          childIds?: number[];
          backendDOMNodeId?: number;
        }>;
      }>(
        "Accessibility.getFullAXTree",
        { depth: depth ?? 8 },
        sid
      );

      const lines: string[] = [];
      const nodeMap = new Map(result.nodes.map((n) => [n.nodeId, n]));

      function renderNode(nodeId: number, indent: number): void {
        const node = nodeMap.get(nodeId);
        if (!node) return;

        const role = node.role.value;
        const name = node.name.value;

        // Skip generic/invisible nodes
        if (role === "none" || role === "generic") {
          for (const childId of node.childIds ?? []) {
            renderNode(childId, indent);
          }
          return;
        }

        // Build property string
        const props: string[] = [];
        for (const p of node.properties ?? []) {
          if (p.name === "focused" && p.value.value) props.push("FOCUSED");
          if (p.name === "checked" && p.value.value) props.push("CHECKED");
          if (p.name === "disabled" && p.value.value) props.push("DISABLED");
          if (p.name === "required" && p.value.value) props.push("REQUIRED");
          if (p.name === "value" && p.value.value) props.push(`value="${p.value.value}"`);
        }
        const propStr = props.length > 0 ? ` [${props.join(", ")}]` : "";

        const prefix = "  ".repeat(indent);
        const uid = node.backendDOMNodeId ? `#${node.backendDOMNodeId}` : "";
        const nameStr = name ? ` "${name}"` : "";
        lines.push(`${prefix}${role}${nameStr}${propStr}${uid ? ` ${uid}` : ""}`);

        for (const childId of node.childIds ?? []) {
          renderNode(childId, indent + 1);
        }
      }

      // Start from root
      if (result.nodes.length > 0) {
        renderNode(result.nodes[0].nodeId, 0);
      }

      return textResult(
        lines.length > 0 ? lines.join("\n") : "Empty accessibility tree."
      );
    }
  );

  defineTool(
    server,
    "evaluate_js",
    "Execute JavaScript in the selected tab's page context. Returns the result.",
    {
      expression: z.string().describe("JavaScript expression to evaluate"),
      returnByValue: z.boolean().optional().describe("Return result by value (default: true). Set false for DOM references."),
    },
    async ({ expression, returnByValue }) => {
      const session = await sessions.getSelectedSession();

      const result = await cdp.send<{
        result: { value?: unknown; description?: string; type: string; className?: string };
        exceptionDetails?: { text: string; exception?: { description: string } };
      }>(
        "Runtime.evaluate",
        {
          expression,
          returnByValue: returnByValue ?? true,
          awaitPromise: true,
          userGesture: true,
        },
        session.sessionId
      );

      if (result.exceptionDetails) {
        const errMsg = result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text;
        return errorResult(`JS Error: ${errMsg}`);
      }

      const val = result.result.value;
      const text = val !== undefined
        ? (typeof val === "string" ? val : JSON.stringify(val, null, 2))
        : result.result.description ?? `[${result.result.type}]`;

      return textResult(text);
    }
  );

  defineTool(
    server,
    "get_html",
    "Get the HTML content of the selected tab, or of a specific element by CSS selector.",
    {
      selector: z.string().optional().describe("CSS selector (default: full page html)"),
      outer: z.boolean().optional().describe("Return outerHTML (default: true). Set false for innerHTML."),
    },
    async ({ selector, outer }) => {
      const session = await sessions.getSelectedSession();
      const useOuter = outer ?? true;
      const sel = selector ?? "html";

      const result = await cdp.send<{
        result: { value: string | null };
      }>(
        "Runtime.evaluate",
        {
          expression: `document.querySelector(${JSON.stringify(sel)})?.${useOuter ? "outerHTML" : "innerHTML"} ?? null`,
          returnByValue: true,
        },
        session.sessionId
      );

      if (result.result.value === null) {
        return errorResult(`Element not found: ${sel}`);
      }

      // Truncate very large HTML
      let html = result.result.value;
      if (html.length > 50000) {
        html = html.slice(0, 50000) + "\n\n... [truncated at 50000 chars]";
      }

      return textResult(html);
    }
  );

  defineTool(
    server,
    "query_selector",
    "Find elements matching a CSS selector. Returns count and basic info about each match.",
    {
      selector: z.string().describe("CSS selector"),
      limit: z.number().optional().describe("Max results (default: 10)"),
    },
    async ({ selector, limit }) => {
      const session = await sessions.getSelectedSession();
      const maxResults = limit ?? 10;

      const result = await cdp.send<{
        result: {
          value: Array<{
            tag: string;
            id: string;
            classes: string;
            text: string;
            href: string;
            rect: { x: number; y: number; width: number; height: number };
          }> | null;
        };
      }>(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const els = document.querySelectorAll(${JSON.stringify(selector)});
            return Array.from(els).slice(0, ${maxResults}).map(el => {
              const r = el.getBoundingClientRect();
              return {
                tag: el.tagName.toLowerCase(),
                id: el.id || '',
                classes: el.className || '',
                text: (el.textContent || '').slice(0, 100).trim(),
                href: el.href || '',
                rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
              };
            });
          })()`,
          returnByValue: true,
        },
        session.sessionId
      );

      if (!result.result.value || result.result.value.length === 0) {
        return textResult(`No elements found matching: ${selector}`);
      }

      const els = result.result.value;
      const lines = els.map((el, i) => {
        const idStr = el.id ? `#${el.id}` : "";
        const classStr = el.classes ? `.${String(el.classes).split(" ").join(".")}` : "";
        const textStr = el.text ? ` "${el.text.slice(0, 60)}"` : "";
        const hrefStr = el.href ? ` href="${el.href}"` : "";
        return `${i + 1}. <${el.tag}${idStr}${classStr}>${textStr}${hrefStr} @(${el.rect.x},${el.rect.y} ${el.rect.width}x${el.rect.height})`;
      });

      return textResult(`${els.length} element(s) matching "${selector}":\n${lines.join("\n")}`);
    }
  );
}
