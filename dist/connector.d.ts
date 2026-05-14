import type { RouterConfig, DiscoveredTool } from "./types.js";
/**
 * Manages connections to all configured downstream MCP servers and
 * maintains an aggregated tool registry.
 */
export declare class McpConnector {
    private servers;
    /** Flat list of every tool from every connected MCP server */
    private toolRegistry;
    connectAll(config: RouterConfig): Promise<void>;
    private connectOne;
    private connectStdio;
    private connectSse;
    private discoverTools;
    /** All tools collected from every connected server */
    get tools(): DiscoveredTool[];
    /** Execute a named tool on the correct downstream server */
    callTool(toolName: string, toolArgs: Record<string, unknown>): Promise<string>;
    /**
     * Execute a tool by its DiscoveredTool entry — avoids cross-server name
     * collisions since we look up the server by mcpName directly.
     */
    callToolEntry(tool: DiscoveredTool, toolArgs: Record<string, unknown>): Promise<string>;
    disconnectAll(): Promise<void>;
}
//# sourceMappingURL=connector.d.ts.map