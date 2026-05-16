#!/usr/bin/env node
import { readFileSync } from "fs";
import { resolve } from "path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { McpConnector } from "./connector.js";
import { createRouterServer, createPassthroughServer } from "./router.js";
import { RouterConfigSchema } from "./types.js";
// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------
function loadConfig() {
    const configPath = process.env.MCP_ROUTER_CONFIG ??
        resolve(process.cwd(), "mcp-router.config.json");
    try {
        const raw = readFileSync(configPath, "utf-8");
        const parsed = RouterConfigSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
            console.error(`[mcp-router] ERROR: Invalid config at "${configPath}":\n` +
                parsed.error.issues
                    .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
                    .join("\n"));
            process.exit(1);
        }
        return parsed.data;
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
async function runStdio(connector, config, hasApiKey) {
    const server = hasApiKey
        ? createRouterServer(connector, config)
        : createPassthroughServer(connector);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[mcp-router] Running via stdio — ready.");
}
async function runHttp(connector, config, hasApiKey) {
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
    // Create the McpServer once; create a new transport per request (stateless).
    const server = hasApiKey
        ? createRouterServer(connector, config)
        : createPassthroughServer(connector);
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
    const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
    if (!hasApiKey) {
        console.error("[mcp-router] No ANTHROPIC_API_KEY found — starting in passthrough mode. " +
            "All downstream tools are exposed directly without AI routing.");
    }
    const config = loadConfig();
    const connector = new McpConnector();
    await connector.connectAll(config);
    const transport = process.env.TRANSPORT ?? "stdio";
    if (transport === "http") {
        await runHttp(connector, config, hasApiKey);
    }
    else {
        await runStdio(connector, config, hasApiKey);
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