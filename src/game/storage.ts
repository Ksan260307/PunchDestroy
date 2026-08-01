/**
 * 自己ベストの保存。表示側だけの持ち物で、進行には一切関わらない。
 * 保存できない環境（プライベート閲覧など）でも遊べるように、失敗しても黙って続ける。
 */

const KEY = 'punch-destroy:best';

export interface BestRecord {
  score: number;
  seconds: number;
  combo: number;
}

export const EMPTY_BEST: BestRecord = { score: 0, seconds: 0, combo: 0 };

export function loadBest(): BestRecord {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return { ...EMPTY_BEST };
    return normalize(JSON.parse(text));
  } catch {
    return { ...EMPTY_BEST };
  }
}

export function saveBest(record: BestRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalize(record)));
  } catch {
    /* 保存できなくても遊べる */
  }
}

export function normalize(raw: unknown): BestRecord {
  const value = (raw ?? {}) as Partial<Record<keyof BestRecord, unknown>>;
  return {
    score: safeNumber(value.score),
    seconds: safeNumber(value.seconds),
    combo: safeNumber(value.combo),
  };
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}
