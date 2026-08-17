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
  BANANA,
  CHERRY,
  DEFAULT_STATUE,
  GRAPE,
  KIWI,
  MELON,
  MIKAN,
  PINEAPPLE,
  STATUES,
  STYLE_APPLE,
  STYLE_BANANA,
  STYLE_CHERRY,
  STYLE_GRAPE,
  STYLE_KIWI,
  STYLE_MELON,
  STYLE_ORANGE,
  STYLE_PINEAPPLE,
  buildStatue,
  collectSpheres,
  findSpec,
  getStatue,
  layoutBerries,
  layoutTube,
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

/** ある高さでの、本体のマスの横幅（へたや葉は数えない） */
function widthAtHeight(shape: StatueShape, y: number): number {
  const c = GRID / 2;
  let width = 0;
  for (let x = 0; x < GRID; x++) {
    if (densityAt(shape, x, y, c) > 128 && kindAt(shape, x, y, c) === MATERIAL_BODY) width++;
  }
  return width;
}

/** 本体のマスがおさまる箱 */
function bodyBox(shape: StatueShape) {
  const box = { minX: GRID, maxX: -1, minY: GRID, maxY: -1, minZ: GRID, maxZ: -1 };
  for (let i = 0; i < VOXEL_COUNT; i++) {
    if (shape.density[i] <= 128) continue;
    if (materialKind(shape.material[i]) !== MATERIAL_BODY) continue;
    const x = i % GRID;
    const y = ((i / GRID) | 0) % GRID;
    const z = (i / (GRID * GRID)) | 0;
    if (x < box.minX) box.minX = x;
    if (x > box.maxX) box.maxX = x;
    if (y < box.minY) box.minY = y;
    if (y > box.maxY) box.maxY = y;
    if (z < box.minZ) box.minZ = z;
    if (z > box.maxZ) box.maxZ = z;
  }
  return box;
}

/** 本体のある高さの範囲。形ごとに背丈が違うので、割合で見るために使う */
function bodySpan(shape: StatueShape): [number, number] {
  let low = GRID;
  let high = -1;
  for (let y = 0; y < GRID; y++) {
    if (widthAtHeight(shape, y) === 0) continue;
    if (y < low) low = y;
    high = y;
  }
  return [low, high];
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

/** 輪郭を回して作る形（粒を並べて作る形は含めない） */
const ROUND_STATUES: Array<[string, string]> = [
  ['りんご', 'apple'],
  ['みかん', 'mikan'],
  ['メロン', 'melon'],
  ['キウイ', 'kiwi'],
  ['パイナップル', 'pineapple'],
];

const ALL_STATUES: Array<[string, string]> = [
  ...ROUND_STATUES,
  ['ぶどう', 'grape'],
  ['バナナ', 'banana'],
  ['さくらんぼ', 'cherry'],
];

describe.each(ALL_STATUES)('%s の形', (_name, id) => {
  const shape = getStatue(id);

  it('中身のあるマスがそれなりの数ある', () => {
    // 房や細長い形もあるので幅は広めに見る
    expect(shape.filledCells).toBeGreaterThan(VOXEL_COUNT * 0.02);
    expect(shape.filledCells).toBeLessThan(VOXEL_COUNT * 0.5);
  });

  it('立体の隅は空いている', () => {
    expect(densityAt(shape, 0, 0, 0)).toBe(0);
    expect(densityAt(shape, GRID - 1, GRID - 1, GRID - 1)).toBe(0);
    expect(densityAt(shape, GRID - 1, 0, GRID - 1)).toBe(0);
  });

  it('中身が詰まっている', () => {
    // 中心が空いている形（さくらんぼは実と実のあいだ）もあるので、
    // 中心そのものではなく「内側と呼べるマスがあるか」を見る
    let solid = 0;
    let deepest = 0;
    for (let i = 0; i < VOXEL_COUNT; i++) {
      if (shape.density[i] <= 200) continue;
      if (materialKind(shape.material[i]) !== MATERIAL_BODY) continue;
      solid++;
      const depth = surfaceDepth(shape.material[i]);
      if (depth > deepest) deepest = depth;
    }
    expect(solid).toBeGreaterThan(VOXEL_COUNT * 0.01);
    // 表面ではなく、きちんと内側があること
    expect(deepest).toBeGreaterThan(3);
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
    // 背丈は形ごとに違うので、本体の範囲を割合で見る
    const [low, high] = bodySpan(shape);
    const at = (ratio: number) => widthAtHeight(shape, Math.round(low + (high - low) * ratio));
    const middle = at(0.45);
    const shoulder = at(0.85);
    const bottom = at(0.15);
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

describe('バナナならではのところ', () => {
  const banana = getStatue('banana');

  it('描き方はバナナの系統で、曲がった筒で作られている', () => {
    expect(banana.spec.style).toBe(STYLE_BANANA);
    expect(BANANA.tubes).toHaveLength(3);
    expect(BANANA.net).toBeUndefined();
    expect(BANANA.bunch).toBeUndefined();
  });

  it('筒は弧に沿って並び、両端が細くなる', () => {
    for (const tube of BANANA.tubes!) {
      const parts = layoutTube(tube);
      expect(parts.length).toBe(tube.samples);
      const middle = parts[Math.floor(parts.length / 2)];
      expect(middle.r).toBeGreaterThan(parts[0].r);
      expect(middle.r).toBeGreaterThan(parts[parts.length - 1].r);

      // 倒したり回したりしても弧の形は変わらない。
      // 上端からの直線距離が、弧の弦の長さと合うことで確かめる
      const span = ((tube.toDegrees - tube.fromDegrees) * Math.PI) / 180;
      const last = parts.length - 1;
      for (let i = 0; i <= last; i++) {
        const chord = 2 * tube.arcRadius * Math.sin((span * i) / last / 2);
        const distance = Math.hypot(
          parts[i].x - parts[0].x,
          parts[i].y - parts[0].y,
          parts[i].z - parts[0].z,
        );
        expect(Math.abs(distance - chord)).toBeLessThan(0.01);
      }
    }
  });

  it('3本の上端が中心軸のひとところに集まる', () => {
    for (const tube of BANANA.tubes!) {
      const head = layoutTube(tube)[0];
      expect(Math.hypot(head.x, head.z)).toBeLessThan(0.01);
      expect(head.y).toBeGreaterThan(0.6);
    }
  });

  it('筒の並びは毎回同じで、3本ぶんが集まる', () => {
    const parts = collectSpheres(BANANA)!;
    const expected = BANANA.tubes!.flatMap((tube) => layoutTube(tube));
    expect(parts.map((p) => `${p.x},${p.y},${p.z},${p.r}`)).toEqual(
      expected.map((p) => `${p.x},${p.y},${p.z},${p.r}`),
    );
    expect(parts.length).toBe(BANANA.tubes!.reduce((sum, tube) => sum + tube.samples, 0));
  });

  it('上でまとまり、下へ向かって外へ広がる', () => {
    // 高さごとに、中心軸からいちばん遠い本体のマスを見る
    const c = GRID / 2;
    const reachAt = (y: number) => {
      let far = 0;
      for (let x = 0; x < GRID; x++) {
        for (let z = 0; z < GRID; z++) {
          if (densityAt(banana, x, y, z) <= 128) continue;
          if (kindAt(banana, x, y, z) !== MATERIAL_BODY) continue;
          far = Math.max(far, Math.hypot(x - c, z - c));
        }
      }
      return far;
    };
    const box = bodyBox(banana);
    const at = (ratio: number) => reachAt(Math.round(box.minY + (box.maxY - box.minY) * ratio));
    expect(at(0.98)).toBeLessThan(at(0.55));
    expect(at(0.55)).toBeGreaterThan(GRID * 0.2);
  });

  it('横に切ると3本に分かれている', () => {
    // 房の高さで中心軸のまわりを一周なぞると、3か所で実に当たる
    const c = GRID / 2;
    const box = bodyBox(banana);
    const y = Math.round(box.minY + (box.maxY - box.minY) * 0.45);
    // いちばん実を長くなぞれる輪で数える（かすめただけの輪は当てにならない）
    let bestSolid = 0;
    let runsThere = 0;
    for (let radius = 10; radius < c; radius += 1) {
      const ring: boolean[] = [];
      for (let i = 0; i < 360; i++) {
        const angle = (2 * Math.PI * i) / 360;
        const x = Math.round(c + Math.cos(angle) * radius);
        const z = Math.round(c + Math.sin(angle) * radius);
        ring.push(densityAt(banana, x, y, z) > 128 && kindAt(banana, x, y, z) === MATERIAL_BODY);
      }
      const solid = ring.filter(Boolean).length;
      if (solid <= bestSolid) continue;
      bestSolid = solid;
      runsThere = 0;
      for (let i = 0; i < ring.length; i++) {
        if (ring[i] && !ring[(i + ring.length - 1) % ring.length]) runsThere++;
      }
    }
    expect(bestSolid).toBeGreaterThan(0);
    expect(runsThere).toBe(3);
  });

  it('1本ずつは弓なりに反っている', () => {
    for (const tube of BANANA.tubes!) {
      const parts = layoutTube(tube);
      const head = parts[0];
      const tail = parts[parts.length - 1];
      const middle = parts[Math.floor(parts.length / 2)];
      // 両端を結んだ線の真ん中から、弧までの隔たり。まっすぐなら0になる
      const sagitta = Math.hypot(
        middle.x - (head.x + tail.x) / 2,
        middle.y - (head.y + tail.y) / 2,
        middle.z - (head.z + tail.z) / 2,
      );
      const span = ((tube.toDegrees - tube.fromDegrees) * Math.PI) / 180;
      expect(Math.abs(sagitta - tube.arcRadius * (1 - Math.cos(span / 2)))).toBeLessThan(0.02);
      expect(sagitta).toBeGreaterThan(0.3);
    }
  });

  it('房をまとめるへたが上に付いている', () => {
    const box = bodyBox(banana);
    let above = 0;
    for (let i = 0; i < VOXEL_COUNT; i++) {
      if (materialKind(banana.material[i]) !== MATERIAL_STEM) continue;
      if (((i / GRID) | 0) % GRID > box.maxY) above++;
    }
    expect(above).toBeGreaterThan(0);
  });
});

describe('パイナップルならではのところ', () => {
  const pineapple = getStatue('pineapple');

  it('描き方はパイナップルの系統で、ななめ格子を持つ', () => {
    expect(pineapple.spec.style).toBe(STYLE_PINEAPPLE);
    expect(PINEAPPLE.net?.diamond).toBe(true);
    expect(PINEAPPLE.stems).toBeUndefined();
  });

  it('うろこに印が付いていて、印は一部だけ', () => {
    let marked = 0;
    let total = 0;
    for (let i = 0; i < VOXEL_COUNT; i++) {
      if (pineapple.density[i] === 0) continue;
      total++;
      if (onNet(pineapple.material[i])) marked++;
    }
    expect(marked).toBeGreaterThan(0);
    expect(marked).toBeLessThan(total * 0.5);
  });

  it('葉の冠が本体の上に立っている', () => {
    expect(PINEAPPLE.leafStems!.length).toBeGreaterThan(10);
    const box = bodyBox(pineapple);
    let above = 0;
    for (let i = 0; i < VOXEL_COUNT; i++) {
      if (materialKind(pineapple.material[i]) !== MATERIAL_LEAF) continue;
      if (((i / GRID) | 0) % GRID > box.maxY) above++;
    }
    expect(above).toBeGreaterThan(100);
  });

  it('本体が決められた高さにおさまる（中心軸の上下にごみが出ない）', () => {
    // ななめ格子は中心軸のまわりで向きが定まらないので、
    // 本体のない高さまで盛ると軸の上に点が残ってしまう
    const toVoxel = (world: number) => (world + 1) * 0.5 * GRID;
    const box = bodyBox(pineapple);
    expect(box.maxY).toBeLessThanOrEqual(toVoxel(PINEAPPLE.top) + 1);
    expect(box.minY).toBeGreaterThanOrEqual(toVoxel(PINEAPPLE.bottom) - 1);
  });

  it('寸胴（胴の太さが上下であまり変わらない）', () => {
    const [low, high] = bodySpan(pineapple);
    const at = (ratio: number) => widthAtHeight(pineapple, Math.round(low + (high - low) * ratio));
    const waist = at(0.5);
    expect(Math.abs(at(0.35) - waist)).toBeLessThan(waist * 0.12);
    expect(Math.abs(at(0.65) - waist)).toBeLessThan(waist * 0.12);
    // キウイのように細長くはない
    expect(waist).toBeGreaterThan((high - low) * 0.8);
  });
});

describe('さくらんぼならではのところ', () => {
  const cherry = getStatue('cherry');

  it('描き方はさくらんぼの系統で、玉を並べて作られている', () => {
    expect(cherry.spec.style).toBe(STYLE_CHERRY);
    expect(CHERRY.spheres!.length).toBe(2);
    expect(CHERRY.bunch).toBeUndefined();
    expect(CHERRY.tubes).toBeUndefined();
    expect(CHERRY.net).toBeUndefined();
  });

  it('玉の並びをそのまま使う', () => {
    const parts = collectSpheres(CHERRY)!;
    expect(parts.map((p) => `${p.x},${p.y},${p.z},${p.r}`)).toEqual(
      CHERRY.spheres!.map((p) => `${p.x},${p.y},${p.z},${p.r}`),
    );
    // 元の並びを書き換えないこと
    parts[0].r = 99;
    expect(CHERRY.spheres![0].r).not.toBe(99);
  });

  it('実がふたつ、くびれてつながっている', () => {
    // 左右に切ったときの断面の大きさを見ると、山がふたつできる
    const mass = new Array<number>(GRID).fill(0);
    for (let i = 0; i < VOXEL_COUNT; i++) {
      if (cherry.density[i] <= 128) continue;
      if (materialKind(cherry.material[i]) !== MATERIAL_BODY) continue;
      mass[i % GRID]++;
    }
    const half = GRID / 2;
    const peakOf = (from: number, to: number) => {
      let best = from;
      for (let x = from; x < to; x++) if (mass[x] > mass[best]) best = x;
      return best;
    };
    const left = peakOf(0, half);
    const right = peakOf(half, GRID);
    let waist = Infinity;
    for (let x = left + 1; x < right; x++) waist = Math.min(waist, mass[x]);
    expect(mass[left]).toBeGreaterThan(0);
    expect(mass[right]).toBeGreaterThan(0);
    expect(waist).toBeLessThan(Math.min(mass[left], mass[right]) * 0.5);
  });

  it('柄がY字に伸びて上でひとつになる', () => {
    expect(CHERRY.stems!.length).toBe(3);
    const [first, second, trunk] = CHERRY.stems!;
    // 2本の先が同じところに集まり、そこから1本が上へ伸びる
    expect(first.b).toEqual(second.b);
    expect(trunk.a[1]).toBeLessThan(trunk.b[1]);
    expect(Math.hypot(trunk.a[0] - first.b[0], trunk.a[1] - first.b[1])).toBeLessThan(0.1);

    const box = bodyBox(cherry);
    let above = 0;
    for (let i = 0; i < VOXEL_COUNT; i++) {
      if (materialKind(cherry.material[i]) !== MATERIAL_STEM) continue;
      if (((i / GRID) | 0) % GRID > box.maxY) above++;
    }
    expect(above).toBeGreaterThan(0);
  });
});
