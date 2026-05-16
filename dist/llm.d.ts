import type { ProviderConfig, RouterConfig } from "./types.js";
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
export type LLMMessage = {
    role: "user";
    text: string;
} | {
    role: "user";
    toolResults: Array<{
        id: string;
        content: string;
    }>;
} | {
    role: "assistant";
    text: string | null;
    toolCalls: LLMToolCall[] | null;
};
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
export declare class AnthropicLLMClient implements LLMClient {
    private _client;
    private client;
    chatWithTools({ system, messages, tools, forceToolCall, model, maxTokens }: {
        system: string;
        messages: LLMMessage[];
        tools: LLMTool[];
        forceToolCall: boolean;
        model: string;
        maxTokens: number;
    }): Promise<LLMResponse>;
    chat({ system, userMessage, model, maxTokens }: {
        system: string;
        userMessage: string;
        model: string;
        maxTokens: number;
    }): Promise<string>;
}
export declare class OpenAICompatibleLLMClient implements LLMClient {
    private _client;
    private config;
    constructor(config: ProviderConfig);
    private client;
    chatWithTools({ system, messages, tools, forceToolCall, model, maxTokens }: {
        system: string;
        messages: LLMMessage[];
        tools: LLMTool[];
        forceToolCall: boolean;
        model: string;
        maxTokens: number;
    }): Promise<LLMResponse>;
    chat({ system, userMessage, model, maxTokens }: {
        system: string;
        userMessage: string;
        model: string;
        maxTokens: number;
    }): Promise<string>;
}
export declare function createLLMClient(config: RouterConfig): LLMClient;
//# sourceMappingURL=llm.d.ts.map