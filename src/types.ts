import { z } from "zod";

// ---------------------------------------------------------------------------
// Config file shape  (mcp-router.config.json)
// ---------------------------------------------------------------------------

export const RouterConfigSchema = z.object({
  mcpServers: z
    .record(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("stdio"),
          command: z.string().min(1, "command must not be empty"),
          args: z.array(z.string()).default([]),
          env: z.record(z.string()).optional(),
        }),
        z.object({
          type: z.literal("sse"),
          url: z.string().url("url must be a valid URL"),
          headers: z.record(z.string()).optional(),
        }),
      ])
    )
    .refine((s) => Object.keys(s).length > 0, "mcpServers must not be empty"),
  claude: z
    .object({
      model: z.string().optional(),
      maxTokens: z.number().positive().optional(),
      maxIterations: z.number().positive().optional(),
    })
    .optional(),
});

export type RouterConfig = z.infer<typeof RouterConfigSchema>;
export type StdioMcpConfig = Extract<RouterConfig["mcpServers"][string], { type: "stdio" }>;
export type SseMcpConfig = Extract<RouterConfig["mcpServers"][string], { type: "sse" }>;
export type McpServerConfig = RouterConfig["mcpServers"][string];

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
