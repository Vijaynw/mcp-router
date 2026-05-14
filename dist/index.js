#!/usr/bin/env node
import { readFileSync } from "fs";
import { resolve } from "path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { McpConnector } from "./connector.js";
import { createRouterServer } from "./router.js";
// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------
function loadConfig() {
    const configPath = process.env.MCP_ROUTER_CONFIG ??
        resolve(process.cwd(), "mcp-router.config.json");
    try {
        const raw = readFileSync(configPath, "utf-8");
        return JSON.parse(raw);
    }
    catch (err) {
        console.error(`[mcp-router] ERROR: Could not load config from "${configPath}"\n` +
            `  ${err instanceof Error ? err.message : String(err)}\n` +
            `  Set MCP_ROUTER_CONFIG env var or place mcp-router.config.json in the working directory.`);
        process.exit(1);
    }
}
// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------
async function runStdio(connector, config) {
    const server = createRouterServer(connector, config);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[mcp-router] Running via stdio — ready.");
}
async function runHttp(connector, config) {
    const port = parseInt(process.env.PORT ?? "3000", 10);
    const host = process.env.HOST ?? "127.0.0.1";
    const app = express();
    app.use(express.json());
    // Create the McpServer once; create a new transport per request (stateless).
    const server = createRouterServer(connector, config);
    app.post("/mcp", async (req, res) => {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        res.on("close", () => transport.close());
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });
    // Health check
    app.get("/health", (_req, res) => {
        res.json({
            status: "ok",
            tools: connector.tools.length,
            servers: [...new Set(connector.tools.map((t) => t.mcpName))],
        });
    });
    await new Promise((resolve) => {
        app.listen(port, host, () => {
            console.error(`[mcp-router] Running via HTTP on http://${host}:${port}/mcp`);
            resolve();
        });
    });
}
// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error("[mcp-router] ERROR: ANTHROPIC_API_KEY environment variable is required.");
        process.exit(1);
    }
    const config = loadConfig();
    const connector = new McpConnector();
    await connector.connectAll(config);
    const transport = process.env.TRANSPORT ?? "stdio";
    if (transport === "http") {
        await runHttp(connector, config);
    }
    else {
        await runStdio(connector, config);
    }
    const shutdown = async () => {
        console.error("[mcp-router] Shutting down…");
        await connector.disconnectAll();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
main().catch((err) => {
    console.error("[mcp-router] Fatal:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map