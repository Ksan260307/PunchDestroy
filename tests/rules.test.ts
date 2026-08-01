import { describe, expect, it } from 'vitest';
import {
  BLOCK_COLLAPSING,
  BLOCK_COUNT,
  BLOCK_GONE,
  COMBO_WINDOW_STEPS,
  GRID,
  HIT_JAB,
  HIT_SMASH,
  RUSH_COMBO,
  RUSH_RADIUS_SCALE,
  RUSH_STEPS,
  VOXEL_COUNT,
} from '../src/core/constants';
import { advance, applyHit, hitParams, type Hit } from '../src/core/rules';
import { createWorld, isRush, recountBlocks, rushStepsLeft, voxelIndex } from '../src/core/world';
import { digestOfArray, toHex, worldFingerprint } from '../src/core/fingerprint';
import { TestShuffler } from './helpers';

const C = GRID / 2;
const CENTER: Hit = { step: 0, x: C, y: C, z: C, kind: HIT_JAB };

function densityDigest(array: Uint8Array): string {
  return toHex(digestOfArray(array, 1));
}

describe('殴ったときの削れ方', () => {
  it('中心がいちばん削れ、範囲の外は無傷', () => {
    const world = createWorld(3);
    const before = world.density.slice();
    advance(world, [CENTER]);

    const center = voxelIndex(C, C, C);
    expect(world.density[center]).toBeLessThan(before[center]);

    const far = voxelIndex(C - 40, C, C);
    expect(world.density[far]).toBe(before[far]);

    // 中心ほど深く抜け、外へ行くほど残る
    const near = voxelIndex(C + 7, C, C);
    const mid = voxelIndex(C + 4, C, C);
    expect(world.density[center]).toBe(0);
    expect(world.density[center]).toBeLessThanOrEqual(world.density[mid]);
    expect(world.density[mid]).toBeLessThanOrEqual(world.density[near]);
    expect(world.density[near]).toBeLessThan(before[near]);
  });

  it('立体の奥行き方向にも削れる', () => {
    const world = createWorld(3);
    const before = world.density.slice();
    advance(world, [CENTER]);
    const front = voxelIndex(C, C, C + 5);
    const back = voxelIndex(C, C, C - 5);
    expect(world.density[front]).toBeLessThan(before[front]);
    expect(world.density[back]).toBeLessThan(before[back]);
  });

  it('残り量が増えることはない', () => {
    const world = createWorld(5);
    const before = world.density.slice();
    const rng = new TestShuffler(7);
    for (let i = 0; i < 20; i++) {
      advance(world, [
        {
          step: world.step,
          x: Math.round(rng.range(30, 98)),
          y: Math.round(rng.range(30, 98)),
          z: Math.round(rng.range(30, 98)),
          kind: HIT_JAB,
        },
      ]);
    }
    for (let i = 0; i < VOXEL_COUNT; i += 3) {
      expect(world.density[i]).toBeLessThanOrEqual(before[i]);
    }
  });

  it('削りすぎても0で止まる', () => {
    const world = createWorld(5);
    for (let i = 0; i < 30; i++) {
      advance(world, [{ step: world.step, x: C, y: C, z: C, kind: HIT_SMASH }]);
    }
    expect(world.density[voxelIndex(C, C, C)]).toBe(0);
    expect(world.remainingUnits).toBeGreaterThan(0);
  });

  it('残り合計と区画ごとの合計が食い違わない', () => {
    const world = createWorld(11);
    const rng = new TestShuffler(19);
    for (let i = 0; i < 25; i++) {
      advance(world, [
        {
          step: world.step,
          x: Math.round(rng.range(24, 104)),
          y: Math.round(rng.range(24, 104)),
          z: Math.round(rng.range(24, 104)),
          kind: i % 4 === 0 ? HIT_SMASH : HIT_JAB,
        },
      ]);
    }
    const counted = recountBlocks(world);
    let sum = 0;
    for (let b = 0; b < BLOCK_COUNT; b++) {
      expect(world.blockRemaining[b]).toBe(counted[b]);
      sum += counted[b];
    }
    expect(world.remainingUnits).toBe(sum);
  });

  it('打撃の威力は連打数と強化状態だけで決まる', () => {
    const world = createWorld(1);
    const plain = hitParams(world, HIT_JAB);
    world.combo = 40;
    const combo = hitParams(world, HIT_JAB);
    expect(combo.power).toBeGreaterThan(plain.power);
    expect(combo.radius).toBeGreaterThanOrEqual(plain.radius);
  });
});

describe('ラッシュ中の一撃', () => {
  it('殴る範囲がちょうど3倍になる', () => {
    const world = createWorld(1);
    const normal = hitParams(world, HIT_JAB);
    world.rushUntilStep = world.step + 10;
    const rush = hitParams(world, HIT_JAB);
    expect(rush.radius).toBe(normal.radius * RUSH_RADIUS_SCALE);
    expect(rush.sharpness).toBeGreaterThan(0);

    const smashNormal = hitParams(world, HIT_SMASH);
    world.rushUntilStep = 0;
    expect(smashNormal.radius).toBe(hitParams(world, HIT_SMASH).radius * RUSH_RADIUS_SCALE);
  });

  it('連打数が上がっても3倍の関係は崩れない', () => {
    const world = createWorld(1);
    for (const combo of [0, 24, 48, 60, 120]) {
      world.combo = combo;
      world.rushUntilStep = 0;
      const normal = hitParams(world, HIT_JAB).radius;
      world.rushUntilStep = world.step + 10;
      expect(hitParams(world, HIT_JAB).radius).toBe(normal * RUSH_RADIUS_SCALE);
    }
  });

  it('広く削れて、中心ほど深い', () => {
    const normal = createWorld(21);
    advance(normal, [{ step: 0, x: C, y: C, z: C, kind: HIT_JAB }]);

    const rush = createWorld(21);
    rush.rushUntilStep = 999;
    advance(rush, [{ step: 0, x: C, y: C, z: C, kind: HIT_JAB }]);

    // 通常の範囲（半径8）では届かない距離まで削れている
    const outside = voxelIndex(C + 14, C, C);
    expect(normal.density[outside]).toBe(normal.origin[outside]);
    expect(rush.density[outside]).toBeLessThan(normal.density[outside]);

    // 中心は抜けている
    expect(rush.density[voxelIndex(C, C, C)]).toBe(0);
    // ふちへ行くほど浅い
    const near = rush.density[voxelIndex(C + 6, C, C)];
    const mid = rush.density[voxelIndex(C + 10, C, C)];
    const far = rush.density[voxelIndex(C + 14, C, C)];
    const edge = rush.density[voxelIndex(C + 18, C, C)];
    expect(near).toBeLessThanOrEqual(mid);
    expect(mid).toBeLessThanOrEqual(far);
    expect(far).toBeLessThanOrEqual(edge);
  });

  it('1発で削れる量は通常よりずっと多い', () => {
    const normal = createWorld(22);
    const a = advance(normal, [{ step: 0, x: C, y: C, z: C, kind: HIT_JAB }]).removed;
    const rush = createWorld(22);
    rush.rushUntilStep = 999;
    const b = advance(rush, [{ step: 0, x: C, y: C, z: C, kind: HIT_JAB }]).removed;
    expect(b).toBeGreaterThan(a * 4);
    // それでも一撃で終わらない程度に抑えてある
    expect(b).toBeLessThan(rush.totalUnits * 0.05);
  });

  it('残り時間が減っていき、切れると元に戻る', () => {
    const world = createWorld(23);
    for (let i = 0; i < RUSH_COMBO; i++) {
      advance(world, [{ step: world.step, x: C + (i % 6), y: C, z: C, kind: HIT_JAB }]);
    }
    expect(isRush(world)).toBe(true);
    const left = rushStepsLeft(world);
    expect(left).toBeGreaterThan(0);
    advance(world, []);
    expect(rushStepsLeft(world)).toBe(left - 1);

    for (let i = 0; i < RUSH_STEPS + 5; i++) advance(world, []);
    expect(isRush(world)).toBe(false);
    expect(rushStepsLeft(world)).toBe(0);
  });
});

describe('順番を入れ替えても結果が変わらない', () => {
  const hits: Hit[] = [
    { step: 0, x: C - 6, y: C, z: C + 4, kind: HIT_JAB },
    { step: 0, x: C, y: C + 5, z: C, kind: HIT_SMASH },
    { step: 0, x: C + 4, y: C - 3, z: C - 2, kind: HIT_JAB },
    { step: 0, x: C + 10, y: C + 8, z: C, kind: HIT_JAB },
    { step: 0, x: C - 2, y: C - 8, z: C + 6, kind: HIT_SMASH },
  ];

  it('同じ回に来た打撃の並び順を変えても同じ', () => {
    const shuffler = new TestShuffler(777);
    const base = createWorld(42);
    advance(base, hits);
    const expected = worldFingerprint(base);

    for (let attempt = 0; attempt < 6; attempt++) {
      const other = createWorld(42);
      advance(other, shuffler.shuffle(hits));
      expect(worldFingerprint(other)).toBe(expected);
    }
  });

  it('1発ずつ当てても、まとめて当てても同じ', () => {
    const together = createWorld(42);
    for (const hit of hits) applyHit(together, hit, together.report);

    const shuffler = new TestShuffler(2024);
    const apart = createWorld(42);
    for (const hit of shuffler.shuffle(hits)) applyHit(apart, hit, apart.report);

    expect(densityDigest(apart.density)).toBe(densityDigest(together.density));
    expect(apart.remainingUnits).toBe(together.remainingUnits);
  });

  it('重なった打撃でも削られる総量は同じ', () => {
    const overlapping: Hit[] = [
      { step: 0, x: C, y: C, z: C, kind: HIT_SMASH },
      { step: 0, x: C, y: C, z: C, kind: HIT_SMASH },
      { step: 0, x: C + 1, y: C + 1, z: C, kind: HIT_SMASH },
    ];
    const shuffler = new TestShuffler(99);
    const a = createWorld(8);
    const removedA = advance(a, overlapping).removed;
    const b = createWorld(8);
    const removedB = advance(b, shuffler.shuffle(overlapping)).removed;
    expect(removedB).toBe(removedA);
    expect(worldFingerprint(b)).toBe(worldFingerprint(a));
  });
});

describe('連打と強化状態', () => {
  it('間を置かずに殴ると数が積み上がる', () => {
    const world = createWorld(4);
    for (let i = 0; i < 10; i++) {
      advance(world, [{ step: world.step, x: C, y: C, z: C, kind: HIT_JAB }]);
    }
    expect(world.combo).toBe(10);
    expect(world.bestCombo).toBe(10);
  });

  it('間が空くと途切れる', () => {
    const world = createWorld(4);
    advance(world, [{ step: world.step, x: C, y: C, z: C, kind: HIT_JAB }]);
    for (let i = 0; i < COMBO_WINDOW_STEPS + 2; i++) advance(world, []);
    expect(world.combo).toBe(0);
    expect(isRush(world)).toBe(false);
  });

  it('連打が続くと強化状態に入る', () => {
    const world = createWorld(4);
    for (let i = 0; i < RUSH_COMBO; i++) {
      advance(world, [{ step: world.step, x: C + (i % 8), y: C, z: C, kind: HIT_JAB }]);
    }
    expect(isRush(world)).toBe(true);
  });

  it('点数は削った量と連打数から決まる', () => {
    const world = createWorld(4);
    const first = advance(world, [CENTER]);
    expect(first.scoreGain).toBeGreaterThan(0);
    expect(world.score).toBe(first.scoreGain);
  });
});

describe('もろくなった区画', () => {
  it('削り込むと崩れ始め、やがて消える', () => {
    const world = createWorld(6);
    let collapsedSeen = false;
    for (let i = 0; i < 400; i++) {
      const report = advance(world, [{ step: world.step, x: C, y: C, z: C, kind: HIT_SMASH }]);
      if (report.collapsing.length > 0) collapsedSeen = true;
      if (report.vanished.length > 0) break;
    }
    expect(collapsedSeen).toBe(true);
    const states = Array.from(world.blockState);
    expect(states.some((s) => s === BLOCK_COLLAPSING || s === BLOCK_GONE)).toBe(true);
  });
});
