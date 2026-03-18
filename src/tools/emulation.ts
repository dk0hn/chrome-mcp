import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionManager } from "../lib/session.js";
import { CDPClient } from "../lib/cdp.js";
import { defineTool, textResult } from "../lib/tool-helper.js";

const DEVICE_PRESETS: Record<string, { width: number; height: number; deviceScaleFactor: number; mobile: boolean; userAgent: string }> = {
  "iphone-14": { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1" },
  "iphone-14-pro-max": { width: 430, height: 932, deviceScaleFactor: 3, mobile: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1" },
  "ipad-pro": { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: true, userAgent: "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1" },
  "pixel-7": { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36" },
  "galaxy-s23": { width: 360, height: 780, deviceScaleFactor: 3, mobile: true, userAgent: "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36" },
};

const NETWORK_PRESETS: Record<string, { latency: number; downloadThroughput: number; uploadThroughput: number }> = {
  "slow-3g": { latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 },
  "fast-3g": { latency: 560, downloadThroughput: 180000, uploadThroughput: 84375 },
  "4g": { latency: 170, downloadThroughput: 1500000, uploadThroughput: 750000 },
  "offline": { latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
};

export function registerEmulationTools(
  server: McpServer,
  sessions: SessionManager,
  cdp: CDPClient
): void {
  defineTool(
    server,
    "set_viewport",
    "Set the viewport/window dimensions.",
    {
      width: z.number().describe("Viewport width in pixels"),
      height: z.number().describe("Viewport height in pixels"),
      deviceScaleFactor: z.number().optional().describe("Device pixel ratio (default: 1)"),
      mobile: z.boolean().optional().describe("Enable mobile viewport mode"),
    },
    async ({ width, height, deviceScaleFactor, mobile }) => {
      const session = await sessions.getSelectedSession();
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width, height, deviceScaleFactor: deviceScaleFactor ?? 1, mobile: mobile ?? false },
        session.sessionId
      );
      return textResult(`Viewport set to ${width}x${height} (scale: ${deviceScaleFactor ?? 1})`);
    }
  );

  defineTool(
    server,
    "set_user_agent",
    "Override the browser's user agent string.",
    {
      userAgent: z.string().describe("User agent string to use"),
      platform: z.string().optional().describe("Platform string (e.g., 'Linux', 'iPhone')"),
    },
    async ({ userAgent, platform }) => {
      const session = await sessions.getSelectedSession();
      const params: Record<string, unknown> = { userAgent };
      if (platform) params.platform = platform;
      await cdp.send("Emulation.setUserAgentOverride", params, session.sessionId);
      return textResult(`User agent set to: ${userAgent.slice(0, 80)}...`);
    }
  );

  defineTool(
    server,
    "emulate_device",
    `Emulate a specific device. Available presets: ${Object.keys(DEVICE_PRESETS).join(", ")}`,
    {
      device: z.string().describe("Device preset name"),
    },
    async ({ device }) => {
      const preset = DEVICE_PRESETS[device.toLowerCase()];
      if (!preset) {
        return textResult(
          `Unknown device "${device}". Available: ${Object.keys(DEVICE_PRESETS).join(", ")}`
        );
      }

      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: preset.width,
        height: preset.height,
        deviceScaleFactor: preset.deviceScaleFactor,
        mobile: preset.mobile,
      }, sid);

      await cdp.send("Emulation.setUserAgentOverride", {
        userAgent: preset.userAgent,
      }, sid);

      return textResult(`Emulating ${device}: ${preset.width}x${preset.height} (${preset.mobile ? "mobile" : "desktop"})`);
    }
  );

  defineTool(
    server,
    "throttle_network",
    `Simulate network conditions. Presets: ${Object.keys(NETWORK_PRESETS).join(", ")}. Or specify custom values.`,
    {
      preset: z.string().optional().describe("Network preset name"),
      latency: z.number().optional().describe("Custom latency in ms"),
      downloadThroughput: z.number().optional().describe("Custom download speed in bytes/sec"),
      uploadThroughput: z.number().optional().describe("Custom upload speed in bytes/sec"),
    },
    async ({ preset, latency, downloadThroughput, uploadThroughput }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      let conditions: { latency: number; downloadThroughput: number; uploadThroughput: number };

      if (preset) {
        const p = NETWORK_PRESETS[preset.toLowerCase()];
        if (!p) {
          return textResult(
            `Unknown preset "${preset}". Available: ${Object.keys(NETWORK_PRESETS).join(", ")}`
          );
        }
        conditions = p;
      } else {
        conditions = {
          latency: latency ?? 0,
          downloadThroughput: downloadThroughput ?? -1,
          uploadThroughput: uploadThroughput ?? -1,
        };
      }

      const offline = conditions.downloadThroughput === 0 && conditions.uploadThroughput === 0;
      await cdp.send("Network.emulateNetworkConditions", {
        offline,
        latency: conditions.latency,
        downloadThroughput: conditions.downloadThroughput,
        uploadThroughput: conditions.uploadThroughput,
      }, sid);

      return textResult(
        preset
          ? `Network throttled to: ${preset}`
          : `Network throttled: ${conditions.latency}ms latency, ${conditions.downloadThroughput} B/s down, ${conditions.uploadThroughput} B/s up`
      );
    }
  );

  defineTool(
    server,
    "set_geolocation",
    "Override the browser's geolocation.",
    {
      latitude: z.number().min(-90).max(90).describe("Latitude (-90 to 90)"),
      longitude: z.number().min(-180).max(180).describe("Longitude (-180 to 180)"),
      accuracy: z.number().optional().describe("Accuracy in meters (default: 1)"),
    },
    async ({ latitude, longitude, accuracy }) => {
      const session = await sessions.getSelectedSession();
      await cdp.send(
        "Emulation.setGeolocationOverride",
        { latitude, longitude, accuracy: accuracy ?? 1 },
        session.sessionId
      );
      return textResult(`Geolocation set to: ${latitude}, ${longitude}`);
    }
  );
}
