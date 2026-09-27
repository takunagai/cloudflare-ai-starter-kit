export interface Identity {
  id: string;
  email: string;
  name: string;
}

export interface PublicModel {
  id: string;
  label: string;
  provider: string;
  available: boolean;
}

// Optional integrations never become mandatory bindings for the core app.
export interface AppEnv {
  DB: D1Database;
  APP_ENV: "local" | "staging" | "production";
  APP_ORIGIN: string;
  AUTH_MODE: "better-auth" | "access";
  LOCAL_DEMO?: string;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  EMAIL?: SendEmail;
  EMAIL_FROM?: string;
  AI?: Ai;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  LM_STUDIO_BASE_URL?: string;
  LM_STUDIO_MODEL?: string;
  ENABLE_RAG?: string;
  ENABLE_AGENT?: string;
  ENABLE_WORKFLOWS?: string;
  ENABLE_IMAGES?: string;
  ENABLE_BILLING?: string;
  RAG_BUCKET?: R2Bucket;
  AI_SEARCH?: Pick<AiSearchInstance, "search">;
  SUMMARY_WORKFLOW?: Workflow;
  FAL_KEY?: string;
  POLAR_ACCESS_TOKEN?: string;
  POLAR_WEBHOOK_SECRET?: string;
  POLAR_PRODUCT_ID?: string;
  POLAR_SERVER?: "sandbox" | "production";
}

export function isLoopbackHostname(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

export function isLocalDevelopment(env: AppEnv): boolean {
  try {
    return (
      env.APP_ENV === "local" &&
      isLoopbackHostname(new URL(env.APP_ORIGIN).hostname)
    );
  } catch {
    return false;
  }
}

export function isEnabled(flag: string | undefined): boolean {
  return flag === "true";
}
