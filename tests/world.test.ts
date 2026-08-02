/**
 * 状態の入れ物そのものの確認。
 * 座標の変換、区画の割り当て、控えの取り方。
 */

import { describe, expect, it } from 'vitest';
import {
  BLOCKS,
  BLOCK_COUNT,
  BLOCK_INTACT,
  BLOCK_SIZE,
  GRID,
  HIT_JAB,
  TOTAL_GRAINS,
  VOXEL_COUNT,
} from '../src/core/constants';
import { advance } from '../src/core/rules';
import { worldFingerprint } from '../src/core/fingerprint';
import {
  blockBounds,
  blockIndexOf,
  blockOfVoxel,
  createWorld,
  destroyedRatio,
  grainsDestroyed,
  grainsRemaining,
  recountBlocks,
  restore,
  snapshot,
  toUnit,
  toVoxel,
  voxelIndex,
} from '../src/core/world';

const C = GRID / 2;

describe('座標の変換', () => {
  it('マス番号と座標が行き来できる', () => {
    for (const [x, y, z] of [
      [0, 0, 0],
      [1, 2, 3],
      [GRID - 1, GRID - 1, GRID - 1],
      [C, C, C],
    ]) {
      const index = voxelIndex(x, y, z);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(VOXEL_COUNT);
      expect(index % GRID).toBe(x);
      expect(((index / GRID) | 0) % GRID).toBe(y);
      expect((index / (GRID * GRID)) | 0).toBe(z);
    }
  });

  it('マスの並びは x がいちばん内側', () => {
    expect(voxelIndex(1, 0, 0) - voxelIndex(0, 0, 0)).toBe(1);
    expect(voxelIndex(0, 1, 0) - voxelIndex(0, 0, 0)).toBe(GRID);
    expect(voxelIndex(0, 0, 1) - voxelIndex(0, 0, 0)).toBe(GRID * GRID);
  });

  it('-1..1 の座標とマス座標が行き来できる', () => {
    for (const coord of [0, 1, 37, C, GRID - 1]) {
      expect(toVoxel(toUnit(coord))).toBe(coord);
    }
    expect(toUnit(0)).toBeLessThan(0);
    expect(toUnit(GRID - 1)).toBeGreaterThan(0);
    expect(Math.abs(toUnit(C))).toBeLessThan(2 / GRID);
  });
});

describe('区画', () => {
  it('マスが正しい区画に入る', () => {
    expect(blockOfVoxel(voxelIndex(0, 0, 0))).toBe(0);
    expect(blockOfVoxel(voxelIndex(BLOCK_SIZE, 0, 0))).toBe(1);
    expect(blockOfVoxel(voxelIndex(0, BLOCK_SIZE, 0))).toBe(BLOCKS);
    expect(blockOfVoxel(voxelIndex(0, 0, BLOCK_SIZE))).toBe(BLOCKS * BLOCKS);
    expect(blockOfVoxel(voxelIndex(GRID - 1, GRID - 1, GRID - 1))).toBe(BLOCK_COUNT - 1);
  });

  it('区画の範囲とマスの対応が合っている', () => {
    for (const block of [0, 1, 37, BLOCK_COUNT - 1]) {
      const bounds = blockBounds(block);
      expect(blockIndexOf(bounds.x0, bounds.y0, bounds.z0)).toBe(block);
      expect(blockIndexOf(bounds.x1, bounds.y1, bounds.z1)).toBe(block);
      expect(bounds.x1 - bounds.x0).toBe(BLOCK_SIZE - 1);
    }
  });

  it('最初はどの区画も無傷で、合計が一致する', () => {
    const world = createWorld(1);
    expect(Array.from(world.blockState).every((s) => s === BLOCK_INTACT)).toBe(true);
    const counted = recountBlocks(world);
    let sum = 0;
    for (let b = 0; b < BLOCK_COUNT; b++) {
      expect(world.blockRemaining[b]).toBe(counted[b]);
      expect(world.blockOrigin[b]).toBe(counted[b]);
      sum += counted[b];
    }
    expect(sum).toBe(world.totalUnits);
  });
});

describe('粒の数え方', () => {
  it('最初はちょうど1兆', () => {
    const world = createWorld(1);
    expect(grainsRemaining(world)).toBe(TOTAL_GRAINS);
    expect(grainsDestroyed(world)).toBe(0);
    expect(destroyedRatio(world)).toBe(0);
  });

  it('削るほど減り、増えることはない', () => {
    const world = createWorld(2);
    let previous = grainsRemaining(world);
    for (let i = 0; i < 12; i++) {
      advance(world, [{ step: world.step, x: C + i * 3, y: C, z: C, kind: HIT_JAB }]);
      const now = grainsRemaining(world);
      expect(now).toBeLessThanOrEqual(previous);
      expect(grainsDestroyed(world)).toBe(TOTAL_GRAINS - now);
      previous = now;
    }
  });
});

describe('途中の控え', () => {
  it('控えて戻すと元どおりになる', () => {
    const world = createWorld(3);
    for (let i = 0; i < 8; i++) {
      advance(world, [{ step: world.step, x: C + i * 4, y: C, z: C, kind: HIT_JAB }]);
    }
    const mark = worldFingerprint(world);
    const keep = snapshot(world);

    for (let i = 0; i < 8; i++) {
      advance(world, [{ step: world.step, x: C, y: C + i * 4, z: C, kind: HIT_JAB }]);
    }
    expect(worldFingerprint(world)).not.toBe(mark);

    restore(world, keep);
    expect(worldFingerprint(world)).toBe(mark);
  });

  it('控えは元の状態と切り離されている', () => {
    const world = createWorld(4);
    const keep = snapshot(world);
    advance(world, [{ step: 0, x: C, y: C, z: C, kind: HIT_JAB }]);
    expect(keep.density[voxelIndex(C, C, C)]).toBeGreaterThan(0);
    expect(keep.remainingUnits).toBe(world.totalUnits);
  });

  it('連打や乱打の状況も一緒に控える', () => {
    const world = createWorld(5);
    for (let i = 0; i < 12; i++) {
      advance(world, [{ step: world.step, x: C + (i % 4), y: C, z: C, kind: HIT_JAB }]);
    }
    const keep = snapshot(world);
    expect(keep.combo).toBe(world.combo);
    expect(keep.recentHits).toBe(world.recentHits);
    expect(keep.barrageUntilStep).toBe(world.barrageUntilStep);
    expect(keep.finaleStep).toBe(world.finaleStep);

    for (let i = 0; i < 200; i++) advance(world, []);
    expect(world.combo).toBe(0);
    restore(world, keep);
    expect(world.combo).toBe(keep.combo);
    expect(world.recentHits).toBe(keep.recentHits);
  });
});
