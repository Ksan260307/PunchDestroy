/**
 * 画面上の1点から伸ばした線が、石像のどのマスに当たるかを調べる。
 *
 * どこから見ているか（カメラ）は表示側の持ち物なので、ここへは
 * 「始点と向き」だけが渡ってくる。結果のマス座標が操作として記録され、
 * 以降の進行はカメラの位置に一切左右されない。
 */

import { BLOCKS, GRID, SOLID_THRESHOLD } from './constants';
import type { World } from './world';

export interface TraceHit {
  x: number;
  y: number;
  z: number;
  /** 始点からの距離 */
  distance: number;
}

const VOXEL_STEP = 2 / GRID;
const BLOCK_STEP = 2 / BLOCKS;

/** 石像を囲む球の半径（-1..1 の座標系） */
const BOUND_RADIUS = 1.05;

function blockOccupied(world: World, ux: number, uy: number, uz: number): boolean {
  const bx = ((ux + 1) * 0.5 * BLOCKS) | 0;
  const by = ((uy + 1) * 0.5 * BLOCKS) | 0;
  const bz = ((uz + 1) * 0.5 * BLOCKS) | 0;
  if (bx < 0 || by < 0 || bz < 0 || bx >= BLOCKS || by >= BLOCKS || bz >= BLOCKS) return false;
  return world.blockRemaining[(bz * BLOCKS + by) * BLOCKS + bx] > 0;
}

function densityAt(world: World, ux: number, uy: number, uz: number): number {
  const x = ((ux + 1) * 0.5 * GRID) | 0;
  const y = ((uy + 1) * 0.5 * GRID) | 0;
  const z = ((uz + 1) * 0.5 * GRID) | 0;
  if (x < 0 || y < 0 || z < 0 || x >= GRID || y >= GRID || z >= GRID) return 0;
  return world.density[(z * GRID + y) * GRID + x];
}

/**
 * 始点 o から向き d へ線を伸ばし、最初にぶつかったマスを返す。
 * `bite` を渡すと、その分だけ内側に食い込んだ位置を返す（殴った跡を中心に寄せる）。
 */
export function traceSurface(
  world: World,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  bite = 0,
): TraceHit | null {
  // まず石像を囲む球との交わりを求めて、無駄な区間を飛ばす
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - BOUND_RADIUS * BOUND_RADIUS;
  const disc = b * b - c;
  if (disc <= 0) return null;
  const root = Math.sqrt(disc);
  let t = -b - root;
  const tEnd = -b + root;
  if (tEnd <= 0) return null;
  if (t < 0) t = 0;

  let guard = 0;
  while (t < tEnd && guard++ < 4096) {
    const px = ox + dx * t;
    const py = oy + dy * t;
    const pz = oz + dz * t;
    if (!blockOccupied(world, px, py, pz)) {
      t += BLOCK_STEP * 0.5;
      continue;
    }
    if (densityAt(world, px, py, pz) >= SOLID_THRESHOLD) {
      const hitT = t + bite;
      const hx = ox + dx * hitT;
      const hy = oy + dy * hitT;
      const hz = oz + dz * hitT;
      return {
        x: Math.min(GRID - 1, Math.max(0, ((hx + 1) * 0.5 * GRID) | 0)),
        y: Math.min(GRID - 1, Math.max(0, ((hy + 1) * 0.5 * GRID) | 0)),
        z: Math.min(GRID - 1, Math.max(0, ((hz + 1) * 0.5 * GRID) | 0)),
        distance: t,
      };
    }
    t += VOXEL_STEP * 0.75;
  }
  return null;
}

/**
 * 線が外れたときの代わりの狙い先。
 * 中心へ向けた線ともっとも近い位置にある、残っているマスを選ぶ。
 */
export function nearestSolid(world: World): TraceHit | null {
  let best = -1;
  let bestIndex = -1;
  const remaining = world.blockRemaining;
  for (let block = 0; block < remaining.length; block++) {
    if (remaining[block] > best) {
      best = remaining[block];
      bestIndex = block;
    }
  }
  if (bestIndex < 0 || best <= 0) return null;
  const bx = bestIndex % BLOCKS;
  const by = ((bestIndex / BLOCKS) | 0) % BLOCKS;
  const bz = (bestIndex / (BLOCKS * BLOCKS)) | 0;
  const size = GRID / BLOCKS;
  return {
    x: Math.round(bx * size + size / 2),
    y: Math.round(by * size + size / 2),
    z: Math.round(bz * size + size / 2),
    distance: 0,
  };
}
