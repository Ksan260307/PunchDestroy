/**
 * 自己ベストの保存。壊れた内容でも遊べなくならないことを確かめる。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_BEST, loadBest, normalize, saveBest } from '../src/game/storage';

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
    saveBest({ score: 999, seconds: 12.5, combo: 30 });
    expect(loadBest()).toEqual({ score: 999, seconds: 12.5, combo: 30 });
  });

  it('何も保存していなければ 0 から始まる', () => {
    expect(loadBest()).toEqual(EMPTY_BEST);
  });

  it('壊れた内容が入っていても落ちない', () => {
    localStorage.setItem('punch-destroy:best', '{壊れている');
    expect(loadBest()).toEqual(EMPTY_BEST);
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
    expect(() => saveBest({ score: 1, seconds: 1, combo: 1 })).not.toThrow();
    expect(loadBest()).toEqual(EMPTY_BEST);
  });
});
