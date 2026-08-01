/**
 * 進行中の状態そのもの。
 *
 * ここに入っているものだけが「正しい状態」で、
 * 見た目・音・カメラ・実測フレームレートの類は一切含めない。
 * 同じ種と同じ操作列からは、必ずこの中身が同じになる。
 *
 * マスの並びは x が最も内側、次に y、いちばん外が z。
 * 描画に送るときそのまま使える順にしてある。
 */

import {
  BLOCKS,
  BLOCK_COUNT,
  BLOCK_INTACT,
  BLOCK_SIZE,
  GRID,
  GRID_AREA,
  TOTAL_GRAINS,
  VOXEL_COUNT,
} from './constants';
import { getStatueShape, type StatueShape } from './shape';
import type { StepReport } from './rules';

export function voxelIndex(x: number, y: number, z: number): number {
  return (z * GRID + y) * GRID + x;
}

export function blockIndexOf(x: number, y: number, z: number): number {
  return (((z / BLOCK_SIZE) | 0) * BLOCKS + ((y / BLOCK_SIZE) | 0)) * BLOCKS + ((x / BLOCK_SIZE) | 0);
}

export function blockOfVoxel(index: number): number {
  const x = index % GRID;
  const y = ((index / GRID) | 0) % GRID;
  const z = (index / GRID_AREA) | 0;
  return blockIndexOf(x, y, z);
}

export interface World {
  step: number;
  readonly seed: number;

  /** マスごとの残り量 */
  readonly density: Uint8Array;
  /** マスごとの初期量（変化しない・全対局で共有） */
  readonly origin: Uint8Array;
  /** マスごとの材質（変化しない・全対局で共有） */
  readonly material: Uint8Array;

  /** 区画ごとの残り合計 */
  readonly blockRemaining: Int32Array;
  /** 区画ごとの初期合計（変化しない） */
  readonly blockOrigin: Int32Array;
  /** 区画ごとの状態 */
  readonly blockState: Uint8Array;

  remainingUnits: number;
  readonly totalUnits: number;
  readonly grainsPerUnit: number;
  readonly grainRemainder: number;

  score: number;
  combo: number;
  bestCombo: number;
  hitCount: number;
  lastHitStep: number;
  rushUntilStep: number;
  clearedStep: number;

  readonly report: StepReport;
}

export interface WorldSnapshot {
  step: number;
  density: Uint8Array;
  blockRemaining: Int32Array;
  blockState: Uint8Array;
  remainingUnits: number;
  score: number;
  combo: number;
  bestCombo: number;
  hitCount: number;
  lastHitStep: number;
  rushUntilStep: number;
  clearedStep: number;
}

export function createWorld(seed: number, shape: StatueShape = getStatueShape()): World {
  const blockOrigin = new Int32Array(BLOCK_COUNT);
  for (let i = 0; i < VOXEL_COUNT; i++) {
    const amount = shape.density[i];
    if (amount !== 0) blockOrigin[blockOfVoxel(i)] += amount;
  }

  const grainsPerUnit = Math.floor(TOTAL_GRAINS / shape.totalUnits);
  const grainRemainder = TOTAL_GRAINS - grainsPerUnit * shape.totalUnits;

  return {
    step: 0,
    seed: seed | 0,
    density: shape.density.slice(),
    origin: shape.density,
    material: shape.material,
    blockRemaining: blockOrigin.slice(),
    blockOrigin,
    blockState: new Uint8Array(BLOCK_COUNT).fill(BLOCK_INTACT),
    remainingUnits: shape.totalUnits,
    totalUnits: shape.totalUnits,
    grainsPerUnit,
    grainRemainder,
    score: 0,
    combo: 0,
    bestCombo: 0,
    hitCount: 0,
    lastHitStep: -9999,
    rushUntilStep: 0,
    clearedStep: -1,
    report: createReport(),
  };
}

function createReport(): StepReport {
  return {
    step: 0,
    hits: [],
    removed: 0,
    scoreGain: 0,
    combo: 0,
    comboBroken: false,
    rush: false,
    rushStarted: false,
    cleared: false,
    collapsing: [],
    vanished: [],
    dirtyValid: false,
    dirtyX0: 0,
    dirtyY0: 0,
    dirtyZ0: 0,
    dirtyX1: 0,
    dirtyY1: 0,
    dirtyZ1: 0,
  };
}

/** 画面に出す残りの粒の数 */
export function grainsRemaining(world: World): number {
  if (world.remainingUnits <= 0) return 0;
  return world.remainingUnits * world.grainsPerUnit + world.grainRemainder;
}

export function grainsDestroyed(world: World): number {
  return TOTAL_GRAINS - grainsRemaining(world);
}

/** 破壊率（0..1） */
export function destroyedRatio(world: World): number {
  return 1 - world.remainingUnits / world.totalUnits;
}

export function isRush(world: World): boolean {
  return world.rushUntilStep > world.step;
}

/** ラッシュの残り（刻み数）。切れていれば 0 */
export function rushStepsLeft(world: World): number {
  const left = world.rushUntilStep - world.step;
  return left > 0 ? left : 0;
}

export function isCleared(world: World): boolean {
  return world.remainingUnits <= 0;
}

export function snapshot(world: World): WorldSnapshot {
  return {
    step: world.step,
    density: world.density.slice(),
    blockRemaining: world.blockRemaining.slice(),
    blockState: world.blockState.slice(),
    remainingUnits: world.remainingUnits,
    score: world.score,
    combo: world.combo,
    bestCombo: world.bestCombo,
    hitCount: world.hitCount,
    lastHitStep: world.lastHitStep,
    rushUntilStep: world.rushUntilStep,
    clearedStep: world.clearedStep,
  };
}

export function restore(world: World, snap: WorldSnapshot): void {
  world.step = snap.step;
  world.density.set(snap.density);
  world.blockRemaining.set(snap.blockRemaining);
  world.blockState.set(snap.blockState);
  world.remainingUnits = snap.remainingUnits;
  world.score = snap.score;
  world.combo = snap.combo;
  world.bestCombo = snap.bestCombo;
  world.hitCount = snap.hitCount;
  world.lastHitStep = snap.lastHitStep;
  world.rushUntilStep = snap.rushUntilStep;
  world.clearedStep = snap.clearedStep;
}

/** 区画の残り合計をマスから数え直す（検証用） */
export function recountBlocks(world: World): Int32Array {
  const sums = new Int32Array(BLOCK_COUNT);
  for (let i = 0; i < VOXEL_COUNT; i++) {
    const amount = world.density[i];
    if (amount !== 0) sums[blockOfVoxel(i)] += amount;
  }
  return sums;
}

export interface BlockBounds {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

/** 区画が占めるマスの範囲 */
export function blockBounds(block: number): BlockBounds {
  const bx = block % BLOCKS;
  const by = ((block / BLOCKS) | 0) % BLOCKS;
  const bz = (block / (BLOCKS * BLOCKS)) | 0;
  return {
    x0: bx * BLOCK_SIZE,
    y0: by * BLOCK_SIZE,
    z0: bz * BLOCK_SIZE,
    x1: bx * BLOCK_SIZE + BLOCK_SIZE - 1,
    y1: by * BLOCK_SIZE + BLOCK_SIZE - 1,
    z1: bz * BLOCK_SIZE + BLOCK_SIZE - 1,
  };
}

/** マス座標を -1..1 の座標へ */
export function toUnit(coord: number): number {
  return ((coord + 0.5) / GRID) * 2 - 1;
}

/** -1..1 の座標をマス座標へ */
export function toVoxel(unit: number): number {
  return Math.floor(((unit + 1) / 2) * GRID);
}
