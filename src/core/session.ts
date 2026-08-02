/**
 * 1回のプレイの進行と、その記録。
 *
 * 記録として残すのは「種」と「いつどこを殴ったか」だけ。
 * 状態そのものは保存しない。必要になったら記録から作り直せばよく、
 * 保存量がプレイ時間に比例して膨らむこともない。
 *
 * 殴った位置は立体のマス座標で残す。どこから見ていたかは残さないので、
 * 見返し再生の内容はカメラ操作にまったく左右されない。
 *
 * 記録には作った時点の版と形の指紋を入れる。
 * ここが食い違う記録は、同じ結果を再現できないので受け付けない。
 */

import { GRID, HIT_JAB } from './constants';
import { pushInt, shapeFingerprint, startDigest, toHex } from './fingerprint';
import { advance, type Hit, type StepReport } from './rules';
import { DEFAULT_STATUE, getStatue } from './shape';
import { createWorld, restore, type World, type WorldSnapshot } from './world';

/** 記録の入れ物の版。中身の形式を変えたら上げる */
export const RECORD_FORMAT = 3;
/** 進行規則の版。削り方や連打の扱いを変えたら上げる */
export const RULES_VERSION = 'punch-4';

/** 1回の計算で受け付ける打撃数の上限 */
export const MAX_HITS_PER_STEP = 8;

/** 記録1件あたりの数値の個数 */
const ENTRY = 5;

const signatureCache = new Map<string, string>();

/** この実装が再現できる記録かどうかを見分けるための文字列（石像ごと） */
export function currentSignature(statueId: string = DEFAULT_STATUE): string {
  const shape = getStatue(statueId);
  const cached = signatureCache.get(shape.id);
  if (cached) return cached;
  const fp = shapeFingerprint(shape.density, shape.material);
  const signature = `${RECORD_FORMAT}:${RULES_VERSION}:${shape.id}:${fp}`;
  signatureCache.set(shape.id, signature);
  return signature;
}

export interface SessionRecord {
  signature: string;
  /** どの石像を壊したか */
  statue: string;
  seed: number;
  steps: number;
  /** [回, x, y, z, 種類] の並び。回の昇順 */
  hits: number[];
  /** 操作列そのものの指紋。途中で欠けたり書き換わった記録を弾く */
  digest: string;
}

/** 記録の中身から指紋を作る */
export function recordDigest(seed: number, steps: number, hits: readonly number[]): string {
  let d = startDigest();
  d = pushInt(d, seed);
  d = pushInt(d, steps);
  d = pushInt(d, hits.length);
  for (let i = 0; i < hits.length; i++) d = pushInt(d, hits[i]);
  return toHex(d);
}

export class ReplayRejected extends Error {
  constructor(
    readonly expected: string,
    readonly found: string,
  ) {
    super(`この記録は再現できません（想定: ${expected} / 記録: ${found}）`);
    this.name = 'ReplayRejected';
  }
}

export class Session {
  readonly world: World;
  readonly statueId: string;
  private readonly log: number[] = [];
  private readonly pending: Hit[] = [];

  constructor(
    readonly seed: number,
    statueId: string = DEFAULT_STATUE,
  ) {
    this.world = createWorld(seed, statueId);
    this.statueId = this.world.statue.id;
  }

  get step(): number {
    return this.world.step;
  }

  /** 次の計算で反映される打撃を積む。範囲外や積みすぎは無視する */
  queueHit(x: number, y: number, z: number, kind: number = HIT_JAB): boolean {
    if (this.pending.length >= MAX_HITS_PER_STEP) return false;
    const gx = clampGrid(x);
    const gy = clampGrid(y);
    const gz = clampGrid(z);
    const gk = kind === 1 ? 1 : 0;
    const step = this.world.step;
    this.pending.push({ step, x: gx, y: gy, z: gz, kind: gk });
    this.log.push(step, gx, gy, gz, gk);
    return true;
  }

  advance(): StepReport {
    const report = advance(this.world, this.pending);
    this.pending.length = 0;
    return report;
  }

  get hitLogLength(): number {
    return this.log.length / ENTRY;
  }

  toRecord(): SessionRecord {
    const steps = this.world.step;
    const hits = this.log.slice();
    return {
      signature: currentSignature(this.statueId),
      statue: this.statueId,
      seed: this.seed,
      steps,
      hits,
      digest: recordDigest(this.seed, steps, hits),
    };
  }
}

function clampGrid(value: number): number {
  const v = Math.round(value);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > GRID - 1) return GRID - 1;
  return v;
}

/** 記録がこの実装で再現できるか確かめる。できなければ例外を投げる */
export function ensureReplayable(record: SessionRecord): void {
  const expected = currentSignature(record.statue);
  if (record.signature !== expected) {
    throw new ReplayRejected(expected, record.signature);
  }
  const digest = recordDigest(record.seed, record.steps, record.hits);
  if (record.digest !== digest) {
    throw new ReplayRejected(digest, record.digest);
  }
  if (record.hits.length % ENTRY !== 0) {
    throw new ReplayRejected('操作の並びが揃っていること', `${record.hits.length} 個`);
  }
}

/**
 * 記録を頭から流し直して、指定した回の状態を作る。
 * 途中の状態を保存していなくても、ここだけで必ず同じ状態に辿り着ける。
 */
export function replay(record: SessionRecord, untilStep = record.steps): World {
  ensureReplayable(record);
  const world = createWorld(record.seed, record.statue);
  return runFrom(world, record, 0, untilStep);
}

/**
 * 途中で控えておいた状態から再開する（頭から流し直すのが遅いときの短縮）。
 * 控えは記録から作り直せるだけのもので、捨てても結果は変わらない。
 */
export function replayFromSnapshot(
  record: SessionRecord,
  snap: WorldSnapshot,
  untilStep = record.steps,
): World {
  ensureReplayable(record);
  const world = createWorld(record.seed, record.statue);
  restore(world, snap);
  return runFrom(world, record, snap.step, untilStep);
}

function runFrom(world: World, record: SessionRecord, fromStep: number, untilStep: number): World {
  const hits = record.hits;
  const target = Math.min(untilStep, record.steps);
  let cursor = 0;
  while (cursor < hits.length && hits[cursor] < fromStep) cursor += ENTRY;

  const batch: Hit[] = [];
  for (let step = fromStep; step < target; step++) {
    batch.length = 0;
    while (cursor < hits.length && hits[cursor] === step) {
      batch.push({
        step,
        x: hits[cursor + 1],
        y: hits[cursor + 2],
        z: hits[cursor + 3],
        kind: hits[cursor + 4],
      });
      cursor += ENTRY;
    }
    advance(world, batch);
  }
  return world;
}

/**
 * 記録を1回ずつ流し直すための道具。
 * プレイ中と同じ規則を同じ順で通すので、見た目まで含めて同じものが出る。
 */
export class RecordPlayer {
  readonly world: World;
  private cursor = 0;
  private readonly batch: Hit[] = [];

  constructor(readonly record: SessionRecord) {
    ensureReplayable(record);
    this.world = createWorld(record.seed);
  }

  get finished(): boolean {
    return this.world.step >= this.record.steps;
  }

  get progress(): number {
    return this.record.steps > 0 ? this.world.step / this.record.steps : 1;
  }

  advance(): StepReport {
    const step = this.world.step;
    const hits = this.record.hits;
    this.batch.length = 0;
    while (this.cursor < hits.length && hits[this.cursor] === step) {
      this.batch.push({
        step,
        x: hits[this.cursor + 1],
        y: hits[this.cursor + 2],
        z: hits[this.cursor + 3],
        kind: hits[this.cursor + 4],
      });
      this.cursor += ENTRY;
    }
    return advance(this.world, this.batch);
  }
}

/** 記録を JSON にする */
export function encodeRecord(record: SessionRecord): string {
  return JSON.stringify(record);
}

/** JSON から記録を読む。形式が違えば例外 */
export function decodeRecord(text: string): SessionRecord {
  const raw = JSON.parse(text) as Partial<SessionRecord>;
  if (
    typeof raw.signature !== 'string' ||
    typeof raw.digest !== 'string' ||
    typeof raw.statue !== 'string' ||
    typeof raw.seed !== 'number' ||
    typeof raw.steps !== 'number' ||
    !Array.isArray(raw.hits) ||
    raw.hits.length % ENTRY !== 0
  ) {
    throw new Error('記録の形式が違います');
  }
  return {
    signature: raw.signature,
    statue: raw.statue,
    seed: raw.seed,
    steps: raw.steps,
    hits: raw.hits as number[],
    digest: raw.digest,
  };
}
