/**
 * 位置と種から値を作る整数ハッシュ。
 *
 * 状態を持たないので、どの順番で呼んでも、何回呼んでも同じ答えが返る。
 * 計算部分のばらつき（削れ方のムラなど）はすべてこれで作る。
 * 32bit 整数演算だけを使うため、実行環境が変わっても結果は一致する。
 */

/** 32bit の撹拌。戻り値は 0 以上 2^32 未満 */
export function mix32(value: number): number {
  let h = value | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hash2(a: number, b: number): number {
  return mix32((Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) | 0);
}

export function hash3(a: number, b: number, c: number): number {
  const t = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) | 0;
  return mix32((t ^ Math.imul(c | 0, 0xc2b2ae35)) | 0);
}

/** 0 以上 range 未満の整数 */
export function pick(hash: number, range: number): number {
  return range > 0 ? hash % range : 0;
}

/**
 * 見た目の演出用に使う、状態を持つ簡易乱数。
 * 計算部分からは絶対に呼ばない（呼ぶと同じ操作でも結果が変わってしまう）。
 */
export class DisplayRandom {
  private state: number;

  constructor(seed = 0x1234567) {
    this.state = seed >>> 0 || 1;
  }

  /** 0 以上 1 未満 */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    return x / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}
