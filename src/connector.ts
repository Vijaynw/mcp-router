import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type {
  RouterConfig,
  StdioMcpConfig,
  SseMcpConfig,
  DiscoveredTool,
} from "./types.js";

interface ConnectedServer {
  name: string;
  client: Client;
}

/**
 * Manages connections to all configured downstream MCP servers and
 * maintains an aggregated tool registry.
 */
export class McpConnector {
  private servers: ConnectedServer[] = [];
  /** Flat list of every tool from every connected MCP server */
  private toolRegistry: DiscoveredTool[] = [];

  async connectAll(config: RouterConfig): Promise<void> {
    const entries = Object.entries(config.mcpServers);

    await Promise.allSettled(
      entries.map(async ([name, serverConfig]) => {
        try {
          const client = await this.connectOne(name, serverConfig);
          const tools = await this.discoverTools(name, client);

          this.servers.push({ name, client });
          this.toolRegistry.push(...tools);

          console.error(
            `[mcp-router] Connected to "${name}" — ${tools.length} tool(s) registered`
          );
        } catch (err) {
          console.error(
            `[mcp-router] WARNING: Could not connect to "${name}": ${
              err instanceof Error ? err.message : String(err)
            }. Skipping.`
          );
        }
      })
    );

    if (this.servers.length === 0) {
      throw new Error(
        "No downstream MCP servers could be connected. Check your mcp-router.config.json."
      );
    }

    console.error(
      `[mcp-router] Ready. ${this.toolRegistry.length} total tool(s) from ${this.servers.length} server(s).`
    );
  }

  private async connectOne(
    name: string,
    config: RouterConfig["mcpServers"][string]
  ): Promise<Client> {
    const client = new Client(
      { name: "mcp-router", version: "1.0.0" },
      { capabilities: {} }
    );

    if (config.type === "stdio") {
      await this.connectStdio(client, config as StdioMcpConfig);
    } else {
      await this.connectSse(client, config as SseMcpConfig);
    }

    return client;
  }

  private async connectStdio(
    client: Client,
    config: StdioMcpConfig
  ): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env
        ? { ...process.env, ...config.env } as Record<string, string>
        : undefined,
    });
    await client.connect(transport);
  }

  private async connectSse(
    client: Client,
    config: SseMcpConfig
  ): Promise<void> {
    const transport = new SSEClientTransport(new URL(config.url));
    await client.connect(transport);
  }

  private async discoverTools(
    mcpName: string,
    client: Client
  ): Promise<DiscoveredTool[]> {
    const response = await client.listTools();
    return response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema as Record<string, unknown>,
      mcpName,
    }));
  }

  // ---------------------------------------------------------------------------
  // Public API used by the router
  // ---------------------------------------------------------------------------

  /** All tools collected from every connected server */
  get tools(): DiscoveredTool[] {
    return this.toolRegistry;
  }

  /** Execute a named tool on the correct downstream server */
  async callTool(
    toolName: string,
    toolArgs: Record<string, unknown>
  ): Promise<string> {
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
  async callToolEntry(
    tool: DiscoveredTool,
    toolArgs: Record<string, unknown>
  ): Promise<string> {
    const server = this.servers.find((s) => s.name === tool.mcpName);
    if (!server) {
      return `Error: Server "${tool.mcpName}" is not connected.`;
    }

    try {
      const raw = await server.client.callTool({
        name: tool.name,
        arguments: toolArgs,
      });

      // The SDK types result.content as unknown in newer versions; cast safely.
      type ContentBlock = { type: string; text?: string; mimeType?: string };
      const result = raw as { content: ContentBlock[]; isError?: boolean };

      const text = result.content
        .map((block) => {
          if (block.type === "text") return block.text ?? "";
          if (block.type === "image")
            return `[image: ${block.mimeType ?? "unknown type"}]`;
          return JSON.stringify(block);
        })
        .join("\n");

      if (result.isError) {
        return `Tool error from "${tool.name}": ${text}`;
      }

      return text;
    } catch (err) {
      return `Error calling "${tool.name}": ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }

  /**
   * Execute a tool and return the raw MCP content array (used by passthrough mode).
   */
  async callToolRaw(
    tool: DiscoveredTool,
    toolArgs: Record<string, unknown>
  ): Promise<{ content: unknown[]; isError?: boolean }> {
    const server = this.servers.find((s) => s.name === tool.mcpName);
    if (!server) {
      return {
        content: [{ type: "text", text: `Error: Server "${tool.mcpName}" is not connected.` }],
        isError: true,
      };
    }
    try {
      const raw = await server.client.callTool({ name: tool.name, arguments: toolArgs });
      return raw as { content: unknown[]; isError?: boolean };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error calling "${tool.name}": ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }

  async disconnectAll(): Promise<void> {
    await Promise.allSettled(
      this.servers.map(({ client }) => client.close())
    );
  }
}
