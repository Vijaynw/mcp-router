import { z } from "zod";
export declare const RouterConfigSchema: z.ZodObject<{
    mcpServers: z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"stdio">;
        command: z.ZodString;
        args: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        type: "stdio";
        command: string;
        args: string[];
        env?: Record<string, string> | undefined;
    }, {
        type: "stdio";
        command: string;
        args?: string[] | undefined;
        env?: Record<string, string> | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"sse">;
        url: z.ZodString;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        type: "sse";
        url: string;
        headers?: Record<string, string> | undefined;
    }, {
        type: "sse";
        url: string;
        headers?: Record<string, string> | undefined;
    }>]>>, Record<string, {
        type: "stdio";
        command: string;
        args: string[];
        env?: Record<string, string> | undefined;
    } | {
        type: "sse";
        url: string;
        headers?: Record<string, string> | undefined;
    }>, Record<string, {
        type: "stdio";
        command: string;
        args?: string[] | undefined;
        env?: Record<string, string> | undefined;
    } | {
        type: "sse";
        url: string;
        headers?: Record<string, string> | undefined;
    }>>;
    claude: z.ZodOptional<z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
        maxIterations: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        model?: string | undefined;
        maxTokens?: number | undefined;
        maxIterations?: number | undefined;
    }, {
        model?: string | undefined;
        maxTokens?: number | undefined;
        maxIterations?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    mcpServers: Record<string, {
        type: "stdio";
        command: string;
        args: string[];
        env?: Record<string, string> | undefined;
    } | {
        type: "sse";
        url: string;
        headers?: Record<string, string> | undefined;
    }>;
    claude?: {
        model?: string | undefined;
        maxTokens?: number | undefined;
        maxIterations?: number | undefined;
    } | undefined;
}, {
    mcpServers: Record<string, {
        type: "stdio";
        command: string;
        args?: string[] | undefined;
        env?: Record<string, string> | undefined;
    } | {
        type: "sse";
        url: string;
        headers?: Record<string, string> | undefined;
    }>;
    claude?: {
        model?: string | undefined;
        maxTokens?: number | undefined;
        maxIterations?: number | undefined;
    } | undefined;
}>;
export type RouterConfig = z.infer<typeof RouterConfigSchema>;
export type StdioMcpConfig = Extract<RouterConfig["mcpServers"][string], {
    type: "stdio";
}>;
export type SseMcpConfig = Extract<RouterConfig["mcpServers"][string], {
    type: "sse";
}>;
export type McpServerConfig = RouterConfig["mcpServers"][string];
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
//# sourceMappingURL=types.d.ts.map