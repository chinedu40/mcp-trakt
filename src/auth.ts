import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

const KEYCHAIN_SERVICE = "mcp-trakt"
const API_BASE = "https://api.trakt.tv"
const DEFAULT_TOKEN_FILE = "/data/trakt-tokens.json"

export type TraktCredentials = {
  clientId: string
  clientSecret?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}

type TokenFile = {
  client_id?: string
  client_secret?: string
  access_token?: string
  refresh_token?: string
  expires_at?: number | string
}

let cachedCredentials: TraktCredentials | null = null

const isDocker = () => existsSync("/.dockerenv") || process.env.MCP_TRAKT_AUTH_STORE === "file"

const keychainRead = (account: string): string | null => {
  if (isDocker()) return null
  try {
    return (
      execFileSync(
        "security",
        ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
        { stdio: ["pipe", "pipe", "pipe"] },
      )
        .toString()
        .trim() || null
    )
  } catch {
    return null
  }
}

const parseExpiresAt = (value: string | number | undefined): number | undefined => {
  if (value === undefined || value === "") return undefined
  if (typeof value === "number") return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const configuredTokenFile = () => process.env.MCP_TRAKT_TOKEN_FILE

const readableTokenFile = () => {
  const configured = configuredTokenFile()
  if (configured) return configured
  if (existsSync(DEFAULT_TOKEN_FILE)) return DEFAULT_TOKEN_FILE
  return undefined
}

const writableTokenFile = () => {
  const configured = configuredTokenFile()
  if (configured) return configured
  if (existsSync("/data")) return DEFAULT_TOKEN_FILE
  return undefined
}

const readTokenFile = (): TokenFile => {
  const tokenFile = readableTokenFile()
  if (!tokenFile || !existsSync(tokenFile)) return {}
  try {
    return JSON.parse(readFileSync(tokenFile, "utf8")) as TokenFile
  } catch (error) {
    throw new Error(`Unable to read Trakt token file at ${tokenFile}: ${(error as Error).message}`)
  }
}

const writeTokenFile = (credentials: TraktCredentials) => {
  const tokenFile = writableTokenFile()
  if (!tokenFile) return
  mkdirSync(dirname(tokenFile), { recursive: true })
  writeFileSync(
    tokenFile,
    `${JSON.stringify(
      {
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        access_token: credentials.accessToken,
        refresh_token: credentials.refreshToken,
        expires_at: credentials.expiresAt,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  )
}

const loadCredentials = (): TraktCredentials => {
  if (process.env.VITEST) {
    return {
      clientId: process.env.MCP_TRAKT_CLIENT_ID || "test-client-id",
      clientSecret: process.env.MCP_TRAKT_CLIENT_SECRET,
      accessToken: process.env.MCP_TRAKT_ACCESS_TOKEN || "test-access-token",
      refreshToken: process.env.MCP_TRAKT_REFRESH_TOKEN,
      expiresAt: parseExpiresAt(process.env.MCP_TRAKT_TOKEN_EXPIRES_AT),
    }
  }

  const file = readTokenFile()
  const clientId =
    process.env.MCP_TRAKT_CLIENT_ID || file.client_id || keychainRead("client-id")
  const clientSecret =
    process.env.MCP_TRAKT_CLIENT_SECRET ||
    file.client_secret ||
    keychainRead("client-secret") ||
    undefined
  const accessToken =
    process.env.MCP_TRAKT_ACCESS_TOKEN ||
    file.access_token ||
    keychainRead("access-token") ||
    undefined
  const refreshToken =
    process.env.MCP_TRAKT_REFRESH_TOKEN ||
    file.refresh_token ||
    keychainRead("refresh-token") ||
    undefined
  const expiresAt = parseExpiresAt(
    process.env.MCP_TRAKT_TOKEN_EXPIRES_AT || file.expires_at || keychainRead("expires-at") || undefined,
  )

  if (!clientId) {
    throw new Error(
      "Missing Trakt client ID. Set MCP_TRAKT_CLIENT_ID, provide it in MCP_TRAKT_TOKEN_FILE, or run npm run setup.",
    )
  }

  return { clientId, clientSecret, accessToken, refreshToken, expiresAt }
}

const isExpired = (credentials: TraktCredentials) => {
  if (!credentials.accessToken) return true
  if (!credentials.expiresAt) return false
  return Date.now() >= credentials.expiresAt - 60_000
}

const refreshCredentials = async (credentials: TraktCredentials) => {
  if (!credentials.clientSecret || !credentials.refreshToken) return credentials

  const response = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: credentials.refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
      grant_type: "refresh_token",
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Trakt token refresh failed (${response.status}). Re-run npm run setup to authorize again.`,
    )
  }

  const token = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }
  const refreshed = {
    ...credentials,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || credentials.refreshToken,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
  }
  writeTokenFile(refreshed)
  return refreshed
}

export const getTraktCredentials = async () => {
  cachedCredentials ??= loadCredentials()
  if (isExpired(cachedCredentials) && cachedCredentials.refreshToken) {
    cachedCredentials = await refreshCredentials(cachedCredentials)
  }
  return cachedCredentials
}

export const resetTraktCredentialsForTests = () => {
  cachedCredentials = null
}
