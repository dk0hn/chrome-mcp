import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findDevToolsActivePort } from "../lib/connection.js";
import * as fs from "node:fs";
import * as os from "node:os";

vi.mock("node:fs");
vi.mock("node:os");

describe("findDevToolsActivePort", () => {
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

    vi.mocked(fs.readFileSync).mockReturnValue("9222\n/devtools/browser/abc-123\n");

    const result = findDevToolsActivePort();
    expect(result).toEqual({
      wsUrl: "ws://127.0.0.1:9222/devtools/browser/abc-123",
      port: 9222,
    });
  });

  it("should throw when no DevToolsActivePort file found", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(() => findDevToolsActivePort()).toThrow(
      "Could not find DevToolsActivePort"
    );
  });

  it("should try multiple browser directories", () => {
    const existsCalls: string[] = [];
    vi.mocked(fs.existsSync).mockImplementation((path) => {
      existsCalls.push(String(path));
      return String(path).includes("Microsoft Edge");
    });

    vi.mocked(fs.readFileSync).mockReturnValue("9333\n/devtools/browser/edge-456\n");

    const result = findDevToolsActivePort();
    expect(result.port).toBe(9333);
    // Should have checked Chrome first
    expect(existsCalls.some((p) => p.includes("Google/Chrome"))).toBe(true);
  });

  it("should handle malformed DevToolsActivePort file", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("garbage\n");

    expect(() => findDevToolsActivePort()).toThrow(
      "Could not find DevToolsActivePort"
    );
  });
});
