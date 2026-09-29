import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { generateText, stepCountIs, streamText, tool } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLocalDemoModel } from "../src/server/ai/local-demo";
import {
  getModel,
  listModels,
  ModelUnavailableError,
} from "../src/server/ai/providers";
import type { AppEnv } from "../src/server/env";

function settings(extra: Partial<AppEnv> = {}): AppEnv {
  // 実Secrets・cloudflare:workers.envには触れない。
  return {
    APP_ENV: "local",
    APP_ORIGIN: "http://127.0.0.1:3000",
    ...extra,
  } as AppEnv;
}

beforeEach(() => {
  // SDKが誤って実HTTPへ接続してもテスト全体で遮断する。
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network_forbidden_in_provider_test");
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("server-owned model selection", () => {
  it("disables every model when bindings and settings are absent", () => {
    const models = listModels(settings());
    expect(models).toHaveLength(7);
    expect(models.every((model) => !model.available)).toBe(true);
    for (const model of models)
      expect(() => getModel(model.id, settings())).toThrow(
        ModelUnavailableError,
      );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns only public metadata, never key/endpoint/model configuration", () => {
    const env = settings({
      OPENAI_API_KEY: "DUMMY_TEST_KEY_NOT_REAL",
      LM_STUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
      LM_STUDIO_MODEL: "private-local-name",
    });
    const result = listModels(env);
    for (const item of result)
      expect(Object.keys(item).sort()).toEqual([
        "available",
        "id",
        "label",
        "provider",
      ]);
    expect(JSON.stringify(result)).not.toContain("DUMMY_TEST_KEY_NOT_REAL");
    expect(JSON.stringify(result)).not.toContain("1234");
    expect(JSON.stringify(result)).not.toContain("private-local-name");
  });

  it.each([
    "",
    "gpt-4.1-mini",
    "workers-ai/llama-3.1-8b",
    "openai/unknown",
    "https://example.test/model",
    "__proto__",
  ])("rejects non-allowlisted ID %#", (id) => {
    expect(() => getModel(id, settings({ OPENAI_API_KEY: "DUMMY" }))).toThrow(
      "model_unavailable",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not enable an empty or whitespace credential", () => {
    expect(
      listModels(settings({ OPENAI_API_KEY: "  " })).find(
        (item) => item.provider === "openai",
      )?.available,
    ).toBe(false);
  });

  it.each(["staging", "production"] as const)(
    "blocks local fake and LM Studio in %s",
    (APP_ENV) => {
      const env = settings({
        APP_ENV,
        LOCAL_DEMO: "true",
        LM_STUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
        LM_STUDIO_MODEL: "dummy",
      });
      expect(() => getModel("local/demo", env)).toThrow(ModelUnavailableError);
      expect(() => getModel("lm-studio/local", env)).toThrow(
        ModelUnavailableError,
      );
    },
  );

  it.each([
    "https://example.test",
    "https://localhost.example.test",
    "not-an-origin",
  ])("blocks local providers with nonlocal app origin %#", (APP_ORIGIN) => {
    expect(() =>
      getModel("local/demo", settings({ APP_ORIGIN, LOCAL_DEMO: "true" })),
    ).toThrow(ModelUnavailableError);
  });

  it.each([
    "http://example.test/v1",
    "http://localhost.example.test/v1",
    "http://127.0.0.1:1234/v1?key=dummy",
    "http://dummy@127.0.0.1:1234/v1",
    "http://127.0.0.1:1234/other",
    "file:///v1",
  ])("rejects invalid LM endpoint %#", (LM_STUDIO_BASE_URL) => {
    expect(() =>
      getModel(
        "lm-studio/local",
        settings({ LM_STUDIO_BASE_URL, LM_STUDIO_MODEL: "dummy" }),
      ),
    ).toThrow(ModelUnavailableError);
  });
});

describe("AI SDK adapters inside workerd, external boundaries mocked", () => {
  const chatResponse = {
    id: "dummy-response",
    object: "chat.completion",
    created: 1,
    model: "dummy",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "mock response" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  };

  it.each([
    [
      "openai/gpt-4.1-mini",
      { OPENAI_API_KEY: "DUMMY" },
      "https://api.openai.com/v1/chat/completions",
      "gpt-4.1-mini",
    ],
    [
      "openrouter/openai/gpt-4.1-mini",
      { OPENROUTER_API_KEY: "DUMMY" },
      "https://openrouter.ai/api/v1/chat/completions",
      "openai/gpt-4.1-mini",
    ],
    [
      "lm-studio/local",
      {
        LM_STUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
        LM_STUDIO_MODEL: "dummy-local",
      },
      "http://127.0.0.1:1234/v1/chat/completions",
      "dummy-local",
    ],
  ] as const)(
    "serializes and parses %s without network",
    async (id, extra, expectedURL, expectedModel) => {
      let target = "";
      let sentModel = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          target = String(input);
          sentModel = JSON.parse(String(init?.body)).model;
          return Response.json(chatResponse);
        }),
      );
      const result = await generateText({
        model: getModel(id, settings(extra)),
        prompt: "dummy input",
        maxOutputTokens: 16,
        maxRetries: 0,
      });
      expect(result.text).toBe("mock response");
      expect(target).toBe(expectedURL);
      expect(sentModel).toBe(expectedModel);
    },
  );

  it("uses Anthropic adapter serialization and parsing", async () => {
    let target = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        target = String(input);
        return Response.json({
          id: "dummy",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [{ type: "text", text: "mock anthropic" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 2 },
        });
      }),
    );
    const result = await generateText({
      model: getModel(
        "anthropic/claude-haiku-4-5",
        settings({ ANTHROPIC_API_KEY: "DUMMY" }),
      ),
      prompt: "dummy",
      maxRetries: 0,
    });
    expect(result.text).toBe("mock anthropic");
    expect(target).toBe("https://api.anthropic.com/v1/messages");
  });

  it("disables redirects on the LM Studio transport", async () => {
    let redirect: RequestRedirect | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        redirect = init?.redirect;
        return Response.json(chatResponse);
      }),
    );
    await generateText({
      model: getModel(
        "lm-studio/local",
        settings({
          LM_STUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
          LM_STUDIO_MODEL: "dummy",
        }),
      ),
      prompt: "dummy",
      maxRetries: 0,
    });
    expect(redirect).toBe("error");
  });

  it("uses Google adapter serialization and parsing", async () => {
    let target = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        target = String(input);
        return Response.json({
          candidates: [
            {
              content: { role: "model", parts: [{ text: "mock google" }] },
              finishReason: "STOP",
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 2,
            totalTokenCount: 3,
          },
        });
      }),
    );
    const result = await generateText({
      model: getModel(
        "google/gemini-3.5-flash-lite",
        settings({ GOOGLE_GENERATIVE_AI_API_KEY: "DUMMY" }),
      ),
      prompt: "dummy",
      maxRetries: 0,
    });
    expect(result.text).toBe("mock google");
    expect(target).toContain("/models/gemini-3.5-flash-lite:generateContent");
  });

  it("calls only the supplied fake Workers AI binding", async () => {
    const run = vi.fn(async () => ({
      response: "mock workers",
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }));
    const result = await generateText({
      model: getModel(
        "workers-ai/llama-3.1-8b-fp8",
        settings({ AI: { run } as unknown as Ai }),
      ),
      prompt: "dummy",
      maxRetries: 0,
    });
    expect(result.text).toBe("mock workers");
    expect(run.mock.calls.length).toBe(1);
    expect(run).toHaveBeenCalledWith(
      "@cf/meta/llama-3.1-8b-instruct-fp8",
      expect.anything(),
      expect.anything(),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("supports fake generation and streaming, visibly separate from actual AI", async () => {
    const model = getModel("local/demo", settings({ LOCAL_DEMO: "true" }));
    const generated = await generateText({
      model,
      prompt: "DO_NOT_REFLECT_INPUT",
    });
    const streamed = await streamText({ model, prompt: "DO_NOT_REFLECT_INPUT" })
      .text;
    expect(streamed).toBe(generated.text);
    expect(streamed).toContain("AI未使用");
    expect(streamed).not.toContain("DO_NOT_REFLECT_INPUT");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("respects abort before fake generation", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      generateText({
        model: getModel("local/demo", settings({ LOCAL_DEMO: "true" })),
        prompt: "dummy",
        abortSignal: abort.signal,
        maxRetries: 0,
      }),
    ).rejects.toThrow();
  });
});

describe("bounded tool execution using local scripted models", () => {
  const inputSchema = z
    .object({
      title: z.string().min(1).max(100),
      content: z.string().min(1).max(8000),
    })
    .strict();

  it("streams one demo draft and then the fixed response", async () => {
    const execute = vi.fn(async (_input: z.infer<typeof inputSchema>) => ({
      approvalId: "dummy-approval",
      status: "awaiting_human_approval",
    }));
    const result = streamText({
      model: createLocalDemoModel(),
      prompt: "DO_NOT_REFLECT_INPUT",
      stopWhen: stepCountIs(3),
      tools: {
        draftNote: tool({ description: "test draft", inputSchema, execute }),
      },
    });
    expect(await result.text).toContain("AI未使用");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      title: "ローカル確認用下書き・AI未使用",
    });
    expect(await result.steps).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["unknownTool", JSON.stringify({ title: "dummy", content: "dummy" })],
    ["draftNote", JSON.stringify({ title: 123, content: "dummy" })],
  ])(
    "does not execute an unknown or invalid tool call %#",
    async (toolName, input) => {
      const execute = vi.fn(async () => ({ status: "should-not-run" }));
      const base = createLocalDemoModel();
      const result = await generateText({
        model: {
          ...base,
          async doGenerate(options: LanguageModelV4CallOptions) {
            return {
              ...(await base.doGenerate(options)),
              content: [
                {
                  type: "tool-call" as const,
                  toolCallId: "dummy-call",
                  toolName,
                  input,
                },
              ],
              finishReason: {
                unified: "tool-calls" as const,
                raw: "tool_calls",
              },
            };
          },
        },
        prompt: "dummy",
        maxRetries: 0,
        tools: {
          draftNote: tool({ description: "test draft", inputSchema, execute }),
        },
      });
      expect(execute).not.toHaveBeenCalled();
      expect(
        result.toolCalls.some((call) => "invalid" in call && call.invalid),
      ).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("stops a model that keeps requesting tools at the step limit", async () => {
    const execute = vi.fn(async () => ({ status: "done" }));
    const base = createLocalDemoModel();
    const generate = vi.fn(async () => ({
      ...(await base.doGenerate({ prompt: [] })),
      content: [
        {
          type: "tool-call" as const,
          toolCallId: crypto.randomUUID(),
          toolName: "draftNote",
          input: JSON.stringify({ title: "dummy", content: "dummy" }),
        },
      ],
      finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
    }));
    const result = await generateText({
      model: { ...base, doGenerate: generate },
      prompt: "dummy",
      stopWhen: stepCountIs(2),
      tools: {
        draftNote: tool({ description: "test draft", inputSchema, execute }),
      },
    });
    expect(result.steps).toHaveLength(2);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });
});
