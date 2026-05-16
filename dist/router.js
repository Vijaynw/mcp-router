import Anthropic from "@anthropic-ai/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
// Lazy-initialize the Anthropic client so the module can be imported safely
// when no API key is present (e.g. in tests or passthrough mode).
let _anthropic = null;
function getAnthropicClient() {
    if (!_anthropic) {
        _anthropic = new Anthropic({ timeout: 120_000 }); // 2-minute timeout per call
    }
    return _anthropic;
}
// ---------------------------------------------------------------------------
// Tool-name encoding
// Anthropic tool names must match ^[a-zA-Z0-9_-]{1,64}$
// We encode as "{server}__{tool}" (sanitized) and keep a reverse map.
// ---------------------------------------------------------------------------
function sanitize(s) {
    return s.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");
}
function buildToolIdMap(tools) {
    const map = new Map();
    const counts = new Map();
    for (const tool of tools) {
        const base = `${sanitize(tool.mcpName)}__${sanitize(tool.name)}`.slice(0, 60);
        const count = counts.get(base) ?? 0;
        counts.set(base, count + 1);
        const id = count === 0 ? base : `${base}_${count}`;
        map.set(id, tool);
    }
    return map;
}
function toAnthropicTools(toolIdMap) {
    return Array.from(toolIdMap.entries()).map(([id, tool]) => ({
        name: id,
        description: `[server: ${tool.mcpName}] ${tool.description}`,
        input_schema: tool.inputSchema,
    }));
}
// ---------------------------------------------------------------------------
// Agentic routing loop
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a tool dispatcher. The user will describe a task.
Use the available tools to complete it. Call tools as needed — you may call
multiple tools in sequence if the task requires it. When the task is done,
reply with a concise summary of what you did and the result.`;
// Known Claude models — warn on unrecognised values to catch config typos early.
const KNOWN_MODELS = new Set([
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
]);
async function runRoutingLoop(task, connector, claudeConfig) {
    const model = claudeConfig?.model ?? "claude-sonnet-4-6";
    const maxTokens = claudeConfig?.maxTokens ?? 8192;
    const maxIterations = claudeConfig?.maxIterations ?? 5;
    if (!KNOWN_MODELS.has(model)) {
        console.error(`[mcp-router] WARNING: Unrecognised model "${model}". Known models: ${[...KNOWN_MODELS].join(", ")}`);
    }
    const toolIdMap = buildToolIdMap(connector.tools);
    if (toolIdMap.size === 0) {
        return "Error: No downstream tools available. Check your mcp-router.config.json.";
    }
    const anthropicTools = toAnthropicTools(toolIdMap);
    const messages = [
        { role: "user", content: task },
    ];
    for (let i = 0; i < maxIterations; i++) {
        // Attach cache_control to the last tool so Anthropic caches the entire
        // tools list + system prompt prefix. This cuts costs ~80% on repeated calls.
        const cachedTools = anthropicTools.length > 0
            ? [
                ...anthropicTools.slice(0, -1),
                { ...anthropicTools.at(-1), cache_control: { type: "ephemeral" } },
            ]
            : anthropicTools;
        const response = await getAnthropicClient().messages.create({
            model,
            max_tokens: maxTokens,
            system: [
                {
                    type: "text",
                    text: SYSTEM_PROMPT,
                    cache_control: { type: "ephemeral" },
                },
            ],
            tools: cachedTools,
            // Force a tool call on the first turn; auto on subsequent turns so
            // Claude can decide when it's done.
            tool_choice: i === 0 ? { type: "any" } : { type: "auto" },
            messages,
            betas: ["prompt-caching-2024-07-31"],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        });
        const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
        const textBlocks = response.content.filter((b) => b.type === "text");
        // Claude finished — return its text answer
        if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
            return textBlocks.map((b) => b.text).join("\n") || "Task completed.";
        }
        // Execute every tool Claude requested (may be parallel)
        messages.push({ role: "assistant", content: response.content });
        const toolResults = await Promise.all(toolUseBlocks.map(async (block) => {
            console.error(`[mcp-router] → ${block.name}(${JSON.stringify(block.input)})`);
            const tool = toolIdMap.get(block.name);
            if (!tool) {
                return {
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: `Error: Tool "${block.name}" not found.`,
                    is_error: true,
                };
            }
            const result = await connector.callToolEntry(tool, block.input);
            console.error(`[mcp-router] ← ${block.name}: ${result.slice(0, 120)}…`);
            return {
                type: "tool_result",
                tool_use_id: block.id,
                content: result,
            };
        }));
        messages.push({ role: "user", content: toolResults });
    }
    return "Error: Reached the maximum number of routing iterations without completing the task. Try a more specific request.";
}
// ---------------------------------------------------------------------------
// Dry-run plan loop
// ---------------------------------------------------------------------------
const PLAN_SYSTEM_PROMPT = `You are a tool dispatcher. The user will describe a task.
Do NOT call any tools. Instead, respond with a step-by-step plan describing:
- Which tool you would call at each step (use the exact tool name)
- What arguments you would pass
- Why you chose that tool

Format as a numbered list. Be specific about argument values where possible.`;
async function runPlanLoop(task, connector, claudeConfig) {
    const model = claudeConfig?.model ?? "claude-sonnet-4-6";
    const maxTokens = claudeConfig?.maxTokens ?? 8192;
    const toolIdMap = buildToolIdMap(connector.tools);
    if (toolIdMap.size === 0) {
        return "Error: No downstream tools available. Check your mcp-router.config.json.";
    }
    const anthropicTools = toAnthropicTools(toolIdMap);
    const response = await getAnthropicClient().messages.create({
        model,
        max_tokens: maxTokens,
        system: PLAN_SYSTEM_PROMPT,
        tools: anthropicTools,
        tool_choice: { type: "none" },
        messages: [{ role: "user", content: task }],
    });
    const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    return text || "No plan generated.";
}
// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------
export function createRouterServer(connector, config) {
    const server = new McpServer({
        name: "mcp-router",
        version: "1.0.0",
    });
    server.registerTool("route", {
        title: "Route Task to MCP Tool",
        description: `Describe what you want to do in plain English. The router uses Claude to
automatically pick the right tool from all connected MCP servers, calls it
(or chains multiple calls if needed), and returns the result.

You never need to know which server or tool name to use — just describe the task.

Args:
  - task: Natural language description of what you want to accomplish.

Returns:
  The result produced by the downstream tool(s).

Examples:
  - "List the files in /home/user/projects"
  - "Create a GitHub issue titled 'Login fails on Safari' in owner/repo"
  - "Search for all TODO comments in TypeScript files under src/"`,
        inputSchema: z.object({
            task: z
                .string()
                .min(1, "Task must not be empty")
                .describe("Plain-English description of the task you want to accomplish"),
        }),
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ task }) => {
        try {
            const result = await runRoutingLoop(task, connector, config.claude);
            return { content: [{ type: "text", text: result }] };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                content: [{ type: "text", text: `Router error: ${msg}` }],
                isError: true,
            };
        }
    });
    server.registerTool("route_plan", {
        title: "Preview Routing Plan (Dry Run)",
        description: `Same as 'route' but does NOT execute anything. Returns a step-by-step
plan showing which tools would be called and with what arguments.
Use this before running destructive or multi-step operations to verify the plan.`,
        inputSchema: z.object({
            task: z
                .string()
                .min(1, "Task must not be empty")
                .describe("The task you want to preview"),
        }),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    }, async ({ task }) => {
        try {
            const plan = await runPlanLoop(task, connector, config.claude);
            return { content: [{ type: "text", text: plan }] };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                content: [{ type: "text", text: `Plan error: ${msg}` }],
                isError: true,
            };
        }
    });
    return server;
}
// ---------------------------------------------------------------------------
// Passthrough server (no API key required)
// Exposes all downstream tools directly — no AI routing.
// ---------------------------------------------------------------------------
export function createPassthroughServer(connector) {
    const toolIdMap = buildToolIdMap(connector.tools);
    const server = new Server({ name: "mcp-router", version: "1.0.0" }, {
        capabilities: { tools: {} },
    });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: Array.from(toolIdMap.entries()).map(([id, tool]) => ({
            name: id,
            description: `[server: ${tool.mcpName}] ${tool.description}`,
            inputSchema: tool.inputSchema,
        })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const toolName = request.params.name;
        const toolArgs = (request.params.arguments ?? {});
        const tool = toolIdMap.get(toolName);
        if (!tool) {
            return {
                content: [{ type: "text", text: `Error: Tool "${toolName}" not found.` }],
                isError: true,
            };
        }
        console.error(`[mcp-router] passthrough → ${toolName}(${JSON.stringify(toolArgs)})`);
        const result = await connector.callToolRaw(tool, toolArgs);
        return result;
    });
    return server;
}
//# sourceMappingURL=router.js.map