import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Logger } from "./logger.js";

export type BridgeOpts = {
  url: string;
  transport: "http" | "sse";
  headers: Record<string, string>;
  log: Logger;
};

export async function createBridge(opts: BridgeOpts) {
  const { url, transport, headers, log } = opts;
  const remoteUrl = new URL(url);

  const local = new StdioServerTransport();
  let remote: StreamableHTTPClientTransport | SSEClientTransport;

  if (transport === "sse") {
    remote = new SSEClientTransport(remoteUrl, {
      // Cast to any to pass headers for SSE GET in Node 'eventsource'
      eventSourceInit: { headers } as any,
      requestInit: { headers },
    });
  } else {
    remote = new StreamableHTTPClientTransport(remoteUrl, {
      requestInit: { headers },
      reconnectionOptions: {
        maxRetries: 2,
        initialReconnectionDelay: 250,
        maxReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1.0,
      },
    });
  }

  const shutdown = async (code: number) => {
    try {
      await Promise.allSettled([local.close(), remote.close()]);
    } finally {
      process.exit(code);
    }
  };

  const redact = (h: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(h).map(([k, v]) =>
        k.toLowerCase() === "authorization" ? [k, "Bearer <redacted>"] : [k, v]
      )
    );

  local.onmessage = async (message) => {
    try {
      const size = Buffer.byteLength(JSON.stringify(message));
      log.info(`local->remote ${size}B`);
      await remote.send(message);
    } catch (e) {
      log.error("Forward local->remote failed", e);
      await shutdown(1);
    }
  };

  remote.onmessage = async (message) => {
    try {
      const size = Buffer.byteLength(JSON.stringify(message));
      log.info(`remote->local ${size}B`);
      await local.send(message);
    } catch (e) {
      log.error("Forward remote->local failed", e);
      await shutdown(1);
    }
  };

  local.onerror = (e) => log.error("local transport error", e);
  remote.onerror = (e) => log.error("remote transport error", e);

  local.onclose = () => {
    log.info("local closed; shutting down");
    void shutdown(0);
  };
  remote.onclose = () => {
    log.info("remote closed; shutting down");
    void shutdown(1);
  };

  log.info("Starting bridge", { url, transport, headers: redact(headers) });

  // Start remote first with SSE retry if needed
  if (transport === "sse") {
    let attempt = 0;
    while (true) {
      try {
        await remote.start();
        log.info("SSE connected");
        break;
      } catch (e) {
        attempt++;
        log.warn(
          `SSE connect failed (attempt ${attempt})`,
          (e as Error).message
        );
        if (attempt >= 3) return shutdown(1);
        await new Promise((r) => setTimeout(r, 250 * attempt));
      }
    }
  } else {
    await remote.start();
  }

  await local.start();
  log.info("Bridge running");
}
