/**
 * 乱打（立て続けに殴ると追い打ちが飛ぶ）の確認。
 */

import { describe, expect, it } from 'vitest';
import {
  BARRAGE_DECAY_STEPS,
  BARRAGE_ECHOES,
  BARRAGE_SPREAD,
  BARRAGE_STEPS,
  BARRAGE_TRIGGER,
  GRID,
  HIT_JAB,
  HIT_SMASH,
} from '../src/core/constants';
import { advance, type Hit } from '../src/core/rules';
import { worldFingerprint } from '../src/core/fingerprint';
import { createView } from '../src/core/view';
import { barrageStepsLeft, createWorld, isBarrage, type World } from '../src/core/world';
import { TestShuffler } from './helpers';

const C = GRID / 2;

function punch(world: World, offset = 0, kind = HIT_JAB): void {
  advance(world, [{ step: world.step, x: C + offset, y: C, z: C, kind }]);
}

/**
 * 立て続けに殴って乱打に入れる。
 * このあと中心を殴って比べたいので、離れた場所を叩いておく。
 */
function enterBarrage(world: World): void {
  for (let i = 0; i < BARRAGE_TRIGGER * 3 && !isBarrage(world); i++) {
    punch(world, -38 - (i % 6));
  }
}

describe('乱打に入る条件', () => {
  it('ゆっくり殴っているうちは入らない', () => {
    const world = createWorld(1);
    for (let i = 0; i < 12; i++) {
      punch(world, i % 4);
      // 抜けていく間隔より遅く叩く
      for (let k = 0; k < BARRAGE_DECAY_STEPS + 2; k++) advance(world, []);
      expect(isBarrage(world)).toBe(false);
    }
  });

  it('立て続けに殴ると入る', () => {
    const world = createWorld(2);
    expect(isBarrage(world)).toBe(false);
    enterBarrage(world);
    expect(isBarrage(world)).toBe(true);
    expect(world.recentHits).toBeGreaterThanOrEqual(BARRAGE_TRIGGER);
  });

  it('複数の指で同時に殴ると、その分だけ早く入る', () => {
    const many = createWorld(3);
    const fingers: Hit[] = [
      { step: 0, x: C - 6, y: C, z: C, kind: HIT_JAB },
      { step: 0, x: C + 6, y: C, z: C, kind: HIT_JAB },
      { step: 0, x: C, y: C + 6, z: C, kind: HIT_JAB },
      { step: 0, x: C, y: C - 6, z: C, kind: HIT_JAB },
    ];
    let steps = 0;
    while (!isBarrage(many) && steps < 20) {
      advance(many, fingers.map((hit) => ({ ...hit, step: many.step })));
      steps++;
    }
    expect(isBarrage(many)).toBe(true);
    expect(steps).toBeLessThanOrEqual(Math.ceil(BARRAGE_TRIGGER / fingers.length));
  });

  it('入った回だけ合図が出る', () => {
    const world = createWorld(4);
    let started = 0;
    for (let i = 0; i < BARRAGE_TRIGGER + 6; i++) {
      const report = advance(world, [{ step: world.step, x: C + (i % 5), y: C, z: C, kind: HIT_JAB }]);
      if (report.barrageStarted) started++;
      expect(report.barrage).toBe(isBarrage(world));
    }
    expect(started).toBe(1);
  });

  it('手を止めると切れる', () => {
    const world = createWorld(5);
    enterBarrage(world);
    expect(isBarrage(world)).toBe(true);
    for (let i = 0; i < BARRAGE_STEPS + 2; i++) advance(world, []);
    expect(isBarrage(world)).toBe(false);
    expect(barrageStepsLeft(world)).toBe(0);
  });

  it('数え上げは上限で頭打ちになる', () => {
    const world = createWorld(6);
    for (let i = 0; i < 60; i++) {
      advance(world, [
        { step: world.step, x: C - 4, y: C, z: C, kind: HIT_JAB },
        { step: world.step, x: C + 4, y: C, z: C, kind: HIT_JAB },
        { step: world.step, x: C, y: C + 4, z: C, kind: HIT_JAB },
      ]);
    }
    expect(world.recentHits).toBeLessThanOrEqual(24);
  });
});

describe('追い打ち', () => {
  it('乱打でないときは追い打ちが出ない', () => {
    const world = createWorld(7);
    const report = advance(world, [{ step: 0, x: C, y: C, z: C, kind: HIT_JAB }]);
    expect(report.hits[0].echoes).toEqual([]);
    expect(report.hits[0].echoRadius).toBe(0);
  });

  it('乱打中は決まった数の追い打ちが出る', () => {
    const world = createWorld(8);
    enterBarrage(world);
    const report = advance(world, [{ step: world.step, x: C, y: C, z: C, kind: HIT_JAB }]);
    const hit = report.hits[0];
    expect(hit.echoes.length).toBe(BARRAGE_ECHOES * 3);
    expect(hit.echoRadius).toBeGreaterThan(0);
    expect(hit.echoRadius).toBeLessThan(hit.radius);
  });

  it('追い打ちは本体の近くに散る', () => {
    const world = createWorld(9);
    enterBarrage(world);
    const report = advance(world, [{ step: world.step, x: C, y: C, z: C, kind: HIT_SMASH }]);
    const hit = report.hits[0];
    for (let i = 0; i < hit.echoes.length; i += 3) {
      expect(Math.abs(hit.echoes[i] - C)).toBeLessThanOrEqual(BARRAGE_SPREAD);
      expect(Math.abs(hit.echoes[i + 1] - C)).toBeLessThanOrEqual(BARRAGE_SPREAD);
      expect(Math.abs(hit.echoes[i + 2] - C)).toBeLessThanOrEqual(BARRAGE_SPREAD);
      // 盤面の外へは出ない
      expect(hit.echoes[i]).toBeGreaterThanOrEqual(0);
      expect(hit.echoes[i]).toBeLessThan(GRID);
    }
  });

  it('追い打ちのぶん、削れる量が増える', () => {
    const plain = createWorld(10);
    const plainRemoved = advance(plain, [{ step: 0, x: C, y: C, z: C, kind: HIT_JAB }]).removed;

    const barrage = createWorld(10);
    enterBarrage(barrage);
    const before = barrage.remainingUnits;
    const report = advance(barrage, [{ step: barrage.step, x: C, y: C, z: C, kind: HIT_JAB }]);
    // 直前の連打で中心はもう削れているので、削り「予定」の量で比べる
    expect(report.hits[0].damage).toBeGreaterThan(plainRemoved);
    expect(barrage.remainingUnits).toBeLessThan(before);
  });

  it('追い打ちの位置は打撃の中身だけで決まる（順番に依らない）', () => {
    const hits: Hit[] = [
      { step: 0, x: C - 8, y: C, z: C + 4, kind: HIT_JAB },
      { step: 0, x: C + 5, y: C - 3, z: C, kind: HIT_SMASH },
      { step: 0, x: C, y: C + 7, z: C - 5, kind: HIT_JAB },
    ];
    const shuffler = new TestShuffler(4242);

    const a = createWorld(11);
    enterBarrage(a);
    const stepA = a.step;
    const reportA = advance(a, hits.map((hit) => ({ ...hit, step: stepA })));
    const echoesA = new Map(reportA.hits.map((hit) => [`${hit.x},${hit.y},${hit.z}`, hit.echoes.join(',')]));

    const b = createWorld(11);
    enterBarrage(b);
    const stepB = b.step;
    const reportB = advance(
      b,
      shuffler.shuffle(hits).map((hit) => ({ ...hit, step: stepB })),
    );
    for (const hit of reportB.hits) {
      expect(hit.echoes.join(',')).toBe(echoesA.get(`${hit.x},${hit.y},${hit.z}`));
    }
    expect(worldFingerprint(b)).toBe(worldFingerprint(a));
  });
});

describe('乱打の見え方', () => {
  it('入るまでの溜まり具合と、入ってからの残りが読める', () => {
    const world = createWorld(12);
    const view = createView(world);
    expect(view.barrage).toBe(false);
    expect(view.barrageCharge).toBe(0);
    expect(view.barrageLeft).toBe(0);

    punch(world, 0);
    expect(view.barrageCharge).toBeGreaterThan(0);
    expect(view.barrageCharge).toBeLessThan(1);

    enterBarrage(world);
    expect(view.barrage).toBe(true);
    expect(view.barrageCharge).toBe(1);
    expect(view.barrageLeft).toBeGreaterThan(0.9);

    for (let i = 0; i < BARRAGE_STEPS + 2; i++) advance(world, []);
    expect(view.barrage).toBe(false);
    expect(view.barrageLeft).toBe(0);
  });

  it('この回に入った打撃の数が分かる', () => {
    const world = createWorld(13);
    const report = advance(world, [
      { step: 0, x: C - 5, y: C, z: C, kind: HIT_JAB },
      { step: 0, x: C + 5, y: C, z: C, kind: HIT_JAB },
    ]);
    expect(report.landed).toBe(2);
    expect(advance(world, []).landed).toBe(0);
  });
});
