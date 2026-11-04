import { describe, expect, it } from "vitest";
import { validText } from "../src/server/decisions/contracts";

describe("依頼分類の文字列検証", () => {
  it("上限ちょうどの文字数を受け付け、超えたら拒否する", () => {
    expect(validText("あいう", 3)).toBe(true);
    expect(validText("あいうえ", 3)).toBe(false);
  });

  it("サロゲートペアの絵文字を1文字として数える", () => {
    expect(validText("😀😀", 2)).toBe(true);
    expect(validText("😀😀😀", 2)).toBe(false);
  });

  it.each([
    ["空文字", ""],
    ["空白だけ", " \n\t "],
    ["NUL文字を含む", "架空\0"],
    ["孤立した上位サロゲート", "a\uD800"],
    ["孤立した下位サロゲート", "\uDC00b"],
  ])("不正な文字列を拒否する: %s", (_name, value) => {
    expect(validText(value, 100)).toBe(false);
  });

  it("前後の空白を含む文字列は空白も文字数に数える", () => {
    expect(validText(" a ", 3)).toBe(true);
    expect(validText(" a ", 2)).toBe(false);
  });
});
