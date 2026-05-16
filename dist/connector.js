import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
/**
 * Manages connections to all configured downstream MCP servers and
 * maintains an aggregated tool registry.
 */
export class McpConnector {
    servers = [];
    /** Flat list of every tool from every connected MCP server */
    toolRegistry = [];
    async connectAll(config) {
        const entries = Object.entries(config.mcpServers);
        await Promise.allSettled(entries.map(async ([name, serverConfig]) => {
            try {
                const client = await this.connectOne(name, serverConfig);
                const tools = await this.discoverTools(name, client);
                this.servers.push({ name, client });
                this.toolRegistry.push(...tools);
                console.error(`[mcp-router] Connected to "${name}" — ${tools.length} tool(s) registered`);
            }
            catch (err) {
                console.error(`[mcp-router] WARNING: Could not connect to "${name}": ${err instanceof Error ? err.message : String(err)}. Skipping.`);
            }
        }));
        if (this.servers.length === 0) {
            throw new Error("No downstream MCP servers could be connected. Check your mcp-router.config.json.");
        }
        console.error(`[mcp-router] Ready. ${this.toolRegistry.length} total tool(s) from ${this.servers.length} server(s).`);
    }
    async connectOne(name, config) {
        const client = new Client({ name: "mcp-router", version: "1.0.0" }, { capabilities: {} });
        if (config.type === "stdio") {
            await this.connectStdio(client, config);
        }
        else {
            await this.connectSse(client, config);
        }
        return client;
    }
    async connectStdio(client, config) {
        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args ?? [],
            env: config.env
                ? { ...process.env, ...config.env }
                : undefined,
        });
        await client.connect(transport);
    }
    async connectSse(client, config) {
        const transport = new SSEClientTransport(new URL(config.url));
        await client.connect(transport);
    }
    async discoverTools(mcpName, client) {
        const response = await client.listTools();
        return response.tools.map((tool) => ({
            name: tool.name,
            description: tool.description ?? "",
            inputSchema: tool.inputSchema,
            mcpName,
        }));
    }
    // ---------------------------------------------------------------------------
    // Public API used by the router
    // ---------------------------------------------------------------------------
    /** All tools collected from every connected server */
    get tools() {
        return this.toolRegistry;
    }
    /** Execute a named tool on the correct downstream server */
    async callTool(toolName, toolArgs) {
        const tool = this.toolRegistry.find((t) => t.name === toolName);
        if (!tool) {
            return `Error: Unknown tool "${toolName}". Available tools: ${this.toolRegistry
                .map((t) => t.name)
                .join(", ")}`;
        }
        return this.callToolEntry(tool, toolArgs);
    }
    /**
     * Execute a tool by its DiscoveredTool entry — avoids cross-server name
     * collisions since we look up the server by mcpName directly.
     */
    async callToolEntry(tool, toolArgs) {
        const server = this.servers.find((s) => s.name === tool.mcpName);
        if (!server) {
            return `Error: Server "${tool.mcpName}" is not connected.`;
        }
        try {
            const raw = await server.client.callTool({
                name: tool.name,
                arguments: toolArgs,
            });
            const result = raw;
            const text = result.content
                .map((block) => {
                if (block.type === "text")
                    return block.text ?? "";
                if (block.type === "image")
                    return `[image: ${block.mimeType ?? "unknown type"}]`;
                return JSON.stringify(block);
            })
                .join("\n");
            if (result.isError) {
                return `Tool error from "${tool.name}": ${text}`;
            }
            return text;
        }
        catch (err) {
            return `Error calling "${tool.name}": ${err instanceof Error ? err.message : String(err)}`;
        }
    }
    /**
     * Execute a tool and return the raw MCP content array (used by passthrough mode).
     */
    async callToolRaw(tool, toolArgs) {
        const server = this.servers.find((s) => s.name === tool.mcpName);
        if (!server) {
            return {
                content: [{ type: "text", text: `Error: Server "${tool.mcpName}" is not connected.` }],
                isError: true,
            };
        }
        try {
            const raw = await server.client.callTool({ name: tool.name, arguments: toolArgs });
            return raw;
        }
        catch (err) {
            return {
                content: [{ type: "text", text: `Error calling "${tool.name}": ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    }
    async disconnectAll() {
        await Promise.allSettled(this.servers.map(({ client }) => client.close()));
    }
}
//# sourceMappingURL=connector.js.map