/**
 * 状態を1つ進める規則。
 *
 * 大事な性質が2つある。
 *
 *  1. 同じ状態と同じ操作からは必ず同じ結果になる。
 *     時計・実測フレームレート・カメラ・乱数生成器の類は一切参照しない。
 *
 *  2. 処理の順番を入れ替えても結果が変わらない。
 *     1発の削り量は「その打撃」と「そのマス」だけから決まり、
 *     いまの残り量を見ない。引き算は 0 で止めるので、
 *     どの順に当てても最後の残り量は同じ値に落ち着く。
 *     これがあるおかげで、あとから並列化や処理の間引きを入れても壊れない。
 */

import {
  BARRAGE_DECAY_STEPS,
  BARRAGE_ECHOES,
  BARRAGE_ECHO_POWER_PERCENT,
  BARRAGE_ECHO_RADIUS_PERCENT,
  BARRAGE_MAX_COUNT,
  BARRAGE_SPREAD,
  BARRAGE_STEPS,
  BARRAGE_TRIGGER,
  BLOCKS,
  BLOCK_COLLAPSING,
  BLOCK_COUNT,
  BLOCK_DAMAGED,
  BLOCK_GONE,
  BLOCK_SIZE,
  COLLAPSE_PERCENT,
  COMBO_WINDOW_STEPS,
  CRUMB_DENSITY,
  FINALE_PERCENT,
  FINALE_SHAKE_STEPS,
  FINALE_WAVE_STEPS,
  GRID,
  HIT_SMASH,
  JAB_POWER,
  JAB_RADIUS,
  RUSH_COMBO,
  RUSH_POWER_PERCENT,
  RUSH_RADIUS_SCALE,
  RUSH_SHARPNESS,
  RUSH_STEPS,
  SMASH_POWER,
  SMASH_RADIUS,
} from './constants';
import { hash2, hash3 } from './random';
import { blockBounds, isBarrage, isRush, type World } from './world';

export interface Hit {
  readonly step: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly kind: number;
}

export interface HitFeedback {
  x: number;
  y: number;
  z: number;
  radius: number;
  power: number;
  /** その打撃が単独で与えた削り量（他の打撃と重なっても値は変わらない） */
  damage: number;
  /** 実際に減った量 */
  removed: number;
  kind: number;
  /** 乱打中に出た追い打ちの位置。[x, y, z] の並び */
  echoes: number[];
  /** 追い打ちの範囲 */
  echoRadius: number;
}

export interface StepReport {
  step: number;
  hits: HitFeedback[];
  removed: number;
  scoreGain: number;
  combo: number;
  comboBroken: boolean;
  rush: boolean;
  rushStarted: boolean;
  /** 乱打中か */
  barrage: boolean;
  /** 乱打に入った回 */
  barrageStarted: boolean;
  /** この回に入った打撃の数（追い打ちを含まない） */
  landed: number;
  /** 総崩れの合図が出た回 */
  finaleStarted: boolean;
  /** 崩れる前に震えている最中 */
  finaleShaking: boolean;
  cleared: boolean;
  /** この回に崩れ始めた区画 */
  collapsing: number[];
  /** この回に消えた区画 */
  vanished: number[];
  dirtyValid: boolean;
  dirtyX0: number;
  dirtyY0: number;
  dirtyZ0: number;
  dirtyX1: number;
  dirtyY1: number;
  dirtyZ1: number;
}

export interface HitParams {
  radius: number;
  power: number;
  /** 中心から外へ向かう減り方を何段きつくするか（中心は深く、外は浅くなる） */
  sharpness: number;
}

/** 打撃の強さは、そのときの状態（連打数・強化中か）だけから決まる */
export function hitParams(world: World, kind: number): HitParams {
  const boost = Math.min(world.combo, 60);
  let radius = kind === HIT_SMASH ? SMASH_RADIUS : JAB_RADIUS;
  let power = kind === HIT_SMASH ? SMASH_POWER : JAB_POWER;
  radius += (boost / 24) | 0;
  power += boost * 4;
  let sharpness = 0;
  if (isRush(world)) {
    radius *= RUSH_RADIUS_SCALE;
    power = ((power * RUSH_POWER_PERCENT) / 100) | 0;
    sharpness = RUSH_SHARPNESS;
  }
  return { radius, power, sharpness };
}

function widen(
  report: StepReport,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): void {
  if (!report.dirtyValid) {
    report.dirtyValid = true;
    report.dirtyX0 = x0;
    report.dirtyY0 = y0;
    report.dirtyZ0 = z0;
    report.dirtyX1 = x1;
    report.dirtyY1 = y1;
    report.dirtyZ1 = z1;
    return;
  }
  if (x0 < report.dirtyX0) report.dirtyX0 = x0;
  if (y0 < report.dirtyY0) report.dirtyY0 = y0;
  if (z0 < report.dirtyZ0) report.dirtyZ0 = z0;
  if (x1 > report.dirtyX1) report.dirtyX1 = x1;
  if (y1 > report.dirtyY1) report.dirtyY1 = y1;
  if (z1 > report.dirtyZ1) report.dirtyZ1 = z1;
}

function clampCoord(value: number): number {
  if (value < 0) return 0;
  if (value > GRID - 1) return GRID - 1;
  return value;
}

/**
 * 打撃1発を反映する。
 * 削り量は「種・回数・打撃の中身・マス番号」だけから決まるので、
 * 同じ回に来た打撃の並び順を入れ替えても結果は変わらない。
 *
 * 乱打中は、1発につき追い打ちが近くへ飛ぶ。
 * 追い打ちの位置も打撃の中身だけから決まるので、順番に依らない。
 */
export function applyHit(world: World, hit: Hit, report: StepReport): HitFeedback {
  const { radius, power, sharpness } = hitParams(world, hit.kind);
  const salt = hash2(world.seed, world.step);
  const key = (hit.kind << 24) ^ ((hit.z << 16) | (hit.y << 8) | hit.x);

  const main = applyStrike(world, hit.x, hit.y, hit.z, radius, power, sharpness, salt, key, report);

  const feedback: HitFeedback = {
    x: hit.x,
    y: hit.y,
    z: hit.z,
    radius,
    power,
    damage: main.damage,
    removed: main.removed,
    kind: hit.kind,
    echoes: [],
    echoRadius: 0,
  };

  if (!isBarrage(world)) return feedback;

  const echoRadius = Math.max(3, ((radius * BARRAGE_ECHO_RADIUS_PERCENT) / 100) | 0);
  const echoPower = Math.max(1, ((power * BARRAGE_ECHO_POWER_PERCENT) / 100) | 0);
  feedback.echoRadius = echoRadius;

  for (let i = 0; i < BARRAGE_ECHOES; i++) {
    const spread = hash3(salt, key, 0x51ed + i);
    const ex = clampCoord(hit.x + offsetFrom(spread, 0));
    const ey = clampCoord(hit.y + offsetFrom(spread, 5));
    const ez = clampCoord(hit.z + offsetFrom(spread, 10));
    const echo = applyStrike(
      world,
      ex,
      ey,
      ez,
      echoRadius,
      echoPower,
      sharpness,
      salt,
      (key ^ (0x9e37 * (i + 1))) | 0,
      report,
    );
    feedback.damage += echo.damage;
    feedback.removed += echo.removed;
    feedback.echoes.push(ex, ey, ez);
  }
  return feedback;
}

/** 散らばりの取り出し。-BARRAGE_SPREAD 〜 +BARRAGE_SPREAD に収める */
function offsetFrom(bits: number, shift: number): number {
  const raw = (bits >>> shift) & 31;
  return ((raw * (2 * BARRAGE_SPREAD + 1)) >> 5) - BARRAGE_SPREAD;
}

interface StrikeResult {
  damage: number;
  removed: number;
}

/** 球ひとつぶんの削り。追い打ちも本体もこれを通る */
function applyStrike(
  world: World,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  power: number,
  sharpness: number,
  salt: number,
  key: number,
  report: StepReport,
): StrikeResult {
  const r2 = radius * radius;
  const r4 = r2 * r2;

  const minX = clampCoord(cx - radius);
  const maxX = clampCoord(cx + radius);
  const minY = clampCoord(cy - radius);
  const maxY = clampCoord(cy + radius);
  const minZ = clampCoord(cz - radius);
  const maxZ = clampCoord(cz + radius);

  let intended = 0;
  let removed = 0;

  for (let z = minZ; z <= maxZ; z++) {
    const dz = z - cz;
    const dz2 = dz * dz;
    const bz = (z / BLOCK_SIZE) | 0;
    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      const d2yz = dz2 + dy * dy;
      if (d2yz > r2) continue;
      const rowBlock = (bz * BLOCKS + ((y / BLOCK_SIZE) | 0)) * BLOCKS;
      const row = (z * GRID + y) * GRID;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const d2 = d2yz + dx * dx;
        if (d2 > r2) continue;

        const index = row + x;
        const before = world.density[index];
        if (before === 0) continue;

        const falloff = r2 - d2;
        let amount = Math.floor((power * falloff * falloff) / r4);
        for (let s = 0; s < sharpness; s++) amount = Math.floor((amount * falloff) / r2);
        if (amount <= 0) continue;
        // 削れ方のムラ（最大で +12% ほど）
        amount += (amount * (hash3(salt, key, index) & 63)) >> 9;
        intended += amount;

        let after = before - amount;
        if (after < CRUMB_DENSITY) after = 0;
        const diff = before - after;
        if (diff === 0) continue;

        world.density[index] = after;
        world.blockRemaining[rowBlock + ((x / BLOCK_SIZE) | 0)] -= diff;
        removed += diff;
      }
    }
  }

  world.remainingUnits -= removed;
  if (removed > 0) widen(report, minX, minY, minZ, maxX, maxY, maxZ);

  return { damage: intended, removed };
}

/** 崩れ始めた区画を、まとめて削り落とす */
export function applyCollapse(world: World, report: StepReport): number {
  let removed = 0;
  for (let block = 0; block < BLOCK_COUNT; block++) {
    if (world.blockState[block] !== BLOCK_COLLAPSING) continue;
    if (world.blockRemaining[block] <= 0) continue;

    const bounds = blockBounds(block);
    let touched = false;
    for (let z = bounds.z0; z <= bounds.z1; z++) {
      for (let y = bounds.y0; y <= bounds.y1; y++) {
        const row = (z * GRID + y) * GRID;
        for (let x = bounds.x0; x <= bounds.x1; x++) {
          const index = row + x;
          const before = world.density[index];
          if (before === 0) continue;
          // 崩れにくさを塊ごとに散らして、区画の四角い形が出ないようにする
          const clump = (x >> 1) + ((y >> 1) << 6) + ((z >> 1) << 12);
          const resist = 14 + (hash2(clump, 0x27d4) & 31);
          let after = before - resist;
          if (after < CRUMB_DENSITY) after = 0;
          const diff = before - after;
          world.density[index] = after;
          world.blockRemaining[block] -= diff;
          removed += diff;
          touched = true;
        }
      }
    }
    if (touched) {
      widen(report, bounds.x0, bounds.y0, bounds.z0, bounds.x1, bounds.y1, bounds.z1);
    }
  }
  world.remainingUnits -= removed;
  return removed;
}

/** 状態を1つ進める。戻り値は使い回しの入れ物なので、その場で読むこと */
export function advance(world: World, hits: readonly Hit[]): StepReport {
  const report = world.report;
  report.step = world.step;
  report.hits.length = 0;
  report.collapsing.length = 0;
  report.vanished.length = 0;
  report.removed = 0;
  report.scoreGain = 0;
  report.comboBroken = false;
  report.rushStarted = false;
  report.barrageStarted = false;
  report.landed = 0;
  report.finaleStarted = false;
  report.finaleShaking = false;
  report.cleared = false;
  report.dirtyValid = false;

  const rushBefore = isRush(world);
  const barrageBefore = isBarrage(world);

  // 乱打の判定は、打撃を入れる前の数え上げで決める（同じ回の中で条件が変わらないように）
  updateBarrage(world, hits.length);

  let removed = 0;
  for (let i = 0; i < hits.length; i++) {
    const feedback = applyHit(world, hits[i], report);
    removed += feedback.removed;
    report.hits.push(feedback);
  }
  removed += applyCollapse(world, report);
  report.removed = removed;
  report.landed = hits.length;

  updateBlocks(world, report);
  updateCombo(world, hits.length, report);
  updateScore(world, report);
  checkFinale(world, report);

  if (world.remainingUnits <= 0 && world.clearedStep < 0) {
    world.clearedStep = world.step;
    report.cleared = true;
  }

  report.combo = world.combo;
  report.rush = isRush(world);
  report.rushStarted = report.rush && !rushBefore;
  report.barrage = isBarrage(world);
  report.barrageStarted = report.barrage && !barrageBefore;

  world.step++;
  return report;
}

function updateBlocks(world: World, report: StepReport): void {
  for (let block = 0; block < BLOCK_COUNT; block++) {
    const origin = world.blockOrigin[block];
    if (origin === 0) continue;

    const state = world.blockState[block];
    if (state === BLOCK_GONE) continue;

    const left = world.blockRemaining[block];
    if (left <= 0) {
      world.blockState[block] = BLOCK_GONE;
      report.vanished.push(block);
      continue;
    }
    if (state === BLOCK_COLLAPSING) continue;

    if (left * 100 < origin * COLLAPSE_PERCENT) {
      world.blockState[block] = BLOCK_COLLAPSING;
      report.collapsing.push(block);
    } else if (left < origin) {
      world.blockState[block] = BLOCK_DAMAGED;
    }
  }
}

/**
 * 立て続けに殴っているかを数える。
 * 一定の間隔でひとつずつ抜けていくので、指を増やして速く叩くほど溜まる。
 */
function updateBarrage(world: World, hitCount: number): void {
  if (world.step % BARRAGE_DECAY_STEPS === 0 && world.recentHits > 0) {
    world.recentHits--;
  }
  if (hitCount > 0) {
    world.recentHits = Math.min(BARRAGE_MAX_COUNT, world.recentHits + hitCount);
  }
  if (world.recentHits >= BARRAGE_TRIGGER) {
    world.barrageUntilStep = world.step + BARRAGE_STEPS;
  }
}

function updateCombo(world: World, hitCount: number, report: StepReport): void {
  if (hitCount > 0) {
    const before = world.combo;
    const linked = world.step - world.lastHitStep <= COMBO_WINDOW_STEPS;
    if (linked) {
      world.combo += hitCount;
    } else {
      if (world.combo > 0) report.comboBroken = true;
      world.combo = hitCount;
    }
    world.lastHitStep = world.step;
    world.hitCount += hitCount;
    if (world.combo > world.bestCombo) world.bestCombo = world.combo;
    // 連打数が節目を越えるたびに強化状態を入れ直す
    const reached = (world.combo / RUSH_COMBO) | 0;
    const had = (before / RUSH_COMBO) | 0;
    if (world.combo >= RUSH_COMBO && reached > had) {
      world.rushUntilStep = world.step + RUSH_STEPS;
    }
  } else if (world.combo > 0 && world.step - world.lastHitStep > COMBO_WINDOW_STEPS) {
    world.combo = 0;
    world.rushUntilStep = 0;
    report.comboBroken = true;
  }
}

function updateScore(world: World, report: StepReport): void {
  if (report.removed <= 0) return;
  let multiplier = 100 + Math.min(world.combo, 300) * 6;
  if (isRush(world)) multiplier *= 2;
  const gain = Math.floor((report.removed * multiplier) / 100);
  world.score += gain;
  report.scoreGain = gain;
}

/**
 * 残りわずかになったら総崩れに入る（最後の詰めを退屈にしない）。
 *
 * いきなり全部消すと唐突なので、まず地響きとともにしばらく震え、
 * そのあと下の段から順に崩れていく。震えの長さも崩れる順も
 * 状態だけから決まるので、見返し再生でも同じように崩れる。
 */
function checkFinale(world: World, report: StepReport): void {
  if (world.remainingUnits <= 0) return;

  if (world.finaleStep < 0) {
    if (world.remainingUnits * 100 >= world.totalUnits * FINALE_PERCENT) return;
    world.finaleStep = world.step;
    report.finaleStarted = true;
    report.finaleShaking = true;
    return;
  }

  const elapsed = world.step - world.finaleStep;
  if (elapsed < FINALE_SHAKE_STEPS) {
    report.finaleShaking = true;
    return;
  }

  const wave = elapsed - FINALE_SHAKE_STEPS;
  for (let block = 0; block < BLOCK_COUNT; block++) {
    const state = world.blockState[block];
    if (state === BLOCK_GONE || state === BLOCK_COLLAPSING) continue;
    if (world.blockRemaining[block] <= 0) continue;
    // 下の段ほど早く崩れる。同じ段の中は少しばらけさせる
    const level = ((block / BLOCKS) | 0) % BLOCKS;
    const delay = level * FINALE_WAVE_STEPS + (hash2(block, 0x6d3f) & 3);
    if (wave < delay) continue;
    world.blockState[block] = BLOCK_COLLAPSING;
    report.collapsing.push(block);
  }
}
