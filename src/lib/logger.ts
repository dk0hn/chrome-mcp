import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const LOG_PATH = join(homedir(), ".chrome-mcp.log");

// Truncate on startup so the log stays small
writeFileSync(LOG_PATH, `[chrome-mcp] Started ${new Date().toISOString()}\n`);

export function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  appendFileSync(LOG_PATH, line);
  console.error(`[chrome-mcp] ${message}`);
}

export function logError(message: string, err?: unknown): void {
  const errMsg = err instanceof Error ? err.message : String(err ?? "");
  const line = `${new Date().toISOString()} ERROR ${message} ${errMsg}\n`;
  appendFileSync(LOG_PATH, line);
  console.error(`[chrome-mcp] ERROR: ${message}`, errMsg);
}

export { LOG_PATH };
