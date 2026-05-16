import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ProviderConfig, RouterConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Normalized types — provider-agnostic
// ---------------------------------------------------------------------------

export interface LLMTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMResponse {
  text: string | null;
  toolCalls: LLMToolCall[] | null;
  isEndTurn: boolean;
}

export type LLMMessage =
  | { role: "user"; text: string }
  | { role: "user"; toolResults: Array<{ id: string; content: string }> }
  | { role: "assistant"; text: string | null; toolCalls: LLMToolCall[] | null };

export interface LLMClient {
  chatWithTools(opts: {
    system: string;
    messages: LLMMessage[];
    tools: LLMTool[];
    forceToolCall: boolean;
    model: string;
    maxTokens: number;
  }): Promise<LLMResponse>;

  chat(opts: {
    system: string;
    userMessage: string;
    model: string;
    maxTokens: number;
  }): Promise<string>;
}

// ---------------------------------------------------------------------------
// Anthropic implementation
// ---------------------------------------------------------------------------

function toAnthropicMessages(messages: LLMMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  for (const msg of messages) {
    if (msg.role === "user" && "text" in msg) {
      result.push({ role: "user", content: msg.text });
    } else if (msg.role === "user" && "toolResults" in msg) {
      result.push({
        role: "user",
        content: msg.toolResults.map((r) => ({
          type: "tool_result" as const,
          tool_use_id: r.id,
          content: r.content,
        })),
      });
    } else if (msg.role === "assistant") {
      const content: Anthropic.MessageParam["content"] = [];
      if (msg.text) (content as Anthropic.TextBlockParam[]).push({ type: "text", text: msg.text });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          (content as Anthropic.ToolUseBlockParam[]).push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
        }
      }
      result.push({ role: "assistant", content });
    }
  }
  return result;
}

function toAnthropicTools(tools: LLMTool[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

export class AnthropicLLMClient implements LLMClient {
  private _client: Anthropic | null = null;

  private client(): Anthropic {
    if (!this._client) {
      this._client = new Anthropic({ timeout: 120_000 });
    }
    return this._client;
  }

  async chatWithTools({ system, messages, tools, forceToolCall, model, maxTokens }: {
    system: string; messages: LLMMessage[]; tools: LLMTool[];
    forceToolCall: boolean; model: string; maxTokens: number;
  }): Promise<LLMResponse> {
    const response = await this.client().messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools: toAnthropicTools(tools),
      tool_choice: forceToolCall ? { type: "any" } : { type: "auto" },
      messages: toAnthropicMessages(messages),
    });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );

    const isEndTurn = response.stop_reason === "end_turn" || toolUseBlocks.length === 0;
    return {
      text: textBlocks.map((b) => b.text).join("\n") || null,
      toolCalls: toolUseBlocks.length > 0
        ? toolUseBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }))
        : null,
      isEndTurn,
    };
  }

  async chat({ system, userMessage, model, maxTokens }: {
    system: string; userMessage: string; model: string; maxTokens: number;
  }): Promise<string> {
    const response = await this.client().messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMessage }],
    });
    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible implementation (Ollama, Groq, LM Studio, OpenRouter, …)
// ---------------------------------------------------------------------------

function toOpenAITools(tools: LLMTool[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

function toOpenAIMessages(system: string, messages: LLMMessage[]): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
  ];
  for (const msg of messages) {
    if (msg.role === "user" && "text" in msg) {
      result.push({ role: "user", content: msg.text });
    } else if (msg.role === "user" && "toolResults" in msg) {
      for (const r of msg.toolResults) {
        result.push({ role: "tool", tool_call_id: r.id, content: r.content });
      }
    } else if (msg.role === "assistant") {
      const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: msg.text ?? null,
      };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        }));
      }
      result.push(assistantMsg);
    }
  }
  return result;
}

export class OpenAICompatibleLLMClient implements LLMClient {
  private _client: OpenAI | null = null;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private client(): OpenAI {
    if (!this._client) {
      this._client = new OpenAI({
        baseURL: this.config.baseUrl,
        apiKey: this.config.apiKey ?? "no-key",
        timeout: 120_000,
      });
    }
    return this._client;
  }

  async chatWithTools({ system, messages, tools, forceToolCall, model, maxTokens }: {
    system: string; messages: LLMMessage[]; tools: LLMTool[];
    forceToolCall: boolean; model: string; maxTokens: number;
  }): Promise<LLMResponse> {
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
          .filter((tc): tc is OpenAI.ChatCompletionMessageToolCall & { type: "function" } => tc.type === "function")
          .map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            input: (() => {
              try { return JSON.parse(tc.function.arguments) as Record<string, unknown>; }
              catch { return {} as Record<string, unknown>; }
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

  async chat({ system, userMessage, model, maxTokens }: {
    system: string; userMessage: string; model: string; maxTokens: number;
  }): Promise<string> {
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

export function createLLMClient(config: RouterConfig): LLMClient {
  if (config.provider?.type === "openai-compatible") {
    return new OpenAICompatibleLLMClient(config.provider);
  }
  return new AnthropicLLMClient();
}
