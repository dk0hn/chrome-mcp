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
 * Try connecting to Chrome's /json/version endpoint on a given port.
 * Returns the browser WebSocket URL if Chrome is listening there.
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
 * Read Chrome's DevToolsActivePort file to get the debugging WebSocket URL.
 * Chrome writes this file when remote debugging is enabled.
 * Format: line 1 = port, line 2 = WebSocket path
 */
export function findDevToolsActivePort(): ChromeConnection | null {
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

/**
 * Find a Chrome connection. Tries in order:
 * 1. Direct port probe (--remote-debugging-port, no dialog)
 * 2. DevToolsActivePort file (chrome://inspect toggle, may show dialog)
 */
export async function findChromeConnection(): Promise<ChromeConnection> {
  // Try direct port first — launched with --remote-debugging-port, no approval dialog
  const portEnv = process.env.CHROME_DEBUG_PORT;
  const port = portEnv ? parseInt(portEnv, 10) : DEFAULT_DEBUG_PORT;
  const direct = await probeDebugPort(port);
  if (direct) return direct;

  // Fall back to DevToolsActivePort file
  const fromFile = findDevToolsActivePort();
  if (fromFile) return fromFile;

  throw new Error(
    "Could not connect to Chrome. Either:\n" +
      "  1. Launch Chrome with: --remote-debugging-port=9222\n" +
      "  2. Enable remote debugging at chrome://inspect/#remote-debugging\n" +
      "Make sure Chrome is running."
  );
}
