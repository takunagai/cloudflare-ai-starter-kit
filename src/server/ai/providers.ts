import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import {
  chatModelAllowed,
  type VerificationEnv,
  verificationSettings,
} from "../ai-verification";
import { type AppEnv, isLocalDevelopment, type PublicModel } from "../env";
import { resolveRuntimePolicy } from "../runtime-policy";
import { chatModelCatalog as catalog } from "./catalog";
import { createLocalDemoModel } from "./local-demo";

export type { PublicModel } from "../env";

export class ModelUnavailableError extends Error {
  constructor() {
    super("model_unavailable");
    this.name = "ModelUnavailableError";
  }
}

function configured(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function localEndpoint(env: AppEnv): string | undefined {
  if (
    !isLocalDevelopment(env) ||
    !configured(env.LM_STUDIO_BASE_URL) ||
    !configured(env.LM_STUDIO_MODEL)
  )
    return;
  try {
    const url = new URL(env.LM_STUDIO_BASE_URL);
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/v1\/?$/.test(url.pathname)
    )
      return;
    return url.href.replace(/\/$/, "");
  } catch {
    return;
  }
}

function available(
  entry: (typeof catalog)[number],
  env: VerificationEnv,
): boolean {
  const policy = resolveRuntimePolicy(env);
  if (
    !policy.boundary.ok ||
    !policy.chat.ok ||
    !chatModelAllowed(policy.chat.value, entry.id)
  )
    return false;
  try {
    verificationSettings(env);
  } catch {
    return false;
  }
  switch (entry.provider) {
    case "openai":
      return configured(env.OPENAI_API_KEY);
    case "anthropic":
      return configured(env.ANTHROPIC_API_KEY);
    case "google":
      return configured(env.GOOGLE_GENERATIVE_AI_API_KEY);
    case "openrouter":
      return configured(env.OPENROUTER_API_KEY);
    case "workers-ai":
      return Boolean(env.AI);
    case "lm-studio":
      return Boolean(localEndpoint(env));
    case "local-demo":
      return isLocalDevelopment(env) && env.LOCAL_DEMO === "true";
  }
}

export function listModels(env: VerificationEnv): PublicModel[] {
  return catalog.map((entry) => ({
    ...entry,
    available: available(entry, env),
  }));
}

export function getModel(modelId: string, env: VerificationEnv): LanguageModel {
  const entry = catalog.find((item) => item.id === modelId);
  if (!entry || !available(entry, env)) throw new ModelUnavailableError();
  switch (entry.provider) {
    case "openai":
      return createOpenAI({ apiKey: env.OPENAI_API_KEY }).chat("gpt-4.1-mini");
    case "anthropic":
      return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(
        "claude-haiku-4-5",
      );
    case "google":
      return createGoogleGenerativeAI({
        apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
      })("gemini-3.5-flash-lite");
    case "openrouter":
      return createOpenRouter({ apiKey: env.OPENROUTER_API_KEY })(
        "openai/gpt-4.1-mini",
      );
    case "workers-ai": {
      if (!env.AI) throw new ModelUnavailableError();
      return createWorkersAI({ binding: env.AI })(
        "@cf/meta/llama-3.1-8b-instruct-fp8",
      );
    }
    case "lm-studio": {
      const baseURL = localEndpoint(env);
      if (!baseURL || !env.LM_STUDIO_MODEL) throw new ModelUnavailableError();
      return createOpenAICompatible({
        name: "lm-studio",
        baseURL,
        // loopbackから外部へのredirectでプロンプトが転送されないようにする。
        fetch: (input, init) => fetch(input, { ...init, redirect: "error" }),
      })(env.LM_STUDIO_MODEL);
    }
    case "local-demo":
      return createLocalDemoModel();
  }
}
