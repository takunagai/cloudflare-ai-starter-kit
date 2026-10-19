import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv, Identity } from "../src/server/env";
import {
  deleteDocument,
  digest,
  getDocument,
  retrieveRag,
  uploadDocument,
} from "../src/server/extensions/rag";
import { handleExtensions } from "../src/server/extensions/routes";

const base = env as unknown as AppEnv;
const alice: Identity = {
  id: "rag-alice",
  email: "alice@example.test",
  name: "Alice",
};
const bob: Identity = { id: "rag-bob", email: "bob@example.test", name: "Bob" };
const search =
  vi.fn<(input: AiSearchSearchRequest) => Promise<AiSearchSearchResponse>>();
const app = { ...base, ENABLE_RAG: "true", AI_SEARCH: { search } };

beforeEach(async () => {
  await base.DB.prepare("DELETE FROM rag_documents").run();
  await base.DB.prepare(
    "DELETE FROM app_rate_limits WHERE key LIKE 'rag-search:%'",
  ).run();
  search.mockReset();
});

describe("RAG isolation with local D1/R2 and fake AI Search", () => {
  it("requires no bindings when every extension is disabled", async () => {
    const disabled = {
      ...base,
      ENABLE_RAG: "false",
      ENABLE_IMAGES: "false",
      ENABLE_WORKFLOWS: "false",
      RAG_BUCKET: undefined,
      AI_SEARCH: undefined,
      SUMMARY_WORKFLOW: undefined,
      FAL_KEY: undefined,
    };
    for (const feature of ["rag", "images", "workflows"]) {
      await expect(
        handleExtensions(
          new Request(`https://starter.test/api/extensions/${feature}`),
          disabled,
          alice,
        ),
      ).rejects.toMatchObject({ status: 404, code: "FEATURE_DISABLED" });
    }
    expect(search).not.toHaveBeenCalled();
  });

  it("uploads owner metadata and returns only owner sources despite contaminated index hits", async () => {
    const own = await uploadDocument(app, alice, {
      title: "社内手順",
      text: "これは資料です。",
    });
    const other = await uploadDocument(app, bob, {
      title: "秘密資料",
      text: "他人の情報",
    });
    const ownerKey = await digest(alice.id);
    const bobKey = await digest(bob.id);
    const key = `${ownerKey.slice(0, 32)}/${own.id}.md`;
    const otherKey = `${bobKey.slice(0, 32)}/${other.id}.md`;
    const ownChunk = {
      id: "c1",
      type: "text",
      score: 0.8,
      text: "手順の抜粋",
      item: { key, metadata: { owner_key: ownerKey, document_id: own.id } },
    };
    search.mockResolvedValue({
      search_query: "手順",
      chunks: [
        ownChunk,
        {
          ...ownChunk,
          id: "c2",
          text: "他人の情報",
          item: {
            key: otherKey,
            metadata: { owner_key: bobKey, document_id: other.id },
          },
        },
        {
          ...ownChunk,
          id: "c3",
          text: "所有者偽装",
          item: {
            key: `${ownerKey.slice(0, 32)}/${other.id}.md`,
            metadata: { owner_key: ownerKey, document_id: other.id },
          },
        },
      ],
    });
    const result = await retrieveRag(app, alice, "手順");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      documentId: own.id,
      text: "手順の抜粋",
    });
    expect(search.mock.calls[0][0]).toMatchObject({
      ai_search_options: {
        retrieval: {
          filters: {
            owner_key: { $eq: ownerKey },
            folder: { $eq: `${ownerKey.slice(0, 32)}/` },
          },
          return_on_failure: false,
        },
        cache: { enabled: false },
      },
    });
    expect(await getDocument(app, alice, own.id)).toMatchObject({
      state: "indexed",
    });
    await expect(getDocument(app, bob, own.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(deleteDocument(app, bob, own.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("hides deleted documents immediately while the search index remains stale", async () => {
    const doc = await uploadDocument(app, alice, {
      title: "消す資料",
      text: "削除対象",
    });
    const ownerKey = await digest(alice.id);
    search.mockResolvedValue({
      search_query: "削除",
      chunks: [
        {
          id: "stale",
          type: "text",
          score: 1,
          text: "削除対象",
          item: {
            key: `${ownerKey.slice(0, 32)}/${doc.id}.md`,
            metadata: { owner_key: ownerKey, document_id: doc.id },
          },
        },
      ],
    });
    await deleteDocument(app, alice, doc.id);
    expect((await retrieveRag(app, alice, "削除")).sources).toEqual([]);
    await expect(getDocument(app, alice, doc.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await deleteDocument(app, alice, doc.id)).toMatchObject({
      state: "deleted",
    });
  });

  it("reports empty/indexing separately from failed retrieval, without retrying unfiltered", async () => {
    search.mockResolvedValue({ search_query: "未索引", chunks: [] });
    expect(await retrieveRag(app, alice, "未索引")).toEqual({
      sources: [],
      indexState: "empty_or_indexing",
    });
    search.mockRejectedValue(new Error("provider private detail"));
    await expect(retrieveRag(app, alice, "失敗")).rejects.toMatchObject({
      code: "RAG_SEARCH_FAILED",
    });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("fails closed when indexed custom metadata is absent", async () => {
    const doc = await uploadDocument(app, alice, {
      title: "metadata確認",
      text: "この資料は本文を返さない",
    });
    const ownerKey = await digest(alice.id);
    search.mockResolvedValue({
      search_query: "確認",
      chunks: [
        {
          id: "missing",
          type: "text",
          score: 1,
          text: "この資料は本文を返さない",
          item: { key: `${ownerKey.slice(0, 32)}/${doc.id}.md` },
        },
      ],
    });
    expect(await retrieveRag(app, alice, "確認")).toEqual({
      sources: [],
      indexState: "empty_or_indexing",
    });
  });

  it("reserves the final daily search slot atomically and rejects the next search", async () => {
    const key = `rag-search:${await digest(alice.id)}:${Math.floor(Date.now() / 86_400_000)}`;
    await base.DB.prepare(
      "INSERT INTO app_rate_limits (key,count,expires_at) VALUES (?,59,?)",
    )
      .bind(key, Date.now() + 86_400_000)
      .run();
    search.mockResolvedValue({ search_query: "枠", chunks: [] });
    const results = await Promise.allSettled([
      retrieveRag(app, alice, "枠"),
      retrieveRag(app, alice, "枠"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "RAG_SEARCH_LIMIT_REACHED" },
    });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("returns a deadline error without an unfiltered retry or quota refund", async () => {
    search.mockImplementation(() => new Promise(() => {}));
    await expect(retrieveRag(app, alice, "timeout", 5)).rejects.toMatchObject({
      status: 504,
      code: "RAG_SEARCH_TIMEOUT",
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(
      await base.DB.prepare(
        "SELECT count FROM app_rate_limits WHERE key LIKE 'rag-search:%'",
      ).first("count"),
    ).toBe(1);
  });

  it.each(["late-success", "late-put-error", "compensation-error"] as const)(
    "preserves a DELETE tombstone during %s and removes the late R2 write",
    async (mode) => {
      const bucket = app.RAG_BUCKET;
      if (!bucket) throw new Error("test R2 binding missing");
      let startPut: () => void = () => {};
      let releasePut: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        startPut = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releasePut = resolve;
      });
      const delayed = {
        ...app,
        RAG_BUCKET: {
          put: async (key: string, value: string, options: R2PutOptions) => {
            startPut();
            await release;
            const result = await bucket.put(key, value, options);
            if (mode === "late-put-error")
              throw new Error("lost PUT acknowledgement");
            return result;
          },
          delete: async (key: string) => {
            if (mode === "compensation-error")
              throw new Error("temporary delete failure");
            return bucket.delete(key);
          },
        } as unknown as R2Bucket,
      };
      const expected =
        mode === "late-success"
          ? "DOCUMENT_DELETED"
          : mode === "late-put-error"
            ? "RAG_UPLOAD_FAILED"
            : "RAG_DELETE_PENDING";
      const uploading = uploadDocument(delayed, alice, {
        title: "削除競合",
        text: "残さない原本",
      });
      const rejected = expect(uploading).rejects.toMatchObject({
        code: expected,
      });
      await started;
      const row = await base.DB.prepare(
        "SELECT id,object_key FROM rag_documents WHERE owner_id = ?",
      )
        .bind(alice.id)
        .first<{ id: string; object_key: string }>();
      if (!row) throw new Error("upload reservation missing");
      await deleteDocument(app, alice, row.id);
      releasePut();
      await rejected;
      expect(
        await base.DB.prepare("SELECT state FROM rag_documents WHERE id = ?")
          .bind(row.id)
          .first("state"),
      ).toBe("deleted");
      await expect(getDocument(app, alice, row.id)).rejects.toMatchObject({
        status: 404,
      });
      if (mode === "compensation-error") {
        expect(await bucket.head(row.object_key)).not.toBeNull();
        await deleteDocument(app, alice, row.id);
      }
      expect(await bucket.head(row.object_key)).toBeNull();
    },
  );
});
