// ---------------------------------------------------------------------------
// Config file shape  (mcp-router.config.json)
// ---------------------------------------------------------------------------

export interface StdioMcpConfig {
  type: "stdio";
  /** Executable to spawn, e.g. "node" or "python" */
  command: string;
  /** Arguments passed to the command */
  args: string[];
  /** Optional extra env vars merged into the child process environment */
  env?: Record<string, string>;
}

export interface SseMcpConfig {
  type: "sse";
  /** Full URL of the SSE endpoint, e.g. "http://localhost:3001/sse" */
  url: string;
  /** Optional HTTP headers (e.g. authorization) */
  headers?: Record<string, string>;
}

export type McpServerConfig = StdioMcpConfig | SseMcpConfig;

export type RouterMode = "router" | "delegated" | "passthrough" | "smart";

export type ProviderType = "anthropic" | "openai-compatible";

export interface ProviderConfig {
  type: ProviderType;
  /** Base URL for OpenAI-compatible endpoints (e.g. http://localhost:11434/v1 for Ollama) */
  baseUrl?: string;
  /** API key — optional for local endpoints like Ollama; required for Groq/OpenRouter */
  apiKey?: string;
  /** Model name */
  model?: string;
  /** Max tokens per response */
  maxTokens?: number;
  /** Max agentic iterations (router mode only). Default 5 */
  maxIterations?: number;
}

export interface RouterConfig {
  /** Named downstream MCP servers */
  mcpServers: Record<string, McpServerConfig>;
  /**
   * AI provider. Defaults to Anthropic when omitted (backward compat).
   * Set type to "openai-compatible" to use Ollama, Groq, LM Studio, OpenRouter, etc.
   */
  provider?: ProviderConfig;
  /**
   * Operating mode. Defaults to "router".
   * - router:      1 tool (route). Claude picks + executes. Needs API key.
   * - delegated:   2 tools (select + execute). Claude classifies only. Needs API key.
   * - passthrough: All downstream tools exposed directly. No API key needed.
   * - smart:       All tools + recommend tool. Needs API key.
   */
  mode?: RouterMode;
  claude?: {
    /** Defaults to claude-sonnet-4-6 */
    model?: string;
    /** Defaults to 8192 */
    maxTokens?: number;
    /** Max routing iterations before returning a partial answer. Defaults to 5 */
    maxIterations?: number;
  };
}

// ---------------------------------------------------------------------------
// Runtime types
// ---------------------------------------------------------------------------

/** A single tool discovered from a downstream MCP server */
export interface DiscoveredTool {
  /** Original tool name as reported by the MCP server */
  name: string;
  description: string;
  /** JSON Schema for the tool's input, as returned by the MCP server */
  inputSchema: Record<string, unknown>;
  /** Which named MCP server owns this tool */
  mcpName: string;
}
