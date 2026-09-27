import type { AppEnv, Identity } from "../env";
import { ApiError, json, readJson } from "../http";
import {
  cancelImage,
  getImage,
  imageInputSchema,
  listImages,
  submitImage,
} from "./images";
import {
  deleteDocument,
  getDocument,
  listDocuments,
  ragQuerySchema,
  ragUploadSchema,
  retrieveRag,
  uploadDocument,
} from "./rag";
import {
  approvalSchema,
  decideSummary,
  getSummary,
  listSummaries,
  startSummary,
  summaryInputSchema,
} from "./workflows";

export async function handleExtensions(
  request: Request,
  env: AppEnv,
  identity: Identity,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/extensions/")) return null;
  const match = /^\/api\/extensions\/(rag|images|workflows)(?:\/(.*))?$/.exec(
    path,
  );
  if (!match) return null;
  const [, feature, rest = ""] = match;
  const enabled =
    feature === "rag"
      ? env.ENABLE_RAG
      : feature === "images"
        ? env.ENABLE_IMAGES
        : env.ENABLE_WORKFLOWS;
  if (enabled !== "true") throw new ApiError(404, "FEATURE_DISABLED");
  const method = request.method;
  if (feature === "rag") {
    if (rest === "documents") {
      if (method === "GET") return json(await listDocuments(env, identity));
      if (method === "POST")
        return json(
          await uploadDocument(
            env,
            identity,
            await readJson(request, ragUploadSchema, 200_000),
          ),
          201,
        );
      return notAllowed("GET, POST");
    }
    if (rest === "search") {
      if (method !== "POST") return notAllowed("POST");
      const { query } = await readJson(request, ragQuerySchema);
      return json(await retrieveRag(env, identity, query));
    }
    const document = /^documents\/([a-f0-9-]{36})$/.exec(rest);
    if (document) {
      if (method === "GET")
        return json(await getDocument(env, identity, document[1]));
      if (method === "DELETE")
        return json(await deleteDocument(env, identity, document[1]));
      return notAllowed("GET, DELETE");
    }
  }
  if (feature === "images") {
    if (!rest) {
      if (method === "GET") return json(await listImages(env, identity));
      if (method === "POST")
        return json(
          await submitImage(
            env,
            identity,
            await readJson(request, imageInputSchema),
          ),
          202,
        );
      return notAllowed("GET, POST");
    }
    const image = /^([a-f0-9-]{36})(\/cancel)?$/.exec(rest);
    if (image) {
      if (image[2])
        return method === "POST"
          ? json(await cancelImage(env, identity, image[1]))
          : notAllowed("POST");
      return method === "GET"
        ? json(await getImage(env, identity, image[1]))
        : notAllowed("GET");
    }
  }
  if (feature === "workflows") {
    if (!rest) {
      if (method === "GET") return json(await listSummaries(env, identity));
      if (method === "POST")
        return json(
          await startSummary(
            env,
            identity,
            await readJson(request, summaryInputSchema),
          ),
          202,
        );
      return notAllowed("GET, POST");
    }
    const job = /^([a-f0-9]{64})(\/decision)?$/.exec(rest);
    if (job) {
      if (job[2]) {
        if (method !== "POST") return notAllowed("POST");
        const { decision } = await readJson(request, approvalSchema);
        return json(await decideSummary(env, identity, job[1], decision));
      }
      return method === "GET"
        ? json(await getSummary(env, identity, job[1]))
        : notAllowed("GET");
    }
  }
  return null;
}

function notAllowed(allow: string) {
  return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: allow });
}
