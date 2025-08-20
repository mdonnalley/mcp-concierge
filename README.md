# MCP Concierge (POC)

A local stdio MCP proxy that forwards to a remote MCP server over HTTP or SSE using a static `Authorization: Bearer` token.

## Usage

- Put a registry at `~/.mcp-concierge/registry.json` or pass `--registry`.
- Start: `mcp-concierge --server <name> [--verbose]`
- Requires `JWT_TOKEN` env var.

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

## Registry format

[
  { "name": "example", "transport": "http", "endpoint": "https://example.com/mcp" }
]
