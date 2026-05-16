import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
// ---------------------------------------------------------------------------
// Anthropic implementation
// ---------------------------------------------------------------------------
function toAnthropicMessages(messages) {
    const result = [];
    for (const msg of messages) {
        if (msg.role === "user" && "text" in msg) {
            result.push({ role: "user", content: msg.text });
        }
        else if (msg.role === "user" && "toolResults" in msg) {
            result.push({
                role: "user",
                content: msg.toolResults.map((r) => ({
                    type: "tool_result",
                    tool_use_id: r.id,
                    content: r.content,
                })),
            });
        }
        else if (msg.role === "assistant") {
            const content = [];
            if (msg.text)
                content.push({ type: "text", text: msg.text });
            if (msg.toolCalls) {
                for (const tc of msg.toolCalls) {
                    content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
                }
            }
            result.push({ role: "assistant", content });
        }
    }
    return result;
}
function toAnthropicTools(tools) {
    return tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
    }));
}
export class AnthropicLLMClient {
    _client = null;
    client() {
        if (!this._client) {
            this._client = new Anthropic({ timeout: 120_000 });
        }
        return this._client;
    }
    async chatWithTools({ system, messages, tools, forceToolCall, model, maxTokens }) {
        const response = await this.client().messages.create({
            model,
            max_tokens: maxTokens,
            system,
            tools: toAnthropicTools(tools),
            tool_choice: forceToolCall ? { type: "any" } : { type: "auto" },
            messages: toAnthropicMessages(messages),
        });
        const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
        const textBlocks = response.content.filter((b) => b.type === "text");
        const isEndTurn = response.stop_reason === "end_turn" || toolUseBlocks.length === 0;
        return {
            text: textBlocks.map((b) => b.text).join("\n") || null,
            toolCalls: toolUseBlocks.length > 0
                ? toolUseBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input }))
                : null,
            isEndTurn,
        };
    }
    async chat({ system, userMessage, model, maxTokens }) {
        const response = await this.client().messages.create({
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: "user", content: userMessage }],
        });
        return response.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("");
    }
}
// ---------------------------------------------------------------------------
// OpenAI-compatible implementation (Ollama, Groq, LM Studio, OpenRouter, …)
// ---------------------------------------------------------------------------
function toOpenAITools(tools) {
    return tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
}
function toOpenAIMessages(system, messages) {
    const result = [
        { role: "system", content: system },
    ];
    for (const msg of messages) {
        if (msg.role === "user" && "text" in msg) {
            result.push({ role: "user", content: msg.text });
        }
        else if (msg.role === "user" && "toolResults" in msg) {
            for (const r of msg.toolResults) {
                result.push({ role: "tool", tool_call_id: r.id, content: r.content });
            }
        }
        else if (msg.role === "assistant") {
            const assistantMsg = {
                role: "assistant",
                content: msg.text ?? null,
            };
            if (msg.toolCalls && msg.toolCalls.length > 0) {
                assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
                    id: tc.id,
                    type: "function",
                    function: { name: tc.name, arguments: JSON.stringify(tc.input) },
                }));
            }
            result.push(assistantMsg);
        }
    }
    return result;
}
export class OpenAICompatibleLLMClient {
    _client = null;
    config;
    constructor(config) {
        this.config = config;
    }
    client() {
        if (!this._client) {
            this._client = new OpenAI({
                baseURL: this.config.baseUrl,
                apiKey: this.config.apiKey ?? "no-key",
                timeout: 120_000,
            });
        }
        return this._client;
    }
    async chatWithTools({ system, messages, tools, forceToolCall, model, maxTokens }) {
        const response = await this.client().chat.completions.create({
            model,
            max_tokens: maxTokens,
            tools: toOpenAITools(tools),
            tool_choice: forceToolCall ? "required" : "auto",
            messages: toOpenAIMessages(system, messages),
        });
        const choice = response.choices[0];
        const msg = choice.message;
        const toolCalls = msg.tool_calls && msg.tool_calls.length > 0
            ? msg.tool_calls
                .filter((tc) => tc.type === "function")
                .map((tc) => ({
                id: tc.id,
                name: tc.function.name,
                input: (() => {
                    try {
                        return JSON.parse(tc.function.arguments);
                    }
                    catch {
                        return {};
                    }
                })(),
            }))
            : null;
        const isEndTurn = choice.finish_reason === "stop" || !toolCalls;
        return {
            text: msg.content ?? null,
            toolCalls,
            isEndTurn,
        };
    }
    async chat({ system, userMessage, model, maxTokens }) {
        const response = await this.client().chat.completions.create({
            model,
            max_tokens: maxTokens,
            messages: [
                { role: "system", content: system },
                { role: "user", content: userMessage },
            ],
        });
        return response.choices[0].message.content ?? "";
    }
}
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createLLMClient(config) {
    if (config.provider?.type === "openai-compatible") {
        return new OpenAICompatibleLLMClient(config.provider);
    }
    return new AnthropicLLMClient();
}
//# sourceMappingURL=llm.js.map