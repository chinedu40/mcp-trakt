import { createServer, type ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"

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

const jsonRpcError = (res: ServerResponse, status: number, code: number, message: string) => {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    }),
  )
}

export const startHttp = async (
  createMcpServer: () => McpServer,
  config: HttpConfig,
) => {
  const transports = new Map<string, StreamableHTTPServerTransport>()

  const requireAuth = (authorization: string | undefined) => {
    if (!config.authToken) return true
    return authorization === `Bearer ${config.authToken}`
  }

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(
        req.url || "/",
        `http://${req.headers.host || "localhost"}`,
      )

      if (url.pathname === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({ ok: true, service: "mcp-trakt", transport: "http" }),
        )
        return
      }

      if (url.pathname !== config.path) {
        jsonRpcError(res, 404, -32001, "Not found")
        return
      }

      if (!requireAuth(req.headers.authorization)) {
        jsonRpcError(res, 401, -32001, "Unauthorized")
        return
      }

      let transport: StreamableHTTPServerTransport
      const sessionId = req.headers["mcp-session-id"]
      if (typeof sessionId === "string" && transports.has(sessionId)) {
        transport = transports.get(sessionId)!
      } else if (typeof sessionId === "string") {
        jsonRpcError(res, 404, -32001, "Session not found")
        return
      } else {
        transport = new StreamableHTTPServerTransport({
          enableJsonResponse: true,
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            transports.set(initializedSessionId, transport)
          },
        })
        transport.onclose = () => {
          if (transport.sessionId) transports.delete(transport.sessionId)
        }
        const server = createMcpServer()
        await server.connect(transport)
      }

      await transport.handleRequest(req, res)
    } catch (error) {
      console.error("HTTP transport error:", (error as Error).message)
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, "Internal server error")
        return
      }
      res.end()
    }
  })

  await new Promise<void>((resolve) =>
    httpServer.listen(config.port, config.host, resolve),
  )
  if (!config.authToken && ["0.0.0.0", "::"].includes(config.host)) {
    console.error(
      "Warning: MCP_HTTP_AUTH_TOKEN is not set while binding to all interfaces. Use HTTPS and a reverse proxy/auth gateway for remote deployment.",
    )
  }
  console.error(
    `mcp-trakt HTTP MCP server listening on http://${config.host}:${config.port}${config.path}`,
  )
  return httpServer
}
