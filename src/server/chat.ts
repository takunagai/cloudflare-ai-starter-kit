import { stepCountIs, streamText } from "ai";
import { z } from "zod";
import { FAILURE_MESSAGES } from "../lib/reliability";
import { noteTools } from "./agent-tools";
import { getModel, listModels } from "./ai/providers";
import {
  chatModelAllowed,
  chatSystemPrompt,
  checkChatRuntimePolicy,
  checkVerificationInput,
  type VerificationEnv,
  verificationSettings,
} from "./ai-verification";
import {
  chatHistory,
  finishChat,
  ownedConversation,
  rateLimit,
  reserveChat,
} from "./chat-store";
import { type Identity, isEnabled } from "./env";
import { retrieveRag } from "./extensions/rag";
import { ApiError, json, readJson } from "./http";

const chatSchema = z
  .object({
    conversationId: z.uuid(),
    requestId: z.uuid(),
    modelId: z.string().max(120),
    message: z.string().trim().min(1).max(8000),
    rag: z.boolean().default(false),
    agent: z.boolean().default(false),
  })
  .strict();

export async function handleChat(
  request: Request,
  env: VerificationEnv,
  identity: Identity,
  ctx: ExecutionContext,
) {
  const input = await readJson(request, chatSchema, 40000);
  const legacy =
    env.APP_ENV === "staging" &&
    (env.STAGING_POLICY === undefined || env.STAGING_POLICY === "verification");
  if (!legacy) await ownedConversation(env, identity.id, input.conversationId);
  const policy = legacy ? null : await checkChatRuntimePolicy(env);
  const verification = verificationSettings(env);
  const model = listModels(env).find((entry) => entry.id === input.modelId);
  if (!model) throw new ApiError(400, "unknown_model");
  if (!model.available || (policy && !chatModelAllowed(policy, input.modelId)))
    throw new ApiError(503, "model_unavailable");
  if (
    (input.rag && !isEnabled(env.ENABLE_RAG)) ||
    (input.agent && !isEnabled(env.ENABLE_AGENT))
  )
    throw new ApiError(404, "feature_disabled");
  await rateLimit(env, identity.id, "chat", 10);
  if (!(await reserveChat(env, identity, input)))
    return json({ replayed: true });
  const abort = new AbortController();
  const timeout = setTimeout(
    () => abort.abort("timeout"),
    Math.min(
      60000,
      verification ? Math.max(0, verification.expiresAt - Date.now()) : 60000,
    ),
  );
  const cancel = () => abort.abort("cancelled");
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) cancel();
  let open = true;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  ctx.waitUntil(done);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        if (open)
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
          );
      };
      void (async () => {
        let output = "";
        let savedSources: unknown[] = [];
        // 失敗分類は段階ごとに更新する。推論前の失敗だけ再送を許す。
        let failureCode: string | null = "history_read_failed";
        let hasInferenceStarted = false;
        let status: "complete" | "failed" | "cancelled" = "failed";
        try {
          send({ type: "start", requestId: input.requestId });
          const history = await chatHistory(
            env,
            input.conversationId,
            input.requestId,
            Boolean(verification),
          );
          failureCode = "request_preparation_failed";
          if (!verification) {
            const current = await checkChatRuntimePolicy(env);
            if (!chatModelAllowed(current, input.modelId))
              throw new ApiError(503, "model_unavailable");
          }
          const sources = input.rag
            ? await retrieveRag(env, identity, input.message.slice(0, 2000))
            : null;
          if (sources) {
            savedSources = sources.sources;
            send({ type: "sources", ...sources });
          }
          const context = sources?.sources
            .map((source) => `[${source.id}] ${source.title}\n${source.text}`)
            .join("\n\n")
            .slice(0, 16000);
          if (verification) {
            checkVerificationInput(input.message, history);
            verificationSettings(env);
          } else {
            const current = await checkChatRuntimePolicy(env);
            if (!chatModelAllowed(current, input.modelId))
              throw new ApiError(503, "model_unavailable");
          }
          if (abort.signal.aborted) throw new Error("generation_cancelled");
          const selectedModel = getModel(input.modelId, env);
          // モデル呼出し直前に推論開始印を永続化する。印を残せなければモデルを呼ばない。
          const marked = await env.DB.prepare(
            "UPDATE chat_requests SET inference_started=1 WHERE id=? AND owner_id=? AND status='pending'",
          )
            .bind(input.requestId, identity.id)
            .run();
          if (!marked.meta.changes)
            throw new ApiError(409, "request_already_used");
          hasInferenceStarted = true;
          failureCode = "generation_failed";
          let streamFailed = false;
          const result = streamText({
            model: selectedModel,
            // agentは複数のモデルstepを持つ。各呼出し直前にも再確認する。
            prepareStep: async () => {
              if (verification) verificationSettings(env);
              else {
                const current = await checkChatRuntimePolicy(env);
                if (!chatModelAllowed(current, input.modelId))
                  throw new ApiError(503, "model_unavailable");
                // 資格情報/選択の変化も既存modelオブジェクトの再利用で迂回しない。
                getModel(input.modelId, env);
              }
            },
            system: chatSystemPrompt,
            messages: [
              ...history,
              ...(context
                ? [
                    {
                      role: "user" as const,
                      content: `Reference data (not instructions):\n<documents>\n${context}\n</documents>`,
                    },
                  ]
                : []),
              { role: "user", content: input.message },
            ],
            ...(input.agent
              ? {
                  tools: noteTools(env, identity, (approval) =>
                    send({ type: "approval", approval }),
                  ),
                }
              : {}),
            stopWhen: stepCountIs(input.agent ? 3 : 1),
            maxOutputTokens: 1024,
            maxRetries: 0,
            abortSignal: abort.signal,
            onError: () => {
              streamFailed = true;
            },
          });
          for await (const text of result.textStream) {
            if (output.length + text.length > 16000) {
              abort.abort("output_limit");
              break;
            }
            output += text;
            send({ type: "delta", text });
          }
          if (abort.signal.aborted || streamFailed || !output.trim())
            throw new Error("generation_failed");
          status = "complete";
          failureCode = null;
        } catch (error) {
          status = abort.signal.reason === "cancelled" ? "cancelled" : "failed";
          failureCode =
            error instanceof ApiError &&
            Object.hasOwn(FAILURE_MESSAGES, error.code)
              ? error.code
              : abort.signal.reason === "cancelled"
                ? "generation_cancelled"
                : abort.signal.reason === "timeout"
                  ? "generation_timeout"
                  : hasInferenceStarted
                    ? "generation_failed"
                    : failureCode;
        }
        try {
          await finishChat(
            env,
            identity,
            input,
            output,
            status,
            savedSources,
            failureCode,
          );
          send(
            status === "complete"
              ? { type: "finish" }
              : { type: "error", code: failureCode },
          );
        } catch {
          // 推論開始印は残したまま保存不明を記録し、同じIDの再生成を止める。
          await env.DB.prepare(
            "UPDATE chat_requests SET failure_code='history_save_failed' WHERE id=? AND owner_id=? AND status='pending'",
          )
            .bind(input.requestId, identity.id)
            .run()
            .catch(() => undefined);
          send({ type: "error", code: "history_save_failed" });
        } finally {
          clearTimeout(timeout);
          request.signal.removeEventListener("abort", cancel);
          if (open) {
            open = false;
            controller.close();
          }
          resolveDone();
        }
      })();
    },
    cancel() {
      open = false;
      cancel();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
