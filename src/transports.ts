import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { randomUUID } from "node:crypto"

export type HttpConfig = {
  host: string
  port: number
  path: string
  authToken?: string
}

export const startStdio = async (server: McpServer) => {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error("mcp-trakt running on stdio")
}

const unauthorized = (res: ServerResponse) => {
  res.writeHead(401, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ error: "Unauthorized" }))
}

const parseBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  if (chunks.length === 0) return undefined
  const raw = Buffer.concat(chunks).toString("utf8")
  return raw ? JSON.parse(raw) : undefined
}

export const startHttp = async (createMcpServer: () => McpServer, config: HttpConfig) => {
  const transports = new Map<string, StreamableHTTPServerTransport>()

  const requireAuth = (authorization: string | undefined) => {
    if (!config.authToken) return true
    return authorization === `Bearer ${config.authToken}`
  }

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)

      if (url.pathname === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: true, service: "mcp-trakt", transport: "http" }))
        return
      }

      if (url.pathname !== config.path) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Not found" }))
        return
      }

      if (!requireAuth(req.headers.authorization)) {
        unauthorized(res)
        return
      }

      if (!config.authToken && ["0.0.0.0", "::"].includes(config.host)) {
        // Startup warning is emitted below; keep request path silent to avoid noisy logs.
      }

      let transport: StreamableHTTPServerTransport
      const sessionId = req.headers["mcp-session-id"]
      if (typeof sessionId === "string" && transports.has(sessionId)) {
        transport = transports.get(sessionId)!
      } else {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        })
        transport.onclose = () => {
          if (transport.sessionId) transports.delete(transport.sessionId)
        }
        const server = createMcpServer()
        await server.connect(transport)
      }

      const body = req.method === "POST" ? await parseBody(req) : undefined
      await transport.handleRequest(req, res, body)
      if (transport.sessionId) transports.set(transport.sessionId, transport)
    } catch (error) {
      console.error("HTTP transport error:", (error as Error).message)
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" })
      }
      res.end(JSON.stringify({ error: "Internal server error" }))
    }
  })

  await new Promise<void>((resolve) => httpServer.listen(config.port, config.host, resolve))
  if (!config.authToken && ["0.0.0.0", "::"].includes(config.host)) {
    console.error("Warning: MCP_HTTP_AUTH_TOKEN is not set while binding to all interfaces. Use HTTPS and a reverse proxy/auth gateway for remote deployment.")
  }
  console.error(`mcp-trakt HTTP MCP server listening on http://${config.host}:${config.port}${config.path}`)
}
