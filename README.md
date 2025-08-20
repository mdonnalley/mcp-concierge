# MCP Concierge (POC)

A local stdio MCP concierge that connects over stdio to your MCP client and forwards to one or more remote MCP servers over HTTP or SSE using a static `Authorization: Bearer` token.

## Usage

- Put a registry at `~/.mcp-concierge/registry.json` or pass `--registry`.
- Start single remote: `mcp-concierge --server <name> [--verbose]`
- Start multiple remotes (aggregator): `mcp-concierge --server <name1> --server <name2>` or `--server name1,name2`
- Requires `JWT_TOKEN` env var for any remote that is not `open: true`.

When multiple remotes are selected, tools are aggregated and exposed with name-prefix routing using a safe delimiter: `<remote>__<tool>` (no slashes). Call tools using that full name. If you call a bare tool name and it is ambiguous across remotes, the server will suggest the fully qualified options.

Example client config:

{
  "mcpServers": {
    "data-cloud-queries": {
      "command": "mcp-concierge",
      "args": ["--server", "data-cloud-queries"],
      "env": { "JWT_TOKEN": "${env:JWT_TOKEN}" }
    }
  }
}
