```
████████╗██████╗  █████╗ ██╗  ██╗████████╗
╚══██╔══╝██╔══██╗██╔══██╗██║ ██╔╝╚══██╔══╝
   ██║   ██████╔╝███████║█████╔╝    ██║
   ██║   ██╔══██╗██╔══██║██╔═██╗    ██║
   ██║   ██║  ██║██║  ██║██║  ██╗   ██║
   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝  ╚═╝
```

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?logo=node.js&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-1.0-blueviolet)
![npm](https://img.shields.io/badge/npm-%40kud%2Fmcp--trakt-CB3837?logo=npm&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

**A Trakt MCP server with 36 tools for TV show and movie tracking, sync, ratings, watchlists, and checkins.**

[Features](#features) • [Quick Start](#quick-start) • [Installation](#installation) • [Tools](#available-tools) • [Development](#development)

</div>

---

## Features

- 🔍 **Search** movies, shows, episodes, and people across Trakt's database
- 🎬 **Movies** — details, trending, popular, related, ratings, and cast
- 📺 **Shows & Episodes** — full show info, seasons, episode details, cast
- 👤 **People** — actor/director profiles and filmographies
- 📅 **Calendar** — your personalised upcoming episodes and movies
- 🕐 **History** — view, add, and remove watch history entries
- ⭐ **Ratings** — get, add, and remove ratings for movies, shows, and episodes
- 📋 **Watchlist** — full CRUD on your movie/show watchlist
- ✅ **Checkin** — check into what you're watching right now
- 🤖 **Recommendations** — personalised movie and show suggestions

---

## Quick Start

### 1. Create a Trakt API app

Go to [trakt.tv/oauth/applications/new](https://trakt.tv/oauth/applications/new) and create a new app. You only need to fill in the name — leave the redirect URI as `urn:ietf:wg:oauth:2.0:oob`. Copy your **Client ID** and **Client Secret**.

### 2. Run setup

```bash
npx @kud/mcp-trakt@latest setup
```

This launches the device OAuth flow: paste your Client ID and Secret when prompted, visit the URL shown, enter the code, and your credentials are saved securely to macOS Keychain. You never touch them again.

### 3. Add to your MCP client

No credentials needed in the config — the server reads them from macOS Keychain automatically.

```json
{
  "mcpServers": {
    "Trakt": {
      "command": "npx",
      "args": ["-y", "@kud/mcp-trakt@latest"]
    }
  }
}
```

---

## Docker / Remote MCP deployment

The default `npx @kud/mcp-trakt` path still uses stdio for local MCP clients. Docker deployments can switch to Streamable HTTP with `MCP_TRANSPORT=http` and file-backed Trakt credentials so the container does not need macOS Keychain.

### 1. Prepare the environment

```bash
git clone https://github.com/<your-username>/mcp-trakt.git
cd mcp-trakt
cp .env.example .env
```

Edit `.env` and set at least:

```bash
MCP_TRAKT_CLIENT_ID=your-trakt-client-id
MCP_TRAKT_CLIENT_SECRET=your-trakt-client-secret
MCP_HTTP_AUTH_TOKEN=use-a-long-random-token
```

Keep `.env` private. It is ignored by git.

### 2. First-time Trakt authorization

Run the setup command in the same container environment that will store tokens:

```bash
docker compose run --rm mcp-trakt npm run setup
```

The setup command uses Trakt's device-code OAuth flow by default, prints a verification URL and user code, and writes tokens to `/data/trakt-tokens.json`. If Trakt rejects the device-code request, setup automatically falls back to a standard authorization-code flow: it prints an authorize URL, asks you to paste the returned code, exchanges it for tokens, and writes the same token file. That path is backed by the `mcp-trakt-data` Docker volume. The token file format is:

```json
{
  "client_id": "xxx",
  "client_secret": "xxx",
  "access_token": "xxx",
  "refresh_token": "xxx",
  "expires_at": 1790000000000
}
```

You can override the location with `MCP_TRAKT_TOKEN_FILE`. If an access token expires and a refresh token plus client secret are available, the server refreshes the token automatically and writes the refreshed token back to the configured token file (or `/data/trakt-tokens.json` when `/data` exists).

### 3. Start the HTTP MCP server

```bash
docker compose up -d --build
```

The Compose service exposes:

- Health check: `GET http://localhost:3000/health`
- Streamable HTTP MCP endpoint: `http://localhost:3000/mcp`

Test the health endpoint:

```bash
curl -i http://localhost:3000/health
```

If `MCP_HTTP_AUTH_TOKEN` is set, remote MCP clients must send:

```http
Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>
```

The health endpoint intentionally does not expose token values or detailed auth status.

To debug Trakt API failures, set `MCP_TRAKT_DEBUG=1` and restart the service. Request logs include method, URL, redacted request headers, and safe auth-state booleans; failed responses include status, response headers, and the first 2 KB of the response body without logging bearer tokens or client secrets. The server also accepts `TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET`, `TRAKT_ACCESS_TOKEN`, `TRAKT_REFRESH_TOKEN`, and `TRAKT_TOKEN_EXPIRES_AT` as aliases for the `MCP_TRAKT_*` variables.

### 4. Reverse proxy and HTTPS

For production, put the container behind a reverse proxy, terminate HTTPS there, and bind the Compose port only where appropriate for your host firewall. Do not expose the raw HTTP endpoint to the public internet without either `MCP_HTTP_AUTH_TOKEN` or an OAuth/OIDC-capable gateway.

Minimal nginx location example:

```nginx
location /mcp {
  proxy_pass http://127.0.0.1:3000/mcp;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header Authorization $http_authorization;
}

location /health {
  proxy_pass http://127.0.0.1:3000/health;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
}
```

Security checklist:

- Use HTTPS for any remote deployment.
- Set a long random `MCP_HTTP_AUTH_TOKEN`, or protect the service with an OAuth/OIDC gateway such as Authentik, Authelia, Cloudflare Access, or another reverse proxy that can enforce OAuth.
- Keep `.env` and `/data/trakt-tokens.json` private.
- Rotate Trakt credentials and tokens if they are leaked.
- Do not paste access or refresh tokens into logs or issue reports.

### 5. Useful Docker commands

```bash
docker compose logs --tail=100 mcp-trakt
docker compose exec mcp-trakt node dist/index.js setup
docker compose down
```

## Remote MCP clients

### Claude Desktop / Claude remote connectors

Claude Desktop has historically focused on local stdio MCP servers. If your Claude app or plan supports remote MCP connectors directly, configure the remote URL as:

```text
https://your-domain.example.com/mcp
```

and send this authorization header if you configured `MCP_HTTP_AUTH_TOKEN`:

```text
Authorization: Bearer YOUR_TOKEN
```

If your Claude Desktop build does not support direct remote HTTP MCP servers, use a local stdio-to-HTTP bridge. One common pattern is `mcp-remote`; verify the current package options before relying on this exact shape:

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

### ChatGPT custom connectors

Use the remote MCP URL:

```text
https://your-domain.example.com/mcp
```

ChatGPT custom connector availability depends on your plan/workspace and current OpenAI feature access. If ChatGPT requires OAuth for custom connectors, this project's simple bearer-token gate is not a complete OAuth provider. For production, place this service behind an OAuth/OIDC-capable gateway and expose only HTTPS.

### MCP Inspector

After building locally, you can inspect the stdio server with:

```bash
npm run inspect
```

For the Docker HTTP endpoint, start the service and run:

```bash
npm run inspect:http
```

If bearer auth is enabled, configure the Inspector request headers with `Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>`.

---

## Installation

Run `npx @kud/mcp-trakt@latest setup` first — this saves your credentials to macOS Keychain so no tokens are needed in any config file.

<details>
<summary><strong>Claude Code CLI</strong></summary>

```bash
claude mcp add trakt npx -- -y @kud/mcp-trakt@latest
```

</details>

<details>
<summary><strong>Claude Desktop — macOS</strong></summary>

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "Trakt": {
      "command": "npx",
      "args": ["-y", "@kud/mcp-trakt@latest"]
    }
  }
}
```

Restart Claude Desktop after saving.

</details>

<details>
<summary><strong>Claude Desktop — Windows</strong></summary>

Edit `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "Trakt": {
      "command": "npx",
      "args": ["-y", "@kud/mcp-trakt@latest"]
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "Trakt": {
      "command": "npx",
      "args": ["-y", "@kud/mcp-trakt@latest"]
    }
  }
}
```

</details>

<details>
<summary><strong>Windsurf</strong></summary>

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "Trakt": {
      "command": "npx",
      "args": ["-y", "@kud/mcp-trakt@latest"]
    }
  }
}
```

</details>

<details>
<summary><strong>VSCode</strong></summary>

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "Trakt": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@kud/mcp-trakt@latest"]
    }
  }
}
```

</details>

---

## Available Tools

### Search

| Tool     | Description                                          |
| -------- | ---------------------------------------------------- |
| `search` | Search for movies, shows, episodes, people, or lists |

### Movies

| Tool                     | Description                                         |
| ------------------------ | --------------------------------------------------- |
| `get_movie`              | Get detailed information about a movie              |
| `get_trending_movies`    | Movies currently being watched across Trakt         |
| `get_popular_movies`     | Most popular movies on Trakt                        |
| `get_anticipated_movies` | Most anticipated movies based on watchlist activity |
| `get_boxoffice_movies`   | Top 10 weekend box office movies                    |
| `get_movie_ratings`      | Community rating distribution for a movie           |
| `get_movie_related`      | Movies related to a given movie                     |
| `get_movie_people`       | Cast and crew for a movie                           |

### Shows

| Tool                    | Description                                        |
| ----------------------- | -------------------------------------------------- |
| `get_show`              | Get detailed information about a TV show           |
| `get_trending_shows`    | Shows currently being watched across Trakt         |
| `get_popular_shows`     | Most popular TV shows on Trakt                     |
| `get_anticipated_shows` | Most anticipated shows based on watchlist activity |
| `get_show_ratings`      | Community rating distribution for a show           |
| `get_show_seasons`      | All seasons, optionally with full episode details  |
| `get_show_people`       | Cast and crew for a show                           |
| `get_show_related`      | TV shows related to a given show                   |

### Episodes

| Tool                  | Description                         |
| --------------------- | ----------------------------------- |
| `get_season_episodes` | All episodes in a specific season   |
| `get_episode`         | Full details for a specific episode |

### People

| Tool                 | Description                        |
| -------------------- | ---------------------------------- |
| `get_person`         | Actor or director profile          |
| `get_person_credits` | Movie or show credits for a person |

### Calendar

| Tool                     | Description                                  |
| ------------------------ | -------------------------------------------- |
| `get_my_show_calendar`   | My upcoming episodes (personalised)          |
| `get_my_movie_calendar`  | My upcoming movies (personalised)            |
| `get_all_show_calendar`  | All shows premiering and airing across Trakt |
| `get_all_movie_calendar` | All movies releasing across Trakt            |

### History

| Tool                  | Description                              |
| --------------------- | ---------------------------------------- |
| `get_history`         | Watch history for the authenticated user |
| `add_to_history`      | Mark movies or episodes as watched       |
| `remove_from_history` | Remove entries from watch history        |

### Collection

| Tool                     | Description                         |
| ------------------------ | ----------------------------------- |
| `get_collection_movies`  | All movies in the user's collection |
| `get_collection_shows`   | All shows in the user's collection  |
| `add_to_collection`      | Add movies, shows, or episodes      |
| `remove_from_collection` | Remove items from the collection    |

### Watched

| Tool                 | Description                                    |
| -------------------- | ---------------------------------------------- |
| `get_watched_movies` | All watched movies with play counts            |
| `get_watched_shows`  | All watched shows with play counts per episode |

### Playback

| Tool              | Description                              |
| ----------------- | ---------------------------------------- |
| `get_playback`    | Paused playback progress to resume later |
| `delete_playback` | Delete a paused playback entry           |

### Sync

| Tool                       | Description                                        |
| -------------------------- | -------------------------------------------------- |
| `get_sync_last_activities` | Timestamps for when each resource was last updated |

### Ratings

| Tool            | Description                                     |
| --------------- | ----------------------------------------------- |
| `get_ratings`   | Ratings given by the authenticated user         |
| `add_rating`    | Rate movies, shows, seasons, or episodes (1–10) |
| `remove_rating` | Remove ratings from items                       |

### Watchlist

| Tool                    | Description                             |
| ----------------------- | --------------------------------------- |
| `get_watchlist`         | View the authenticated user's watchlist |
| `add_to_watchlist`      | Add movies, shows, or episodes          |
| `remove_from_watchlist` | Remove items from the watchlist         |

### Checkin

| Tool             | Description                                        |
| ---------------- | -------------------------------------------------- |
| `checkin`        | Check in to a movie or episode you're watching now |
| `delete_checkin` | Cancel the current active checkin                  |

### Scrobble

| Tool             | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `scrobble_start` | Start scrobbling when playback begins                |
| `scrobble_pause` | Pause scrobbling to save progress                    |
| `scrobble_stop`  | Stop scrobbling when playback ends to record a watch |

### Recommendations

| Tool                        | Description                          |
| --------------------------- | ------------------------------------ |
| `get_movie_recommendations` | Personalised movie recommendations   |
| `get_show_recommendations`  | Personalised TV show recommendations |

### User

| Tool                | Description                             |
| ------------------- | --------------------------------------- |
| `get_user_profile`  | Profile info for any user (or yourself) |
| `get_user_stats`    | Watch statistics for a user             |
| `get_user_watching` | What a user is currently watching       |

**Total: 53 Tools**

---

## Example Conversations

> "What movies are trending on Trakt right now?"

> "Search for Breaking Bad and give me its full details."

> "What episodes of Severance do I have coming up this week?"

> "Mark that I just watched Dune: Part Two — give it a 9."

> "Add The Penguin to my watchlist."

> "Check me in to S02E01 of The Bear."

> "What have I watched this month?"

> "Give me 10 personalised movie recommendations."

> "Who plays the lead in Succession and what else have they been in?"

> "What are my all-time watch stats?"

---

## Development

### Project Structure

```
mcp-trakt/
├── src/
│   └── index.ts       # Full server — all 36 tools
├── dist/              # Compiled output (git-ignored)
├── setup.js           # OAuth device flow setup script
├── package.json
└── tsconfig.json
```

### Scripts

| Script                | Purpose                                    |
| --------------------- | ------------------------------------------ |
| `npm run setup`       | Run OAuth device flow and save credentials |
| `npm run build`       | Compile TypeScript to `dist/`              |
| `npm run build:watch` | Watch mode compilation                     |
| `npm run dev`         | Run directly with `tsx` (no build needed)  |
| `npm run inspect`     | Open MCP Inspector against built output    |
| `npm run inspect:dev` | Open MCP Inspector with live `tsx`         |
| `npm run typecheck`   | Type-check without emitting                |
| `npm run clean`       | Remove `dist/`                             |

### Dev Workflow

```bash
# Run without building
npm run dev

# Inspect all tools interactively in the browser
npm run inspect:dev
```

---

## Authentication

Trakt uses OAuth 2.0. The `npm run setup` script handles the full device flow — you never manage tokens manually.

### How it works

1. Run `npm run setup`
2. Enter your **Client ID** and **Client Secret** from [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications)
3. Visit the URL shown (e.g. `https://trakt.tv/activate`), enter the displayed code
4. Tokens are saved to macOS Keychain — the server reads them automatically on every start

To refresh an expired token, just run `npm run setup` again.

### Test your credentials

```bash
curl -s https://api.trakt.tv/users/me \
  -H "trakt-api-version: 2" \
  -H "trakt-api-key: YOUR_CLIENT_ID" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" | jq .username
```

---

## Troubleshooting

**Server not showing in Claude Desktop**

- Check JSON syntax in `claude_desktop_config.json`
- Verify the path to `dist/index.js` is absolute and the file exists
- Run `npm run build` if `dist/` is missing

**401 / auth errors**

- Access tokens expire after 3 months — regenerate via the OAuth device flow
- Make sure `MCP_TRAKT_CLIENT_ID` matches the app your access token was issued for
- Check logs: Claude Desktop → Help → Show Logs

**No data returned for personal endpoints (history, watchlist, etc.)**

- These require a valid `MCP_TRAKT_ACCESS_TOKEN` — public/read-only `client_id` alone is not enough
- Make sure the token was granted the correct scopes during the OAuth flow

---

## Security Best Practices

- Local stdio credentials are stored in macOS Keychain by default; Docker deployments use a mounted token file when `MCP_TRAKT_AUTH_STORE=file`.
- Keep `.env` and token files private, and never commit secrets.
- Use HTTPS and `MCP_HTTP_AUTH_TOKEN` or an OAuth/OIDC reverse proxy for remote HTTP deployments.
- Rotate your access token if it is accidentally exposed — run `npm run setup` again.
- Trakt access tokens expire; the server refreshes them automatically when a refresh token and client secret are available.
- Treat your access token like a password: full account access with history/checkin write rights

---

## Tech Stack

|               |                                      |
| ------------- | ------------------------------------ |
| Runtime       | Node.js ≥ 20                         |
| Language      | TypeScript 5.x                       |
| Target        | ES2023                               |
| Protocol      | Model Context Protocol (MCP) SDK 1.x |
| HTTP Client   | Native `fetch`                       |
| Module System | ESM (`"type": "module"`)             |

---

## Contributing

Issues and PRs welcome at [github.com/kud/mcp-trakt](https://github.com/kud/mcp-trakt).

## License

MIT © kud

## Acknowledgments

Built on the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) by Anthropic. API provided by [Trakt](https://trakt.tv).

## Support

Open an issue at [github.com/kud/mcp-trakt/issues](https://github.com/kud/mcp-trakt/issues).

---

<div align="center">

Made with ❤️ for TV and movie fans

⭐ Star this repo if it's useful • [↑ Back to top](#)

</div>
