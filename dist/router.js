import Anthropic from "@anthropic-ai/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
        const response = await getAnthropicClient().messages.create({
            model,
            max_tokens: maxTokens,
            system: SYSTEM_PROMPT,
            tools: anthropicTools,
            // Force a tool call on the first turn; auto on subsequent turns so
            // Claude can decide when it's done.
            tool_choice: i === 0 ? { type: "any" } : { type: "auto" },
            messages,
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
    return server;
}
//# sourceMappingURL=router.js.map