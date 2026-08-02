/**
 * 自己ベストの保存。壊れた内容でも遊べなくならないことを確かめる。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_BEST, loadBest, loadBestTable, normalize, saveBest } from '../src/game/storage';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

describe('保存の中身を整える', () => {
  it('数でないものは 0 にする', () => {
    expect(normalize({ score: 'たくさん', seconds: null, combo: undefined })).toEqual(EMPTY_BEST);
    expect(normalize(null)).toEqual(EMPTY_BEST);
    expect(normalize({ score: Number.NaN })).toEqual(EMPTY_BEST);
    expect(normalize({ score: -5 })).toEqual(EMPTY_BEST);
  });

  it('まともな値はそのまま通す', () => {
    expect(normalize({ score: 120, seconds: 30.5, combo: 44 })).toEqual({
      score: 120,
      seconds: 30.5,
      combo: 44,
    });
  });
});

describe('保存と読み出し', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage());
  });

  it('保存したものを読み戻せる', () => {
    saveBest('apple', { score: 999, seconds: 12.5, combo: 30 });
    expect(loadBest('apple')).toEqual({ score: 999, seconds: 12.5, combo: 30 });
  });

  it('石像ごとに別々に覚える', () => {
    saveBest('apple', { score: 100, seconds: 10, combo: 5 });
    saveBest('melon', { score: 200, seconds: 20, combo: 9 });
    expect(loadBest('apple').score).toBe(100);
    expect(loadBest('melon').score).toBe(200);
    expect(Object.keys(loadBestTable()).sort()).toEqual(['apple', 'melon']);
  });

  it('片方を書き換えても、もう片方は残る', () => {
    saveBest('apple', { score: 100, seconds: 10, combo: 5 });
    saveBest('melon', { score: 200, seconds: 20, combo: 9 });
    saveBest('apple', { score: 300, seconds: 30, combo: 12 });
    expect(loadBest('apple').score).toBe(300);
    expect(loadBest('melon').score).toBe(200);
  });

  it('何も保存していなければ 0 から始まる', () => {
    expect(loadBest('apple')).toEqual(EMPTY_BEST);
    expect(loadBestTable()).toEqual({});
  });

  it('壊れた内容が入っていても落ちない', () => {
    localStorage.setItem('punch-destroy:best', '{壊れている');
    expect(loadBest('apple')).toEqual(EMPTY_BEST);
  });

  it('中身が数でなくても整えて読む', () => {
    localStorage.setItem('punch-destroy:best', '{"apple":{"score":"たくさん"}}');
    expect(loadBest('apple')).toEqual(EMPTY_BEST);
  });

  it('保存できない環境でも落ちない', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('使えません');
      },
      setItem: () => {
        throw new Error('使えません');
      },
    });
    expect(() => saveBest('apple', { score: 1, seconds: 1, combo: 1 })).not.toThrow();
    expect(loadBest('apple')).toEqual(EMPTY_BEST);
  });
});
