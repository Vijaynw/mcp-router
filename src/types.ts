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

export interface RouterConfig {
  /** Named downstream MCP servers */
  mcpServers: Record<string, McpServerConfig>;
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
