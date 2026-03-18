import { describe, it, expect, vi, beforeEach } from "vitest";
import { CDPClient } from "../lib/cdp.js";

// Mock WebSocket
class MockWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.onclose?.();
  }

  // Test helpers
  simulateOpen() {
    this.onopen?.();
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("CDPClient", () => {
  let client: CDPClient;
  let mockWs: MockWebSocket;

  beforeEach(() => {
    client = new CDPClient();
    mockWs = new MockWebSocket();

    // Replace global WebSocket
    vi.stubGlobal("WebSocket", function () {
      return mockWs;
    });
  });

  it("should connect to a WebSocket URL", async () => {
    const connectPromise = client.connect("ws://127.0.0.1:9222/devtools/browser/abc");
    mockWs.simulateOpen();
    await connectPromise;
    expect(client.connected).toBe(true);
  });

  it("should send commands and receive responses", async () => {
    const connectPromise = client.connect("ws://localhost:9222/test");
    mockWs.simulateOpen();
    await connectPromise;

    const sendPromise = client.send("Browser.getVersion");

    // Simulate response
    const sentMsg = JSON.parse(mockWs.sent[0]);
    expect(sentMsg.method).toBe("Browser.getVersion");

    mockWs.simulateMessage({
      id: sentMsg.id,
      result: { product: "Chrome/146.0.0.0" },
    });

    const result = await sendPromise;
    expect(result).toEqual({ product: "Chrome/146.0.0.0" });
  });

  it("should handle CDP errors", async () => {
    const connectPromise = client.connect("ws://localhost:9222/test");
    mockWs.simulateOpen();
    await connectPromise;

    const sendPromise = client.send("Invalid.Method");

    const sentMsg = JSON.parse(mockWs.sent[0]);
    mockWs.simulateMessage({
      id: sentMsg.id,
      error: { code: -32601, message: "Method not found" },
    });

    await expect(sendPromise).rejects.toThrow("CDP error: Method not found");
  });

  it("should dispatch events to handlers", async () => {
    const connectPromise = client.connect("ws://localhost:9222/test");
    mockWs.simulateOpen();
    await connectPromise;

    const handler = vi.fn();
    client.on("Page.loadEventFired", handler);

    mockWs.simulateMessage({
      method: "Page.loadEventFired",
      params: { timestamp: 12345 },
    });

    expect(handler).toHaveBeenCalledWith({ timestamp: 12345 });
  });

  it("should support once() for single-fire events", async () => {
    const connectPromise = client.connect("ws://localhost:9222/test");
    mockWs.simulateOpen();
    await connectPromise;

    const handler = vi.fn();
    client.once("Page.loadEventFired", handler);

    mockWs.simulateMessage({ method: "Page.loadEventFired", params: {} });
    mockWs.simulateMessage({ method: "Page.loadEventFired", params: {} });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should send sessionId when provided", async () => {
    const connectPromise = client.connect("ws://localhost:9222/test");
    mockWs.simulateOpen();
    await connectPromise;

    client.send("Page.navigate", { url: "https://example.com" }, "session-123");

    const sentMsg = JSON.parse(mockWs.sent[0]);
    expect(sentMsg.sessionId).toBe("session-123");
    expect(sentMsg.params.url).toBe("https://example.com");
  });

  it("should reject pending commands on disconnect", async () => {
    const connectPromise = client.connect("ws://localhost:9222/test");
    mockWs.simulateOpen();
    await connectPromise;

    const sendPromise = client.send("Page.navigate", { url: "https://example.com" });
    mockWs.close();

    await expect(sendPromise).rejects.toThrow("WebSocket closed");
    expect(client.connected).toBe(false);
  });
});
