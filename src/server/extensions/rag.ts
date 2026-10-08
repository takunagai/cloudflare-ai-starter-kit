import { z } from "zod";
import type { AppEnv, Identity } from "../env";
import { ApiError } from "../http";
import {
  checkExtensionRuntimePolicy,
  requireExtensionEnabled,
} from "../runtime-guards";

export type RagSearchBinding = Pick<AiSearchInstance, "search">;

export const ragUploadSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(50_000),
});
export const ragQuerySchema = z.strictObject({
  query: z.string().trim().min(1).max(2_000),
});

interface DocumentRow {
  id: string;
  owner_id: string;
  title: string;
  object_key: string;
  state: string;
  created_at: number;
}

export interface RagSource {
  id: string;
  documentId: string;
  title: string;
  text: string;
  url: string;
}

export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function bindings(env: AppEnv) {
  requireExtensionEnabled(env, env.ENABLE_RAG);
  if (!env.RAG_BUCKET || !env.AI_SEARCH)
    throw new ApiError(503, "RAG_NOT_CONFIGURED");
  return { bucket: env.RAG_BUCKET, search: env.AI_SEARCH };
}

export async function listDocuments(env: AppEnv, identity: Identity) {
  requireExtensionEnabled(env, env.ENABLE_RAG);
  await checkExtensionRuntimePolicy(env);
  bindings(env);
  const result = await env.DB.prepare(
    "SELECT id, title, state, created_at FROM rag_documents WHERE owner_id = ? AND state != 'deleted' ORDER BY created_at DESC LIMIT 100",
  )
    .bind(identity.id)
    .all();
  return { documents: result.results };
}

export async function uploadDocument(
  env: AppEnv,
  identity: Identity,
  input: z.infer<typeof ragUploadSchema>,
) {
  requireExtensionEnabled(env, env.ENABLE_RAG);
  const checked = ragUploadSchema.safeParse(input);
  if (!checked.success) throw new ApiError(400, "INVALID_INPUT");
  input = checked.data;
  await checkExtensionRuntimePolicy(env);
  const { bucket } = bindings(env);
  const ownerKey = await digest(identity.id);
  const id = crypto.randomUUID();
  // A fixed short folder and fixed metadata schema avoid caller-controlled filters.
  const key = `${ownerKey.slice(0, 32)}/${id}.md`;
  const reserved = await env.DB.prepare(
    `INSERT INTO rag_documents (id, owner_id, title, object_key, state, created_at)
     SELECT ?, ?, ?, ?, 'uploading', ?
     WHERE (SELECT COUNT(*) FROM rag_documents WHERE owner_id = ? AND state != 'deleted') < 100`,
  )
    .bind(id, identity.id, input.title, key, Date.now(), identity.id)
    .run();
  if (!reserved.meta.changes) throw new ApiError(429, "DOCUMENT_LIMIT_REACHED");
  let published: D1Result;
  try {
    await checkExtensionRuntimePolicy(env);
    await bucket.put(key, input.text, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      customMetadata: { owner_key: ownerKey, document_id: id },
    });
    await checkExtensionRuntimePolicy(env);
    published = await env.DB.prepare(
      "UPDATE rag_documents SET state = 'pending_index' WHERE id = ? AND state = 'uploading'",
    )
      .bind(id)
      .run();
  } catch (error) {
    const failed = await env.DB.prepare(
      "UPDATE rag_documents SET state = 'failed' WHERE id = ? AND state = 'uploading'",
    )
      .bind(id)
      .run();
    if (!failed.meta.changes) {
      const row = await env.DB.prepare(
        "SELECT state FROM rag_documents WHERE id = ?",
      )
        .bind(id)
        .first<{ state: string }>();
      if (row?.state === "deleted") await removeDeletedUpload(bucket, key);
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "RAG_UPLOAD_FAILED");
  }
  if (!published.meta.changes) {
    // DELETE may have finished before an in-flight PUT wrote the object. Keep
    // the tombstone and compensate the late write instead of reviving it.
    await removeDeletedUpload(bucket, key);
    throw new ApiError(409, "DOCUMENT_DELETED");
  }
  return { id, title: input.title, state: "pending_index" };
}

async function removeDeletedUpload(bucket: R2Bucket, key: string) {
  try {
    await bucket.delete(key);
  } catch {
    throw new ApiError(502, "RAG_DELETE_PENDING");
  }
}

async function documentFor(env: AppEnv, identity: Identity, id: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM rag_documents WHERE id = ? AND owner_id = ? AND state != 'deleted'",
  )
    .bind(id, identity.id)
    .first<DocumentRow>();
  if (!row) throw new ApiError(404, "NOT_FOUND");
  return row;
}

export async function getDocument(env: AppEnv, identity: Identity, id: string) {
  requireExtensionEnabled(env, env.ENABLE_RAG);
  const row = await documentFor(env, identity, id);
  await checkExtensionRuntimePolicy(env);
  const { bucket } = bindings(env);
  const object = await bucket.get(row.object_key);
  if (!object) throw new ApiError(404, "NOT_FOUND");
  return {
    id: row.id,
    title: row.title,
    state: row.state,
    text: await object.text(),
  };
}

export async function deleteDocument(
  env: AppEnv,
  identity: Identity,
  id: string,
) {
  requireExtensionEnabled(env, env.ENABLE_RAG);
  // Also allow repeating deletion if R2 deletion failed after the SQL tombstone.
  const row = await env.DB.prepare(
    "SELECT * FROM rag_documents WHERE id = ? AND owner_id = ?",
  )
    .bind(id, identity.id)
    .first<DocumentRow>();
  if (!row) throw new ApiError(404, "NOT_FOUND");
  await checkExtensionRuntimePolicy(env);
  const { bucket } = bindings(env);
  await env.DB.prepare(
    "UPDATE rag_documents SET state = 'deleted', deleted_at = ? WHERE id = ? AND owner_id = ?",
  )
    .bind(Date.now(), id, identity.id)
    .run();
  try {
    await checkExtensionRuntimePolicy(env);
    await bucket.delete(row.object_key);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "RAG_DELETE_PENDING");
  }
  return { id, state: "deleted", indexDeletion: "pending" };
}

export async function retrieveRag(
  env: AppEnv,
  identity: Identity,
  query: string,
  deadlineMs = 15_000,
): Promise<{
  sources: RagSource[];
  indexState: "ready" | "empty_or_indexing";
}> {
  requireExtensionEnabled(env, env.ENABLE_RAG);
  const checked = ragQuerySchema.safeParse({ query });
  if (!checked.success) throw new ApiError(400, "INVALID_INPUT");
  await checkExtensionRuntimePolicy(env);
  const { search, bucket } = bindings(env);
  const ownerKey = await digest(identity.id);
  const folder = `${ownerKey.slice(0, 32)}/`;
  const day = Math.floor(Date.now() / 86_400_000);
  const reserved = await env.DB.prepare(
    `INSERT INTO app_rate_limits (key, count, expires_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < 60 RETURNING count`,
  )
    .bind(`rag-search:${ownerKey}:${day}`, (day + 2) * 86_400_000)
    .first();
  if (!reserved) throw new ApiError(429, "RAG_SEARCH_LIMIT_REACHED");
  let result: AiSearchSearchResponse;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await checkExtensionRuntimePolicy(env);
    const pending = search.search({
      query: checked.data.query,
      ai_search_options: {
        retrieval: {
          filters: { owner_key: { $eq: ownerKey }, folder: { $eq: folder } },
          max_num_results: 5,
          return_on_failure: false,
        },
        query_rewrite: { enabled: false },
        cache: { enabled: false },
      },
    });
    result = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ApiError(504, "RAG_SEARCH_TIMEOUT")),
          deadlineMs,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "RAG_SEARCH_FAILED");
  } finally {
    clearTimeout(timer);
  }
  const sources: RagSource[] = [];
  for (const chunk of result.chunks.slice(0, 5)) {
    const key = chunk.item.key;
    if (!key.startsWith(folder) || chunk.item.metadata?.owner_key !== ownerKey)
      continue;
    const row = await env.DB.prepare(
      "SELECT * FROM rag_documents WHERE object_key = ? AND owner_id = ? AND state IN ('pending_index', 'indexed')",
    )
      .bind(key, identity.id)
      .first<DocumentRow>();
    // SQL tombstones reject stale index hits immediately. R2 metadata is checked
    // independently, before any retrieved text reaches the chat provider.
    if (!row || chunk.item.metadata?.document_id !== row.id) continue;
    await checkExtensionRuntimePolicy(env);
    const object = await bucket.head(key);
    if (
      object?.customMetadata?.owner_key !== ownerKey ||
      object.customMetadata.document_id !== row.id
    )
      continue;
    sources.push({
      id: `source-${sources.length + 1}`,
      documentId: row.id,
      title: row.title,
      text: chunk.text.slice(0, 4_000),
      url: `/api/extensions/rag/documents/${row.id}`,
    });
    await checkExtensionRuntimePolicy(env);
    await env.DB.prepare(
      "UPDATE rag_documents SET state = 'indexed' WHERE id = ? AND state = 'pending_index'",
    )
      .bind(row.id)
      .run();
  }
  return {
    sources,
    indexState: sources.length ? "ready" : "empty_or_indexing",
  };
}
