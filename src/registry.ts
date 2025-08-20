export default [
  {
    name: "sobject-reads",
    transport: "http",
    endpoint: "https://api.salesforce.com/platform/mcp/v1-beta.1/query",
  },
  {
    name: "github",
    transport: "http",
    endpoint: "https://api.githubcopilot.com/mcp/",
  },
  {
    name: "git",
    transport: "sse",
    endpoint: "https://gitmcp.io/docs",
    open: true,
  },
];
