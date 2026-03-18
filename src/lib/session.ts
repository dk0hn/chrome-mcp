/**
 * Tab session manager. Handles lazy attachment to tabs and caches sessions.
 *
 * Key design: we never enumerate all tabs upfront. We list targets for
 * discovery, but only attach (Target.attachToTarget) when a tool needs
 * to interact with a specific tab. This is what makes it work with 100+ tabs.
 */

import { CDPClient } from "./cdp.js";

export interface TabInfo {
  targetId: string;
  title: string;
  url: string;
  type: string;
}

export interface TabSession {
  targetId: string;
  sessionId: string;
  info: TabInfo;
}

export class SessionManager {
  private sessions = new Map<string, TabSession>();
  private selectedTabId: string | null = null;
  private consoleMessages = new Map<string, ConsoleMessage[]>();
  private networkRequests = new Map<string, NetworkRequest[]>();

  constructor(private cdp: CDPClient) {
    // Listen for tab close events to evict sessions
    this.cdp.on("Target.targetDestroyed", (params) => {
      const targetId = params.targetId as string;
      this.sessions.delete(targetId);
      this.consoleMessages.delete(targetId);
      this.networkRequests.delete(targetId);
      if (this.selectedTabId === targetId) {
        this.selectedTabId = null;
      }
    });

    // Listen for target info changes (title/url updates)
    this.cdp.on("Target.targetInfoChanged", (params) => {
      const info = params.targetInfo as TabInfo;
      const session = this.sessions.get(info.targetId);
      if (session) {
        session.info = info;
      }
    });
  }

  /**
   * Clear all cached sessions and state. Called on reconnection.
   */
  reset(): void {
    this.sessions.clear();
    this.consoleMessages.clear();
    this.networkRequests.clear();
    this.selectedTabId = null;
  }

  /**
   * Enable target discovery so we get events about tab creation/destruction.
   */
  async init(): Promise<void> {
    await this.cdp.send("Target.setDiscoverTargets", {
      discover: true,
      filter: [{ type: "page" }],
    });
  }

  /**
   * List all open page targets. Lightweight — just metadata, no attachment.
   */
  async listTabs(options?: {
    filter?: string;
    limit?: number;
    offset?: number;
  }): Promise<TabInfo[]> {
    const result = await this.cdp.send<{ targetInfos: TabInfo[] }>(
      "Target.getTargets",
      { filter: [{ type: "page" }] }
    );

    let tabs = result.targetInfos.filter((t) => t.type === "page");

    if (options?.filter) {
      const pattern = options.filter.toLowerCase();
      tabs = tabs.filter(
        (t) =>
          t.title.toLowerCase().includes(pattern) ||
          t.url.toLowerCase().includes(pattern)
      );
    }

    if (options?.offset) {
      tabs = tabs.slice(options.offset);
    }

    if (options?.limit) {
      tabs = tabs.slice(0, options.limit);
    }

    return tabs;
  }

  /**
   * Get or create a CDP session for a specific tab.
   * Lazily attaches only when first needed.
   */
  async getSession(targetId: string): Promise<TabSession> {
    const existing = this.sessions.get(targetId);
    if (existing) {
      return existing;
    }

    // Attach to the target — this is when Chrome shows its permission dialog
    const result = await this.cdp.send<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId, flatten: true }
    );

    // Enable domains we need on this session
    const sessionId = result.sessionId;
    await Promise.all([
      this.cdp.send("Page.enable", {}, sessionId),
      this.cdp.send("Runtime.enable", {}, sessionId),
      this.cdp.send("DOM.enable", {}, sessionId),
      this.cdp.send("Network.enable", {}, sessionId),
    ]);

    // Set up console message collection for this tab
    this.consoleMessages.set(targetId, []);
    this.cdp.on("Runtime.consoleAPICalled", (params) => {
      const messages = this.consoleMessages.get(targetId);
      if (messages) {
        messages.push({
          type: params.type as string,
          text: (params.args as Array<{ value?: unknown; description?: string }>)
            .map((a) => a.value ?? a.description ?? "")
            .join(" "),
          timestamp: params.timestamp as number,
        });
        // Keep only last 500 messages per tab
        if (messages.length > 500) {
          messages.splice(0, messages.length - 500);
        }
      }
    });

    // Set up network request collection
    this.networkRequests.set(targetId, []);
    this.cdp.on("Network.responseReceived", (params) => {
      const requests = this.networkRequests.get(targetId);
      if (requests) {
        const response = params.response as {
          url: string;
          status: number;
          mimeType: string;
        };
        requests.push({
          requestId: params.requestId as string,
          url: response.url,
          method: (params.type as string) || "GET",
          status: response.status,
          mimeType: response.mimeType,
          timestamp: params.timestamp as number,
        });
        if (requests.length > 1000) {
          requests.splice(0, requests.length - 1000);
        }
      }
    });

    // Get tab info
    const tabs = await this.listTabs();
    const info = tabs.find((t) => t.targetId === targetId) ?? {
      targetId,
      title: "Unknown",
      url: "",
      type: "page",
    };

    const session: TabSession = { targetId, sessionId, info };
    this.sessions.set(targetId, session);
    return session;
  }

  /**
   * Get the currently selected tab's session, or throw if none selected.
   */
  async getSelectedSession(): Promise<TabSession> {
    if (!this.selectedTabId) {
      throw new Error(
        "No tab selected. Use list_tabs to see available tabs, then select_tab to pick one."
      );
    }
    return this.getSession(this.selectedTabId);
  }

  selectTab(targetId: string): void {
    this.selectedTabId = targetId;
  }

  getSelectedTabId(): string | null {
    return this.selectedTabId;
  }

  getConsoleMessages(targetId: string): ConsoleMessage[] {
    return this.consoleMessages.get(targetId) ?? [];
  }

  clearConsoleMessages(targetId: string): void {
    this.consoleMessages.set(targetId, []);
  }

  getNetworkRequests(targetId: string): NetworkRequest[] {
    return this.networkRequests.get(targetId) ?? [];
  }

  clearNetworkRequests(targetId: string): void {
    this.networkRequests.set(targetId, []);
  }

  /**
   * Detach from a tab session.
   */
  async detach(targetId: string): Promise<void> {
    const session = this.sessions.get(targetId);
    if (session) {
      try {
        await this.cdp.send("Target.detachFromTarget", {
          sessionId: session.sessionId,
        });
      } catch {
        // Already detached
      }
      this.sessions.delete(targetId);
    }
  }
}

export interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
}

export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  status: number;
  mimeType: string;
  timestamp: number;
}
