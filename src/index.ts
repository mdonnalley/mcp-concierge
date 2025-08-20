#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBridge } from "./lib/bridge.js";
import { createLogger } from "./lib/logger.js";
import registry from "./registry.js";

type Args = { servers?: string[]; verbose?: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { servers: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--server") {
      const v = argv[++i];
      if (!v) {
        console.error("Missing value for --server");
        process.exit(1);
      }
      // support comma-separated or repeated --server
      for (const part of v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        args.servers!.push(part);
      }
    } else if (a === "--verbose") args.verbose = true;
  }
  return args;
}

async function main() {
  const { servers, verbose } = parseArgs(process.argv);
  const log = createLogger(verbose);

  if (!servers || servers.length === 0) {
    console.error("Missing --server <name>");
    process.exit(1);
  }

  // TODO: support multiple servers
  const server = servers[0];

  const token = process.env.JWT_TOKEN;
  if (!token) {
    console.error("Missing JWT_TOKEN env var");
    process.exit(1);
  }

  const entry = registry.find((e) => e.name === server);
  if (!entry || !entry.endpoint) {
    console.error(`Server not found in registry: ${server}`);
    process.exit(1);
  }

  const headers = entry.open ? {} : { Authorization: `Bearer ${token}` };

  await createBridge({
    url: entry.endpoint,
    transport: entry.transport === "sse" ? "sse" : "http",
    headers,
    log,
  });
}

main().catch((err) => {
  console.error("Fatal:", err?.stack ?? err ?? "Unknown Error");
  process.exit(1);
});
