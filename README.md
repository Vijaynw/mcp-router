# mcp-router

> Proxy all your MCP servers behind one smart router — choose how much AI you want.

Instead of exposing 50+ tools to your AI editor and hoping it picks the right one, `mcp-router` sits in front of all your MCP servers and gives you four modes to match your workflow and budget.

---

## Modes at a glance

| Mode | Your editor sees | AI does | API key needed |
|---|---|---|---|
| `router` | 1 tool (`route`) | picks **and** executes | yes |
| `delegated` | 2 tools (`select` + `execute`) | picks only — you review before execution | yes |
| `passthrough` | all downstream tools directly | nothing | no |
| `smart` | all tools + `recommend` | recommends only — editor executes | yes |

---

## Why

AI editors connect to MCP servers to give agents superpowers — file access, GitHub, databases, Slack, etc. The problem: the more MCP servers you add, the more tools the agent sees. Five servers × ten tools each = 50 tools cluttering every prompt. The agent slows down, picks the wrong tool, or gets confused.

`mcp-router` solves this by standing between your editor and all your MCP servers, letting you control exactly how many tools the editor sees and how much AI is involved.

---

## Requirements

- Node.js >= 18
- An AI provider (see [Providers](#providers) — Ollama is free and local)

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

**1. Create `mcp-router.config.json`:**

```json
{
  "mode": "router",
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
      "env": { "GITHUB_TOKEN": "ghp_your_token_here" }
    }
  },
  "claude": {
    "model": "claude-sonnet-4-6"
  }
}
```

**2. Set your API key** (skip if using Ollama):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**3. Add to your editor** (`~/.windsurf/mcp_config.json`, `~/.cursor/mcp.json`, or `claude_desktop_config.json`):

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

Restart your editor — you'll see one `route` tool instead of all the individual tools.

---

## Modes

### `router` mode (default)

Your editor sees **1 tool**: `route(task)`. Describe what you want in plain English — the router picks the right downstream tool, executes it (chaining multiple calls if needed), and returns the result. You never need to know tool names.

```
Your editor ──── route("create a GitHub issue about X") ────► mcp-router
                                                                    │
                                                            AI picks + calls
                                                                    │
                                                        github__create_issue(...)
                                                                    │
Your editor ◄─────────────── result ────────────────────────────────┘
```

**Config:**
```json
{
  "mode": "router",
  "mcpServers": { ... },
  "claude": { "model": "claude-sonnet-4-6", "maxTokens": 8192, "maxIterations": 5 }
}
```

**Best for:** Fully automated pipelines, single-user setups where you trust the AI to execute.

---

### `delegated` mode

Your editor sees **2 tools**: `select(task)` and `execute(tool, args)`. The AI only *classifies* which tool to use — you (or your editor) review the selection and args before anything runs.

```
select("get my open GitHub issues")
        │
        AI reads names+descriptions only (no schemas — tiny payload)
        │
        returns { tool: "github__list_issues", schema: {...}, suggestedArgs: {...}, reason: "..." }
        │
[you review in Windsurf/Cursor]
        │
execute("github__list_issues", { state: "open" })
        │
        router proxies to GitHub MCP — no AI involved
        │
        result
```

**Config:**
```json
{
  "mode": "delegated",
  "mcpServers": { ... },
  "claude": { "model": "claude-haiku-4-5-20251001", "maxTokens": 1024 }
}
```

**Best for:** Windsurf / Cursor users who want to review tool calls before execution. Most cost-efficient AI mode — Haiku with 1K tokens is sufficient.

---

### `passthrough` mode

Your editor sees **all downstream tools** directly (no AI involved at all). The router acts as a multiplexer — it connects to all your MCP servers and exposes their tools under namespaced names (`server__tool`).

```
Your editor ──── filesystem__list_directory("/tmp") ────► mcp-router ──► filesystem MCP
Your editor ──── github__create_issue({...})         ────► mcp-router ──► github MCP
```

**Config:**
```json
{
  "mode": "passthrough",
  "mcpServers": { ... }
}
```

No API key needed. The router handles connection management and tool namespacing — you still get unified access to all servers through one MCP connection.

**Best for:** Editors with good native tool selection, situations where you want full visibility and control over every call.

---

### `smart` mode

Your editor sees **all downstream tools** (like passthrough) plus one extra `recommend(task)` tool. When you call `recommend`, the AI suggests which tool to use and what args — but the editor executes it directly using its own context.

```
recommend("search for TODO comments")
        │
        AI reads names+descriptions, returns { tool, args, reason }
        │
[editor calls the recommended tool directly]
```

**Config:**
```json
{
  "mode": "smart",
  "mcpServers": { ... },
  "claude": { "model": "claude-haiku-4-5-20251001" }
}
```

**Best for:** Editors that handle tool execution well but benefit from AI-assisted discovery.

---

## Providers

mcp-router works with **Anthropic Claude** (paid) or any **OpenAI-compatible endpoint** (Ollama, Groq, LM Studio, OpenRouter). Configure via the `provider` block.

### Anthropic Claude (default)

```json
{
  "claude": {
    "model": "claude-sonnet-4-6",
    "maxTokens": 8192,
    "maxIterations": 5
  }
}
```

Requires `ANTHROPIC_API_KEY` env var. Available models: `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, `claude-opus-4-7`.

### Ollama — free, runs locally

```bash
ollama serve
ollama pull llama3.1:8b
```

```json
{
  "provider": {
    "type": "openai-compatible",
    "baseUrl": "http://localhost:11434/v1",
    "model": "llama3.1:8b",
    "apiKey": "ollama"
  }
}
```

No API key env var needed. Any model with tool-calling support works for `router` mode (`llama3.1`, `mistral`, `qwen2.5`). Any model works for `delegated` and `smart` modes.

### Groq — free tier, fast cloud inference

Get a free API key at [console.groq.com](https://console.groq.com).

```json
{
  "provider": {
    "type": "openai-compatible",
    "baseUrl": "https://api.groq.com/openai/v1",
    "model": "llama-3.1-8b-instant",
    "apiKey": "gsk_your_key_here"
  }
}
```

### LM Studio / OpenRouter

Same pattern — set `baseUrl` to your endpoint and `model` to the model name.

### `provider` fields

| Field | Required | Description |
|---|---|---|
| `type` | yes | `"openai-compatible"` |
| `baseUrl` | yes | Base URL of the OpenAI-compatible API |
| `model` | yes | Model name (provider-specific) |
| `apiKey` | no | API key — optional for local endpoints like Ollama |
| `maxTokens` | no | Max tokens per response (default: 8192 for router, 1024 for delegated/smart) |
| `maxIterations` | no | Max agentic iterations in router mode (default: 5) |

---

## Configuration reference

### `mcp-router.config.json`

| Field | Type | Default | Description |
|---|---|---|---|
| `mcpServers` | object | required | Map of named downstream MCP servers |
| `mode` | string | `"router"` | `router`, `delegated`, `passthrough`, or `smart` |
| `provider` | object | — | AI provider config (Ollama, Groq, etc.) — overrides `claude` block |
| `claude` | object | — | Anthropic provider config |
| `claude.model` | string | `claude-sonnet-4-6` | Claude model |
| `claude.maxTokens` | number | `8192` | Max tokens per response |
| `claude.maxIterations` | number | `5` | Max tool calls chained per request (router mode) |

### Server types

**`stdio`** — spawns a local process (most MCP servers):

```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
  "env": { "EXTRA_VAR": "value" }
}
```

**`sse`** — connects to a remote SSE endpoint:

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
| `ANTHROPIC_API_KEY` | — | Required when using Anthropic provider |
| `MCP_ROUTER_CONFIG` | `./mcp-router.config.json` | Path to config file |
| `TRANSPORT` | `stdio` | `stdio` or `http` |
| `PORT` | `3000` | HTTP port (when `TRANSPORT=http`) |
| `HOST` | `127.0.0.1` | HTTP bind address (when `TRANSPORT=http`) |
| `MCP_ROUTER_TOKEN` | — | Bearer token to protect HTTP endpoints |

---

## HTTP Mode

Run as an HTTP server instead of stdio — useful for remote or multi-client setups:

```bash
TRANSPORT=http PORT=3000 ANTHROPIC_API_KEY=sk-ant-... npx mcp-router
```

- **MCP endpoint:** `POST http://127.0.0.1:3000/mcp`
- **Health check:** `GET http://127.0.0.1:3000/health`

```json
{ "status": "ok", "tools": 14, "servers": ["filesystem", "github"] }
```

---

## Cost

| Mode | AI calls per request | Cheapest model | Approx cost |
|---|---|---|---|
| `router` | 1 + 1 per chained tool call | Haiku / Llama 3.1 8B | ~$0.0005–0.015 |
| `delegated` | 1 (classification only) | Haiku / Llama 3.1 8B | ~$0.0001–0.0003 |
| `smart` | 1 (recommendation only) | Haiku / Llama 3.1 8B | ~$0.0001–0.0003 |
| `passthrough` | 0 | — | free |

Using Ollama or Groq's free tier makes all AI modes effectively free.

---

## Security Considerations

### Config file

**Never commit `mcp-router.config.json`** — it may contain API keys and tokens. It is listed in `.gitignore`. Use `mcp-router.config.example.json` as a template.

### HTTP mode

- **Always set `MCP_ROUTER_TOKEN`** when running HTTP mode:
  ```bash
  MCP_ROUTER_TOKEN=your-secret TRANSPORT=http npx mcp-router
  ```
  All requests must include `Authorization: Bearer your-secret`.

- **Never bind to `0.0.0.0` without authentication.** The default `HOST=127.0.0.1` is safe for local use.

- For internet-facing deployments, put the router behind a reverse proxy (nginx, Caddy) that handles TLS.

### Stdio mode

Only accepts connections from the local editor process — no network exposure. Safest for personal use.

---

## Development

```bash
git clone https://github.com/vijaynw/mcp-router
cd mcp-router
npm install
npm run build   # compile to dist/
npm start       # run compiled output
```

---

## License

MIT © [Vijaynw](https://github.com/vijaynw)
