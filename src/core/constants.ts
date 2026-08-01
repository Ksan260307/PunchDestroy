/**
 * 計算部分の共通定数。
 *
 * 石像は立体のマス目（ボクセル）ごとの「残り量」だけで持つ。
 * 粒を1つずつ持つのではなく、残り量1あたり何千粒という換算で
 * 見た目上の粒数を作るので、1兆個の破壊を数MBで扱える。
 */

/** 立体のマス目の一辺 */
export const GRID = 128;
export const GRID_AREA = GRID * GRID;
export const VOXEL_COUNT = GRID * GRID * GRID;

/** まとめ処理の単位。空の区画は描画も計算も丸ごと飛ばす */
export const BLOCK_SIZE = 8;
export const BLOCKS = GRID / BLOCK_SIZE;
export const BLOCK_COUNT = BLOCKS * BLOCKS * BLOCKS;

/** 1マスに詰まっている量の上限 */
export const MAX_DENSITY = 255;
/** ここを超えていれば中身が詰まっているとみなす */
export const SOLID_THRESHOLD = 128;

/** 画面に出す「粒の総数」 */
export const TOTAL_GRAINS = 1_000_000_000_000;

/** 計算の刻み。実時間とは切り離し、常にこの一定間隔で進める */
export const STEPS_PER_SECOND = 60;
export const STEP_MS = 1000 / STEPS_PER_SECOND;

/** 連打が途切れたと見なすまでの猶予 */
export const COMBO_WINDOW_STEPS = 50;
/** ラッシュ（強化状態）に入る連打数 */
export const RUSH_COMBO = 30;
/** ラッシュの持続 */
export const RUSH_STEPS = 110;
/** ラッシュ中は殴る範囲がこの倍率になる */
export const RUSH_RADIUS_SCALE = 3;
/**
 * ラッシュ中の威力（%）。
 * 範囲が3倍＝体積が27倍になるので、深さと減衰でならして
 * 「広く薄くえぐる」当たりにしている。
 */
export const RUSH_POWER_PERCENT = 130;
/** ラッシュ中の減衰の強さ。中心は深く、ふちへ向かって浅くなる */
export const RUSH_SHARPNESS = 3;

/** マスの材質 */
export const MATERIAL_EMPTY = 0;
export const MATERIAL_BODY = 1;
export const MATERIAL_STEM = 2;
export const MATERIAL_LEAF = 3;

/** 区画の状態 */
export const BLOCK_INTACT = 0;
export const BLOCK_DAMAGED = 1;
export const BLOCK_COLLAPSING = 2;
export const BLOCK_GONE = 3;

/** 残りが何%を切ったらその区画が自壊し始めるか */
export const COLLAPSE_PERCENT = 14;
/** 全体の残りが何%を切ったら総崩れに入るか */
export const FINALE_PERCENT = 10;

/** 打撃の種類 */
export const HIT_JAB = 0;
export const HIT_SMASH = 1;

/** 打撃の基本性能（半径はマス数、威力は残り量の単位） */
export const JAB_RADIUS = 8;
export const JAB_POWER = 460;
export const SMASH_RADIUS = 13;
export const SMASH_POWER = 1000;

/** 残り量がこれ未満になったマスは空にする（薄皮を残さない） */
export const CRUMB_DENSITY = 10;
