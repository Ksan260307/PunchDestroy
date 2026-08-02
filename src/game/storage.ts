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

export type BestTable = Record<string, BestRecord>;

/** 石像ごとの自己ベストをまとめて読む */
export function loadBestTable(): BestTable {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return {};
    return normalizeTable(JSON.parse(text));
  } catch {
    return {};
  }
}

export function loadBest(statueId: string): BestRecord {
  return loadBestTable()[statueId] ?? { ...EMPTY_BEST };
}

export function saveBest(statueId: string, record: BestRecord): void {
  try {
    const table = loadBestTable();
    table[statueId] = normalize(record);
    localStorage.setItem(KEY, JSON.stringify(table));
  } catch {
    /* 保存できなくても遊べる */
  }
}

export function normalizeTable(raw: unknown): BestTable {
  const table: BestTable = {};
  if (!raw || typeof raw !== 'object') return table;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) continue;
    table[key] = normalize(value);
  }
  return table;
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
