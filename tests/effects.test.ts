/**
 * 演出の仕組みの確認。
 * ここは見た目だけの担当なので、進行に触れないことと、
 * 決めた上限を超えないことを見る。
 */

import { describe, expect, it } from 'vitest';
import { GRID, HIT_JAB, HIT_SMASH } from '../src/core/constants';
import { advance } from '../src/core/rules';
import { createView } from '../src/core/view';
import { createWorld, type World } from '../src/core/world';
import {
  EffectSystem,
  MAX_GLOW_POINTS,
  QUALITY_LEVELS,
  comboColor,
  formatShort,
} from '../src/game/effects';

const C = GRID / 2;

function playOnce(world: World, effects: EffectSystem, kind = HIT_JAB) {
  const view = createView(world);
  const report = advance(world, [{ step: world.step, x: C, y: C, z: C, kind }]);
  effects.onStep(report, view);
  return report;
}

describe('破片', () => {
  it('殴ると出て、時間が経つと消える', () => {
    const effects = new EffectSystem();
    const world = createWorld(1);
    playOnce(world, effects);
    expect(effects.count).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) effects.update(1 / 60);
    expect(effects.count).toBe(0);
  });

  it('決めた上限を超えない', () => {
    const effects = new EffectSystem();
    effects.quality = QUALITY_LEVELS[0];
    const world = createWorld(2);
    for (let i = 0; i < 60; i++) {
      playOnce(world, effects, HIT_SMASH);
      effects.update(1 / 120);
    }
    expect(effects.count).toBeLessThanOrEqual(QUALITY_LEVELS[0].particles);
  });

  it('演出を絞ると数が減る', () => {
    const counts = QUALITY_LEVELS.map((quality) => {
      const effects = new EffectSystem();
      effects.quality = quality;
      playOnce(createWorld(3), effects, HIT_SMASH);
      return effects.count;
    });
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
  });

  it('描画へ渡す並びは、生きている数だけ詰まっている', () => {
    const effects = new EffectSystem();
    playOnce(createWorld(4), effects, HIT_SMASH);
    const count = effects.packInstances();
    expect(count).toBe(effects.count);
    for (let i = 0; i < count; i++) {
      const size = effects.instances[i * 8 + 3];
      const alpha = effects.instances[i * 8 + 7];
      expect(size).toBeGreaterThan(0);
      expect(alpha).toBeGreaterThan(0);
    }
  });

  it('落ちきった破片は消える', () => {
    const effects = new EffectSystem();
    playOnce(createWorld(5), effects, HIT_SMASH);
    const before = effects.count;
    for (let i = 0; i < 90; i++) effects.update(1 / 30);
    expect(effects.count).toBeLessThan(before);
  });
});

describe('光る点', () => {
  it('殴ると増え、時間で弱まる', () => {
    const effects = new EffectSystem();
    playOnce(createWorld(6), effects);
    const strength = effects.glowPoints[3];
    expect(strength).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) effects.update(1 / 60);
    expect(effects.glowPoints[3]).toBeLessThan(strength);
  });

  it('決めた数を超えて増えない', () => {
    const effects = new EffectSystem();
    const world = createWorld(7);
    for (let i = 0; i < MAX_GLOW_POINTS * 3; i++) playOnce(world, effects);
    expect(effects.glowPoints).toHaveLength(MAX_GLOW_POINTS * 4);
  });
});

describe('画面の揺れ', () => {
  it('殴ると揺れ、放っておくと収まる', () => {
    const effects = new EffectSystem();
    playOnce(createWorld(8), effects, HIT_SMASH);
    effects.update(1 / 60);
    expect(Math.hypot(effects.shakeX, effects.shakeY)).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) effects.update(1 / 60);
    expect(Math.hypot(effects.shakeX, effects.shakeY)).toBe(0);
  });

  it('揺れを弱める設定なら揺れない', () => {
    const effects = new EffectSystem();
    effects.motionScale = 0;
    playOnce(createWorld(9), effects, HIT_SMASH);
    effects.update(1 / 60);
    expect(Math.abs(effects.shakeX)).toBe(0);
    expect(Math.abs(effects.shakeY)).toBe(0);
    // 破片は出ている
    expect(effects.count).toBeGreaterThan(0);
  });

  it('やり直すと何もかも消える', () => {
    const effects = new EffectSystem();
    playOnce(createWorld(10), effects, HIT_SMASH);
    effects.reset();
    expect(effects.count).toBe(0);
    expect(effects.texts).toEqual([]);
    expect(effects.tremor).toBe(0);
    expect(effects.shakePower).toBe(0);
    expect(Array.from(effects.glowPoints).every((value) => value === 0)).toBe(true);
  });
});

describe('文字', () => {
  it('画面に貼る文字と、立体に貼る文字を出せる', () => {
    const effects = new EffectSystem();
    effects.pushScreenText(0.5, 0.2, 'テスト', 30, '#000');
    effects.pushWorldText(0, 0, 0, 'テスト', 30, '#000');
    expect(effects.texts).toHaveLength(2);
    expect(effects.texts[0].inWorld).toBe(false);
    expect(effects.texts[1].inWorld).toBe(true);
  });

  it('increase しても画面が文字だらけにならない', () => {
    const effects = new EffectSystem();
    for (let i = 0; i < 40; i++) effects.pushScreenText(0.5, 0.2, `${i}`, 20, '#000');
    expect(effects.texts.length).toBeLessThanOrEqual(9);
  });

  it('時間が経つと消える', () => {
    const effects = new EffectSystem();
    effects.pushScreenText(0.5, 0.2, 'テスト', 30, '#000');
    for (let i = 0; i < 120; i++) effects.update(1 / 60);
    expect(effects.texts).toEqual([]);
  });
});

describe('数の見せ方', () => {
  it('大きな数を短くする', () => {
    expect(formatShort(1234)).toBe('1234');
    expect(formatShort(56789)).toBe('6万');
    expect(formatShort(3_120_000_000)).toBe('31.2億');
    expect(formatShort(31_200_000_000)).toBe('312億');
    expect(formatShort(450_000_000)).toBe('4.5億');
    expect(formatShort(1_230_000_000_000)).toBe('1.23兆');
  });

  it('連打数によって色が変わる', () => {
    const colors = new Set([comboColor(1), comboColor(20), comboColor(40), comboColor(60)]);
    expect(colors.size).toBe(4);
  });
});
