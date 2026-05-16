#!/usr/bin/env node
import { readFileSync } from "fs";
import { resolve } from "path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { McpConnector } from "./connector.js";
import { createLLMClient } from "./llm.js";
import { createRouterServer, createDelegatedServer, createPassthroughServer, createSmartServer, } from "./router.js";
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
// Server factory — dispatches to the right implementation based on config.mode
// ---------------------------------------------------------------------------
function buildServer(connector, config) {
    const mode = config.mode ?? "router";
    const provider = config.provider?.type ?? "anthropic";
    console.error(`[mcp-router] Mode: ${mode} | Provider: ${provider}`);
    const client = createLLMClient(config);
    switch (mode) {
        case "delegated": return createDelegatedServer(connector, config, client);
        case "passthrough": return createPassthroughServer(connector);
        case "smart": return createSmartServer(connector, config, client);
        case "router":
        default: return createRouterServer(connector, config, client);
    }
}
// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------
async function runStdio(connector, config) {
    const server = buildServer(connector, config);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[mcp-router] Running via stdio — ready.");
}
async function runHttp(connector, config) {
    const port = parseInt(process.env.PORT ?? "3000", 10);
    const host = process.env.HOST ?? "127.0.0.1";
    const token = process.env.MCP_ROUTER_TOKEN;
    const app = express();
    // Limit request body size to prevent memory exhaustion
    app.use(express.json({ limit: "1mb" }));
    // Security headers
    app.use((_req, res, next) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("X-XSS-Protection", "1; mode=block");
        next();
    });
    if (!token) {
        console.error("[mcp-router] WARNING: MCP_ROUTER_TOKEN is not set. " +
            "HTTP mode is unauthenticated — ensure the server is only reachable from trusted networks.");
    }
    // Bearer token guard — only enforced when MCP_ROUTER_TOKEN is set
    const requireAuth = (req, res, next) => {
        if (!token)
            return next();
        const auth = req.headers.authorization;
        if (auth !== `Bearer ${token}`) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        next();
    };
    const server = buildServer(connector, config);
    app.post("/mcp", requireAuth, async (req, res) => {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        res.on("close", () => transport.close());
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });
    // Health check
    app.get("/health", requireAuth, (_req, res) => {
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
    const config = loadConfig();
    const mode = config.mode ?? "router";
    const isAnthropicProvider = !config.provider || config.provider.type === "anthropic";
    if (mode !== "passthrough" && isAnthropicProvider && !process.env.ANTHROPIC_API_KEY) {
        console.error(`[mcp-router] ERROR: ANTHROPIC_API_KEY is required for mode "${mode}" with the Anthropic provider. ` +
            `Set it, or configure a free provider (e.g. Ollama) via the "provider" block in your config.`);
        process.exit(1);
    }
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