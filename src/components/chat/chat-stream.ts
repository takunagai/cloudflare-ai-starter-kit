import { ClientError } from "../api-client";

export type Conversation = { id: string; title: string; updated_at?: number };
export type Message = {
  id: string;
  role: string;
  content: string;
  status: string;
  sources?: Source[];
};
export type Source = { id: string; title: string; text?: string };
export type StreamEvent = {
  type: string;
  text?: string;
  code?: string;
  sources?: Source[];
};

/** SSEの`data:`行をJSONのイベントとして順に渡す。形式外は`invalid_stream`。 */
export async function consumeEvents(
  response: Response,
  receive: (event: StreamEvent) => void,
) {
  if (!response.body) throw new ClientError("empty_stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 262144) throw new ClientError("invalid_stream");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") {
          let event: StreamEvent;
          try {
            event = JSON.parse(data) as StreamEvent;
          } catch {
            throw new ClientError("invalid_stream");
          }
          if (!event || typeof event.type !== "string")
            throw new ClientError("invalid_stream");
          receive(event);
        }
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
