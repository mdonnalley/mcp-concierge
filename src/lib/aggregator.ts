import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Logger } from "./logger.js";

export type RemoteConfig = {
  name: string;
  url: string;
  transport: "http" | "sse";
  headers: Record<string, string>;
};

type Remote = {
  cfg: RemoteConfig;
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport;
};

type ToolInfo = {
  remote: string;
  original: string;
  // Keep the original definition object as-is for listTools result
  def: any;
};

export async function runAggregator(opts: {
  remotes: RemoteConfig[];
  log: Logger;
  serverInfo?: { name: string; version: string };
}) {
  const { remotes: remoteCfgs, log, serverInfo } = opts;

  const server = new Server(
    serverInfo ?? { name: "mcp-concierge", version: "0.0.1" },
    {
      // Only declare tools capability for P0
      capabilities: {
        tools: { listChanged: true },
      },
      debouncedNotificationMethods: ["notifications/tools/list_changed"],
    }
  );

  const local = new StdioServerTransport();

  const remotes: Remote[] = [];
  const toolsByPrefixed: Map<string, ToolInfo> = new Map();
  const SEP = "__"; // safe delimiter: only [a-z0-9_-] allowed; no '/'

  const redact = (h: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(h).map(([k, v]) =>
        k.toLowerCase() === "authorization" ? [k, "Bearer <redacted>"] : [k, v]
      )
    );

  async function connectRemote(cfg: RemoteConfig): Promise<Remote | undefined> {
    const url = new URL(cfg.url);
    let transport: StreamableHTTPClientTransport | SSEClientTransport;
    if (cfg.transport === "sse") {
      transport = new SSEClientTransport(url, {
        eventSourceInit: { headers: cfg.headers } as any,
        requestInit: { headers: cfg.headers },
      });
    } else {
      transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: cfg.headers },
        reconnectionOptions: {
          maxRetries: 2,
          initialReconnectionDelay: 250,
          maxReconnectionDelay: 1000,
          reconnectionDelayGrowFactor: 1.0,
        },
      });
    }
    const client = new Client({
      name: `concierge:${cfg.name}`,
      version: "0.0.1",
    });
    client.onerror = (e) => log.error(`[remote:${cfg.name}] error`, e);
    client.fallbackNotificationHandler = async (n) => {
      if (n.method === "notifications/tools/list_changed") {
        await refreshRemoteTools(cfg.name, client).catch((e) =>
          log.warn(`[remote:${cfg.name}] refresh tools failed`, e)
        );
        await server.sendToolListChanged();
      }
    };

    // Try to connect; for SSE allow a couple retries
    if (cfg.transport === "sse") {
      let attempt = 0;
      while (true) {
        try {
          await client.connect(transport as any);
          log.info(`[remote:${cfg.name}] connected (sse)`);
          break;
        } catch (e) {
          attempt++;
          log.warn(
            `[remote:${cfg.name}] sse connect failed (attempt ${attempt})`,
            (e as Error).message
          );
          if (attempt >= 3) return undefined;
          await new Promise((r) => setTimeout(r, 250 * attempt));
        }
      }
    } else {
      await client.connect(transport as any);
      log.info(`[remote:${cfg.name}] connected (http)`);
    }

    return { cfg, client, transport };
  }

  async function refreshRemoteTools(name: string, client: Client) {
    const res = await client.listTools({});
    // purge existing entries from this remote
    for (const key of [...toolsByPrefixed.keys()]) {
      const info = toolsByPrefixed.get(key)!;
      if (info.remote === name) toolsByPrefixed.delete(key);
    }
    for (const tool of res.tools) {
      const prefixed = `${name}${SEP}${tool.name}`;
      toolsByPrefixed.set(prefixed, {
        remote: name,
        original: tool.name,
        def: { ...tool, name: prefixed },
      });
    }
  }

  // Install request handlers on the local server
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: [...toolsByPrefixed.values()].map((t) => t.def) } as any;
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const full = req.params.name;
    // Prefer exact aggregated-name match first
    const direct = toolsByPrefixed.get(full);
    if (direct) {
      const remote = remotes.find((r) => r.cfg.name === direct.remote);
      if (!remote) throw new Error(`Remote not connected: ${direct.remote}`);
      return (await remote.client.callTool({
        name: direct.original,
        arguments: req.params.arguments,
      })) as any;
    }

    // Otherwise treat as unprefixed and find unique match by original name
    {
      const matches = [...toolsByPrefixed.values()].filter(
        (v) => v.original === full
      );
      if (matches.length === 0) {
        throw new Error(`Unknown tool: ${full}`);
      }
      if (matches.length > 1) {
        const options = matches
          .map((m) => `${m.remote}${SEP}${m.original}`)
          .join(", ");
        throw new Error(
          `Ambiguous tool name '${full}'. Use one of: ${options}`
        );
      }
      const m = matches[0]!;
      const remote = remotes.find((r) => r.cfg.name === m.remote);
      if (!remote) throw new Error(`Remote not connected: ${m.remote}`);
      return (await remote.client.callTool({
        name: m.original,
        arguments: req.params.arguments,
      })) as any;
    }
  });

  // Wire transports lifecycle
  server.onclose = async () => {
    await Promise.allSettled(remotes.map((r) => r.client.close()));
    await Promise.allSettled(remotes.map((r) => r.transport.close()));
    process.exit(0);
  };

  // Start remote connections
  log.info(
    "Aggregator starting remotes:",
    remoteCfgs.map((r) => ({ ...r, headers: redact(r.headers) }))
  );
  for (const cfg of remoteCfgs) {
    try {
      const r = await connectRemote(cfg);
      if (!r) continue;
      remotes.push(r);
      await refreshRemoteTools(cfg.name, r.client);
    } catch (e) {
      log.warn(`[remote:${cfg.name}] failed to connect`, e);
    }
  }

  // Now expose local stdio server
  await server.connect(local as any);
  log.info("Aggregator running with tools:", [...toolsByPrefixed.keys()]);
  // Proactively notify client that tools are available
  await server.sendToolListChanged();
}
