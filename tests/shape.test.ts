import { describe, expect, it } from 'vitest';
import {
  GRID,
  MATERIAL_BODY,
  MATERIAL_LEAF,
  MATERIAL_STEM,
  HIT_JAB,
  TOTAL_GRAINS,
  VOXEL_COUNT,
} from '../src/core/constants';
import {
  APPLE,
  DEFAULT_STATUE,
  GRAPE,
  KIWI,
  MELON,
  MIKAN,
  STATUES,
  STYLE_APPLE,
  STYLE_GRAPE,
  STYLE_KIWI,
  STYLE_MELON,
  STYLE_ORANGE,
  buildStatue,
  findSpec,
  getStatue,
  layoutBerries,
  materialKind,
  onNet,
  surfaceDepth,
  type StatueShape,
} from '../src/core/shape';
import { shapeFingerprint } from '../src/core/fingerprint';
import { hitParams } from '../src/core/rules';
import { createWorld, grainsRemaining, destroyedRatio, voxelIndex } from '../src/core/world';

function densityAt(shape: StatueShape, x: number, y: number, z: number): number {
  return shape.density[voxelIndex(x, y, z)];
}

function kindAt(shape: StatueShape, x: number, y: number, z: number): number {
  return materialKind(shape.material[voxelIndex(x, y, z)]);
}

/** ある高さでの、中身のあるマスの横幅 */
function widthAtHeight(shape: StatueShape, y: number): number {
  const c = GRID / 2;
  let width = 0;
  for (let x = 0; x < GRID; x++) {
    if (densityAt(shape, x, y, c) > 128) width++;
  }
  return width;
}

/** 中心軸上で、いちばん高い位置にある本体のマス */
function topOfAxis(shape: StatueShape, offset = 0): number {
  const c = GRID / 2;
  for (let y = GRID - 1; y >= 0; y--) {
    if (kindAt(shape, c + offset, y, c) === MATERIAL_BODY && densityAt(shape, c + offset, y, c) > 128) {
      return y;
    }
  }
  return -1;
}

describe('石像の並び', () => {
  it('選べるものがそろっている', () => {
    expect(STATUES.length).toBe(ALL_STATUES.length);
    for (const [, id] of ALL_STATUES) {
      expect(STATUES.map((spec) => spec.id)).toContain(id);
    }
    for (const spec of STATUES) {
      expect(spec.name.length).toBeGreaterThan(0);
    }
  });

  it('名前が重ならない', () => {
    expect(new Set(STATUES.map((spec) => spec.id)).size).toBe(STATUES.length);
  });

  it('知らない名前を渡しても既定のものになる', () => {
    expect(findSpec('しらないもの').id).toBe(DEFAULT_STATUE);
    expect(getStatue('しらないもの').id).toBe(DEFAULT_STATUE);
  });

  it('同じ名前なら作り直さず使い回す', () => {
    expect(getStatue('melon')).toBe(getStatue('melon'));
  });

  it('形ごとに指紋が違う', () => {
    const apple = getStatue('apple');
    const melon = getStatue('melon');
    expect(shapeFingerprint(melon.density, melon.material)).not.toBe(
      shapeFingerprint(apple.density, apple.material),
    );
  });
});

/** 輪郭からできている形（房でないもの） */
const ROUND_STATUES: Array<[string, string]> = [
  ['りんご', 'apple'],
  ['みかん', 'mikan'],
  ['メロン', 'melon'],
  ['キウイ', 'kiwi'],
];

const ALL_STATUES: Array<[string, string]> = [...ROUND_STATUES, ['ぶどう', 'grape']];

describe.each(ALL_STATUES)('%s の形', (_name, id) => {
  const shape = getStatue(id);

  it('中身のあるマスがそれなりの数ある', () => {
    // 房のように隙間の多い形もあるので幅は広めに見る
    expect(shape.filledCells).toBeGreaterThan(VOXEL_COUNT * 0.06);
    expect(shape.filledCells).toBeLessThan(VOXEL_COUNT * 0.5);
  });

  it('立体の隅は空いている', () => {
    expect(densityAt(shape, 0, 0, 0)).toBe(0);
    expect(densityAt(shape, GRID - 1, GRID - 1, GRID - 1)).toBe(0);
    expect(densityAt(shape, GRID - 1, 0, GRID - 1)).toBe(0);
  });

  it('中心は詰まっている', () => {
    const c = GRID / 2;
    expect(densityAt(shape, c, c, c)).toBeGreaterThan(200);
    expect(kindAt(shape, c, c, c)).toBe(MATERIAL_BODY);
    // 表面ではなく、きちんと内側にあること（粒の集まりは1粒ぶんの厚みしかない）
    expect(surfaceDepth(shape.material[voxelIndex(c, c, c)])).toBeGreaterThan(3);
  });

  it('本体と、へたか葉がある', () => {
    const kinds = new Set<number>();
    for (let i = 0; i < VOXEL_COUNT; i += 5) kinds.add(materialKind(shape.material[i]));
    expect(kinds.has(MATERIAL_BODY)).toBe(true);
    expect(kinds.has(MATERIAL_STEM) || kinds.has(MATERIAL_LEAF)).toBe(true);
  });

  it('何度作っても同じものになる', () => {
    const a = buildStatue(shape.spec);
    const b = buildStatue(shape.spec);
    expect(shapeFingerprint(a.density, a.material)).toBe(shapeFingerprint(b.density, b.material));
    expect(a.totalUnits).toBe(b.totalUnits);
  });

  it('残り量の合計と粒数の対応がとれている', () => {
    const world = createWorld(1, id);
    expect(world.statue.id).toBe(id);
    expect(world.totalUnits).toBe(shape.totalUnits);
    expect(world.grainsPerUnit).toBeGreaterThan(0);
    expect(grainsRemaining(world)).toBe(TOTAL_GRAINS);
    expect(destroyedRatio(world)).toBe(0);
  });

  it('すべて削れたら粒は0になる', () => {
    const world = createWorld(1, id);
    world.density.fill(0);
    world.remainingUnits = 0;
    expect(grainsRemaining(world)).toBe(0);
    expect(destroyedRatio(world)).toBe(1);
  });
});

describe.each(ROUND_STATUES)('%s の輪郭', (_name, id) => {
  const shape = getStatue(id);

  it('上下に向かうほど細い', () => {
    const middle = widthAtHeight(shape, Math.round(GRID * 0.45));
    const shoulder = widthAtHeight(shape, Math.round(GRID * 0.8));
    const bottom = widthAtHeight(shape, Math.round(GRID * 0.22));
    expect(middle).toBeGreaterThan(shoulder);
    expect(middle).toBeGreaterThan(bottom);
    expect(bottom).toBeGreaterThan(0);
  });

  it('上面はくぼんでいて、とがっていない', () => {
    // 中心軸より高いところが、軸から離れた場所にあること
    const axis = topOfAxis(shape);
    expect(axis).toBeGreaterThan(0);
    let highest = -1;
    for (let offset = 2; offset < GRID / 2; offset++) {
      highest = Math.max(highest, topOfAxis(shape, offset));
    }
    expect(highest).toBeGreaterThan(axis);
  });
});

describe('りんごならではのところ', () => {
  const shape = getStatue('apple');

  it('葉が付いている', () => {
    const kinds = new Set<number>();
    for (let i = 0; i < VOXEL_COUNT; i += 5) kinds.add(materialKind(shape.material[i]));
    expect(kinds.has(MATERIAL_LEAF)).toBe(true);
  });

  it('描き方はりんごの系統', () => {
    expect(shape.spec.style).toBe(STYLE_APPLE);
    expect(APPLE.net).toBeUndefined();
  });
});

describe('メロンならではのところ', () => {
  const melon = getStatue('melon');
  const apple = getStatue('apple');

  it('描き方はメロンの系統', () => {
    expect(melon.spec.style).toBe(STYLE_MELON);
    expect(MELON.net).toBeDefined();
  });

  it('葉は付いていない', () => {
    let leaves = 0;
    for (let i = 0; i < VOXEL_COUNT; i++) {
      if (materialKind(melon.material[i]) === MATERIAL_LEAF) leaves++;
    }
    expect(leaves).toBe(0);
  });

  it('りんごより丸い（縦と横の差が小さい）', () => {
    const ratio = (shape: StatueShape) => {
      const c = GRID / 2;
      let width = 0;
      let height = 0;
      for (let x = 0; x < GRID; x++) if (densityAt(shape, x, c, c) > 128) width++;
      for (let y = 0; y < GRID; y++) if (densityAt(shape, c, y, c) > 128) height++;
      return width / height;
    };
    expect(Math.abs(ratio(melon) - 1)).toBeLessThan(Math.abs(ratio(apple) - 1));
  });

  it('表面に網目の凹凸がある', () => {
    // 同じ高さの外周をなぞって、表面の位置がぎざぎざに変わることを見る
    const c = GRID / 2;
    const y = Math.round(GRID * 0.5);
    const edges: number[] = [];
    for (let z = c - 12; z <= c + 12; z += 2) {
      for (let x = GRID - 1; x >= 0; x--) {
        if (densityAt(melon, x, y, z) > 128) {
          edges.push(x);
          break;
        }
      }
    }
    const changes = edges.filter((value, i) => i > 0 && value !== edges[i - 1]).length;
    expect(changes).toBeGreaterThan(2);
  });

  it('網目の筋に印が付いている', () => {
    let marked = 0;
    let total = 0;
    for (let i = 0; i < VOXEL_COUNT; i++) {
      if (melon.density[i] === 0) continue;
      total++;
      if (onNet(melon.material[i])) marked++;
    }
    expect(marked).toBeGreaterThan(0);
    // 印が付くのは表面のごく一部だけ
    expect(marked).toBeLessThan(total * 0.2);
  });

  it('りんごには網目の印が付かない', () => {
    for (let i = 0; i < VOXEL_COUNT; i += 3) {
      if (apple.density[i] === 0) continue;
      expect(onNet(apple.material[i])).toBe(false);
    }
  });

  it('網目は表面の近くだけで、中身は詰まっている', () => {
    const c = GRID / 2;
    for (let x = c - 20; x <= c + 20; x++) {
      expect(densityAt(melon, x, c, c)).toBeGreaterThan(200);
    }
  });
});

describe('みかんならではのところ', () => {
  const mikan = getStatue('mikan');
  const apple = getStatue('apple');

  it('描き方はみかんの系統', () => {
    expect(mikan.spec.style).toBe(STYLE_ORANGE);
    expect(MIKAN.net).toBeDefined();
    expect(MIKAN.stems).toBeUndefined();
  });

  it('平たい（りんごより横に広い）', () => {
    const flatness = (shape: StatueShape) => {
      const c = GRID / 2;
      let width = 0;
      let height = 0;
      for (let x = 0; x < GRID; x++) if (densityAt(shape, x, c, c) > 128) width++;
      for (let y = 0; y < GRID; y++) if (densityAt(shape, c, y, c) > 128) height++;
      return width / height;
    };
    expect(flatness(mikan)).toBeGreaterThan(flatness(apple));
    expect(flatness(mikan)).toBeGreaterThan(1);
  });

  it('上にヘタが付いている', () => {
    let leaves = 0;
    for (let i = 0; i < VOXEL_COUNT; i++) {
      if (materialKind(mikan.material[i]) === MATERIAL_LEAF) leaves++;
    }
    expect(leaves).toBeGreaterThan(0);
  });

  it('上下ともくぼんでいる', () => {
    const c = GRID / 2;
    const bottomOfAxis = () => {
      for (let y = 0; y < GRID; y++) {
        if (densityAt(mikan, c, y, c) > 128) return y;
      }
      return -1;
    };
    let lowest = GRID;
    for (let offset = 2; offset < GRID / 2; offset++) {
      for (let y = 0; y < GRID; y++) {
        if (densityAt(mikan, c + offset, y, c) > 128) {
          lowest = Math.min(lowest, y);
          break;
        }
      }
    }
    expect(lowest).toBeLessThan(bottomOfAxis());
  });
});

describe('キウイならではのところ', () => {
  const kiwi = getStatue('kiwi');

  it('描き方はキウイの系統', () => {
    expect(kiwi.spec.style).toBe(STYLE_KIWI);
    expect(KIWI.net).toBeDefined();
    expect(KIWI.leaf).toBeUndefined();
  });

  it('縦に長い', () => {
    const c = GRID / 2;
    let width = 0;
    let height = 0;
    for (let x = 0; x < GRID; x++) if (densityAt(kiwi, x, c, c) > 128) width++;
    for (let y = 0; y < GRID; y++) if (densityAt(kiwi, c, y, c) > 128) height++;
    expect(height).toBeGreaterThan(width * 1.2);
  });

  it('上下の両端にヘタが付いている', () => {
    const c = GRID / 2;
    const kinds = { upper: 0, lower: 0 };
    for (let y = 0; y < GRID; y++) {
      if (materialKind(kiwi.material[voxelIndex(c, y, c)]) !== MATERIAL_STEM) continue;
      if (y > c) kinds.upper++;
      else kinds.lower++;
    }
    expect(kinds.upper).toBeGreaterThan(0);
    expect(kinds.lower).toBeGreaterThan(0);
  });

  it('芯はほかより細い（種の輪がその外側に来る）', () => {
    expect(KIWI.coreRadius).toBeLessThan(APPLE.coreRadius);
  });
});

describe('ぶどうならではのところ', () => {
  const grape = getStatue('grape');

  it('描き方はぶどうの系統で、房で作られている', () => {
    expect(grape.spec.style).toBe(STYLE_GRAPE);
    expect(GRAPE.bunch).toBeDefined();
    expect(GRAPE.net).toBeUndefined();
    expect(GRAPE.leaf).toBeUndefined();
  });

  it('粒がたくさん並ぶ', () => {
    const berries = layoutBerries(GRAPE.bunch!);
    expect(berries.length).toBeGreaterThan(40);
    for (const berry of berries) {
      expect(berry.r).toBeGreaterThan(0);
      expect(Math.hypot(berry.x, berry.z)).toBeLessThanOrEqual(GRAPE.bunch!.spread + 0.1);
      expect(berry.y).toBeLessThanOrEqual(GRAPE.bunch!.topY + 0.1);
      expect(berry.y).toBeGreaterThanOrEqual(GRAPE.bunch!.bottomY - 0.1);
    }
  });

  it('粒の並びは毎回同じ', () => {
    const a = layoutBerries(GRAPE.bunch!);
    const b = layoutBerries(GRAPE.bunch!);
    expect(b.map((berry) => `${berry.x},${berry.y},${berry.z},${berry.r}`)).toEqual(
      a.map((berry) => `${berry.x},${berry.y},${berry.z},${berry.r}`),
    );
  });

  it('上へ行くほど広く、下はすぼまる', () => {
    const upper = widthAtHeight(grape, Math.round(GRID * 0.62));
    const lower = widthAtHeight(grape, Math.round(GRID * 0.2));
    expect(upper).toBeGreaterThan(lower);
    expect(lower).toBeGreaterThan(0);
  });

  it('横から見ると粒の切れ目がある', () => {
    // 房の縁を縦になぞると、粒と粒のすきまで途切れる
    const c = GRID / 2;
    const x = c + Math.round(GRID * 0.16);
    let runs = 0;
    let inside = false;
    for (let y = 20; y < GRID - 20; y++) {
      const solid = densityAt(grape, x, y, c) > 128;
      if (solid && !inside) runs++;
      inside = solid;
    }
    expect(runs).toBeGreaterThan(1);
  });

  it('殴る範囲がほかより狭い（中身が少ないぶん）', () => {
    expect(GRAPE.hitScale).toBeLessThan(100);
    const world = createWorld(1, 'grape');
    const apple = createWorld(1, 'apple');
    expect(hitParams(world, HIT_JAB).radius).toBeLessThan(hitParams(apple, HIT_JAB).radius);
  });

  it('ラッシュの3倍は房でも変わらない', () => {
    const world = createWorld(1, 'grape');
    const normal = hitParams(world, HIT_JAB).radius;
    world.rushUntilStep = world.step + 10;
    expect(hitParams(world, HIT_JAB).radius).toBe(normal * 3);
  });
});
