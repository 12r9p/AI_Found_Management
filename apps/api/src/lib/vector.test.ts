import { test, expect } from "bun:test";
import { cosineSimilarity, toPgVector } from "./vector.ts";
import { deterministicEmbed } from "../ai/provider.ts";

test("cosineSimilarity: identical vectors = 1", () => {
  expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
});

test("cosineSimilarity: orthogonal = 0", () => {
  expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
});

test("cosineSimilarity: length mismatch = 0", () => {
  expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
});

test("deterministicEmbed: deterministic and normalized", () => {
  const a = deterministicEmbed("茶色い革の財布", 256);
  const b = deterministicEmbed("茶色い革の財布", 256);
  expect(a).toEqual(b);
  const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  expect(norm).toBeCloseTo(1, 5);
});

test("deterministicEmbed: Japanese paraphrases score higher than unrelated", () => {
  const q = deterministicEmbed("茶色い革の二つ折り財布", 512);
  const near = deterministicEmbed("茶色の革製二つ折り財布", 512);
  const far = deterministicEmbed("銀色のステンレス水筒", 512);
  expect(cosineSimilarity(q, near)).toBeGreaterThan(cosineSimilarity(q, far));
});

test("toPgVector formats a pgvector literal", () => {
  expect(toPgVector([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
});
