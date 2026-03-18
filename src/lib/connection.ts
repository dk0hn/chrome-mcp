import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

const DEFAULT_DEBUG_PORT = 9222;

/** Known Chrome-based browser profile directories on macOS/Linux/Windows */
function getProfileDirs(): Record<string, string[]> {
  const home = homedir();
  return {
    darwin: [
      join(home, "Library/Application Support/Google/Chrome"),
      join(home, "Library/Application Support/Google/Chrome Canary"),
      join(home, "Library/Application Support/Google/Chrome Dev"),
      join(home, "Library/Application Support/Microsoft Edge"),
      join(home, "Library/Application Support/BraveSoftware/Brave-Browser"),
      join(home, "Library/Application Support/Vivaldi"),
    ],
    linux: [
      join(home, ".config/google-chrome"),
      join(home, ".config/google-chrome-unstable"),
      join(home, ".config/microsoft-edge"),
      join(home, ".config/BraveSoftware/Brave-Browser"),
      join(home, ".config/vivaldi"),
    ],
    win32: [
      join(home, "AppData/Local/Google/Chrome/User Data"),
      join(home, "AppData/Local/Microsoft/Edge/User Data"),
      join(home, "AppData/Local/BraveSoftware/Brave-Browser/User Data"),
    ],
  };
}

export interface ChromeConnection {
  wsUrl: string;
  port: number;
}

/**
 * Try connecting to Chrome's /json/version HTTP endpoint.
 * Works with --remote-debugging-port flag (older approach).
 * Chrome 146's toggle-based debugging returns 404 here.
 */
export async function probeDebugPort(
  port: number
): Promise<ChromeConnection | null> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { webSocketDebuggerUrl?: string };
    if (data.webSocketDebuggerUrl) {
      return { wsUrl: data.webSocketDebuggerUrl, port };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Verify a WebSocket URL is live by opening and immediately closing a connection.
 * Resolves true if the handshake succeeds, false otherwise.
 */
export function verifyWebSocket(wsUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(wsUrl);
      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 3000);

      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    } catch {
      resolve(false);
    }
  });
}

/**
 * Read Chrome's DevToolsActivePort file to get the debugging WebSocket URL.
 * Chrome writes this file when remote debugging is enabled.
 * Format: line 1 = port, line 2 = WebSocket path
 */
export function readDevToolsActivePort(): ChromeConnection | null {
  const os = platform();
  const dirs = getProfileDirs()[os];
  if (!dirs) return null;

  for (const dir of dirs) {
    const portFile = join(dir, "DevToolsActivePort");
    if (existsSync(portFile)) {
      try {
        const content = readFileSync(portFile, "utf-8").trim();
        const lines = content.split("\n");
        if (lines.length >= 2) {
          const port = parseInt(lines[0], 10);
          const path = lines[1];
          if (!isNaN(port) && path) {
            return {
              wsUrl: `ws://127.0.0.1:${port}${path}`,
              port,
            };
          }
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

/** @deprecated Use readDevToolsActivePort instead */
export const findDevToolsActivePort = readDevToolsActivePort;

/**
 * Find a Chrome connection. Tries in order:
 * 1. HTTP probe on default/configured port (--remote-debugging-port)
 * 2. DevToolsActivePort file + WebSocket verification (chrome://inspect toggle)
 */
export async function findChromeConnection(): Promise<ChromeConnection> {
  // Try HTTP probe first (works with --remote-debugging-port flag)
  const portEnv = process.env.CHROME_DEBUG_PORT;
  const port = portEnv ? parseInt(portEnv, 10) : DEFAULT_DEBUG_PORT;
  const direct = await probeDebugPort(port);
  if (direct) return direct;

  // Read DevToolsActivePort and verify via WebSocket handshake
  const fromFile = readDevToolsActivePort();
  if (fromFile) {
    const isLive = await verifyWebSocket(fromFile.wsUrl);
    if (isLive) return fromFile;
  }

  throw new Error(
    "Could not connect to Chrome. Enable remote debugging:\n" +
      "  1. Open chrome://inspect/#remote-debugging\n" +
      "  2. Toggle remote debugging ON\n" +
      "Make sure Chrome is running."
  );
}
