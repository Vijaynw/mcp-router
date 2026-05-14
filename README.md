# mcp-router

> One tool to rule them all — a smart MCP router that uses Claude to automatically pick and call the right downstream MCP tool from your natural language task.

Instead of exposing 50+ tools to your AI editor (Windsurf, Cursor, etc.) and hoping it picks the right one, `mcp-router` proxies all your MCP servers behind a **single `route` tool**. You describe what you want in plain English — the router figures out which tool to call.

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

AI editors connect to MCP servers to give agents superpowers — file access, GitHub, databases, Slack, etc. The problem: the more MCP servers you add, the more tools the agent sees. With 5 servers × 10 tools each = 50 tools cluttering every prompt. The agent slows down, picks the wrong tool, or gets confused.

`mcp-router` solves this by:

- **Hiding complexity** — your editor sees exactly 1 tool regardless of how many MCPs you connect
- **Intelligent routing** — Claude reads your request and picks the best downstream tool automatically
- **Multi-step tasks** — for complex requests, Claude chains multiple tool calls in sequence and returns a single answer

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
      "url": "http://localhost:3001/sse"
    }
  },
  "claude": {
    "model": "claude-sonnet-4-6",
    "maxTokens": 8192,
    "maxIterations": 5
  }
}
```

| Field | Default | Description |
|---|---|---|
| `mcpServers` | — | Map of named downstream MCP servers |
| `claude.model` | `claude-sonnet-4-6` | Claude model used for routing |
| `claude.maxTokens` | `8192` | Max tokens per routing call |
| `claude.maxIterations` | `5` | Max tool calls chained for one request |

> The `claude` block is optional — all fields have sensible defaults.

### Server types

**stdio** — spawns a local process (most MCP servers):

```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
  "env": { "EXTRA_VAR": "value" }
}
```

**sse** — connects to a remote SSE endpoint:

```json
{
  "type": "sse",
  "url": "http://localhost:3001/sse",
  "headers": { "Authorization": "Bearer token" }
}
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **Required.** Your Anthropic API key |
| `MCP_ROUTER_CONFIG` | `./mcp-router.config.json` | Path to config file |
| `TRANSPORT` | `stdio` | `stdio` or `http` |
| `PORT` | `3000` | HTTP port (when `TRANSPORT=http`) |
| `HOST` | `127.0.0.1` | HTTP host (when `TRANSPORT=http`) |

---

## HTTP Mode

Run as an HTTP server instead of stdio — useful for remote/multi-client setups:

```bash
TRANSPORT=http PORT=3000 ANTHROPIC_API_KEY=sk-ant-... npx mcp-router
```

Endpoint: `POST http://127.0.0.1:3000/mcp`  
Health check: `GET http://127.0.0.1:3000/health`

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
        "MCP_ROUTER_CONFIG": "C:/Users/you/mcp-router.config.json"
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
3. Claude picks the best tool (or chains multiple tools for complex tasks)
4. The router executes the call on the correct downstream server and returns the result

---

## Cost

Each `route` call makes **one Claude API call** (plus one per chained tool if multi-step). With `claude-sonnet-4-6`:

- Simple single-tool task: ~$0.001–0.003
- Multi-step task (3–5 tool calls): ~$0.005–0.015

For occasional use in an editor, this is negligible. For high-volume automated pipelines, consider using `claude-haiku-4-5` as the routing model in your config.

---

## Development

```bash
git clone https://github.com/vijaynw/mcp-router
cd mcp-router
npm install
npm run dev     # watch mode with tsx
npm run build   # compile to dist/
```

---

## License

MIT © [Vijaynw](https://github.com/vijaynw)
