/**
 * 石像の形を立体のマス目に焼き込む。
 *
 * 本体は縦軸まわりの回転体で作り、上下のへこみを楕円体で削り取り、
 * 軸や葉を足す。境目は1〜2マスかけてなだらかに減らすので、
 * 拡大してもマス目の角が出ない。
 *
 * 形は「作り方の指定」を差し替えるだけで増やせる。
 * 生成後は整数の配列になり、その内容から取った指紋を記録に含めるので、
 * 環境差はあとから検出できる。
 */

import {
  GRID,
  GRID_AREA,
  VOXEL_COUNT,
  MAX_DENSITY,
  MATERIAL_BODY,
  MATERIAL_STEM,
  MATERIAL_LEAF,
} from './constants';
import { hash2, hash3, pick } from './random';

export type Vec3 = [number, number, number];

/** 描き方の系統。色づかいを選ぶのに使う */
export const STYLE_APPLE = 0;
export const STYLE_MELON = 1;

/** 軸（へた）の指定 */
export interface StemSpec {
  a: Vec3;
  b: Vec3;
  radius: number;
}

/** 葉の指定 */
export interface LeafSpec {
  center: Vec3;
  long: number;
  short: number;
  thick: number;
  cos: number;
  sin: number;
}

/** 表面の網目の指定 */
export interface NetSpec {
  /** 網目の細かさ */
  scale: number;
  /** 盛り上がりの高さ */
  height: number;
  /** 線の太さ（0〜1。大きいほど太い） */
  width: number;
}

/** 引き算するへこみ（楕円体） */
export interface DentSpec {
  y: number;
  radius: number;
  height: number;
}

export interface StatueSpec {
  readonly id: string;
  readonly name: string;
  readonly style: number;
  /** 下から上へ等間隔に並べた輪郭の太さ */
  readonly profile: number[];
  readonly bottom: number;
  readonly top: number;
  readonly scale: number;
  /** 縦に走るふくらみ */
  readonly lobes: number;
  readonly lobeDepth: number;
  readonly dents: DentSpec[];
  /** 軸（へた）。複数つなげると T 字などにできる */
  readonly stems?: StemSpec[];
  readonly leaf?: LeafSpec;
  readonly net?: NetSpec;
  /** 中心の「芯」の大きさ */
  readonly coreRadius: number;
}

export interface StatueShape {
  readonly spec: StatueSpec;
  readonly id: string;
  /** マスごとの初期の残り量（0 は空） */
  readonly density: Uint8Array;
  /** マスごとの材質と深さを詰めた値 */
  readonly material: Uint8Array;
  readonly totalUnits: number;
  readonly filledCells: number;
  /** 形の縦方向の中心（-1..1 の座標系） */
  readonly centerY: number;
}

/**
 * 材質の1バイトの詰め方
 *   下2桁     … 材質
 *   その上5桁 … もとの表面からの深さ（0〜31マス）
 *   最上位    … 網目の筋の上かどうか
 */
export const MAX_PACKED_DEPTH = 31;
const NET_BIT = 128;

/** 詰め込んだ1バイトから材質を取り出す */
export function materialKind(packed: number): number {
  return packed & 3;
}

/** 詰め込んだ1バイトから、もとの表面からの深さ（マス単位）を取り出す */
export function surfaceDepth(packed: number): number {
  return (packed >> 2) & MAX_PACKED_DEPTH;
}

/** 網目の筋の上か */
export function onNet(packed: number): boolean {
  return (packed & NET_BIT) !== 0;
}

/** りんご。赤い塗り面の下に石の素地、中心に金色の芯 */
export const APPLE: StatueSpec = {
  id: 'apple',
  name: 'りんご',
  style: STYLE_APPLE,
  profile: [0, 0.6, 0.82, 0.93, 0.985, 1.0, 0.995, 0.96, 0.87, 0.68, 0.34],
  bottom: -0.8,
  top: 0.74,
  scale: 0.84,
  lobes: 5,
  lobeDepth: 0.028,
  dents: [
    { y: 0.64, radius: 0.36, height: 0.2 },
    { y: -0.84, radius: 0.26, height: 0.15 },
  ],
  stems: [{ a: [0, 0.42, 0], b: [0.05, 0.98, -0.03], radius: 0.033 }],
  leaf: {
    center: [0.21, 0.86, 0],
    long: 0.2,
    short: 0.062,
    thick: 0.055,
    cos: 0.86,
    sin: 0.51,
  },
  coreRadius: 0.44,
};

/** メロン。網目の入った緑の皮、下は白い果肉、中心に種の詰まった芯 */
export const MELON: StatueSpec = {
  id: 'melon',
  name: 'メロン',
  style: STYLE_MELON,
  profile: [0, 0.66, 0.87, 0.95, 0.99, 1.0, 0.99, 0.95, 0.87, 0.66, 0.24],
  bottom: -0.82,
  top: 0.8,
  scale: 0.86,
  lobes: 10,
  lobeDepth: 0.014,
  dents: [
    { y: 0.8, radius: 0.24, height: 0.12 },
    { y: -0.84, radius: 0.18, height: 0.1 },
  ],
  // T 字のへた：縦の軸に横棒を渡す
  stems: [
    { a: [0, 0.62, 0], b: [0.005, 0.92, -0.005], radius: 0.055 },
    { a: [-0.13, 0.925, 0.012], b: [0.13, 0.935, -0.012], radius: 0.04 },
  ],
  net: { scale: 9.5, height: 0.017, width: 0.72 },
  coreRadius: 0.42,
};

export const STATUES: StatueSpec[] = [APPLE, MELON];
export const DEFAULT_STATUE = APPLE.id;

export function findSpec(id: string): StatueSpec {
  return STATUES.find((spec) => spec.id === id) ?? APPLE;
}

const cache = new Map<string, StatueShape>();

/** 同じ形は一度だけ作って使い回す */
export function getStatue(id: string = DEFAULT_STATUE): StatueShape {
  const spec = findSpec(id);
  let shape = cache.get(spec.id);
  if (!shape) {
    shape = buildStatue(spec);
    cache.set(spec.id, shape);
  }
  return shape;
}

/** マスの中心に対応する -1..1 の座標 */
export function voxelToUnit(index: number): number {
  return ((index + 0.5) / GRID) * 2 - 1;
}

/** 境目を何マスかけてなだらかにするか */
const EDGE_VOXELS = 1.4;
const SHARPNESS = GRID / (2 * EDGE_VOXELS);

/** 高さ u（0=下端, 1=上端）における輪郭の半径 */
function profileRadius(spec: StatueSpec, u: number): number {
  if (u <= 0 || u >= 1) return 0;
  const profile = spec.profile;
  const last = profile.length - 1;
  const scaled = u * last;
  const i = Math.min(last - 1, Math.floor(scaled));
  const f = scaled - i;
  const p0 = profile[Math.max(0, i - 1)];
  const p1 = profile[i];
  const p2 = profile[i + 1];
  const p3 = profile[Math.min(last, i + 2)];
  const r =
    0.5 *
    (2 * p1 +
      (p2 - p0) * f +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f +
      (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);
  return r > 0 ? r * spec.scale : 0;
}

/** 線分までの距離 */
function distanceToSegment(px: number, py: number, pz: number, a: Vec3, b: Vec3): number {
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

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 位置から作る滑らかな揺らぎ。整数ハッシュだけを使うので毎回同じ */
function valueNoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);

  const corner = (dx: number, dy: number, dz: number): number =>
    hash3(ix + dx, iy + dy, iz + dz) / 4294967296;

  const x00 = corner(0, 0, 0) + (corner(1, 0, 0) - corner(0, 0, 0)) * fx;
  const x10 = corner(0, 1, 0) + (corner(1, 1, 0) - corner(0, 1, 0)) * fx;
  const x01 = corner(0, 0, 1) + (corner(1, 0, 1) - corner(0, 0, 1)) * fx;
  const x11 = corner(0, 1, 1) + (corner(1, 1, 1) - corner(0, 1, 1)) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

/** 網目の盛り上がり（0〜1）。筋の上でだけ1に近づく */
function netRidge(spec: NetSpec, x: number, y: number, z: number): number {
  const n =
    valueNoise(x * spec.scale, y * spec.scale, z * spec.scale) * 0.65 +
    valueNoise(x * spec.scale * 2.1 + 31.7, y * spec.scale * 2.1, z * spec.scale * 2.1) * 0.35;
  const ridged = 1 - Math.abs(n * 2 - 1);
  const edge = spec.width;
  if (ridged <= edge) return 0;
  const t = (ridged - edge) / (1 - edge);
  return t * t * (3 - 2 * t);
}

export function buildStatue(spec: StatueSpec): StatueShape {
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
      lobe[index] = 1 + spec.lobeDepth * Math.cos(spec.lobes * Math.atan2(nz, nx) + 0.4);
    }
  }

  const net = spec.net;
  // 網目を調べるのは表面の近くだけでよい
  const netBand = net ? net.height * 3 + 0.05 : 0;

  let totalUnits = 0;
  let filledCells = 0;

  for (let y = 0; y < GRID; y++) {
    const ny = unit[y];
    const u = (ny - spec.bottom) / (spec.top - spec.bottom);
    const bodyRadius = profileRadius(spec, u);

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
        let onRidge = false;

        // 表面近くだけ網目を盛る
        if (net && field > -netBand && field < netBand) {
          const ridge = netRidge(net, nx, ny, nz);
          if (ridge > 0.42) onRidge = true;
          field += net.height * ridge;
        }

        // へこみを引く
        for (let d = 0; d < spec.dents.length; d++) {
          const dent = spec.dents[d];
          const t = (ny - dent.y) / dent.height;
          const inside = 1 - t * t;
          if (inside <= 0) continue;
          const q = Math.sqrt((r * r) / (dent.radius * dent.radius) + (1 - inside));
          const cut = (q - 1) * dent.radius;
          if (cut < field) field = cut;
        }

        // 軸（複数つなげられる）
        const stems = spec.stems;
        if (stems) {
          for (let s = 0; s < stems.length; s++) {
            const stem = stems[s];
            const low = Math.min(stem.a[1], stem.b[1]) - stem.radius - 0.02;
            const high = Math.max(stem.a[1], stem.b[1]) + stem.radius + 0.02;
            if (ny < low || ny > high || r > 0.32) continue;
            const value = stem.radius - distanceToSegment(nx, ny, nz, stem.a, stem.b);
            if (value > field) {
              field = value;
              kind = MATERIAL_STEM;
            }
          }
        }

        // 葉
        const leaf = spec.leaf;
        if (leaf && Math.abs(ny - leaf.center[1]) < leaf.long + 0.05) {
          const lx = nx - leaf.center[0];
          const ly = ny - leaf.center[1];
          const lz = nz - leaf.center[2];
          const ax = (lx * leaf.cos + ly * leaf.sin) / leaf.long;
          const ay = (-lx * leaf.sin + ly * leaf.cos) / leaf.short;
          const az = lz / leaf.thick;
          const q = Math.sqrt(ax * ax + ay * ay + az * az);
          const value = (1 - q) * leaf.short;
          if (value > field) {
            field = value;
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

        // 材質・深さ・網目の印をまとめて1バイトに詰める
        let depth = Math.round(field * (GRID / 2));
        if (depth < 0) depth = 0;
        else if (depth > MAX_PACKED_DEPTH) depth = MAX_PACKED_DEPTH;

        const index = base + x;
        density[index] = amount;
        material[index] = kind | (depth << 2) | (onRidge ? NET_BIT : 0);
        totalUnits += amount;
        filledCells++;
      }
    }
  }

  return {
    spec,
    id: spec.id,
    density,
    material,
    totalUnits,
    filledCells,
    centerY: (spec.top + spec.bottom) / 2,
  };
}
