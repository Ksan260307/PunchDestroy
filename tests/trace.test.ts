/**
 * 画面から伸ばした線が、石像のどこに当たるかの確認。
 * ここが正しければ、どの角度から見ていても狙ったところを殴れる。
 */

import { describe, expect, it } from 'vitest';
import { GRID, SOLID_THRESHOLD } from '../src/core/constants';
import { advance } from '../src/core/rules';
import { traceSurface } from '../src/core/trace';
import { createWorld, voxelIndex } from '../src/core/world';
import { TestShuffler, aim } from './helpers';

const C = GRID / 2;

describe('線を伸ばして当たる場所を探す', () => {
  it('正面から狙うと手前の面に当たる', () => {
    const world = createWorld(1);
    const hit = traceSurface(world, 0, 0, 3, 0, 0, -1);
    expect(hit).not.toBeNull();
    expect(hit!.z).toBeGreaterThan(C);
    expect(Math.abs(hit!.x - C)).toBeLessThanOrEqual(1);
    expect(world.density[voxelIndex(hit!.x, hit!.y, hit!.z)]).toBeGreaterThanOrEqual(
      SOLID_THRESHOLD,
    );
  });

  it('裏から狙うと奥の面に当たる', () => {
    const world = createWorld(1);
    const hit = traceSurface(world, 0, 0, -3, 0, 0, 1);
    expect(hit).not.toBeNull();
    expect(hit!.z).toBeLessThan(C);
  });

  it('横から狙うと横の面に当たる', () => {
    const world = createWorld(1);
    const right = traceSurface(world, 3, 0, 0, -1, 0, 0);
    const left = traceSurface(world, -3, 0, 0, 1, 0, 0);
    expect(right!.x).toBeGreaterThan(C);
    expect(left!.x).toBeLessThan(C);
  });

  it('外れる向きなら何も返さない', () => {
    const world = createWorld(1);
    expect(traceSurface(world, 0, 0, 3, 0, 1, 0)).toBeNull();
    expect(traceSurface(world, 5, 5, 5, 1, 1, 1)).toBeNull();
  });

  it('内側へ食い込ませると、より奥のマスを返す', () => {
    const world = createWorld(1);
    const surface = traceSurface(world, 0, 0, 3, 0, 0, -1)!;
    const inside = traceSurface(world, 0, 0, 3, 0, 0, -1, 0.1)!;
    expect(inside.z).toBeLessThan(surface.z);
  });

  it('穴を開けたあとは、その奥の面に当たるようになる', () => {
    const world = createWorld(1);
    const before = traceSurface(world, 0, 0, 3, 0, 0, -1)!;
    for (let i = 0; i < 12; i++) {
      advance(world, [{ step: world.step, x: C, y: C, z: before.z - 4, kind: 1 }]);
    }
    const after = traceSurface(world, 0, 0, 3, 0, 0, -1);
    expect(after).not.toBeNull();
    expect(after!.z).toBeLessThan(before.z);
  });

  it('あらゆる向きから狙っても表面に当たる', () => {
    const world = createWorld(1);
    const rng = new TestShuffler(2468);
    let found = 0;
    for (let i = 0; i < 200; i++) {
      const hit = aim(world, rng, 0.35);
      if (!hit) continue;
      found++;
      expect(hit.x).toBeGreaterThanOrEqual(0);
      expect(hit.x).toBeLessThan(GRID);
      expect(hit.y).toBeGreaterThanOrEqual(0);
      expect(hit.y).toBeLessThan(GRID);
      expect(hit.z).toBeGreaterThanOrEqual(0);
      expect(hit.z).toBeLessThan(GRID);
    }
    expect(found).toBeGreaterThan(150);
  });

  it('全部消したあとは何にも当たらない', () => {
    const world = createWorld(1);
    world.density.fill(0);
    world.blockRemaining.fill(0);
    expect(traceSurface(world, 0, 0, 3, 0, 0, -1)).toBeNull();
  });
});
