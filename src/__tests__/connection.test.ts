import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  readDevToolsActivePort,
  findChromeConnection,
  probeDebugPort,
} from "../lib/connection.js";
import * as fs from "node:fs";
import * as os from "node:os";

vi.mock("node:fs");
vi.mock("node:os");

describe("readDevToolsActivePort", () => {
  beforeEach(() => {
    vi.mocked(os.platform).mockReturnValue("darwin");
    vi.mocked(os.homedir).mockReturnValue("/Users/testuser");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should parse DevToolsActivePort file correctly", () => {
    vi.mocked(fs.existsSync).mockImplementation((path) => {
      return String(path).includes("Google/Chrome/DevToolsActivePort");
    });

    vi.mocked(fs.readFileSync).mockReturnValue(
      "9222\n/devtools/browser/abc-123\n"
    );

    const result = readDevToolsActivePort();
    expect(result).toEqual({
      wsUrl: "ws://127.0.0.1:9222/devtools/browser/abc-123",
      port: 9222,
    });
  });

  it("should return null when no DevToolsActivePort file found", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(readDevToolsActivePort()).toBeNull();
  });

  it("should try multiple browser directories", () => {
    const existsCalls: string[] = [];
    vi.mocked(fs.existsSync).mockImplementation((path) => {
      existsCalls.push(String(path));
      return String(path).includes("Microsoft Edge");
    });

    vi.mocked(fs.readFileSync).mockReturnValue(
      "9333\n/devtools/browser/edge-456\n"
    );

    const result = readDevToolsActivePort();
    expect(result?.port).toBe(9333);
    expect(existsCalls.some((p) => p.includes("Google/Chrome"))).toBe(true);
  });

  it("should return null for malformed DevToolsActivePort file", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("garbage\n");
    expect(readDevToolsActivePort()).toBeNull();
  });
});

describe("probeDebugPort", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return connection when Chrome is listening", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
          }),
      })
    );

    const result = await probeDebugPort(9222);
    expect(result).toEqual({
      wsUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
      port: 9222,
    });
  });

  it("should return null when nothing is listening", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    );

    const result = await probeDebugPort(9222);
    expect(result).toBeNull();
  });
});

describe("findChromeConnection", () => {
  beforeEach(() => {
    vi.mocked(os.platform).mockReturnValue("darwin");
    vi.mocked(os.homedir).mockReturnValue("/Users/testuser");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should prefer direct port probe over DevToolsActivePort", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/direct",
          }),
      })
    );

    // DevToolsActivePort also exists
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      "9333\n/devtools/browser/file-based\n"
    );

    const result = await findChromeConnection();
    expect(result.port).toBe(9222);
    expect(result.wsUrl).toContain("direct");
  });

  it("should fall back to DevToolsActivePort when default port probe fails", async () => {
    // Default port 9222 fails, but port from file (9333) succeeds
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("9333")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/browser/fallback",
              }),
          });
        }
        return Promise.reject(new Error("ECONNREFUSED"));
      })
    );

    vi.mocked(fs.existsSync).mockImplementation((path) => {
      return String(path).includes("Google/Chrome/DevToolsActivePort");
    });
    vi.mocked(fs.readFileSync).mockReturnValue(
      "9333\n/devtools/browser/fallback\n"
    );

    const result = await findChromeConnection();
    expect(result.port).toBe(9333);
    expect(result.wsUrl).toContain("fallback");
  });

  it("should throw when both methods fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    );
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await expect(findChromeConnection()).rejects.toThrow(
      "Could not connect to Chrome"
    );
  });
});
