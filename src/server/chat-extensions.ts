import { noteTools } from "./agent-tools";
import type { ChatExtensions } from "./chat";
import { retrieveRag } from "./extensions/rag";

/**
 * チャットへ接続する任意拡張。拡張を外す複製先は、この行と拡張moduleを消す。
 * 呼出しごとにimport先を参照し、試験でのmodule単位の差替えを効かせる。
 */
export const CHAT_EXTENSIONS: ChatExtensions = {
  retrieveSources: (env, identity, query) => retrieveRag(env, identity, query),
  createTools: (env, identity, onApproval) =>
    noteTools(env, identity, onApproval),
};
