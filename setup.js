#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { createInterface } from "node:readline"

const KEYCHAIN_SERVICE = "mcp-trakt"
const API_BASE = "https://api.trakt.tv"
const TRAKT_WEB_BASE = "https://trakt.tv"
const DEFAULT_TOKEN_FILE = "/data/trakt-tokens.json"
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob"
const USER_AGENT = "mcp-trakt-setup/1.0"

const rl = createInterface({ input: process.stdin, output: process.stdout })
const ask = (q) => new Promise((resolve) => rl.question(q, resolve))

const isDocker = () => existsSync("/.dockerenv") || process.env.MCP_TRAKT_AUTH_STORE === "file"
const authStore = process.env.MCP_TRAKT_AUTH_STORE || (isDocker() ? "file" : "keychain")
const tokenFile = process.env.MCP_TRAKT_TOKEN_FILE || DEFAULT_TOKEN_FILE

const oauthHeaders = (clientId) => ({
  "Content-Type": "application/json",
  Accept: "application/json",
  "trakt-api-version": "2",
  "trakt-api-key": clientId,
  "User-Agent": USER_AGENT,
})

const sensitiveKeyPattern = /client_secret|access_token|refresh_token/i

const redactSecrets = (value) => {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (!value || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[redacted]" : redactSecrets(entry),
    ]),
  )
}

const redactSecretText = (body) =>
  body.replace(
    /(client_secret|access_token|refresh_token)(["'\s:=]+)([^\s,"'}]+)/gi,
    "$1$2[redacted]",
  )

const safeResponseBody = async (response) => {
  const body = await response.text()
  if (!body) return "<empty>"

  try {
    return JSON.stringify(redactSecrets(JSON.parse(body)), null, 2)
  } catch {
    return redactSecretText(body).slice(0, 1500)
  }
}

const throwOAuthError = async (message, response) => {
  const body = await safeResponseBody(response)
  const cfRay = response.headers.get("cf-ray")
  const extra = cfRay ? `\nCloudflare Ray ID: ${cfRay}` : ""
  throw new Error(
    `${message} (${response.status} ${response.statusText})${extra}\nResponse body: ${body}`,
  )
}

const isDeviceCodeFlowError = (error) =>
  error instanceof Error && error.message.includes("Device code request failed")

const keychainRead = (account) => {
  if (authStore !== "keychain") return null

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

const keychainWrite = (account, value) =>
  execFileSync("security", [
    "add-generic-password",
    "-U",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    account,
    "-w",
    value,
  ])

const readTokenFile = () => {
  if (!existsSync(tokenFile)) return {}

  try {
    return JSON.parse(readFileSync(tokenFile, "utf8"))
  } catch (error) {
    throw new Error(`Unable to read ${tokenFile}: ${error.message}`)
  }
}

const writeTokenFile = (data) => {
  mkdirSync(dirname(tokenFile), { recursive: true })

  const temporaryFile = `${tokenFile}.tmp`

  writeFileSync(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, {
    mode: 0o600,
  })

  renameSync(temporaryFile, tokenFile)
}

const saveToken = (clientId, clientSecret, token) => {
  const expiresAt = token.expires_in ? Date.now() + token.expires_in * 1000 : undefined

  if (authStore === "file") {
    writeTokenFile({
      client_id: clientId,
      client_secret: clientSecret,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: expiresAt,
    })

    console.log(`\nSaved Trakt credentials to ${tokenFile}`)
    return
  }

  keychainWrite("client-id", clientId)
  keychainWrite("client-secret", clientSecret)
  keychainWrite("access-token", token.access_token)
  keychainWrite("refresh-token", token.refresh_token)

  if (expiresAt) {
    keychainWrite("expires-at", String(expiresAt))
  }

  console.log("\nSaved Trakt credentials to macOS Keychain")
}

const poll = async (deviceCode, clientId, clientSecret, interval) => {
  process.stdout.write("\nWaiting for authorization")

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000))
    process.stdout.write(".")

    const res = await fetch(`${API_BASE}/oauth/device/token`, {
      method: "POST",
      headers: oauthHeaders(clientId),
      body: JSON.stringify({
        code: deviceCode,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })

    if (res.status === 200) {
      process.stdout.write("\n")
      return await res.json()
    }

    if (res.status === 400) {
      continue
    }

    if (res.status === 404) {
      throw new Error("Invalid device code")
    }

    if (res.status === 409) {
      throw new Error("Code already used")
    }

    if (res.status === 410) {
      throw new Error("Code expired, run setup again")
    }

    if (res.status === 418) {
      throw new Error("Denied by user")
    }

    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      continue
    }

    await throwOAuthError("Device token request failed", res)
  }
}

const runDeviceCodeFlow = async (clientId, clientSecret) => {
  const codeRes = await fetch(`${API_BASE}/oauth/device/code`, {
    method: "POST",
    headers: oauthHeaders(clientId),
    body: JSON.stringify({ client_id: clientId }),
  })

  if (!codeRes.ok) {
    await throwOAuthError("Device code request failed", codeRes)
  }

  const code = await codeRes.json()

  console.log("\nOpen this URL and enter the code:")
  console.log(code.verification_url)
  console.log(`Code: ${code.user_code}\n`)

  return await poll(code.device_code, clientId, clientSecret, code.interval || 5)
}

const runAuthorizationCodeFlow = async (clientId, clientSecret) => {
  const authorizeUrl = new URL("/oauth/authorize", TRAKT_WEB_BASE)
  authorizeUrl.searchParams.set("response_type", "code")
  authorizeUrl.searchParams.set("client_id", clientId)
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI)

  console.log("\nDevice-code setup did not complete. Falling back to standard OAuth.")
  console.log("Open this URL in your browser and approve access:")
  console.log(authorizeUrl.toString())
  console.log("\nAfter approval, paste the returned authorization code below.")

  const code = (await ask("Authorization code: ")).trim()

  if (!code) {
    throw new Error("Authorization code is required.")
  }

  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: oauthHeaders(clientId),
    body: JSON.stringify({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  })

  if (!res.ok) {
    await throwOAuthError("Authorization code token exchange failed", res)
  }

  return await res.json()
}

const main = async () => {
  const existingFile = authStore === "file" ? readTokenFile() : {}

  const existingClientId =
    process.env.MCP_TRAKT_CLIENT_ID ||
    existingFile.client_id ||
    keychainRead("client-id")

  const existingClientSecret =
    process.env.MCP_TRAKT_CLIENT_SECRET ||
    existingFile.client_secret ||
    keychainRead("client-secret")

  console.log("Trakt MCP Setup")
  console.log("───────────────")
  console.log("Create an app at https://trakt.tv/oauth/applications/new if you haven't yet.\n")
  console.log(`Credential store: ${authStore}`)

  if (authStore === "file") {
    console.log(`Token file: ${tokenFile}`)
  }

  console.log("")

  const clientId =
    (
      await ask(
        `Client ID${existingClientId ? ` [${existingClientId.slice(0, 8)}…]` : ""}: `,
      )
    ).trim() || existingClientId

  const clientSecret =
    (await ask(`Client Secret${existingClientSecret ? " [saved]" : ""}: `)).trim() ||
    existingClientSecret

  if (!clientId || !clientSecret) {
    console.error("Both client ID and secret are required.")
    process.exit(1)
  }

  let token

  try {
    token = await runDeviceCodeFlow(clientId, clientSecret)
  } catch (error) {
    if (!isDeviceCodeFlowError(error)) {
      throw error
    }

    console.error(`\n${error.message}`)
    token = await runAuthorizationCodeFlow(clientId, clientSecret)
  }

  saveToken(clientId, clientSecret, token)
  console.log("Done.")
  console.log("You can now run mcp-trakt.")
}

try {
  await main()
} catch (error) {
  console.error("\nSetup failed:", error.message)
  process.exit(1)
} finally {
  rl.close()
}
