/**
 * 「表示側が何をしても進行は変わらない」ことの確認。
 *
 * 演出の量を変えても、時計を狂わせても、カメラをどこへ動かしても、
 * 演出の仕組みを丸ごと動かしても、状態は1ビットも変わらない。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { worldFingerprint } from '../src/core/fingerprint';
import { replay, Session } from '../src/core/session';
import { createView } from '../src/core/view';
import { EffectSystem, QUALITY_LEVELS } from '../src/game/effects';
import { OrbitCamera } from '../src/game/camera';
import { traceSurface } from '../src/core/trace';
import { HIT_JAB, HIT_SMASH } from '../src/core/constants';
import { TestShuffler } from './helpers';

/**
 * 決まった向きの並びから狙って殴る。
 * カメラの持ち方を変えても、同じ向きから狙えば同じ操作列になる。
 */
interface RunOptions {
  effects?: EffectSystem;
  quality?: number;
  camera?: OrbitCamera;
  steps?: number;
}

function run(options: RunOptions): { fingerprint: string; score: number; punches: number } {
  const played = runSession(options);
  return {
    fingerprint: worldFingerprint(played.session.world),
    score: played.session.world.score,
    punches: played.punches,
  };
}

function runSession(options: RunOptions): { session: Session; punches: number } {
  const session = new Session(20240501);
  const view = createView(session.world);
  const effects = options.effects;
  if (effects && options.quality !== undefined) {
    effects.quality = QUALITY_LEVELS[options.quality];
  }
  const camera = options.camera ?? new OrbitCamera();
  const rng = new TestShuffler(90210);
  const steps = options.steps ?? 260;
  let punches = 0;

  for (let step = 0; step < steps; step++) {
    if (step % 4 === 0) {
      // 見る向きは毎回変える（表示側の都合）
      camera.yaw = rng.range(0, Math.PI * 2);
      camera.pitch = rng.range(-1, 1);
      camera.refresh(900, 600);
      const ray = camera.rayFrom(rng.range(300, 600), rng.range(180, 420), 900, 600);
      const hit = traceSurface(
        session.world,
        ray.ox,
        ray.oy,
        ray.oz,
        ray.dx,
        ray.dy,
        ray.dz,
        0.06,
      );
      if (hit) {
        punches++;
        session.queueHit(hit.x, hit.y, hit.z, punches % 5 === 0 ? HIT_SMASH : HIT_JAB);
      }
    }
    const report = session.advance();
    if (effects) {
      effects.onStep(report, view);
      effects.update(1 / 60);
    }
  }
  return { session, punches };
}

describe('表示は進行に影響しない', () => {
  const baseline = run({});

  it('演出をまったく動かさない場合と、目一杯動かす場合で同じ', () => {
    const heavy = run({ effects: new EffectSystem(), quality: 2 });
    expect(heavy.fingerprint).toBe(baseline.fingerprint);
    expect(heavy.score).toBe(baseline.score);
  });

  it('演出の量を落としても同じ', () => {
    for (let level = 0; level < QUALITY_LEVELS.length; level++) {
      expect(run({ effects: new EffectSystem(), quality: level }).fingerprint).toBe(
        baseline.fingerprint,
      );
    }
  });

  it('カメラの向きや寄り引きは記録に残らない', () => {
    // 見る位置を変えれば当然「どこを殴ったか」は変わるが、
    // 記録に残るのは当たったマスだけなので、作り直しにカメラは要らない
    const near = new OrbitCamera();
    near.distance = 2.0;
    const played = runSession({ camera: near });
    const record = played.session.toRecord();
    expect(record.hits.some((value) => !Number.isInteger(value))).toBe(false);
    expect(worldFingerprint(replay(record))).toBe(worldFingerprint(played.session.world));
  });

  it('演出が実際に何かを出していることも確かめる（比較が空振りでない）', () => {
    const effects = new EffectSystem();
    const result = run({ effects, quality: 2 });
    expect(effects.count).toBeGreaterThan(0);
    expect(result.punches).toBeGreaterThan(20);
  });
});

describe('時計に左右されない', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('時刻をどう動かしても結果は同じ', () => {
    const first = run({});

    vi.spyOn(Date, 'now').mockReturnValue(0);
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const frozen = run({});

    vi.spyOn(Date, 'now').mockReturnValue(8.64e15);
    vi.spyOn(performance, 'now').mockReturnValue(1e9);
    const shifted = run({});

    expect(frozen.fingerprint).toBe(first.fingerprint);
    expect(shifted.fingerprint).toBe(first.fingerprint);
  });

  it('乱数生成器を差し替えても結果は同じ', () => {
    const first = run({});
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.42);
    const second = run({});
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(spy).not.toHaveBeenCalled();
  });
});
