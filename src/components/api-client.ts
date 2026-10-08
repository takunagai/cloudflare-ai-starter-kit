export class ClientError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export function safeCode(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_]{1,100}$/.test(value)
    ? value
    : "request_failed";
}

export function responseError(data: unknown): string {
  if (typeof data !== "object" || data === null) return "request_failed";
  if ("error" in data) return safeCode(data.error);
  return "code" in data ? safeCode(data.code) : "request_failed";
}

export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  }).catch(() => {
    throw new ClientError("network_unconfirmed");
  });
  if (response.status === 401 || response.redirected)
    throw new ClientError("authentication_required");
  if (!response.headers.get("Content-Type")?.includes("application/json"))
    throw new ClientError("unexpected_response");
  const data = await response.json().catch(() => {
    throw new ClientError("unexpected_response");
  });
  if (!response.ok) throw new ClientError(responseError(data));
  return data as T;
}

export function errorCode(error: unknown): string {
  return error instanceof ClientError ? error.code : "request_failed";
}

export type Features = {
  rag: boolean;
  agent: boolean;
  workflows: boolean;
  images: boolean;
  billing: boolean;
};
export type Model = {
  id: string;
  label: string;
  provider: string;
  available: boolean;
};
