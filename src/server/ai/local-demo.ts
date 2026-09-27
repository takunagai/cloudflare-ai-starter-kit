import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4ToolCall,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";

const text =
  "【ローカル動作確認・AI未使用】メッセージを受け付けました。この固定応答で、ストリーム表示と履歴保存を確認できます。実際のAI回答ではありません。";
const usage: LanguageModelV4Usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function demoToolCall(
  options: LanguageModelV4CallOptions,
): LanguageModelV4ToolCall | undefined {
  if (
    options.tools?.some(
      (tool) => tool.type === "function" && tool.name === "draftNote",
    ) &&
    !options.prompt.some((message) => message.role === "tool")
  ) {
    return {
      type: "tool-call",
      toolCallId: "local-demo-draft",
      toolName: "draftNote",
      input: JSON.stringify({
        title: "ローカル確認用下書き・AI未使用",
        content:
          "これは承認から保存までを確認する固定の下書きです。AIによる生成や外部への送信は行っていません。",
      }),
    };
  }
}

// 実AIではない。入力を反射せず、外部通信や課金を一切行わない。
export function createLocalDemoModel(): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "local-demo",
    modelId: "demo",
    supportedUrls: {},
    async doGenerate(options) {
      options.abortSignal?.throwIfAborted();
      const toolCall = demoToolCall(options);
      return {
        content: toolCall ? [toolCall] : [{ type: "text", text }],
        finishReason: {
          unified: toolCall ? "tool-calls" : "stop",
          raw: "stop",
        },
        usage,
        warnings: [],
      };
    },
    async doStream(options) {
      options.abortSignal?.throwIfAborted();
      const toolCall = demoToolCall(options);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            if (toolCall) {
              controller.enqueue(toolCall);
            } else {
              controller.enqueue({ type: "text-start", id: "demo-text" });
              controller.enqueue({
                type: "text-delta",
                id: "demo-text",
                delta: text,
              });
              controller.enqueue({ type: "text-end", id: "demo-text" });
            }
            controller.enqueue({
              type: "finish",
              finishReason: {
                unified: toolCall ? "tool-calls" : "stop",
                raw: "stop",
              },
              usage,
            });
            controller.close();
          },
        }),
      };
    },
  };
}
