import type {
  ProviderCapabilities,
  ProviderHealth,
  TaskInput,
  ProviderEvent,
} from "@feather/shared";

export interface ProviderAdapter {
  id: string;
  name: string;
  type: string;
  capabilities: ProviderCapabilities;
  validateConfig(): Promise<ProviderHealth>;
  startTask(input: TaskInput): AsyncIterable<ProviderEvent>;
  cancelTask(taskId: string): Promise<void>;
}
