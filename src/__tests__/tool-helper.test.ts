import { describe, it, expect } from "vitest";
import { textResult, errorResult, imageResult } from "../lib/tool-helper.js";

describe("tool-helper", () => {
  it("textResult should create proper MCP text content", () => {
    const result = textResult("hello world");
    expect(result).toEqual({
      content: [{ type: "text", text: "hello world" }],
    });
  });

  it("errorResult should include isError flag", () => {
    const result = errorResult("something failed");
    expect(result).toEqual({
      content: [{ type: "text", text: "something failed" }],
      isError: true,
    });
  });

  it("imageResult should create proper MCP image content", () => {
    const result = imageResult("base64data", "image/jpeg");
    expect(result).toEqual({
      content: [{ type: "image", data: "base64data", mimeType: "image/jpeg" }],
    });
  });

  it("imageResult should default to PNG mime type", () => {
    const result = imageResult("data");
    expect(result.content[0].mimeType).toBe("image/png");
  });
});
