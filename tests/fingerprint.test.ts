/**
 * 指紋の確認。
 * 同じ中身からは同じ値、少しでも違えば別の値になること。
 */

import { describe, expect, it } from 'vitest';
import {
  digestOfArray,
  pushByte,
  pushInt,
  pushNumber,
  shapeFingerprint,
  startDigest,
  toHex,
  worldFingerprint,
} from '../src/core/fingerprint';
import { GRID, HIT_JAB } from '../src/core/constants';
import { advance } from '../src/core/rules';
import { createWorld } from '../src/core/world';
import { getStatueShape } from '../src/core/shape';

const C = GRID / 2;

describe('混ぜ方', () => {
  it('同じ入力からは同じ値', () => {
    expect(pushByte(startDigest(), 7)).toBe(pushByte(startDigest(), 7));
    expect(pushInt(startDigest(), 123456)).toBe(pushInt(startDigest(), 123456));
    expect(pushNumber(startDigest(), 1e12)).toBe(pushNumber(startDigest(), 1e12));
  });

  it('1 違えば別の値', () => {
    expect(pushByte(startDigest(), 7)).not.toBe(pushByte(startDigest(), 8));
    expect(pushInt(startDigest(), 1000)).not.toBe(pushInt(startDigest(), 1001));
    expect(pushNumber(startDigest(), 1e12)).not.toBe(pushNumber(startDigest(), 1e12 + 1));
  });

  it('大きな数も上下まで見ている', () => {
    // 下 32bit が同じで上だけ違う組
    const low = 12345;
    const a = pushNumber(startDigest(), low);
    const b = pushNumber(startDigest(), low + 0x100000000);
    expect(a).not.toBe(b);
  });

  it('順番が違えば別の値', () => {
    const a = pushInt(pushInt(startDigest(), 1), 2);
    const b = pushInt(pushInt(startDigest(), 2), 1);
    expect(a).not.toBe(b);
  });

  it('16進の文字列は常に8桁', () => {
    for (const value of [0, 1, 0xffffffff, 0x0000000f]) {
      expect(toHex(value)).toHaveLength(8);
    }
  });
});

describe('配列の指紋', () => {
  it('中身が同じなら同じ', () => {
    const a = new Uint8Array([1, 2, 3, 250]);
    const b = new Uint8Array([1, 2, 3, 250]);
    expect(digestOfArray(a, 1)).toBe(digestOfArray(b, 1));
  });

  it('1マス違うだけで変わる', () => {
    const a = new Uint8Array([1, 2, 3, 250]);
    const b = new Uint8Array([1, 2, 3, 249]);
    expect(digestOfArray(a, 1)).not.toBe(digestOfArray(b, 1));
  });

  it('2バイト・4バイトの並びも扱える', () => {
    const a = new Uint16Array([1, 65535]);
    const b = new Uint16Array([1, 65534]);
    expect(digestOfArray(a, 2)).not.toBe(digestOfArray(b, 2));
    const c = new Int32Array([1, -1]);
    const d = new Int32Array([1, -2]);
    expect(digestOfArray(c, 4)).not.toBe(digestOfArray(d, 4));
  });
});

describe('状態の指紋', () => {
  it('同じ状態なら同じ', () => {
    expect(worldFingerprint(createWorld(1))).toBe(worldFingerprint(createWorld(1)));
  });

  it('種が違えば別（ばらつきの元が変わる）', () => {
    const a = createWorld(1);
    const b = createWorld(2);
    advance(a, [{ step: 0, x: C, y: C, z: C, kind: HIT_JAB }]);
    advance(b, [{ step: 0, x: C, y: C, z: C, kind: HIT_JAB }]);
    expect(worldFingerprint(a)).not.toBe(worldFingerprint(b));
  });

  it('殴れば変わる', () => {
    const world = createWorld(3);
    const before = worldFingerprint(world);
    advance(world, [{ step: 0, x: C, y: C, z: C, kind: HIT_JAB }]);
    expect(worldFingerprint(world)).not.toBe(before);
  });

  it('何もしなくても回が進めば変わる', () => {
    const world = createWorld(4);
    const before = worldFingerprint(world);
    advance(world, []);
    expect(worldFingerprint(world)).not.toBe(before);
  });

  it('点数だけ違っても見分けられる', () => {
    const a = createWorld(5);
    const b = createWorld(5);
    b.score += 1;
    expect(worldFingerprint(a)).not.toBe(worldFingerprint(b));
  });
});

describe('形の指紋', () => {
  it('同じ形なら同じ', () => {
    const shape = getStatueShape();
    expect(shapeFingerprint(shape.density, shape.material)).toBe(
      shapeFingerprint(shape.density, shape.material),
    );
  });

  it('1マスでも違えば変わる', () => {
    const shape = getStatueShape();
    const changed = shape.density.slice();
    const index = changed.findIndex((value) => value > 1);
    changed[index] -= 1;
    expect(shapeFingerprint(changed, shape.material)).not.toBe(
      shapeFingerprint(shape.density, shape.material),
    );
  });

  it('材質だけ違っても変わる', () => {
    const shape = getStatueShape();
    const changed = shape.material.slice();
    changed[changed.length - 1] ^= 1;
    expect(shapeFingerprint(shape.density, changed)).not.toBe(
      shapeFingerprint(shape.density, shape.material),
    );
  });
});
