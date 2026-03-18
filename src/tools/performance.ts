import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionManager } from "../lib/session.js";
import { CDPClient } from "../lib/cdp.js";
import { defineTool, defineSimpleTool, textResult, errorResult } from "../lib/tool-helper.js";
import { writeFileSync } from "node:fs";

export function registerPerformanceTools(
  server: McpServer,
  sessions: SessionManager,
  cdp: CDPClient
): void {
  defineTool(
    server,
    "start_trace",
    "Begin a Chrome trace recording for performance analysis.",
    {
      categories: z.array(z.string()).optional().describe(
        "Trace categories (default: standard web perf categories)"
      ),
    },
    async ({ categories }) => {
      const session = await sessions.getSelectedSession();

      const defaultCategories = [
        "-*",
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "v8.execute",
        "blink.console",
        "blink.user_timing",
        "loading",
        "latencyInfo",
      ];

      await cdp.send(
        "Tracing.start",
        {
          traceConfig: {
            includedCategories: categories ?? defaultCategories,
            recordMode: "recordUntilFull",
          },
          transferMode: "ReturnAsStream",
        },
        session.sessionId
      );

      return textResult("Trace recording started. Use stop_trace to end and save.");
    }
  );

  defineTool(
    server,
    "stop_trace",
    "Stop the trace recording and save to a file.",
    {
      outputPath: z.string().describe("File path to save the trace JSON"),
    },
    async ({ outputPath }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      // Collect trace data
      const chunks: string[] = [];

      return new Promise((resolve) => {
        cdp.on("Tracing.dataCollected", (params) => {
          const value = params.value as Array<Record<string, unknown>>;
          chunks.push(JSON.stringify(value));
        });

        cdp.on("Tracing.tracingComplete", () => {
          const traceData = `{"traceEvents":[${chunks.join(",")}]}`;
          try {
            writeFileSync(outputPath, traceData);
            resolve(textResult(`Trace saved to: ${outputPath} (${(traceData.length / 1024).toFixed(1)} KB)`));
          } catch (err) {
            resolve(errorResult(`Failed to save trace: ${err instanceof Error ? err.message : String(err)}`));
          }
        });

        cdp.send("Tracing.end", {}, sid).catch(() => {
          resolve(errorResult("Failed to stop trace recording."));
        });
      });
    }
  );

  defineTool(
    server,
    "memory_snapshot",
    "Take a heap snapshot for memory analysis.",
    {
      outputPath: z.string().describe("File path to save the .heapsnapshot file"),
    },
    async ({ outputPath }) => {
      const session = await sessions.getSelectedSession();
      const sid = session.sessionId;

      const chunks: string[] = [];

      return new Promise((resolve) => {
        cdp.on("HeapProfiler.addHeapSnapshotChunk", (params) => {
          chunks.push(params.chunk as string);
        });

        cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false }, sid)
          .then(() => {
            const snapshot = chunks.join("");
            try {
              writeFileSync(outputPath, snapshot);
              resolve(textResult(`Heap snapshot saved: ${outputPath} (${(snapshot.length / 1024 / 1024).toFixed(1)} MB)`));
            } catch (err) {
              resolve(errorResult(`Failed to save snapshot: ${err instanceof Error ? err.message : String(err)}`));
            }
          })
          .catch(() => {
            resolve(errorResult("Failed to take heap snapshot."));
          });
      });
    }
  );

  defineSimpleTool(
    server,
    "get_metrics",
    "Get runtime performance metrics for the selected tab (DOM nodes, JS heap, layouts, etc.).",
    async () => {
      const session = await sessions.getSelectedSession();

      const result = await cdp.send<{
        metrics: Array<{ name: string; value: number }>;
      }>("Performance.getMetrics", {}, session.sessionId);

      const interesting = [
        "Timestamp", "Documents", "Frames", "JSEventListeners",
        "Nodes", "LayoutCount", "RecalcStyleCount", "LayoutDuration",
        "RecalcStyleDuration", "ScriptDuration", "TaskDuration",
        "JSHeapUsedSize", "JSHeapTotalSize",
      ];

      const lines = result.metrics
        .filter((m) => interesting.includes(m.name))
        .map((m) => {
          let val: string;
          if (m.name.includes("Size")) {
            val = `${(m.value / 1024 / 1024).toFixed(1)} MB`;
          } else if (m.name.includes("Duration")) {
            val = `${(m.value * 1000).toFixed(1)} ms`;
          } else {
            val = String(Math.round(m.value));
          }
          return `${m.name}: ${val}`;
        });

      return textResult(lines.join("\n"));
    }
  );
}
