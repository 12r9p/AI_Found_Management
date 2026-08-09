import { expect, test } from "bun:test";
import { createApp } from "../app.ts";
import type { Env } from "../config.ts";
import { setEnv } from "../env-holder.ts";
import { configuredOption, inquiryImportFingerprint, parseInquiryCsv } from "./inquiry-import.ts";

test("Googleフォーム形式のCSVから問い合わせ列を抽出する", () => {
  const rows = parseInquiryCsv(
    "\uFEFFタイムスタンプ,落とし物の特徴を教えてください,カテゴリ,色,受付番号,タグ,備考\r\n" +
      '2026/08/09 10:00,"青いタオル, 星柄\n記名なし",タオル,青,R-10,"布、星柄","確認済み"\r\n',
  );
  expect(rows).toEqual([
    {
      rowNumber: 2,
      description: "青いタオル, 星柄\n記名なし",
      category: "タオル",
      color: "青",
      referenceNo: "R-10",
      tags: ["布", "星柄"],
      notes: "確認済み",
    },
  ]);
});

test("特徴列がないCSVを拒否する", () => {
  expect(() => parseInquiryCsv("カテゴリ,色\nタオル,青")).toThrow("description_column_required");
});

test("設定済み選択肢だけを表記揺れを吸収して採用する", () => {
  expect(configuredOption(" タオル ", ["財布", "タオル"])).toBe("タオル");
  expect(configuredOption("未登録カテゴリ", ["財布", "タオル"])).toBe("");
});

test("受付番号と特徴を正規化して重複判定する", () => {
  expect(inquiryImportFingerprint("Ｒ－１０", " 青い タオル ")).toBe(
    inquiryImportFingerprint("R-10", "青いタオル"),
  );
});

test("CSV APIは問い合わせを取り込み、同じ受付番号と特徴の再取込をスキップする", async () => {
  setEnv({} as Env);
  const referenceNo = `CSV-${crypto.randomUUID()}`;
  const csv = `落とし物の特徴,カテゴリ,色,受付番号\n青い折りたたみ傘,,,${referenceNo}`;
  const request = () => {
    const body = new FormData();
    body.append("file", new File([csv], "inquiries.csv", { type: "text/csv" }));
    return createApp().handle(
      new Request("http://localhost/api/inquiries/import", { method: "POST", body }),
    );
  };

  const first = await request();
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ total: 1, imported: 1, skipped: 0, failed: 0 });
  const listed = await createApp().handle(new Request("http://localhost/api/inquiries"));
  const imported = (
    (await listed.json()) as {
      inquiries: { reference_no: string; category: string; color: string }[];
    }
  ).inquiries.find((inquiry) => inquiry.reference_no === referenceNo);
  expect(imported).toMatchObject({ category: "傘", color: "青" });

  const second = await request();
  expect(second.status).toBe(200);
  expect(await second.json()).toMatchObject({ total: 1, imported: 0, skipped: 1, failed: 0 });
});
