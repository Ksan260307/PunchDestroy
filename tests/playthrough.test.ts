/**
 * 最初から最後まで通しで確かめる。
 */

import { describe, expect, it } from 'vitest';
import { worldFingerprint } from '../src/core/fingerprint';
import { replay, Session } from '../src/core/session';
import { STEPS_PER_SECOND, TOTAL_GRAINS } from '../src/core/constants';
import { grainsRemaining, destroyedRatio, recountBlocks } from '../src/core/world';
import { playScript } from './helpers';

describe('通しプレイ', () => {
  // 6 回／秒くらいの、人が続けられる速さで殴り続ける
  const session = new Session(20260801);
  const steps = playScript(session, { every: 10 });
  const world = session.world;

  it('最後まで壊しきれる', () => {
    expect(world.remainingUnits).toBe(0);
    expect(grainsRemaining(world)).toBe(0);
    expect(destroyedRatio(world)).toBe(1);
  });

  it('壊しきるまでの長さが遊べる範囲に収まっている', () => {
    const seconds = steps / STEPS_PER_SECOND;
    expect(seconds).toBeGreaterThan(15);
    expect(seconds).toBeLessThan(240);
  });

  it('殴った回数が記録と一致する', () => {
    expect(world.hitCount).toBe(session.hitLogLength);
    expect(world.hitCount).toBeGreaterThan(50);
  });

  it('区画ごとの集計が最後まで狂わない', () => {
    const counted = recountBlocks(world);
    for (let i = 0; i < counted.length; i++) {
      expect(world.blockRemaining[i]).toBe(counted[i]);
    }
  });

  it('壊した粒の合計がちょうど1兆になる', () => {
    expect(TOTAL_GRAINS - grainsRemaining(world)).toBe(TOTAL_GRAINS);
  });

  it('通しでも記録から完全に作り直せる', () => {
    expect(worldFingerprint(replay(session.toRecord()))).toBe(worldFingerprint(world));
  });

  it('連打が速いほど早く壊しきれる', () => {
    const fast = new Session(20260801);
    const fastSteps = playScript(fast, { every: 4 });
    expect(fast.world.remainingUnits).toBe(0);
    expect(fastSteps).toBeLessThan(steps);
    expect(fast.hitLogLength).toBeLessThan(world.hitCount);
  });

  it('同じ台本なら別の実行でも同じ結果になる', () => {
    const again = new Session(20260801);
    playScript(again, { every: 10 });
    expect(worldFingerprint(again.world)).toBe(worldFingerprint(world));
    expect(again.world.score).toBe(world.score);
    expect(again.world.bestCombo).toBe(world.bestCombo);
  });
});

describe.each([
  ['りんご', 'apple'],
  ['みかん', 'mikan'],
  ['メロン', 'melon'],
  ['キウイ', 'kiwi'],
  ['ぶどう', 'grape'],
])('%s も通しで壊せる', (_name, id) => {
  const session = new Session(4242, id);
  const steps = playScript(session, { every: 10, seed: 4242 });

  it('最後まで壊しきれる', () => {
    expect(session.world.statue.id).toBe(id);
    expect(session.world.remainingUnits).toBe(0);
    expect(grainsRemaining(session.world)).toBe(0);
  });

  it('遊べる長さに収まっている', () => {
    const seconds = steps / STEPS_PER_SECOND;
    expect(seconds).toBeGreaterThan(15);
    expect(seconds).toBeLessThan(240);
  });

  it('殴る回数が形によって極端に偏らない', () => {
    expect(session.world.hitCount).toBeGreaterThan(60);
    expect(session.world.hitCount).toBeLessThan(400);
  });

  it('記録から完全に作り直せる', () => {
    expect(worldFingerprint(replay(session.toRecord()))).toBe(worldFingerprint(session.world));
  });
});
