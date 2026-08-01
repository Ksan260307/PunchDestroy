/**
 * 表示側へ渡す窓口の確認。
 * 読み取りしかできないことと、出てくる数値が状態と食い違わないこと。
 */

import { describe, expect, it } from 'vitest';
import {
  COMBO_WINDOW_STEPS,
  GRID,
  HIT_JAB,
  RUSH_COMBO,
  RUSH_STEPS,
  TOTAL_GRAINS,
} from '../src/core/constants';
import { advance } from '../src/core/rules';
import { createView } from '../src/core/view';
import { createWorld, grainsRemaining } from '../src/core/world';

const C = GRID / 2;

describe('読み取り専用の窓口', () => {
  it('書き換えようとしても通らない', () => {
    const world = createWorld(1);
    const view = createView(world);
    expect(Object.isFrozen(view)).toBe(true);
    expect(() => {
      (view as unknown as { score: number }).score = 999;
    }).toThrow();
    expect(view.score).toBe(0);
  });

  it('状態の数値をそのまま映す', () => {
    const world = createWorld(1);
    const view = createView(world);
    expect(view.grainsLeft).toBe(TOTAL_GRAINS);
    expect(view.destroyed).toBe(0);
    expect(view.combo).toBe(0);
    expect(view.rush).toBe(false);
    expect(view.rushLeft).toBe(0);
    expect(view.cleared).toBe(false);

    advance(world, [{ step: 0, x: C, y: C, z: C, kind: HIT_JAB }]);
    expect(view.grainsLeft).toBe(grainsRemaining(world));
    expect(view.grainsLeft).toBeLessThan(TOTAL_GRAINS);
    expect(view.grainsGone).toBe(TOTAL_GRAINS - view.grainsLeft);
    expect(view.destroyed).toBeGreaterThan(0);
    expect(view.combo).toBe(1);
    expect(view.hitCount).toBe(1);
  });

  it('ラッシュの残りは 1 から 0 へ減っていく', () => {
    const world = createWorld(2);
    const view = createView(world);
    for (let i = 0; i < RUSH_COMBO; i++) {
      advance(world, [{ step: world.step, x: C + (i % 5), y: C, z: C, kind: HIT_JAB }]);
    }
    expect(view.rush).toBe(true);
    expect(view.rushLeft).toBeGreaterThan(0.95);
    expect(view.rushLeft).toBeLessThanOrEqual(1);

    // 連打が途切れない範囲だけ待つ（途切れるとラッシュも終わる）
    for (let i = 0; i < COMBO_WINDOW_STEPS - 5; i++) advance(world, []);
    const later = view.rushLeft;
    expect(later).toBeLessThan(1);
    expect(later).toBeGreaterThan(0);

    for (let i = 0; i < RUSH_STEPS; i++) advance(world, []);
    expect(view.rush).toBe(false);
    expect(view.rushLeft).toBe(0);
  });

  it('壊しきると終わったことが分かる', () => {
    const world = createWorld(3);
    const view = createView(world);
    world.density.fill(0);
    world.blockRemaining.fill(0);
    world.remainingUnits = 0;
    expect(view.cleared).toBe(true);
    expect(view.grainsLeft).toBe(0);
    expect(view.destroyed).toBe(1);
  });
});
