/**
 * 配列や状態から短い指紋を作る。
 * 「同じ操作をしたら本当に同じ結果になっているか」の照合に使う。
 */

import { BLOCK_COUNT, VOXEL_COUNT } from './constants';
import type { World } from './world';

const OFFSET = 0x811c9dc5;
const PRIME = 0x01000193;

export function startDigest(): number {
  return OFFSET >>> 0;
}

export function pushByte(digest: number, byte: number): number {
  return Math.imul(digest ^ (byte & 0xff), PRIME) >>> 0;
}

/** 32bit までの整数を4バイトとして混ぜる */
export function pushInt(digest: number, value: number): number {
  let d = digest;
  const v = value | 0;
  d = pushByte(d, v);
  d = pushByte(d, v >>> 8);
  d = pushByte(d, v >>> 16);
  d = pushByte(d, v >>> 24);
  return d;
}

/** 2^53 未満の整数を上下に分けて混ぜる */
export function pushNumber(digest: number, value: number): number {
  const low = value % 0x100000000;
  const high = Math.floor(value / 0x100000000);
  return pushInt(pushInt(digest, low), high);
}

export function digestOfArray(
  array: ArrayLike<number>,
  bytesPerEntry: number,
  digest = startDigest(),
): number {
  let d = digest;
  for (let i = 0; i < array.length; i++) {
    const v = array[i];
    d = pushByte(d, v);
    if (bytesPerEntry > 1) d = pushByte(d, v >>> 8);
    if (bytesPerEntry > 2) {
      d = pushByte(d, v >>> 16);
      d = pushByte(d, v >>> 24);
    }
  }
  return d;
}

export function toHex(digest: number): string {
  return (digest >>> 0).toString(16).padStart(8, '0');
}

/** 状態全体の指紋。区画ごとの集計と目に見える数値をすべて含める */
export function worldFingerprint(world: World): string {
  let d = startDigest();
  d = digestOfArray(world.density, 1, d);
  d = digestOfArray(world.blockRemaining, 4, d);
  d = digestOfArray(world.blockState, 1, d);
  d = pushInt(d, world.step);
  d = pushInt(d, world.seed);
  d = pushNumber(d, world.remainingUnits);
  d = pushNumber(d, world.score);
  d = pushInt(d, world.combo);
  d = pushInt(d, world.bestCombo);
  d = pushInt(d, world.hitCount);
  d = pushInt(d, world.lastHitStep);
  d = pushInt(d, world.rushUntilStep);
  d = pushInt(d, world.clearedStep);
  return toHex(d);
}

/** 形の指紋。生成結果が環境で変わっていないかの確認に使う */
export function shapeFingerprint(density: ArrayLike<number>, material: ArrayLike<number>): string {
  let d = startDigest();
  d = digestOfArray(density, 1, d);
  d = digestOfArray(material, 1, d);
  d = pushInt(d, VOXEL_COUNT);
  d = pushInt(d, BLOCK_COUNT);
  return toHex(d);
}
