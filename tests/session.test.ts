import { describe, expect, it } from 'vitest';
import { worldFingerprint } from '../src/core/fingerprint';
import {
  RecordPlayer,
  ReplayRejected,
  Session,
  currentSignature,
  decodeRecord,
  encodeRecord,
  ensureReplayable,
  recordDigest,
  replay,
  replayFromSnapshot,
} from '../src/core/session';
import { snapshot } from '../src/core/world';
import { GRID, HIT_SMASH } from '../src/core/constants';
import { playScript } from './helpers';

const C = GRID / 2;

function shortPlay(seed: number): Session {
  const session = new Session(seed);
  playScript(session, { every: 5, maxSteps: 260, seed });
  return session;
}

describe('記録と再現', () => {
  it('記録から作り直すと、同じ状態にたどり着く', () => {
    const session = shortPlay(2468);
    const live = worldFingerprint(session.world);
    expect(worldFingerprint(replay(session.toRecord()))).toBe(live);
  });

  it('何度作り直しても同じ', () => {
    const record = shortPlay(13579).toRecord();
    const a = worldFingerprint(replay(record));
    const b = worldFingerprint(replay(record));
    const c = worldFingerprint(replay(record));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('途中の回を指定して作り直せる', () => {
    const session = new Session(31);
    let mark = '';
    for (let i = 0; i < 160; i++) {
      if (i % 4 === 0) session.queueHit(C + (i % 20) - 10, C, C + 10, HIT_SMASH);
      session.advance();
      if (i === 79) mark = worldFingerprint(session.world);
    }
    expect(worldFingerprint(replay(session.toRecord(), 80))).toBe(mark);
  });

  it('保存しておいた途中の状態から再開しても結果は同じ', () => {
    const session = new Session(777);
    let middle: ReturnType<typeof snapshot> | null = null;
    for (let i = 0; i < 200; i++) {
      if (i % 3 === 0) session.queueHit(C + ((i * 7) % 30) - 15, C + ((i * 5) % 20) - 10, C + 8);
      session.advance();
      if (i === 99) middle = snapshot(session.world);
    }
    const record = session.toRecord();
    expect(worldFingerprint(replayFromSnapshot(record, middle!))).toBe(
      worldFingerprint(replay(record)),
    );
  });

  it('種が違えば削れ方も変わる', () => {
    const a = new Session(1);
    const b = new Session(2);
    for (let i = 0; i < 60; i++) {
      a.queueHit(C, C, C + 10);
      b.queueHit(C, C, C + 10);
      a.advance();
      b.advance();
    }
    expect(worldFingerprint(b.world)).not.toBe(worldFingerprint(a.world));
  });

  it('記録の中身は操作の並びだけで、状態を持たない', () => {
    const session = shortPlay(5);
    const record = session.toRecord();
    expect(Object.keys(record).sort()).toEqual([
      'digest',
      'hits',
      'seed',
      'signature',
      'statue',
      'steps',
    ]);
    expect(record.hits.length % 5).toBe(0);
    expect(record.hits.length / 5).toBe(session.hitLogLength);
  });

  it('JSON にして読み戻しても同じ', () => {
    const session = shortPlay(64);
    const restored = decodeRecord(encodeRecord(session.toRecord()));
    expect(worldFingerprint(replay(restored))).toBe(worldFingerprint(session.world));
  });
});

describe('石像ごとの記録', () => {
  it('どの石像を壊したかが記録に残る', () => {
    const melon = new Session(1, 'melon');
    playScript(melon, { every: 6, maxSteps: 120, seed: 1 });
    const record = melon.toRecord();
    expect(record.statue).toBe('melon');
    expect(record.signature).toBe(currentSignature('melon'));
    expect(record.signature).not.toBe(currentSignature('apple'));
  });

  it('メロンの記録もそのまま作り直せる', () => {
    const melon = new Session(31, 'melon');
    playScript(melon, { every: 5, maxSteps: 220, seed: 31 });
    const rebuilt = replay(melon.toRecord());
    expect(rebuilt.statue.id).toBe('melon');
    expect(worldFingerprint(rebuilt)).toBe(worldFingerprint(melon.world));
  });

  it('石像を偽った記録は拒否する', () => {
    const melon = new Session(7, 'melon');
    playScript(melon, { every: 6, maxSteps: 120, seed: 7 });
    const record = melon.toRecord();
    expect(() => replay({ ...record, statue: 'apple' })).toThrow(ReplayRejected);
  });

  it('同じ操作でも石像が違えば結果は違う', () => {
    const apple = new Session(5, 'apple');
    const melon = new Session(5, 'melon');
    for (let i = 0; i < 40; i++) {
      apple.queueHit(C, C, C + 10);
      melon.queueHit(C, C, C + 10);
      apple.advance();
      melon.advance();
    }
    expect(worldFingerprint(melon.world)).not.toBe(worldFingerprint(apple.world));
  });

  it('知らない石像の名前は既定のものとして扱う', () => {
    const session = new Session(1, 'しらないもの');
    expect(session.statueId).toBe('apple');
    expect(session.toRecord().statue).toBe('apple');
  });
});

describe('再現できない記録は受け付けない', () => {
  it('版が違う記録は拒否する', () => {
    const record = shortPlay(9).toRecord();
    const tampered = { ...record, signature: '0:old-rules:apple:deadbeef' };
    expect(() => replay(tampered)).toThrow(ReplayRejected);
    expect(() => ensureReplayable(tampered)).toThrow(/再現できません/);
  });

  it('形が違う記録も拒否する', () => {
    const record = shortPlay(9).toRecord();
    expect(() => replay({ ...record, signature: `${currentSignature()}x` })).toThrow(ReplayRejected);
  });

  it('壊れた JSON は読み込まない', () => {
    expect(() => decodeRecord('{"seed":1}')).toThrow();
    expect(() => decodeRecord('[]')).toThrow();
    const record = shortPlay(3).toRecord();
    const { digest, ...withoutDigest } = record;
    expect(digest).toMatch(/^[0-9a-f]{8}$/);
    expect(() => decodeRecord(JSON.stringify(withoutDigest))).toThrow();
  });

  it('操作の並びが書き換わった記録は拒否する', () => {
    const record = shortPlay(3).toRecord();
    const hits = record.hits.slice();
    hits[1] = (hits[1] + 5) % GRID;
    expect(() => replay({ ...record, hits })).toThrow(ReplayRejected);
  });

  it('操作が欠けた記録も拒否する', () => {
    const record = shortPlay(3).toRecord();
    expect(() => replay({ ...record, hits: record.hits.slice(0, -5) })).toThrow(ReplayRejected);
    expect(() => replay({ ...record, hits: record.hits.slice(0, -2) })).toThrow(ReplayRejected);
  });

  it('回数だけ書き換えた記録も拒否する', () => {
    const record = shortPlay(3).toRecord();
    expect(() => replay({ ...record, steps: record.steps + 1 })).toThrow(ReplayRejected);
    expect(() => replay({ ...record, seed: record.seed + 1 })).toThrow(ReplayRejected);
  });

  it('中身が同じなら指紋も同じ', () => {
    const record = shortPlay(3).toRecord();
    expect(recordDigest(record.seed, record.steps, record.hits)).toBe(record.digest);
  });

  it('いまの記録は当然受け付ける', () => {
    const record = shortPlay(9).toRecord();
    expect(() => ensureReplayable(record)).not.toThrow();
    expect(record.signature).toBe(currentSignature());
  });
});

describe('見返し再生', () => {
  it('1回ずつ流し直しても、まとめて作り直したものと一致する', () => {
    const session = shortPlay(4321);
    const player = new RecordPlayer(session.toRecord());
    let guard = 0;
    while (!player.finished && guard++ < 10000) player.advance();
    expect(worldFingerprint(player.world)).toBe(worldFingerprint(session.world));
    expect(player.progress).toBe(1);
  });
});

describe('操作の受け付け', () => {
  it('範囲の外を指しても内側に収める', () => {
    const session = new Session(1);
    session.queueHit(-50, 9999, -1);
    session.queueHit(GRID + 40, -3, GRID + 3);
    const hits = session.toRecord().hits;
    expect(hits.slice(1, 4)).toEqual([0, GRID - 1, 0]);
    expect(hits.slice(6, 9)).toEqual([GRID - 1, 0, GRID - 1]);
  });

  it('1回の刻みで受け付ける数には上限がある', () => {
    const session = new Session(1);
    let accepted = 0;
    for (let i = 0; i < 40; i++) if (session.queueHit(C, C, C)) accepted++;
    expect(accepted).toBe(8);
  });
});
