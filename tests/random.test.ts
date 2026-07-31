import { describe, expect, it } from 'vitest';
import { DisplayRandom, hash2, hash3, mix32, pick } from '../src/core/random';

describe('位置から値を作るハッシュ', () => {
  it('同じ入力からは必ず同じ値', () => {
    expect(mix32(12345)).toBe(mix32(12345));
    expect(hash2(7, 9)).toBe(hash2(7, 9));
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
  });

  it('入力が違えば値も散らばる', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) seen.add(hash2(i, i * 3 + 1));
    expect(seen.size).toBeGreaterThan(4900);
  });

  it('順番を入れ替えると別の値になる（位置を取り違えない）', () => {
    expect(hash2(3, 8)).not.toBe(hash2(8, 3));
    expect(hash3(1, 2, 3)).not.toBe(hash3(3, 2, 1));
  });

  it('つねに 0 以上 2^32 未満の整数', () => {
    for (let i = -1000; i < 1000; i++) {
      const value = hash2(i, -i);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(2 ** 32);
    }
  });

  it('偏りが極端でない', () => {
    const buckets = new Array(16).fill(0);
    for (let i = 0; i < 16000; i++) buckets[pick(hash2(i, 5), 16)]++;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(700);
      expect(count).toBeLessThan(1300);
    }
  });

  it('範囲 0 を渡しても壊れない', () => {
    expect(pick(hash2(1, 1), 0)).toBe(0);
  });
});

describe('演出用の乱数', () => {
  it('種が同じなら同じ並びになる', () => {
    const a = new DisplayRandom(99);
    const b = new DisplayRandom(99);
    for (let i = 0; i < 100; i++) expect(b.next()).toBe(a.next());
  });

  it('0 以上 1 未満に収まる', () => {
    const rng = new DisplayRandom(5);
    for (let i = 0; i < 5000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('指定した範囲に収まる', () => {
    const rng = new DisplayRandom(6);
    for (let i = 0; i < 1000; i++) {
      const value = rng.range(-3, 7);
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThan(7);
    }
  });
});
