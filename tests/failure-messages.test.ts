import { describe, expect, it } from "vitest";
import { responseError, safeCode } from "../src/components/api-client";
import {
  AUTH_FAILURE_MESSAGES,
  authFailureMessage,
} from "../src/lib/auth-errors";
import {
  EXTENSION_FAILURE_MESSAGES,
  extensionFailureMessage,
} from "../src/lib/extension-errors";
import { FAILURE_MESSAGES, failureMessage } from "../src/lib/reliability";

const UNSAFE_CODES = [
  "<script>alert(1)</script>",
  "has space",
  "日本語",
  "",
  "a".repeat(101),
];

describe("応答本文からのエラーコード抽出", () => {
  it("英数字と_の1〜100文字だけをコードとして通す", () => {
    expect(safeCode("rate_limited")).toBe("rate_limited");
    expect(safeCode("a".repeat(100))).toBe("a".repeat(100));
    for (const code of UNSAFE_CODES)
      expect(safeCode(code)).toBe("request_failed");
    expect(safeCode(42)).toBe("request_failed");
    expect(safeCode(undefined)).toBe("request_failed");
  });

  it("errorを優先し、無ければcodeを読む", () => {
    expect(responseError({ error: "rate_limited", code: "other" })).toBe(
      "rate_limited",
    );
    expect(responseError({ code: "INVALID_TOKEN" })).toBe("INVALID_TOKEN");
    expect(responseError({ error: "bad code", code: "INVALID_TOKEN" })).toBe(
      "request_failed",
    );
  });

  it.each([null, "rate_limited", 42, {}, { message: "x" }])(
    "形式外の本文をrequest_failedにする: %j",
    (data) => {
      expect(responseError(data)).toBe("request_failed");
    },
  );
});

describe("認証画面のエラー表示文", () => {
  it("既知のコードは説明文の後に括弧書きでコードを付ける", () => {
    for (const [code, message] of Object.entries(AUTH_FAILURE_MESSAGES))
      expect(authFailureMessage(code)).toBe(`${message}（${code}）`);
  });

  it("未知のコードは汎用文にし、不正なコードはrequest_failedへ置き換える", () => {
    expect(authFailureMessage("unknown_code")).toBe(
      "処理できませんでした（unknown_code）。",
    );
    for (const code of UNSAFE_CODES)
      expect(authFailureMessage(code)).toBe(
        "処理できませんでした（request_failed）。",
      );
  });
});

describe("任意拡張・mediaのエラー表示文", () => {
  it("既知のコードは説明文の後に括弧書きでコードを付ける", () => {
    for (const [code, message] of Object.entries(EXTENSION_FAILURE_MESSAGES))
      expect(extensionFailureMessage(code)).toBe(`${message}（${code}）`);
  });

  it("未知のコードは汎用文にし、不正なコードはrequest_failedへ置き換える", () => {
    expect(extensionFailureMessage("unknown_code")).toBe(
      "処理できませんでした（unknown_code）。",
    );
    for (const code of UNSAFE_CODES)
      expect(extensionFailureMessage(code)).toBe(
        "処理できませんでした（request_failed）。",
      );
  });
});

describe("チャットの失敗分類の表示文", () => {
  it("既知のコードは定義済みの説明文をそのまま返す", () => {
    for (const [code, message] of Object.entries(FAILURE_MESSAGES))
      expect(failureMessage(code)).toBe(message);
  });

  it("未知のコードは汎用文にし、不正なコードはrequest_failedへ置き換える", () => {
    expect(failureMessage("unknown_code")).toBe(
      "処理を確認できませんでした（unknown_code）。",
    );
    for (const code of UNSAFE_CODES)
      expect(failureMessage(code)).toBe(
        "処理を確認できませんでした（request_failed）。",
      );
  });
});
