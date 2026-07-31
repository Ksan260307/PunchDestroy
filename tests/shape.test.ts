import { describe, expect, it } from 'vitest';
import {
  GRID,
  MATERIAL_BODY,
  MATERIAL_LEAF,
  MATERIAL_STEM,
  TOTAL_GRAINS,
  VOXEL_COUNT,
} from '../src/core/constants';
import { buildStatueShape, getStatueShape, materialKind, surfaceDepth } from '../src/core/shape';
import { shapeFingerprint } from '../src/core/fingerprint';
import { createWorld, grainsRemaining, destroyedRatio, voxelIndex } from '../src/core/world';

const shape = getStatueShape();

function densityAt(x: number, y: number, z: number): number {
  return shape.density[voxelIndex(x, y, z)];
}

function kindAt(x: number, y: number, z: number): number {
  return materialKind(shape.material[voxelIndex(x, y, z)]);
}

describe('石像の形', () => {
  it('中身のあるマスがそれなりの数ある', () => {
    expect(shape.filledCells).toBeGreaterThan(VOXEL_COUNT * 0.15);
    expect(shape.filledCells).toBeLessThan(VOXEL_COUNT * 0.5);
  });

  it('立体の隅は空いている', () => {
    expect(densityAt(0, 0, 0)).toBe(0);
    expect(densityAt(GRID - 1, GRID - 1, GRID - 1)).toBe(0);
    expect(densityAt(GRID - 1, 0, GRID - 1)).toBe(0);
  });

  it('中心は詰まっている', () => {
    const c = GRID / 2;
    expect(densityAt(c, c, c)).toBeGreaterThan(200);
    expect(kindAt(c, c, c)).toBe(MATERIAL_BODY);
  });

  it('本体・軸・葉がそろっている', () => {
    const kinds = new Set<number>();
    for (let i = 0; i < VOXEL_COUNT; i += 7) kinds.add(materialKind(shape.material[i]));
    expect(kinds.has(MATERIAL_BODY)).toBe(true);
    expect(kinds.has(MATERIAL_STEM)).toBe(true);
    expect(kinds.has(MATERIAL_LEAF)).toBe(true);
  });

  it('上下に向かうほど細い（リンゴの輪郭になっている）', () => {
    const middle = widthAtHeight(Math.round(GRID * 0.45));
    const shoulder = widthAtHeight(Math.round(GRID * 0.78));
    const bottom = widthAtHeight(Math.round(GRID * 0.2));
    expect(middle).toBeGreaterThan(shoulder);
    expect(middle).toBeGreaterThan(bottom);
    expect(bottom).toBeGreaterThan(0);
  });

  it('上面はくぼんでいて、とがっていない', () => {
    const c = GRID / 2;
    // 中心軸のいちばん上にある本体のマスを探す
    let topOfAxis = -1;
    for (let y = GRID - 1; y >= 0; y--) {
      if (kindAt(c, y, c) === MATERIAL_BODY && densityAt(c, y, c) > 128) {
        topOfAxis = y;
        break;
      }
    }
    // 中心から少し外れたところのほうが高くなっている（＝ふちが立っている）
    let topOfRim = -1;
    const offset = Math.round(GRID * 0.18);
    for (let y = GRID - 1; y >= 0; y--) {
      if (kindAt(c + offset, y, c) === MATERIAL_BODY && densityAt(c + offset, y, c) > 128) {
        topOfRim = y;
        break;
      }
    }
    expect(topOfAxis).toBeGreaterThan(0);
    expect(topOfRim).toBeGreaterThan(topOfAxis);
  });

  it('表面からの深さが詰め込まれている', () => {
    const c = GRID / 2;
    expect(surfaceDepth(shape.material[voxelIndex(c, c, c)])).toBeGreaterThan(20);
  });

  it('何度作っても同じものになる', () => {
    const a = buildStatueShape();
    const b = buildStatueShape();
    expect(shapeFingerprint(a.density, a.material)).toBe(shapeFingerprint(b.density, b.material));
    expect(a.totalUnits).toBe(b.totalUnits);
  });

  it('残り量の合計と粒数の対応がとれている', () => {
    const world = createWorld(1);
    expect(world.totalUnits).toBe(shape.totalUnits);
    expect(world.grainsPerUnit).toBeGreaterThan(0);
    expect(grainsRemaining(world)).toBe(TOTAL_GRAINS);
    expect(destroyedRatio(world)).toBe(0);
  });

  it('すべて削れたら粒は0になる', () => {
    const world = createWorld(1);
    world.density.fill(0);
    world.remainingUnits = 0;
    expect(grainsRemaining(world)).toBe(0);
    expect(destroyedRatio(world)).toBe(1);
  });
});

/** ある高さでの、中身のあるマスの横幅 */
function widthAtHeight(y: number): number {
  const c = GRID / 2;
  let width = 0;
  for (let x = 0; x < GRID; x++) {
    if (densityAt(x, y, c) > 128) width++;
  }
  return width;
}
