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
export const STYLE_GRAPE = 2;
export const STYLE_ORANGE = 3;
export const STYLE_KIWI = 4;
export const STYLE_BANANA = 5;
export const STYLE_PINEAPPLE = 6;
export const STYLE_CHERRY = 7;

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
  /** ななめ格子のうろこにする（パイナップルの皮） */
  diamond?: boolean;
  /** 格子の数（周まわり／高さ方向） */
  columns?: number;
  rows?: number;
}

/** 曲がった筒の指定（バナナのような形） */
export interface TubeSpec {
  /** 曲がりの中心と半径 */
  centerX: number;
  centerY: number;
  arcRadius: number;
  /** 角度の範囲（度） */
  fromDegrees: number;
  toDegrees: number;
  /** 端と真ん中の太さ */
  endRadius: number;
  midRadius: number;
  /** いくつの玉でつなぐか */
  samples: number;
  /** 上端を支点にして倒す角度（度）。房を外へ広げるのに使う */
  tiltDegrees?: number;
  /** 中心の縦軸まわりに回す角度（度）。同じ筒を並べて房にするのに使う */
  spinDegrees?: number;
  /** 置き場所のずらし。倒して回したあとに効く */
  shiftX?: number;
  shiftY?: number;
  shiftZ?: number;
}

/** 引き算するへこみ（楕円体） */
export interface DentSpec {
  y: number;
  radius: number;
  height: number;
}

/** 房（たくさんの粒の集まり）の指定 */
export interface BunchSpec {
  /** 房のいちばん上と下 */
  topY: number;
  bottomY: number;
  /** いちばん太いところの半径 */
  spread: number;
  /** 粒の大きさ（上と下） */
  topRadius: number;
  bottomRadius: number;
  /** 段の数 */
  levels: number;
  /** 位置の散らばり */
  jitter: number;
}

/** 房を組む1粒 */
export interface Berry {
  x: number;
  y: number;
  z: number;
  r: number;
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
  /** 房で作る場合の指定。これがあるときは輪郭ではなく粒の集まりで形を作る */
  readonly bunch?: BunchSpec;
  /** 玉をそのまま並べて作る場合（さくらんぼなど） */
  readonly spheres?: Berry[];
  /** 曲がった筒で作る場合（バナナなど）。並べると房になる */
  readonly tubes?: TubeSpec[];
  /** 軸（へた）。複数つなげると T 字などにできる */
  readonly stems?: StemSpec[];
  /** 葉としてあつかう軸（パイナップルの冠など） */
  readonly leafStems?: StemSpec[];
  readonly leaf?: LeafSpec;
  readonly net?: NetSpec;
  /** 中心の「芯」の大きさ */
  readonly coreRadius: number;
  /**
   * この石像を殴るときの範囲と威力の倍率（%）。
   * 中身の量やすき間の多さが形ごとに違うので、遊ぶ長さをここでそろえる。
   */
  readonly hitScale?: number;
  readonly hitPowerScale?: number;
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

/** ぶどう。粒の集まった房。皮は紫、中は淡い果肉 */
export const GRAPE: StatueSpec = {
  id: 'grape',
  name: 'ぶどう',
  style: STYLE_GRAPE,
  profile: [],
  bottom: -0.86,
  top: 0.5,
  scale: 1,
  lobes: 0,
  lobeDepth: 0,
  dents: [],
  bunch: {
    topY: 0.5,
    bottomY: -0.86,
    spread: 0.52,
    topRadius: 0.118,
    bottomRadius: 0.086,
    levels: 9,
    jitter: 0.028,
  },
  // T 字のへた
  stems: [
    { a: [0, 0.36, 0], b: [0.004, 0.9, -0.004], radius: 0.036 },
    { a: [-0.11, 0.905, 0.01], b: [0.11, 0.915, -0.01], radius: 0.03 },
  ],
  coreRadius: 0.36,
  // 房はすき間が多く、1発が空を切りやすい。範囲は少し狭め、そのぶん深く抜く
  hitScale: 88,
  hitPowerScale: 210,
};

/** みかん。平たい橙の球。皮の下は白いわた、中はふさに分かれた果肉 */
export const MIKAN: StatueSpec = {
  id: 'mikan',
  name: 'みかん',
  style: STYLE_ORANGE,
  profile: [0, 0.72, 0.9, 0.96, 0.99, 1.0, 0.99, 0.96, 0.9, 0.7, 0.24],
  bottom: -0.66,
  top: 0.66,
  scale: 0.86,
  lobes: 12,
  lobeDepth: 0.007,
  dents: [
    { y: 0.64, radius: 0.2, height: 0.1 },
    { y: -0.64, radius: 0.22, height: 0.1 },
  ],
  // 細かい粒立ちの皮
  net: { scale: 17, height: 0.006, width: 0.52 },
  // 上のヘタ（平たい緑の円盤）
  leaf: {
    center: [0, 0.605, 0],
    long: 0.17,
    short: 0.038,
    thick: 0.17,
    cos: 1,
    sin: 0,
  },
  coreRadius: 0.3,
};

/** キウイ。産毛の生えた茶色い楕円。割ると鮮やかな緑と種の輪 */
export const KIWI: StatueSpec = {
  id: 'kiwi',
  name: 'キウイ',
  style: STYLE_KIWI,
  profile: [0, 0.54, 0.78, 0.91, 0.975, 1.0, 0.975, 0.91, 0.78, 0.54, 0.2],
  bottom: -0.86,
  top: 0.86,
  scale: 0.66,
  lobes: 0,
  lobeDepth: 0,
  dents: [
    { y: 0.84, radius: 0.14, height: 0.08 },
    { y: -0.84, radius: 0.13, height: 0.07 },
  ],
  // 産毛のざらつき
  net: { scale: 24, height: 0.005, width: 0.48 },
  // 両端の小さなヘタ
  stems: [
    { a: [0, 0.76, 0], b: [0, 0.9, 0], radius: 0.032 },
    { a: [0, -0.9, 0], b: [0, -0.78, 0], radius: 0.028 },
  ],
  coreRadius: 0.22,
};

/** パイナップルの冠。中心から外へ広がる葉を並べる */
function pineappleCrown(): StemSpec[] {
  const crown: StemSpec[] = [];
  const base = 0.42;
  const rings: Array<[number, number, number, number]> = [
    // [枚数, 先の高さ, 外へ広がる量, 太さ]
    [7, 1.02, 0.3, 0.036],
    [6, 0.86, 0.46, 0.032],
    [5, 0.7, 0.56, 0.028],
  ];
  for (let ring = 0; ring < rings.length; ring++) {
    const [count, top, spread, radius] = rings[ring];
    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i) / count + ring * 0.55;
      crown.push({
        a: [0, base, 0],
        b: [Math.cos(angle) * spread, top, Math.sin(angle) * spread],
        radius,
      });
    }
  }
  return crown;
}

/**
 * 房1本ぶんの弧。
 * centerX は上端（140度の位置）がちょうど中心軸に来るように決めてある。
 * こうすると縦軸まわりに回しても、上は1か所に集まったまま下だけ広がる。
 */
const BANANA_ARC_RADIUS = 1.1;
const bananaArc: TubeSpec = {
  centerX: -BANANA_ARC_RADIUS * Math.cos((140 * Math.PI) / 180),
  centerY: 0,
  arcRadius: BANANA_ARC_RADIUS,
  fromDegrees: 140,
  toDegrees: 240,
  endRadius: 0.055,
  midRadius: 0.22,
  samples: 150,
};

/**
 * 房ぜんぶの向きと置き場所。
 * 大きく倒すと実が片側に寄るので、その分を戻して真ん中に置く。
 * 向きは、扇の開きが正面から見えるように決めてある。
 */
const BANANA_FACING = (130 * Math.PI) / 180;
const BANANA_REACH = 0.7;
const BANANA_SHIFT_Y = -0.25;
/** 付け根から out だけ離れた、房の向きに沿う場所 */
function bananaAt(out: number, y: number): Vec3 {
  const reach = BANANA_REACH + out;
  return [reach * Math.cos(BANANA_FACING), y, -reach * Math.sin(BANANA_FACING)];
}
const [bananaPlaceX, , bananaPlaceZ] = bananaAt(0, 0);
const bananaPlace = { shiftX: bananaPlaceX, shiftY: BANANA_SHIFT_Y, shiftZ: bananaPlaceZ };
/** へたの付け根の高さ。弧の上端がここに集まる */
const BANANA_JOINT_Y = BANANA_ARC_RADIUS * Math.sin((140 * Math.PI) / 180) + BANANA_SHIFT_Y;
const BANANA_SPIN = (BANANA_FACING * 180) / Math.PI;

/** バナナ。曲がった筒を3本まとめた房。皮の下は白い果肉 */
export const BANANA: StatueSpec = {
  id: 'banana',
  name: 'バナナ',
  style: STYLE_BANANA,
  profile: [],
  bottom: -0.86,
  top: 0.86,
  scale: 1,
  lobes: 0,
  lobeDepth: 0,
  dents: [],
  // 3本の房。上端はどれも一点で重なり、そこから大きく倒して扇形に広げる。
  // 狭い角度に並べるので、実どうしが軽く触れあって一房に見える。
  // まとまりが片側に寄るぶん、全体を横にずらして真ん中に置く
  tubes: [
    { ...bananaArc, toDegrees: 236, tiltDegrees: -60, spinDegrees: BANANA_SPIN - 36, ...bananaPlace },
    { ...bananaArc, toDegrees: 242, tiltDegrees: -63, spinDegrees: BANANA_SPIN, ...bananaPlace },
    { ...bananaArc, toDegrees: 238, tiltDegrees: -61, spinDegrees: BANANA_SPIN + 35, ...bananaPlace },
  ],
  // 房をまとめる太いへた。付け根は太く、先はすぼまる
  stems: [
    {
      a: bananaAt(-0.03, BANANA_JOINT_Y - 0.02),
      b: bananaAt(0.02, BANANA_JOINT_Y + 0.22),
      radius: 0.155,
    },
    {
      a: bananaAt(0.02, BANANA_JOINT_Y + 0.2),
      b: bananaAt(0.08, BANANA_JOINT_Y + 0.46),
      radius: 0.085,
    },
  ],
  coreRadius: 0.03,
  // 細いぶん空を切りやすいので、当たりは狭めつつ深く抜く
  hitScale: 94,
  hitPowerScale: 150,
};

/** パイナップル。ななめ格子の皮と葉の冠。中は黄色い果肉 */
export const PINEAPPLE: StatueSpec = {
  id: 'pineapple',
  name: 'パイナップル',
  style: STYLE_PINEAPPLE,
  profile: [0, 0.76, 0.93, 0.985, 1.0, 1.0, 1.0, 0.985, 0.93, 0.78, 0.4],
  bottom: -0.78,
  top: 0.44,
  scale: 0.58,
  lobes: 0,
  lobeDepth: 0,
  dents: [{ y: 0.44, radius: 0.16, height: 0.08 }],
  // ななめ格子のうろこ
  net: { scale: 0, height: 0.03, width: 0.36, diamond: true, columns: 15, rows: 9 },
  leafStems: pineappleCrown(),
  coreRadius: 0.2,
};

/** さくらんぼ。2つの実と、上でつながる細い柄 */
export const CHERRY: StatueSpec = {
  id: 'cherry',
  name: 'さくらんぼ',
  style: STYLE_CHERRY,
  profile: [],
  bottom: -0.78,
  top: 0.8,
  scale: 1,
  lobes: 0,
  lobeDepth: 0,
  dents: [],
  spheres: [
    { x: -0.31, y: -0.33, z: 0.04, r: 0.34 },
    { x: 0.33, y: -0.42, z: -0.06, r: 0.31 },
  ],
  stems: [
    { a: [-0.29, -0.08, 0.04], b: [0.01, 0.58, 0], radius: 0.022 },
    { a: [0.31, -0.18, -0.06], b: [0.01, 0.58, 0], radius: 0.022 },
    { a: [0.01, 0.55, 0], b: [0.03, 0.79, 0], radius: 0.03 },
  ],
  coreRadius: 0.03,
  hitScale: 80,
  hitPowerScale: 150,
};

export const STATUES: StatueSpec[] = [
  APPLE,
  MIKAN,
  MELON,
  KIWI,
  GRAPE,
  BANANA,
  PINEAPPLE,
  CHERRY,
];
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

function fract(value: number): number {
  return value - Math.floor(value);
}

/** ななめ格子のうろこ。溝の上で0、うろこの真ん中で1になる */
function diamondScale(spec: NetSpec, x: number, y: number, z: number): number {
  const columns = spec.columns ?? 14;
  const rows = spec.rows ?? 9;
  const around = (Math.atan2(z, x) / (2 * Math.PI)) * columns;
  const along = y * rows;
  const a = Math.abs(fract(around + along) - 0.5) * 2;
  const b = Math.abs(fract(around - along) - 0.5) * 2;
  const edge = Math.min(a, b);
  const width = spec.width;
  if (edge >= width) return 1;
  const t = edge / width;
  return t * t * (3 - 2 * t);
}

/** 網目の盛り上がり（0〜1）。筋の上でだけ1に近づく */
function netRidge(spec: NetSpec, x: number, y: number, z: number): number {
  if (spec.diamond) return diamondScale(spec, x, y, z);
  const n =
    valueNoise(x * spec.scale, y * spec.scale, z * spec.scale) * 0.65 +
    valueNoise(x * spec.scale * 2.1 + 31.7, y * spec.scale * 2.1, z * spec.scale * 2.1) * 0.35;
  const ridged = 1 - Math.abs(n * 2 - 1);
  const edge = spec.width;
  if (ridged <= edge) return 0;
  const t = (ridged - edge) / (1 - edge);
  return t * t * (3 - 2 * t);
}

/**
 * 房の粒を並べる。外周・内周・中心の柱の3つで組むので、
 * 見た目は粒の集まりでも、中身はきちんと詰まる。
 */
export function layoutBerries(bunch: BunchSpec): Berry[] {
  const list: Berry[] = [];
  const span = bunch.topY - bunch.bottomY;
  let seed = 0;
  const wobble = (): number => {
    seed++;
    return ((hash2(seed, 0x5f3a) & 1023) / 1023 - 0.5) * bunch.jitter;
  };
  const radiusAt = (t: number): number =>
    bunch.topRadius + (bunch.bottomRadius - bunch.topRadius) * t;

  // 中心の柱。房の中身を詰めて、途切れないようにする
  const step = bunch.topRadius * 0.62;
  for (let y = bunch.bottomY + step; y <= bunch.topY; y += step) {
    const t = (bunch.topY - y) / span;
    list.push({ x: wobble(), y: y + wobble(), z: wobble(), r: radiusAt(t) });
  }

  for (let level = 0; level < bunch.levels; level++) {
    const t = bunch.levels > 1 ? level / (bunch.levels - 1) : 0;
    const y = bunch.topY - t * span;
    const radius = radiusAt(t);
    const ring = bunch.spread * Math.pow(1 - 0.94 * t, 0.7);
    if (ring < radius * 0.6) continue;

    const count = Math.max(3, Math.round((2 * Math.PI * ring) / (radius * 1.75)));
    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i) / count + level * 0.7;
      const reach = ring + wobble();
      list.push({
        x: Math.cos(angle) * reach + wobble(),
        y: y + wobble(),
        z: Math.sin(angle) * reach + wobble(),
        r: radius,
      });
    }

    const inner = ring * 0.5;
    if (inner <= radius * 0.8) continue;
    const innerCount = Math.max(2, Math.round(count / 2));
    for (let i = 0; i < innerCount; i++) {
      const angle = (2 * Math.PI * i) / innerCount + level * 1.3;
      list.push({
        x: Math.cos(angle) * inner + wobble(),
        y: y + wobble(),
        z: Math.sin(angle) * inner + wobble(),
        r: radius,
      });
    }
  }
  return list;
}

/**
 * 曲がった筒を、つながった玉の列にほどく。
 * 弧を描いたあと、上端を支点に倒し、縦軸まわりに回して置く。
 */
export function layoutTube(tube: TubeSpec): Berry[] {
  const list: Berry[] = [];
  const from = (tube.fromDegrees * Math.PI) / 180;
  const to = (tube.toDegrees * Math.PI) / 180;
  const tilt = ((tube.tiltDegrees ?? 0) * Math.PI) / 180;
  const tiltCos = Math.cos(tilt);
  const tiltSin = Math.sin(tilt);
  const spin = ((tube.spinDegrees ?? 0) * Math.PI) / 180;
  const spinCos = Math.cos(spin);
  const spinSin = Math.sin(spin);
  const shiftX = tube.shiftX ?? 0;
  const shiftY = tube.shiftY ?? 0;
  const shiftZ = tube.shiftZ ?? 0;
  const headX = tube.centerX + tube.arcRadius * Math.cos(from);
  const headY = tube.centerY + tube.arcRadius * Math.sin(from);
  const last = Math.max(1, tube.samples - 1);
  for (let i = 0; i < tube.samples; i++) {
    const t = i / last;
    const angle = from + (to - from) * t;
    const taper = Math.pow(Math.sin(Math.PI * t), 0.55);
    const armX = tube.centerX + tube.arcRadius * Math.cos(angle) - headX;
    const armY = tube.centerY + tube.arcRadius * Math.sin(angle) - headY;
    const x = headX + armX * tiltCos - armY * tiltSin;
    const y = headY + armX * tiltSin + armY * tiltCos;
    list.push({
      x: x * spinCos + shiftX,
      y: y + shiftY,
      z: -x * spinSin + shiftZ,
      r: tube.endRadius + (tube.midRadius - tube.endRadius) * taper,
    });
  }
  return list;
}

/** その形が玉の集まりで作られるなら、その玉を集める */
export function collectSpheres(spec: StatueSpec): Berry[] | null {
  if (spec.bunch) return layoutBerries(spec.bunch);
  if (spec.tubes) return spec.tubes.flatMap((tube) => layoutTube(tube));
  if (spec.spheres) return spec.spheres.map((berry) => ({ ...berry }));
  return null;
}

/** 房の形をマスごとの値にしておく。粒ごとに囲みの中だけ回すので速い */
const BERRY_SCALE = 8192;

function buildBunchField(berries: Berry[]): Int16Array {
  const field = new Int16Array(VOXEL_COUNT).fill(-32768);
  const half = GRID / 2;
  const toVoxel = (unit: number): number => (unit + 1) * half;

  for (const berry of berries) {
    const minX = Math.max(0, Math.floor(toVoxel(berry.x - berry.r)));
    const maxX = Math.min(GRID - 1, Math.ceil(toVoxel(berry.x + berry.r)));
    const minY = Math.max(0, Math.floor(toVoxel(berry.y - berry.r)));
    const maxY = Math.min(GRID - 1, Math.ceil(toVoxel(berry.y + berry.r)));
    const minZ = Math.max(0, Math.floor(toVoxel(berry.z - berry.r)));
    const maxZ = Math.min(GRID - 1, Math.ceil(toVoxel(berry.z + berry.r)));

    for (let z = minZ; z <= maxZ; z++) {
      const dz = voxelToUnit(z) - berry.z;
      for (let y = minY; y <= maxY; y++) {
        const dy = voxelToUnit(y) - berry.y;
        const row = (z * GRID + y) * GRID;
        for (let x = minX; x <= maxX; x++) {
          const dx = voxelToUnit(x) - berry.x;
          const value = berry.r - Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (value <= 0) continue;
          const packed = Math.round(value * BERRY_SCALE);
          const index = row + x;
          if (packed > field[index]) field[index] = packed;
        }
      }
    }
  }
  return field;
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
  const spheres = collectSpheres(spec);
  const bunchField = spheres ? buildBunchField(spheres) : null;

  // へた・葉の当たり範囲は形ごとに決まるので、先に出しておく
  const rods: Array<{ stem: StemSpec; kind: number; low: number; high: number; reach: number }> =
    [];
  for (const [list, kind] of [
    [spec.stems, MATERIAL_STEM],
    [spec.leafStems, MATERIAL_LEAF],
  ] as const) {
    for (const stem of list ?? []) {
      rods.push({
        stem,
        kind,
        low: Math.min(stem.a[1], stem.b[1]) - stem.radius - 0.02,
        high: Math.max(stem.a[1], stem.b[1]) + stem.radius + 0.02,
        reach:
          Math.max(Math.hypot(stem.a[0], stem.a[2]), Math.hypot(stem.b[0], stem.b[2])) +
          stem.radius,
      });
    }
  }

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

        const index = base + x;
        // 本体。房で作る形は粒の集まり、そうでなければ回転体
        let field = bunchField
          ? bunchField[index] / BERRY_SCALE
          : bodyRadius * lobe[rowRadial + x] - r;
        let kind = MATERIAL_BODY;
        let onRidge = false;

        // 表面近くだけ網目を盛る。
        // 本体のない高さでは中心軸まわりの向きが定まらず、
        // 軸の上にごみが残るので、本体のあるところに限る。
        if (net && bodyRadius > 0 && field > -netBand && field < netBand) {
          const ridge = netRidge(net, nx, ny, nz);
          if (ridge > 0.42) onRidge = true;
          field += net.height * ridge;
        }

        // へこみを引く（房で作る形には使わない）
        for (let d = 0; d < spec.dents.length && !bunchField; d++) {
          const dent = spec.dents[d];
          const t = (ny - dent.y) / dent.height;
          const inside = 1 - t * t;
          if (inside <= 0) continue;
          const q = Math.sqrt((r * r) / (dent.radius * dent.radius) + (1 - inside));
          const cut = (q - 1) * dent.radius;
          if (cut < field) field = cut;
        }

        // へた・葉としてあつかう軸
        for (let s = 0; s < rods.length; s++) {
          const rod = rods[s];
          if (ny < rod.low || ny > rod.high || r > rod.reach) continue;
          const value = rod.stem.radius - distanceToSegment(nx, ny, nz, rod.stem.a, rod.stem.b);
          if (value > field) {
            field = value;
            kind = rod.kind;
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
