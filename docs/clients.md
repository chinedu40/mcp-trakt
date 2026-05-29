# Remote MCP client setup

## Claude

If your Claude app or plan supports remote MCP connectors, use:

- URL: `https://your-domain.example.com/mcp`
- Header, when `MCP_HTTP_AUTH_TOKEN` is set: `Authorization: Bearer YOUR_TOKEN`

Claude Desktop builds vary in direct remote HTTP support. When direct remote MCP is unavailable, use a local stdio-to-HTTP bridge. A common pattern is `mcp-remote`; verify the current package options before using this exact shape:

```json
{
  "mcpServers": {
    "trakt": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://your-domain.example.com/mcp",
        "--header",
        "Authorization: Bearer YOUR_TOKEN"
      ]
    }
  }
}
```

## ChatGPT custom connectors

Use the remote MCP URL:

```text
https://your-domain.example.com/mcp
```

ChatGPT custom connector availability depends on your plan/workspace and current OpenAI feature access. If ChatGPT requires OAuth for custom connectors, this project’s static bearer-token gate is not enough by itself. Run the service behind an OAuth/OIDC-capable gateway such as Authentik, Authelia, Cloudflare Access, or another OAuth-aware reverse proxy, and expose only HTTPS.

## Local MCP Inspector

Stdio:

```bash
npm run inspect
```

HTTP:

```bash
npm run inspect:http
```

If bearer auth is enabled, configure the Inspector request headers with `Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>`.
