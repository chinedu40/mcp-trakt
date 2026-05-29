import { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { createMcpServer } from "../index.js"
import { startHttp } from "../transports.js"

let server: Awaited<ReturnType<typeof startHttp>> | undefined

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server) {
      resolve()
      return
    }
    server.close((error) => (error ? reject(error) : resolve()))
    server = undefined
  })
})

describe("HTTP transport", () => {
  it("returns JSON-RPC JSON responses for Streamable HTTP POST requests", async () => {
    server = await startHttp(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
    })
    const { port } = server.address() as AddressInfo

    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "vitest", version: "1" },
        },
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/json")
    const body = await response.json()
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: { name: "trakt" },
      },
    })
  })
})
