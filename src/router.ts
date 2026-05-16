import Anthropic from "@anthropic-ai/sdk";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { McpConnector } from "./connector.js";
import type { DiscoveredTool, RouterConfig } from "./types.js";

// Lazy-initialize the Anthropic client so the module can be imported safely
// when no API key is present (e.g. in tests or passthrough mode).
let _anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
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

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");
}

function buildToolIdMap(
  tools: DiscoveredTool[]
): Map<string, DiscoveredTool> {
  const map = new Map<string, DiscoveredTool>();
  const counts = new Map<string, number>();

  for (const tool of tools) {
    const base = `${sanitize(tool.mcpName)}__${sanitize(tool.name)}`.slice(0, 60);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    const id = count === 0 ? base : `${base}_${count}`;
    map.set(id, tool);
  }

  return map;
}

function toAnthropicTools(
  toolIdMap: Map<string, DiscoveredTool>
): Anthropic.Tool[] {
  return Array.from(toolIdMap.entries()).map(([id, tool]) => ({
    name: id,
    description: `[server: ${tool.mcpName}] ${tool.description}`,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

// ---------------------------------------------------------------------------
// Task-based tool pre-filtering
// Scores each server by keyword overlap with the task, then returns only the
// tools from the best-matching server(s). Falls back to all tools if nothing
// scores above the threshold so the router never silently drops valid options.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "is","it","i","my","me","do","get","list","show","find","create","what",
  "can","all","from","this","that","please","want","need","give","let","make",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function filterToolsForTask(task: string, tools: DiscoveredTool[]): DiscoveredTool[] {
  if (tools.length === 0) return tools;

  const taskTokens = tokenize(task);
  if (taskTokens.length === 0) return tools;
  console.error(`[mcp-router] Task tokens: ${taskTokens.join(", ")}`);
  // Group tools by server
  const byServer = new Map<string, DiscoveredTool[]>();
  for (const tool of tools) {
    const list = byServer.get(tool.mcpName) ?? [];
    list.push(tool);
    byServer.set(tool.mcpName, list);
  }

  // Score each server: count task-token hits in server name + tool names + descriptions
  const scores = new Map<string, number>();
  for (const [serverName, serverTools] of byServer) {
    const corpus = [
      serverName,
      ...serverTools.map((t) => t.name),
      ...serverTools.map((t) => t.description),
    ].join(" ");
    const corpusTokens = new Set(tokenize(corpus));

    let score = 0;
    for (const token of taskTokens) {
      if (corpusTokens.has(token)) score += 2;                  // exact match
      else if ([...corpusTokens].some((c) => c.includes(token) || token.includes(c))) score += 1; // partial
    }
    scores.set(serverName, score);
  }

  const maxScore = Math.max(...scores.values());

  // Log all server scores so it's visible why a server was chosen or skipped
  const scoresSummary = [...scores.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([name, score]) => `${name}=${score}`)
    .join(", ");
  console.error(`[mcp-router] Server scores for "${task}": ${scoresSummary}`);

  // Only filter if at least one server scored meaningfully
  if (maxScore < 2) {
    console.error(`[mcp-router] No strong server match — using all ${tools.length} tool(s)`);
    return tools;
  }

  // Accept all servers within 1 point of the top score (handles multi-server tasks)
  const threshold = maxScore - 1;
  const chosen = [...scores.entries()]
    .filter(([, s]) => s >= threshold)
    .map(([name]) => name);
  const dropped = [...scores.keys()].filter((n) => !chosen.includes(n));

  const filtered = tools.filter((t) => chosen.includes(t.mcpName));
  console.error(
    `[mcp-router] Filtered: kept [${chosen.join(", ")}], dropped [${dropped.join(", ")}] — ${filtered.length} tool(s) remaining`
  );
  return filtered;
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

async function runRoutingLoop(
  task: string,
  connector: McpConnector,
  claudeConfig: RouterConfig["claude"]
): Promise<string> {
  const model = claudeConfig?.model ?? "claude-sonnet-4-6";
  const maxTokens = claudeConfig?.maxTokens ?? 8192;
  const maxIterations = claudeConfig?.maxIterations ?? 5;

  if (!KNOWN_MODELS.has(model)) {
    console.error(
      `[mcp-router] WARNING: Unrecognised model "${model}". Known models: ${[...KNOWN_MODELS].join(", ")}`
    );
  }

  const relevantTools = filterToolsForTask(task, connector.tools);
  const toolIdMap = buildToolIdMap(relevantTools);

  if (toolIdMap.size === 0) {
    return "Error: No downstream tools available. Check your mcp-router.config.json.";
  }

  const anthropicTools = toAnthropicTools(toolIdMap);
  const messages: Anthropic.MessageParam[] = [
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

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );

    // Claude finished — return its text answer
    if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
      return textBlocks.map((b) => b.text).join("\n") || "Task completed.";
    }

    // Execute every tool Claude requested (may be parallel)
    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (block) => {
        console.error(
          `[mcp-router] → ${block.name}(${JSON.stringify(block.input)})`
        );

        const tool = toolIdMap.get(block.name);
        if (!tool) {
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: `Error: Tool "${block.name}" not found.`,
            is_error: true,
          };
        }

        const result = await connector.callToolEntry(
          tool,
          block.input as Record<string, unknown>
        );

        console.error(`[mcp-router] ← ${block.name}: ${result.slice(0, 120)}…`);

        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: result,
        };
      })
    );

    messages.push({ role: "user", content: toolResults });
  }

  return "Error: Reached the maximum number of routing iterations without completing the task. Try a more specific request.";
}

// ---------------------------------------------------------------------------
// Smart server — passthrough + Claude-powered recommend tool
//
// Flow:
//   1. Windsurf sees all downstream tools (passthrough) + one extra "recommend" tool
//   2. Windsurf calls recommend(task) → Claude reads tool names+descriptions only
//      (no schemas — tiny payload) and returns { tool, args, reason }
//   3. Windsurf calls the recommended tool directly with the suggested args
//
// Claude never executes tools — only classifies. Windsurf executes using its
// own context budget, so no Anthropic rate limits on tool calls.
// ---------------------------------------------------------------------------

const RECOMMEND_SYSTEM_PROMPT = `You are a tool selector. Given a task and a list of available tools,
return ONLY a JSON object (no markdown, no explanation) with this exact shape:
{ "tool": "<exact tool name>", "args": { <key-value pairs matching the tool's expected arguments> }, "reason": "<one sentence>" }
Pick the single best tool. If the task needs multiple tools, pick the first one to call.`;

async function recommendTool(
  task: string,
  tools: DiscoveredTool[],
  claudeConfig: RouterConfig["claude"]
): Promise<string> {
  const model = claudeConfig?.model ?? "claude-haiku-4-5-20251001";
  const maxTokens = claudeConfig?.maxTokens ?? 1024;

  // Send only names + descriptions — no schemas. Keeps the payload tiny.
  const toolList = tools
    .map((t) => `- ${sanitize(t.mcpName)}__${sanitize(t.name)}: ${t.description}`)
    .join("\n");

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: RECOMMEND_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Task: ${task}\n\nAvailable tools:\n${toolList}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return text;
}

// ---------------------------------------------------------------------------
// Delegated mode helpers
// ---------------------------------------------------------------------------

const SELECT_SYSTEM_PROMPT = `You are a tool selector. Given a task and a list of available tools (name + description only),
return ONLY a JSON object with this exact shape — no markdown, no explanation:
{ "tool": "<exact tool id>", "suggestedArgs": { <key-value pairs> }, "reason": "<one sentence>" }
Pick the single best tool. If multiple tools are needed, pick the first one.`;

async function selectTool(
  task: string,
  toolIdMap: Map<string, DiscoveredTool>,
  claudeConfig: RouterConfig["claude"]
): Promise<{ tool: string; schema: Record<string, unknown>; suggestedArgs: Record<string, unknown>; reason: string } | { error: string }> {
  const model = claudeConfig?.model ?? "claude-haiku-4-5-20251001";
  const maxTokens = claudeConfig?.maxTokens ?? 1024;

  const toolList = Array.from(toolIdMap.entries())
    .map(([id, t]) => `- ${id}: ${t.description}`)
    .join("\n");

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: SELECT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Task: ${task}\n\nAvailable tools:\n${toolList}` }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed: { tool: string; suggestedArgs: Record<string, unknown>; reason: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: `Claude returned non-JSON: ${text.slice(0, 200)}` };
  }

  const discovered = toolIdMap.get(parsed.tool);
  if (!discovered) {
    return { error: `Claude selected unknown tool "${parsed.tool}". Available: ${[...toolIdMap.keys()].join(", ")}` };
  }

  return {
    tool: parsed.tool,
    schema: discovered.inputSchema,
    suggestedArgs: parsed.suggestedArgs ?? {},
    reason: parsed.reason ?? "",
  };
}

export function createDelegatedServer(
  connector: McpConnector,
  config: RouterConfig
): Server {
  const server = new Server(
    { name: "mcp-router", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "select",
        description:
          "Describe a task in plain English. Returns the best matching tool name, its full input schema, suggested arguments, and a one-sentence reason — so you can review and then call execute().",
        inputSchema: {
          type: "object",
          properties: {
            task: { type: "string", description: "Plain-English description of what you want to do" },
          },
          required: ["task"],
        },
      },
      {
        name: "execute",
        description:
          "Execute a downstream tool by its exact id (as returned by select). Pass the args object matching the tool's schema.",
        inputSchema: {
          type: "object",
          properties: {
            tool: { type: "string", description: "Exact tool id returned by select()" },
            args: { type: "object", description: "Arguments matching the tool's schema" },
          },
          required: ["tool", "args"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolId = request.params.name;
    const rawArgs = (request.params.arguments ?? {}) as Record<string, unknown>;

    console.error(`[mcp-router/delegated] request received — tool: "${toolId}", args: ${JSON.stringify(rawArgs)}`);

    if (toolId === "select") {
      const task = rawArgs.task as string;
      if (!task) {
        return { content: [{ type: "text", text: '{"error":"task argument is required"}' }], isError: true };
      }

      try {
        console.error(`[mcp-router/delegated] select called — task: "${task}"`);
        console.error(`[mcp-router/delegated] all tools (${connector.tools.length}): ${connector.tools.map(t => `${t.mcpName}__${t.name}`).join(", ")}`);
        const relevantTools = filterToolsForTask(task, connector.tools);
        console.error(`[mcp-router/delegated] filtered to ${relevantTools.length} tool(s): ${relevantTools.map(t => `${t.mcpName}__${t.name}`).join(", ")}`);
        const toolIdMap = buildToolIdMap(relevantTools);
        console.error(`[mcp-router/delegated] select: "${task}" (${toolIdMap.size} candidates)`);
        const result = await selectTool(task, toolIdMap, config.claude);
        console.error(`[mcp-router/delegated] selected tool: ${JSON.stringify(result)}`);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `{"error":"${msg}"}` }], isError: true };
      }
    }

    if (toolId === "execute") {
      const targetToolId = rawArgs.tool as string;

      if (!targetToolId) {
        return { content: [{ type: "text", text: '{"error":"tool argument is required"}' }], isError: true };
      }

      if (typeof rawArgs.args !== "object" || rawArgs.args === null || Array.isArray(rawArgs.args)) {
        return { content: [{ type: "text", text: '{"error":"args must be an object"}' }], isError: true };
      }

      const args = rawArgs.args as Record<string, unknown>;

      try {
        const allToolIdMap = buildToolIdMap(connector.tools);
        const discovered = allToolIdMap.get(targetToolId);
        if (!discovered) {
          return {
            content: [{ type: "text", text: `{"error":"Tool \\"${targetToolId}\\" not found. Call select() first to get a valid tool id."}` }],
            isError: true,
          };
        }
        console.error(`[mcp-router/delegated] → execute ${targetToolId}(${JSON.stringify(args)})`);
        const result = await connector.callToolEntry(discovered, args);
        // console.error(`[mcp-router/delegated] ← ${targetToolId} result: ${result}`);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `{"error":"${msg}"}` }], isError: true };
      }
    }

    return { content: [{ type: "text", text: `Unknown tool "${toolId}"` }], isError: true };
  });

  return server;
}

export function createSmartServer(
  connector: McpConnector,
  config: RouterConfig
): Server {
  const server = new Server(
    { name: "mcp-router", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // Expose all downstream tools (Windsurf can call them directly)
  // + one special "recommend" tool that Claude uses for classification only
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "recommend",
        description:
          "Describe a task in plain English. Claude picks the right tool, calls it, and returns the result directly.",
        inputSchema: {
          type: "object",
          properties: {
            task: { type: "string", description: "Plain-English description of what you want to do" },
          },
          required: ["task"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolId = request.params.name;

    // Handle the recommend tool
    if (toolId === "recommend") {
      const task = (request.params.arguments as Record<string, unknown>)?.task as string;
      if (!task) {
        return { content: [{ type: "text", text: '{"error": "task argument is required"}' }], isError: true };
      }
      const relevantTools = filterToolsForTask(task, connector.tools);
      console.error(`[mcp-router/smart] Recommending tool for: "${task}" (${relevantTools.length} candidates)`);
      const recommendation = await recommendTool(task, relevantTools, config.claude);
      console.error(`[mcp-router/smart] Recommendation: ${recommendation}`);
      return { content: [{ type: "text", text: recommendation }] };
    }

    // Handle passthrough calls to downstream tools
    const tool = connector.tools.find(
      (t) => `${sanitize(t.mcpName)}__${sanitize(t.name)}`.slice(0, 64) === toolId
    );
    if (!tool) {
      return { content: [{ type: "text", text: `Tool "${toolId}" not found.` }], isError: true };
    }
    console.error(`[mcp-router/smart] → ${toolId}(${JSON.stringify(request.params.arguments)})`);
    const result = await connector.callToolEntry(
      tool,
      (request.params.arguments ?? {}) as Record<string, unknown>
    );
    console.error(`[mcp-router/smart] ← ${toolId}: ${result.slice(0, 120)}…`);
    return { content: [{ type: "text", text: result }] };
  });

  return server;
}

// ---------------------------------------------------------------------------
// Passthrough server — exposes all downstream tools directly to the host agent
// ---------------------------------------------------------------------------

// Server (low-level) is intentionally used here instead of McpServer because
// passthrough requires dynamically registering downstream tools with raw JSON
// schemas at runtime — an advanced use case the MCP SDK explicitly supports via Server.
export function createPassthroughServer(connector: McpConnector): Server {
  const server = new Server(
    { name: "mcp-router", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: connector.tools.map((tool) => ({
      name: `${sanitize(tool.mcpName)}__${sanitize(tool.name)}`.slice(0, 64),
      description: `[${tool.mcpName}] ${tool.description}`,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolId = request.params.name;
    const tool = connector.tools.find(
      (t) =>
        `${sanitize(t.mcpName)}__${sanitize(t.name)}`.slice(0, 64) === toolId
    );
    if (!tool) {
      return {
        content: [{ type: "text", text: `Tool "${toolId}" not found.` }],
        isError: true,
      };
    }
    console.error(`[mcp-router/passthrough] → ${toolId}(${JSON.stringify(request.params.arguments)})`);
    const result = await connector.callToolEntry(
      tool,
      (request.params.arguments ?? {}) as Record<string, unknown>
    );
    console.error(`[mcp-router/passthrough] ← ${toolId}: ${result.slice(0, 120)}…`);
    return { content: [{ type: "text", text: result }] };
  });

  return server;
}

// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------

export function createRouterServer(
  connector: McpConnector,
  config: RouterConfig
): McpServer {
  const server = new McpServer({
    name: "mcp-router",
    version: "1.0.0",
  });

  server.registerTool(
    "route",
    {
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
          .describe(
            "Plain-English description of the task you want to accomplish"
          ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ task }) => {
      try {
        const result = await runRoutingLoop(task, connector, config.claude);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Router error: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}
