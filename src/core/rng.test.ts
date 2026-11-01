import { describe, expect, it } from "vitest";
import { Rng, hashString } from "./rng.ts";

describe("Rng", () => {
  it("同一 seed 產生相同序列", () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("不同 seed 產生不同序列", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("next() 位於 [0, 1) 範圍", () => {
    const rng = new Rng("test");
    for (let i = 0; i < 200; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("int() 位於含頭尾的整數範圍", () => {
    const rng = new Rng(99);
    for (let i = 0; i < 200; i++) {
      const value = rng.int(3, 7);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
    }
  });

  it("shuffle 為可重現的排列且不修改原陣列", () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffledA = new Rng(42).shuffle(source);
    const shuffledB = new Rng(42).shuffle(source);
    expect(shuffledA).toEqual(shuffledB);
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shuffledA.slice().sort((x, y) => x - y)).toEqual(source);
  });

  it("fork 產生獨立且可重現的子流", () => {
    const parentA = new Rng(7);
    const childA = parentA.fork("terrain");
    const parentB = new Rng(7);
    const childB = parentB.fork("terrain");
    expect(Array.from({ length: 5 }, () => childA.next())).toEqual(
      Array.from({ length: 5 }, () => childB.next()),
    );
  });

  it("hashString 穩定且區分不同字串", () => {
    expect(hashString("city")).toBe(hashString("city"));
    expect(hashString("city")).not.toBe(hashString("citY"));
  });
});
