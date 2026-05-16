# mcp-router

> One tool to rule them all — a smart MCP router that uses Claude to automatically pick and call the right downstream MCP tool from your natural language task.

Instead of exposing 50+ tools to your AI editor (Windsurf, Cursor, Claude Desktop, etc.) and hoping it picks the right one, `mcp-router` proxies all your MCP servers behind a **single `route` tool**. Describe what you want in plain English — the router figures out which tool to call.

```
Your prompt → route("create a GitHub issue about X")
                    ↓
              Claude picks the right tool
                    ↓
              github__create_issue(...)
                    ↓
              Result back to you
```

---

## Why

AI editors connect to MCP servers to give agents superpowers — file access, GitHub, databases, Slack, etc. The problem: the more MCP servers you add, the more tools the agent sees. Five servers × ten tools each = 50 tools cluttering every prompt. The agent slows down, picks the wrong tool, or gets confused.

`mcp-router` solves this by:

- **Hiding complexity** — your editor sees exactly 1 tool regardless of how many MCP servers you connect
- **Intelligent routing** — Claude reads your request and picks the best downstream tool automatically
- **Multi-step tasks** — for complex requests, Claude chains multiple tool calls in sequence and returns a single answer

---

## Requirements

- Node.js >= 18
- An [Anthropic API key](https://console.anthropic.com/)

---

## Install

```bash
npm install -g mcp-router
```

Or run without installing:

```bash
npx mcp-router
```

---

## Quick Start

**1. Create a config file** — `mcp-router.config.json` in your project or home directory:

```json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/your/path"]
    },
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

**2. Set your Anthropic API key:**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**3. Add to your editor** (Windsurf / Cursor / Claude Desktop):

```json
{
  "mcpServers": {
    "router": {
      "command": "npx",
      "args": ["mcp-router"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "MCP_ROUTER_CONFIG": "/absolute/path/to/mcp-router.config.json"
      }
    }
  }
}
```

Restart your editor — you'll see a single `route` tool instead of all the individual tools.

---

## Usage

Once connected, just describe what you want:

| You say | Router calls |
|---|---|
| `"list files in /tmp"` | `filesystem__list_directory` |
| `"create a GitHub issue titled 'Bug: login fails'"` | `github__create_issue` |
| `"search for TODO in all JS files under src/"` | `filesystem__search_files` |
| `"what's in the README?"` | `filesystem__read_file` |

For complex tasks, the router chains calls automatically:

> *"Read the package.json, then create a GitHub issue summarising the dependencies"*
> → reads file → creates issue → returns result

### Dry Run (preview without executing)

Use the `route_plan` tool to see what the router *would* do — without executing anything:

```
route_plan("delete all .tmp files in /home/user and open a GitHub issue summarising what was removed")

→ Plan:
  Step 1: filesystem__list_directory({ path: "/home/user" }) — list to find .tmp files
  Step 2: filesystem__delete_file({ path: "..." }) × N — remove each .tmp file
  Step 3: github__create_issue({ title: "Cleanup: N .tmp files removed", body: "..." })
```

This is useful before destructive or multi-step operations.

### Passthrough Mode (no API key required)

If `ANTHROPIC_API_KEY` is not set, the router starts in **passthrough mode**: all downstream tools are exposed directly as individual MCP tools with no AI routing. Useful when you just want an MCP aggregator or when testing without using the Claude API.

---

## Configuration

### `mcp-router.config.json`

```json
{
  "mcpServers": {
    "<name>": {
      "type": "stdio",
      "command": "node",
      "args": ["path/to/server.js"],
      "env": { "MY_TOKEN": "..." }
    },
    "<name2>": {
      "type": "sse",
      "url": "http://localhost:3001/sse",
      "headers": { "Authorization": "Bearer token" }
    }
  },
  "claude": {
    "model": "claude-sonnet-4-6",
    "maxTokens": 8192,
    "maxIterations": 5
  }
}
```

#### `mcpServers` fields

**`stdio`** — spawns a local process (most MCP servers):

| Field | Required | Description |
|---|---|---|
| `type` | yes | `"stdio"` |
| `command` | yes | Executable to run (e.g. `"npx"`, `"node"`, `"python"`) |
| `args` | yes | Arguments array passed to the command |
| `env` | no | Extra environment variables merged into the child process |

**`sse`** — connects to a remote SSE endpoint:

| Field | Required | Description |
|---|---|---|
| `type` | yes | `"sse"` |
| `url` | yes | Full SSE endpoint URL (e.g. `"http://localhost:3001/sse"`) |
| `headers` | no | HTTP headers to include (e.g. `Authorization`) |

#### `claude` fields (all optional)

| Field | Default | Description |
|---|---|---|
| `model` | `claude-sonnet-4-6` | Claude model used for routing |
| `maxTokens` | `8192` | Max tokens per Claude response |
| `maxIterations` | `5` | Max tool calls chained per request before returning a partial answer |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Your Anthropic API key. If omitted, router starts in passthrough mode (all tools exposed directly, no AI routing) |
| `MCP_ROUTER_CONFIG` | `./mcp-router.config.json` | Path to config file |
| `TRANSPORT` | `stdio` | `stdio` or `http` |
| `PORT` | `3000` | HTTP port (when `TRANSPORT=http`) |
| `HOST` | `127.0.0.1` | HTTP bind address (when `TRANSPORT=http`) |
| `MCP_ROUTER_TOKEN` | — | Bearer token to protect HTTP endpoints. If set, all requests must include `Authorization: Bearer <token>` |

---

## HTTP Mode

Run as an HTTP server instead of stdio — useful for remote or multi-client setups:

```bash
TRANSPORT=http PORT=3000 ANTHROPIC_API_KEY=sk-ant-... npx mcp-router
```

- **MCP endpoint:** `POST http://127.0.0.1:3000/mcp`
- **Health check:** `GET http://127.0.0.1:3000/health`

The health endpoint returns the number of connected tools and servers:

```json
{ "status": "ok", "tools": 14, "servers": ["filesystem", "github"] }
```

---

## Editor Setup

### Windsurf

Edit `~/.windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "router": {
      "command": "npx",
      "args": ["mcp-router"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "MCP_ROUTER_CONFIG": "/absolute/path/to/mcp-router.config.json"
      }
    }
  }
}
```

### Cursor

Edit `~/.cursor/mcp.json` with the same format as above.

### Claude Desktop

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "router": {
      "command": "npx",
      "args": ["mcp-router"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "MCP_ROUTER_CONFIG": "/Users/you/mcp-router.config.json"
      }
    }
  }
}
```

---

## How It Works

```
┌─────────────┐        route(task)         ┌──────────────────┐
│  Windsurf / │ ─────────────────────────► │                  │
│  Cursor /   │                            │   mcp-router     │
│  Claude     │ ◄───────────────────────── │                  │
└─────────────┘        result              └────────┬─────────┘
                                                    │
                                          Claude picks tool
                                                    │
                          ┌─────────────────────────┼──────────────────────┐
                          ▼                         ▼                      ▼
                  ┌───────────────┐      ┌─────────────────┐    ┌──────────────────┐
                  │  filesystem   │      │     github      │    │   your-mcp-xyz   │
                  │  MCP server   │      │   MCP server    │    │    MCP server    │
                  └───────────────┘      └─────────────────┘    └──────────────────┘
```

1. On startup, the router connects to every server in your config and **caches all their tools**
2. When `route(task)` is called, it sends your task + all discovered tools to Claude
3. Claude picks the best tool (or chains multiple tools for complex tasks) — first iteration forces a tool call, subsequent ones let Claude decide when it's done
4. The router executes the call(s) on the correct downstream server and returns the result

Tool names are encoded as `{server}__{tool}` (e.g. `github__create_issue`) and sanitised to match Anthropic's naming constraints. Cross-server collisions are handled automatically with a numeric suffix.

---

## Cost

Each `route` call makes **one Claude API call** (plus one more per additional chained tool call if multi-step). With `claude-sonnet-4-6`:

- Simple single-tool task: ~$0.001–0.003
- Multi-step task (3–5 tool calls): ~$0.005–0.015

For occasional use in an editor this is negligible. For high-volume automated pipelines, set `"model": "claude-haiku-4-5-20251001"` in the `claude` block of your config.

---

## Security Considerations

### Config file

**Never commit `mcp-router.config.json` to version control** — it may contain API tokens and credentials. `mcp-router.config.json` is already listed in `.gitignore`. Use `mcp-router.config.example.json` (included in the repo) as a template.

### HTTP mode

HTTP mode exposes all configured downstream tools over the network. Before using it:

- **Always set `MCP_ROUTER_TOKEN`** so only authorised clients can call the router:
  ```bash
  MCP_ROUTER_TOKEN=your-secret-token TRANSPORT=http npx mcp-router
  ```
  Clients must then send `Authorization: Bearer your-secret-token` with every request.

- **Never bind to `0.0.0.0` without authentication.** The default `HOST=127.0.0.1` is safe for local use. Exposing the router publicly without a token allows anyone to invoke all your configured MCP tools using your embedded credentials.

- For internet-facing deployments, put the router behind a reverse proxy (nginx, Caddy) that handles TLS.

### Stdio mode

Stdio mode only accepts connections from the local editor process — no network exposure. This is the safest mode for personal use.

---

## Development

```bash
git clone https://github.com/vijaynw/mcp-router
cd mcp-router
npm install
npm run dev     # watch mode (tsx)
npm run build   # compile to dist/
npm start       # run compiled output
```

---

## License

MIT © [Vijaynw](https://github.com/vijaynw)
