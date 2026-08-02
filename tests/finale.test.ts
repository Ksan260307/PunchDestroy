/**
 * 総崩れの確認。
 *
 * いきなり全部消えるのではなく、
 * 「震える → 下の段から順に崩れる → 消える」の順に進むこと。
 */

import { describe, expect, it } from 'vitest';
import {
  BLOCKS,
  BLOCK_COUNT,
  BLOCK_COLLAPSING,
  FINALE_PERCENT,
  FINALE_SHAKE_STEPS,
  GRID,
} from '../src/core/constants';
import { advance } from '../src/core/rules';
import { worldFingerprint } from '../src/core/fingerprint';
import { createView } from '../src/core/view';
import { blockBounds, createWorld, finaleProgress, type World } from '../src/core/world';

/** 区画をまるごと空にして、残りを指定の割合まで減らす（検証用の下ごしらえ） */
function reduceTo(world: World, ratio: number): void {
  const target = world.totalUnits * ratio;
  for (let block = 0; block < BLOCK_COUNT; block++) {
    if (world.remainingUnits <= target) break;
    if (world.blockRemaining[block] <= 0) continue;
    const bounds = blockBounds(block);
    for (let z = bounds.z0; z <= bounds.z1; z++) {
      for (let y = bounds.y0; y <= bounds.y1; y++) {
        const row = (z * GRID + y) * GRID;
        for (let x = bounds.x0; x <= bounds.x1; x++) {
          world.remainingUnits -= world.density[row + x];
          world.density[row + x] = 0;
        }
      }
    }
    world.blockRemaining[block] = 0;
  }
}

function levelOf(block: number): number {
  return ((block / BLOCKS) | 0) % BLOCKS;
}

describe('総崩れ', () => {
  it('しきい値を割ると、まず震え始める', () => {
    const world = createWorld(1);
    reduceTo(world, (FINALE_PERCENT - 1) / 100);
    const report = advance(world, []);
    expect(report.finaleStarted).toBe(true);
    expect(report.finaleShaking).toBe(true);
    expect(world.finaleStep).toBe(0);
    expect(world.remainingUnits).toBeGreaterThan(0);
  });

  it('しきい値の手前では何も起きない', () => {
    const world = createWorld(1);
    reduceTo(world, (FINALE_PERCENT + 8) / 100);
    const report = advance(world, []);
    expect(report.finaleStarted).toBe(false);
    expect(world.finaleStep).toBe(-1);
  });

  it('震えている間は崩れない', () => {
    const world = createWorld(2);
    reduceTo(world, (FINALE_PERCENT - 1) / 100);
    advance(world, []);
    const before = world.remainingUnits;

    for (let i = 0; i < FINALE_SHAKE_STEPS - 2; i++) {
      const report = advance(world, []);
      expect(report.finaleShaking).toBe(true);
      expect(report.collapsing).toEqual([]);
    }
    expect(world.remainingUnits).toBe(before);
  });

  it('震えの進み具合が 0 から 1 へ上がる', () => {
    const world = createWorld(2);
    reduceTo(world, (FINALE_PERCENT - 1) / 100);
    const view = createView(world);
    expect(view.finale).toBe(false);
    expect(view.finaleTension).toBe(0);

    advance(world, []);
    expect(view.finale).toBe(true);
    const early = view.finaleTension;

    for (let i = 0; i < FINALE_SHAKE_STEPS / 2; i++) advance(world, []);
    const middle = view.finaleTension;
    expect(middle).toBeGreaterThan(early);
    expect(middle).toBeLessThan(1);

    for (let i = 0; i < FINALE_SHAKE_STEPS; i++) advance(world, []);
    expect(view.finaleTension).toBe(1);
    expect(finaleProgress(world)).toBe(1);
  });

  it('震えたあとは下の段から順に崩れる', () => {
    const world = createWorld(3);
    reduceTo(world, (FINALE_PERCENT - 1) / 100);
    advance(world, []);
    for (let i = 0; i < FINALE_SHAKE_STEPS - 1; i++) advance(world, []);

    const firstWave: number[] = [];
    const lastWave: number[] = [];
    for (let i = 0; i < 90; i++) {
      const report = advance(world, []);
      if (report.collapsing.length === 0) continue;
      if (firstWave.length === 0) firstWave.push(...report.collapsing);
      lastWave.length = 0;
      lastWave.push(...report.collapsing);
    }
    expect(firstWave.length).toBeGreaterThan(0);
    expect(lastWave.length).toBeGreaterThan(0);

    const lowest = Math.min(...firstWave.map(levelOf));
    const highest = Math.max(...lastWave.map(levelOf));
    expect(highest).toBeGreaterThan(lowest);
  });

  it('最後には全部消える', () => {
    const world = createWorld(4);
    reduceTo(world, (FINALE_PERCENT - 1) / 100);
    let guard = 0;
    let cleared = false;
    while (guard++ < 900) {
      const report = advance(world, []);
      if (report.cleared) {
        cleared = true;
        break;
      }
    }
    expect(cleared).toBe(true);
    expect(world.remainingUnits).toBe(0);
    // 震えの長さぶんはきちんと待っている
    expect(guard).toBeGreaterThan(FINALE_SHAKE_STEPS);
  });

  it('崩れ方は毎回同じ', () => {
    const run = () => {
      const world = createWorld(5);
      reduceTo(world, (FINALE_PERCENT - 1) / 100);
      for (let i = 0; i < FINALE_SHAKE_STEPS + 40; i++) advance(world, []);
      return worldFingerprint(world);
    };
    expect(run()).toBe(run());
  });

  it('崩れ始めた区画は崩壊中の印が付く', () => {
    const world = createWorld(6);
    reduceTo(world, (FINALE_PERCENT - 1) / 100);
    for (let i = 0; i < FINALE_SHAKE_STEPS + 20; i++) advance(world, []);
    const states = Array.from(world.blockState);
    expect(states.some((state) => state === BLOCK_COLLAPSING)).toBe(true);
  });
});
