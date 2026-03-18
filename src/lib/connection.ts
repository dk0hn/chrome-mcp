import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

/** Known Chrome-based browser profile directories on macOS/Linux/Windows */
const PROFILE_DIRS: Record<string, string[]> = {
  darwin: [
    join(homedir(), "Library/Application Support/Google/Chrome"),
    join(homedir(), "Library/Application Support/Google/Chrome Canary"),
    join(homedir(), "Library/Application Support/Google/Chrome Dev"),
    join(homedir(), "Library/Application Support/Microsoft Edge"),
    join(homedir(), "Library/Application Support/BraveSoftware/Brave-Browser"),
    join(homedir(), "Library/Application Support/Vivaldi"),
  ],
  linux: [
    join(homedir(), ".config/google-chrome"),
    join(homedir(), ".config/google-chrome-unstable"),
    join(homedir(), ".config/microsoft-edge"),
    join(homedir(), ".config/BraveSoftware/Brave-Browser"),
    join(homedir(), ".config/vivaldi"),
  ],
  win32: [
    join(homedir(), "AppData/Local/Google/Chrome/User Data"),
    join(homedir(), "AppData/Local/Microsoft/Edge/User Data"),
    join(homedir(), "AppData/Local/BraveSoftware/Brave-Browser/User Data"),
  ],
};

export interface ChromeConnection {
  wsUrl: string;
  port: number;
}

/**
 * Read Chrome's DevToolsActivePort file to get the debugging WebSocket URL.
 * Chrome writes this file when remote debugging is enabled.
 * Format: line 1 = port, line 2 = WebSocket path
 */
export function findDevToolsActivePort(): ChromeConnection {
  const os = platform();
  const dirs = PROFILE_DIRS[os];
  if (!dirs) {
    throw new Error(`Unsupported platform: ${os}`);
  }

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
        // File exists but unreadable — try next browser
        continue;
      }
    }
  }

  throw new Error(
    "Could not find DevToolsActivePort. Make sure Chrome is running " +
      "and remote debugging is enabled at chrome://inspect/#remote-debugging"
  );
}
