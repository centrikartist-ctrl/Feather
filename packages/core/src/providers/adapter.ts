import type {
  ProviderCapabilities,
  ProviderHealth,
  TaskInput,
  ProviderEvent,
} from "@feather/shared";

export type ProviderChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ProviderChatInput = {
  systemPrompt?: string;
  messages: ProviderChatMessage[];
  maxOutputTokens?: number;
};

export type ProviderChatResult = {
  text: string;
};

export interface ProviderAdapter {
  id: string;
  name: string;
  type: string;
  capabilities: ProviderCapabilities;
  validateConfig(): Promise<ProviderHealth>;
  startTask(input: TaskInput): AsyncIterable<ProviderEvent>;
  startChat?(input: ProviderChatInput): Promise<ProviderChatResult>;
  cancelTask(taskId: string): Promise<void>;
}
