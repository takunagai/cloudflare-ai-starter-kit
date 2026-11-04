import { describe, expect, it } from "vitest";
import { ClientError } from "../src/components/api-client";
import {
  consumeEvents,
  type StreamEvent,
} from "../src/components/chat/chat-stream";

function streamOf(chunks: (string | Uint8Array)[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(
            typeof chunk === "string" ? encoder.encode(chunk) : chunk,
          );
        controller.close();
      },
    }),
  );
}

async function collect(response: Response) {
  const events: StreamEvent[] = [];
  await consumeEvents(response, (event) => events.push(event));
  return events;
}

describe("SSEのイベント読取り", () => {
  it("data行をJSONのイベントとして順に渡し、[DONE]とdata以外の行を無視する", async () => {
    const events = await collect(
      streamOf([
        ': comment\nevent: message\ndata: {"type":"delta","text":"架空"}\n\n',
        'data: {"type":"done"}\n\ndata: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([{ type: "delta", text: "架空" }, { type: "done" }]);
  });

  it("チャンク境界をまたぐイベントとUTF-8の分割を復元する", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"type":"delta","text":"日本語"}\n\n',
    );
    const middle = bytes.indexOf(0xe6) + 1;
    const events = await collect(
      streamOf([bytes.slice(0, middle), bytes.slice(middle)]),
    );
    expect(events).toEqual([{ type: "delta", text: "日本語" }]);
  });

  it("CRLFの区切りと複数行のdataを連結する", async () => {
    const events = await collect(
      streamOf(['data: {"type":\r\ndata: "delta","text":"a"}\r\n\r\n']),
    );
    expect(events).toEqual([{ type: "delta", text: "a" }]);
  });

  it.each([
    ["JSONでない", "data: not-json\n\n"],
    ["typeがない", 'data: {"text":"a"}\n\n'],
    ["typeが文字列でない", 'data: {"type":1}\n\n'],
    ["nullである", "data: null\n\n"],
  ])("形式外のイベントをinvalid_streamにする: %s", async (_name, body) => {
    await expect(collect(streamOf([body]))).rejects.toMatchObject({
      code: "invalid_stream",
    });
  });

  it("区切りのないまま上限を超えるとinvalid_streamにする", async () => {
    await expect(
      collect(streamOf([`data: ${"x".repeat(262145)}`])),
    ).rejects.toMatchObject({ code: "invalid_stream" });
  });

  it("本文のない応答をempty_streamにする", async () => {
    const error = await collect(new Response(null)).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ClientError);
    expect(error).toMatchObject({ code: "empty_stream" });
  });

  it("失敗後も読取りのロックを解放する", async () => {
    const response = streamOf(["data: not-json\n\n"]);
    await expect(collect(response)).rejects.toThrow(ClientError);
    expect(response.body?.locked).toBe(false);
  });
});
