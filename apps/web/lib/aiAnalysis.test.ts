import { expect, test } from "bun:test";
import { fillMissingAiValue } from "./aiAnalysis";

test("未設定の項目をAI解析結果で補完する", () => {
  expect(fillMissingAiValue("", "タオル")).toBe("タオル");
  expect(fillMissingAiValue(undefined, "財布")).toBe("財布");
  expect(fillMissingAiValue(null, "傘")).toBe("傘");
  expect(fillMissingAiValue("   ", "鍵")).toBe("鍵");
});

test("設定済みの項目はAI解析結果で上書きしない", () => {
  expect(fillMissingAiValue("ハンカチ", "タオル")).toBe("ハンカチ");
});
