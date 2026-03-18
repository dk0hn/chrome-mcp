import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionManager } from "../lib/session.js";
import { CDPClient } from "../lib/cdp.js";
import { defineTool, textResult, errorResult } from "../lib/tool-helper.js";

export function registerInputTools(
  server: McpServer,
  sessions: SessionManager,
  cdp: CDPClient
): void {
  defineTool(
    server,
    "click",
    "Click an element by CSS selector. Scrolls the element into view first.",
    {
      selector: z.string().describe("CSS selector of the element to click"),
      button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button (default: left)"),
    },
    async ({ selector, button }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      // Get element center coordinates
      const result = await cdp.send<{
        result: { value: { x: number; y: number } | null };
      }>(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            el.scrollIntoView({ block: 'center', inline: 'center' });
            const r = el.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          })()`,
          returnByValue: true,
        },
        sid
      );

      if (!result.result.value) {
        return errorResult(`Element not found: ${selector}`);
      }

      const { x, y } = result.result.value;
      await dispatchClick(cdp, sid, x, y, button ?? "left");

      return textResult(`Clicked ${selector} at (${Math.round(x)}, ${Math.round(y)})`);
    }
  );

  defineTool(
    server,
    "click_xy",
    "Click at specific x,y coordinates on the page.",
    {
      x: z.number().describe("X coordinate (pixels from left)"),
      y: z.number().describe("Y coordinate (pixels from top)"),
      button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button (default: left)"),
    },
    async ({ x, y, button }) => {
      const session = await sessions.getSelectedSession();
      await dispatchClick(cdp, session.sessionId, x, y, button ?? "left");
      return textResult(`Clicked at (${x}, ${y})`);
    }
  );

  defineTool(
    server,
    "double_click",
    "Double-click an element by CSS selector.",
    {
      selector: z.string().describe("CSS selector of the element to double-click"),
    },
    async ({ selector }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      const result = await cdp.send<{
        result: { value: { x: number; y: number } | null };
      }>(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            el.scrollIntoView({ block: 'center', inline: 'center' });
            const r = el.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          })()`,
          returnByValue: true,
        },
        sid
      );

      if (!result.result.value) return errorResult(`Element not found: ${selector}`);

      const { x, y } = result.result.value;
      await dispatchClick(cdp, sid, x, y, "left", 2);

      return textResult(`Double-clicked ${selector}`);
    }
  );

  defineTool(
    server,
    "type_text",
    "Type text into the currently focused element. Uses Input.insertText for cross-origin iframe support.",
    {
      text: z.string().describe("Text to type"),
      selector: z.string().optional().describe("CSS selector to focus first"),
      pressEnter: z.boolean().optional().describe("Press Enter after typing"),
    },
    async ({ text, selector, pressEnter }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      if (selector) {
        await cdp.send(
          "Runtime.evaluate",
          {
            expression: `document.querySelector(${JSON.stringify(selector)})?.focus()`,
          },
          sid
        );
      }

      await cdp.send("Input.insertText", { text }, sid);

      if (pressEnter) {
        await cdp.send(
          "Input.dispatchKeyEvent",
          { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
          sid
        );
        await cdp.send(
          "Input.dispatchKeyEvent",
          { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
          sid
        );
      }

      return textResult(`Typed "${text.slice(0, 50)}${text.length > 50 ? "..." : ""}"`);
    }
  );

  defineTool(
    server,
    "press_key",
    "Press a keyboard key, optionally with modifiers.",
    {
      key: z.string().describe("Key to press (e.g., 'Enter', 'Tab', 'Escape', 'a', 'ArrowDown')"),
      modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).optional()
        .describe("Modifier keys to hold"),
    },
    async ({ key, modifiers }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      let modifierFlags = 0;
      if (modifiers?.includes("Alt")) modifierFlags |= 1;
      if (modifiers?.includes("Control")) modifierFlags |= 2;
      if (modifiers?.includes("Meta")) modifierFlags |= 4;
      if (modifiers?.includes("Shift")) modifierFlags |= 8;

      await cdp.send(
        "Input.dispatchKeyEvent",
        { type: "keyDown", key, code: key, modifiers: modifierFlags },
        sid
      );
      await cdp.send(
        "Input.dispatchKeyEvent",
        { type: "keyUp", key, code: key, modifiers: modifierFlags },
        sid
      );

      const modStr = modifiers?.length ? `${modifiers.join("+")}+` : "";
      return textResult(`Pressed ${modStr}${key}`);
    }
  );

  defineTool(
    server,
    "hover",
    "Move the mouse cursor over an element.",
    {
      selector: z.string().describe("CSS selector of the element to hover"),
    },
    async ({ selector }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      const result = await cdp.send<{
        result: { value: { x: number; y: number } | null };
      }>(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            el.scrollIntoView({ block: 'center', inline: 'center' });
            const r = el.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          })()`,
          returnByValue: true,
        },
        sid
      );

      if (!result.result.value) return errorResult(`Element not found: ${selector}`);

      const { x, y } = result.result.value;
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sid);

      return textResult(`Hovered over ${selector}`);
    }
  );

  defineTool(
    server,
    "drag",
    "Drag from one element to another.",
    {
      fromSelector: z.string().describe("CSS selector of the source element"),
      toSelector: z.string().describe("CSS selector of the target element"),
    },
    async ({ fromSelector, toSelector }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      const coords = await cdp.send<{
        result: { value: { from: { x: number; y: number }; to: { x: number; y: number } } | null };
      }>(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const fromEl = document.querySelector(${JSON.stringify(fromSelector)});
            const toEl = document.querySelector(${JSON.stringify(toSelector)});
            if (!fromEl || !toEl) return null;
            const fr = fromEl.getBoundingClientRect();
            const tr = toEl.getBoundingClientRect();
            return {
              from: { x: fr.x + fr.width / 2, y: fr.y + fr.height / 2 },
              to: { x: tr.x + tr.width / 2, y: tr.y + tr.height / 2 }
            };
          })()`,
          returnByValue: true,
        },
        sid
      );

      if (!coords.result.value) return errorResult("Source or target element not found.");

      const { from, to } = coords.result.value;
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y }, sid);
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1 }, sid);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: to.x, y: to.y }, sid);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1 }, sid);

      return textResult(`Dragged from ${fromSelector} to ${toSelector}`);
    }
  );

  defineTool(
    server,
    "upload_file",
    "Upload a file to a file input element.",
    {
      selector: z.string().describe("CSS selector of the file input"),
      filePath: z.string().describe("Absolute path to the file to upload"),
    },
    async ({ selector, filePath }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      // Get the DOM node for the file input
      const doc = await cdp.send<{ root: { nodeId: number } }>("DOM.getDocument", {}, sid);
      const node = await cdp.send<{ nodeId: number }>(
        "DOM.querySelector",
        { nodeId: doc.root.nodeId, selector },
        sid
      );

      if (!node.nodeId) return errorResult(`File input not found: ${selector}`);

      await cdp.send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [filePath] }, sid);

      return textResult(`Uploaded file: ${filePath}`);
    }
  );

  defineTool(
    server,
    "fill_form",
    "Fill multiple form fields at once. Each field is identified by CSS selector.",
    {
      fields: z.array(
        z.object({
          selector: z.string().describe("CSS selector of the form field"),
          value: z.string().describe("Value to set"),
        })
      ).describe("Array of {selector, value} pairs to fill"),
    },
    async ({ fields }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      const results: string[] = [];
      for (const field of fields) {
        const setResult = await cdp.send<{ result: { value: boolean } }>(
          "Runtime.evaluate",
          {
            expression: `(() => {
              const el = document.querySelector(${JSON.stringify(field.selector)});
              if (!el) return false;
              el.focus();
              if (el.tagName === 'SELECT') {
                el.value = ${JSON.stringify(field.value)};
                el.dispatchEvent(new Event('change', { bubbles: true }));
              } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLInputElement.prototype, 'value'
                )?.set || Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype, 'value'
                )?.set;
                nativeInputValueSetter?.call(el, ${JSON.stringify(field.value)});
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
              return true;
            })()`,
            returnByValue: true,
          },
          sid
        );

        if (setResult.result.value) {
          results.push(`  ${field.selector}: set to "${field.value}"`);
        } else {
          results.push(`  ${field.selector}: NOT FOUND`);
        }
      }

      return textResult(`Form filled:\n${results.join("\n")}`);
    }
  );
}

async function dispatchClick(
  cdp: CDPClient,
  sessionId: string,
  x: number,
  y: number,
  button: string,
  clickCount = 1
): Promise<void> {
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x, y, button, clickCount },
    sessionId
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", x, y, button, clickCount },
    sessionId
  );
}
