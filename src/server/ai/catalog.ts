// 公開ID・表示・providerの正本。設定判定からも参照する純粋な定義。
export const workersAiChatModelId = "workers-ai/llama-3.1-8b-fp8";
export const selectableChatModels = [
  { id: "openai/gpt-4.1-mini", label: "GPT-4.1 mini", provider: "openai" },
  {
    id: "anthropic/claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
  },
  {
    id: "google/gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    provider: "google",
  },
  {
    id: workersAiChatModelId,
    label: "Llama 3.1 8B FP8 · Workers AI",
    provider: "workers-ai",
  },
  {
    id: "openrouter/openai/gpt-4.1-mini",
    label: "GPT-4.1 mini · OpenRouter",
    provider: "openrouter",
  },
  {
    id: "lm-studio/local",
    label: "LM Studio · ローカルモデル",
    provider: "lm-studio",
  },
] as const;
export type SelectableChatModelId = (typeof selectableChatModels)[number]["id"];
export const selectableChatModelIds: readonly SelectableChatModelId[] =
  selectableChatModels.map(({ id }) => id);
export const chatModelCatalog = [
  ...selectableChatModels,
  {
    id: "local/demo",
    label: "動作確認用の固定応答（AI未使用）",
    provider: "local-demo",
  },
] as const;
