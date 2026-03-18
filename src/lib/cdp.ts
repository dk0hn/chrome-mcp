/**
 * Low-level Chrome DevTools Protocol client over WebSocket.
 * Uses Node.js 22+ built-in WebSocket — zero dependencies.
 */

export type CDPEventHandler = (params: Record<string, unknown>) => void;

export class CDPClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
    }
  >();
  private eventHandlers = new Map<string, Set<CDPEventHandler>>();
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  async connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this._connected = true;
        resolve();
      };

      this.ws.onerror = (event) => {
        const message =
          event instanceof ErrorEvent ? event.message : "WebSocket error";
        if (!this._connected) {
          reject(new Error(`Failed to connect to Chrome: ${message}`));
        }
      };

      this.ws.onclose = () => {
        this._connected = false;
        // Reject all pending commands
        for (const [, pending] of this.pending) {
          pending.reject(new Error("WebSocket closed"));
        }
        this.pending.clear();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(
          typeof event.data === "string"
            ? event.data
            : event.data.toString()
        );
      };
    });
  }

  private handleMessage(data: string): void {
    let msg: {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      error?: { code: number; message: string; data?: string };
    };

    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    // Response to a command we sent
    if (msg.id !== undefined) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(
            new Error(`CDP error: ${msg.error.message} (${msg.error.code})`)
          );
        } else {
          pending.resolve(msg.result ?? {});
        }
      }
      return;
    }

    // Event from Chrome
    if (msg.method) {
      const handlers = this.eventHandlers.get(msg.method);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(msg.params ?? {});
          } catch {
            // Don't let handler errors break the event loop
          }
        }
      }
    }
  }

  /**
   * Send a CDP command and wait for its response.
   */
  async send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ): Promise<T> {
    if (!this.ws || !this._connected) {
      throw new Error("Not connected to Chrome");
    }

    const id = this.nextId++;
    const message: Record<string, unknown> = { id, method };
    if (params) message.params = params;
    if (sessionId) message.sessionId = sessionId;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      const timeout = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }
      }, 30000);

      this.pending.set(id, {
        resolve: (value: unknown) => {
          clearTimeout(timeout);
          (resolve as (value: unknown) => void)(value);
        },
        reject: (reason: Error) => {
          clearTimeout(timeout);
          reject(reason);
        },
      });

      this.ws!.send(JSON.stringify(message));
    });
  }

  /**
   * Subscribe to a CDP event.
   */
  on(method: string, handler: CDPEventHandler): void {
    if (!this.eventHandlers.has(method)) {
      this.eventHandlers.set(method, new Set());
    }
    this.eventHandlers.get(method)!.add(handler);
  }

  /**
   * Unsubscribe from a CDP event.
   */
  off(method: string, handler: CDPEventHandler): void {
    this.eventHandlers.get(method)?.delete(handler);
  }

  /**
   * Subscribe to a CDP event, but only fire once.
   */
  once(method: string, handler: CDPEventHandler): void {
    const wrapper: CDPEventHandler = (params) => {
      this.off(method, wrapper);
      handler(params);
    };
    this.on(method, wrapper);
  }

  disconnect(): void {
    if (this.ws) {
      this._connected = false;
      this.ws.close();
      this.ws = null;
    }
  }
}
