/**
 * 石像（リンゴ）の形を立体のマス目に焼き込む。
 *
 * 本体は縦軸まわりの回転体で作り、上下のへこみを楕円体で削り取り、
 * 軸と葉を足す。境目は1〜2マスかけてなだらかに減らすので、
 * 拡大してもマス目の角が出ない。
 *
 * ここだけは三角関数を使うが、生成後は整数の配列になり、
 * その内容から取った指紋を記録に含めるので、環境差はあとから検出できる。
 */

import {
  GRID,
  GRID_AREA,
  VOXEL_COUNT,
  MAX_DENSITY,
  MATERIAL_EMPTY,
  MATERIAL_BODY,
  MATERIAL_STEM,
  MATERIAL_LEAF,
} from './constants';
import { hash2, pick } from './random';

/** 詰め込んだ1バイトから材質を取り出す */
export function materialKind(packed: number): number {
  return packed & 3;
}

/** 詰め込んだ1バイトから、もとの表面からの深さ（マス単位）を取り出す */
export function surfaceDepth(packed: number): number {
  return packed >> 2;
}

export interface StatueShape {
  /** マスごとの初期の残り量（0 は空） */
  readonly density: Uint8Array;
  /** マスごとの材質と深さを詰めた値 */
  readonly material: Uint8Array;
  /** 残り量の合計 */
  readonly totalUnits: number;
  /** 中身のあるマス数 */
  readonly filledCells: number;
  /** 形の縦方向の中心（-1..1 の座標系） */
  readonly centerY: number;
}

/** 形を変えたらこの名前を変える */
export const SHAPE_NAME = 'apple3';

const BODY_BOTTOM = -0.80;
const BODY_TOP = 0.74;
const BODY_SCALE = 0.84;
/** 縦に走る5つのふくらみ。これがあるとリンゴらしく見える */
const LOBES = 5;
const LOBE_DEPTH = 0.028;

/**
 * 下から上へ等間隔に並べた輪郭の太さ。
 * いちばん太いのは中央よりわずかに上。上端はへこみで削るので尖らせない。
 */
const PROFILE = [0, 0.6, 0.82, 0.93, 0.985, 1.0, 0.995, 0.96, 0.87, 0.68, 0.34];

/** 上のへこみ（軸のつけ根） */
const TOP_DENT_Y = 0.64;
const TOP_DENT_R = 0.36;
const TOP_DENT_H = 0.2;

/** 下のへこみ（座り） */
const BOTTOM_DENT_Y = -0.84;
const BOTTOM_DENT_R = 0.26;
const BOTTOM_DENT_H = 0.15;

/** 軸 */
const STEM_A: Vec3 = [0.0, 0.42, 0.0];
const STEM_B: Vec3 = [0.05, 0.98, -0.03];
const STEM_R = 0.033;

/** 葉 */
const LEAF_C: Vec3 = [0.21, 0.86, 0.0];
const LEAF_LONG = 0.2;
const LEAF_SHORT = 0.062;
const LEAF_THICK = 0.055;
const LEAF_COS = 0.86;
const LEAF_SIN = 0.51;

type Vec3 = [number, number, number];

/** 境目を何マスかけてなだらかにするか */
const EDGE_VOXELS = 1.4;
const SHARPNESS = GRID / (2 * EDGE_VOXELS);

/** 高さ u（0=下端, 1=上端）における輪郭の半径 */
function profileRadius(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  const last = PROFILE.length - 1;
  const scaled = u * last;
  const i = Math.min(last - 1, Math.floor(scaled));
  const f = scaled - i;
  const p0 = PROFILE[Math.max(0, i - 1)];
  const p1 = PROFILE[i];
  const p2 = PROFILE[i + 1];
  const p3 = PROFILE[Math.min(last, i + 2)];
  const r =
    0.5 *
    (2 * p1 +
      (p2 - p0) * f +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f +
      (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);
  return r > 0 ? r * BODY_SCALE : 0;
}

/** 線分までの距離 */
function distanceToSegment(
  px: number,
  py: number,
  pz: number,
  a: Vec3,
  b: Vec3,
): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const apx = px - a[0];
  const apy = py - a[1];
  const apz = pz - a[2];
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = (apx * abx + apy * aby + apz * abz) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  const dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

let cached: StatueShape | null = null;

/** 形は常に同じなので一度だけ作って使い回す */
export function getStatueShape(): StatueShape {
  if (!cached) cached = buildStatueShape();
  return cached;
}

/** マスの中心に対応する -1..1 の座標 */
export function voxelToUnit(index: number): number {
  return ((index + 0.5) / GRID) * 2 - 1;
}

export function buildStatueShape(): StatueShape {
  const density = new Uint8Array(VOXEL_COUNT);
  const material = new Uint8Array(VOXEL_COUNT);

  // 横断面での軸からの距離とふくらみは高さによらないので先に作っておく
  const radial = new Float32Array(GRID_AREA);
  const lobe = new Float32Array(GRID_AREA);
  const unit = new Float32Array(GRID);
  for (let i = 0; i < GRID; i++) unit[i] = voxelToUnit(i);
  for (let z = 0; z < GRID; z++) {
    const nz = unit[z];
    for (let x = 0; x < GRID; x++) {
      const nx = unit[x];
      const index = z * GRID + x;
      radial[index] = Math.sqrt(nx * nx + nz * nz);
      lobe[index] = 1 + LOBE_DEPTH * Math.cos(LOBES * Math.atan2(nz, nx) + 0.4);
    }
  }

  let totalUnits = 0;
  let filledCells = 0;

  for (let y = 0; y < GRID; y++) {
    const ny = unit[y];
    const u = (ny - BODY_BOTTOM) / (BODY_TOP - BODY_BOTTOM);
    const bodyRadius = profileRadius(u);

    const topDentT = (ny - TOP_DENT_Y) / TOP_DENT_H;
    const topDentInside = 1 - topDentT * topDentT;
    const bottomDentT = (ny - BOTTOM_DENT_Y) / BOTTOM_DENT_H;
    const bottomDentInside = 1 - bottomDentT * bottomDentT;

    const nearStem = ny > STEM_A[1] - 0.1 && ny < STEM_B[1] + 0.1;
    const nearLeaf = Math.abs(ny - LEAF_C[1]) < LEAF_LONG + 0.05;

    for (let z = 0; z < GRID; z++) {
      const nz = unit[z];
      const rowRadial = z * GRID;
      const base = (z * GRID + y) * GRID;

      for (let x = 0; x < GRID; x++) {
        const nx = unit[x];
        const r = radial[rowRadial + x];

        // 本体（縦のふくらみを乗せる）
        let field = bodyRadius * lobe[rowRadial + x] - r;
        let kind = MATERIAL_BODY;

        // 上下のへこみを引く
        if (topDentInside > 0) {
          const q = Math.sqrt(
            (r * r) / (TOP_DENT_R * TOP_DENT_R) + (1 - topDentInside),
          );
          const dent = (q - 1) * TOP_DENT_R;
          if (dent < field) field = dent;
        }
        if (bottomDentInside > 0) {
          const q = Math.sqrt(
            (r * r) / (BOTTOM_DENT_R * BOTTOM_DENT_R) + (1 - bottomDentInside),
          );
          const dent = (q - 1) * BOTTOM_DENT_R;
          if (dent < field) field = dent;
        }

        // 軸
        if (nearStem && r < 0.2) {
          const stem = STEM_R - distanceToSegment(nx, ny, nz, STEM_A, STEM_B);
          if (stem > field) {
            field = stem;
            kind = MATERIAL_STEM;
          }
        }

        // 葉
        if (nearLeaf) {
          const lx = nx - LEAF_C[0];
          const ly = ny - LEAF_C[1];
          const lz = nz - LEAF_C[2];
          const ax = (lx * LEAF_COS + ly * LEAF_SIN) / LEAF_LONG;
          const ay = (-lx * LEAF_SIN + ly * LEAF_COS) / LEAF_SHORT;
          const az = lz / LEAF_THICK;
          const q = Math.sqrt(ax * ax + ay * ay + az * az);
          const leaf = (1 - q) * LEAF_SHORT;
          if (leaf > field) {
            field = leaf;
            kind = MATERIAL_LEAF;
          }
        }

        if (field <= 0) continue;

        let value = field * SHARPNESS;
        if (value > 1) value = 1;
        // 石らしいざらつき
        let amount = Math.round(value * MAX_DENSITY) + (pick(hash2(base + x, 0x51ed), 7) - 3);
        if (amount <= 0) continue;
        if (amount > MAX_DENSITY) amount = MAX_DENSITY;

        // 材質（下2桁）と、もとの表面からの深さ（マス単位）をまとめて1バイトに詰める
        let depth = Math.round(field * (GRID / 2));
        if (depth < 0) depth = 0;
        else if (depth > 63) depth = 63;

        const index = base + x;
        density[index] = amount;
        material[index] = kind | (depth << 2);
        totalUnits += amount;
        filledCells++;
      }
    }
  }

  return {
    density,
    material,
    totalUnits,
    filledCells,
    centerY: (BODY_TOP + BODY_BOTTOM) / 2,
  };
}
