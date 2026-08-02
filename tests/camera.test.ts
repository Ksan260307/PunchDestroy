/**
 * 見まわすカメラの確認。
 * ここが正しければ、拡大しても狙った場所を殴れる。
 */

import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, OrbitCamera } from '../src/game/camera';

const W = 900;
const H = 600;

function made(): OrbitCamera {
  const camera = new OrbitCamera();
  camera.refresh(W, H);
  return camera;
}

describe('カメラの向き', () => {
  it('画面の中央から伸ばした線は中心を通る', () => {
    const camera = made();
    const ray = camera.rayFrom(W / 2, H / 2, W, H);
    // 視点から中心へ向かう向きと一致する
    const len = Math.hypot(camera.px, camera.py, camera.pz);
    expect(ray.dx).toBeCloseTo(-camera.px / len, 5);
    expect(ray.dy).toBeCloseTo(-camera.py / len, 5);
    expect(ray.dz).toBeCloseTo(-camera.pz / len, 5);
  });

  it('中心は画面の中央に写る', () => {
    const camera = made();
    const p = camera.project(0, 0, 0, W, H);
    expect(p.x).toBeCloseTo(W / 2, 3);
    expect(p.y).toBeCloseTo(H / 2, 3);
    expect(p.depth).toBeGreaterThan(0);
  });

  it('写した点をもう一度たどると、元の点へ戻る', () => {
    const camera = made();
    camera.yaw = 0.9;
    camera.pitch = -0.4;
    camera.refresh(W, H);
    const target = [0.3, 0.15, -0.2] as const;
    const p = camera.project(target[0], target[1], target[2], W, H);
    const ray = camera.rayFrom(p.x, p.y, W, H);
    const t = p.depth / (ray.dx * camera.fx + ray.dy * camera.fy + ray.dz * camera.fz);
    expect(ray.ox + ray.dx * t).toBeCloseTo(target[0], 4);
    expect(ray.oy + ray.dy * t).toBeCloseTo(target[1], 4);
    expect(ray.oz + ray.dz * t).toBeCloseTo(target[2], 4);
  });

  it('上を向くほど視点が高くなる', () => {
    const camera = made();
    camera.pitch = 0;
    camera.refresh(W, H);
    const low = camera.py;
    camera.pitch = 1.0;
    camera.refresh(W, H);
    expect(camera.py).toBeGreaterThan(low);
  });

  it('回しても視点は原点からの距離を保つ', () => {
    const camera = made();
    for (const yaw of [0, 1, 2, 3, 4]) {
      camera.yaw = yaw;
      camera.refresh(W, H);
      expect(Math.hypot(camera.px, camera.py, camera.pz)).toBeCloseTo(camera.distance, 5);
    }
  });
});

describe('画面の縦横比', () => {
  it('渡された縦横比をそのまま使う（描く側の実寸に合わせる）', () => {
    const camera = new OrbitCamera();
    // 画面は横長でも、実際に描いている面が正方形ならそちらに合わせる
    camera.refresh(1200, 600, 1);
    expect(camera.aspect).toBe(1);
    camera.refresh(1200, 600);
    expect(camera.aspect).toBeCloseTo(2, 5);
  });

  it('縦横比のぶんだけ横に広く写す（伸びない）', () => {
    const wide = new OrbitCamera();
    wide.refresh(1200, 600, 2);
    const square = new OrbitCamera();
    square.refresh(600, 600, 1);

    // 同じ大きさのものを、画面の短辺に対して同じ割合で写す
    const heightOf = (camera: OrbitCamera, w: number, h: number) => {
      const a = camera.project(0, 0, 0, w, h);
      const b = camera.project(0, 0.2, 0, w, h);
      return Math.abs(b.y - a.y) / h;
    };
    expect(heightOf(wide, 1200, 600)).toBeCloseTo(heightOf(square, 600, 600), 5);

    const widthOf = (camera: OrbitCamera, w: number, h: number) => {
      const a = camera.project(0, 0, 0, w, h);
      const b = camera.project(0.2, 0, 0, w, h);
      return Math.abs(b.x - a.x) / w;
    };
    // 横長の画面では、同じ幅のものは画面比で半分の割合になる
    expect(widthOf(wide, 1200, 600) * 2).toBeCloseTo(widthOf(square, 600, 600), 5);
  });

  it('おかしな縦横比は無視する', () => {
    const camera = new OrbitCamera();
    camera.refresh(900, 600, 0);
    expect(camera.aspect).toBe(1);
    camera.refresh(900, 600, Number.NaN);
    expect(camera.aspect).toBe(1);
  });

  it('狙いも同じ縦横比で計算される', () => {
    const camera = new OrbitCamera();
    camera.refresh(1200, 600, 1);
    // 実際に描いている面が正方形なら、画面の端でも狙いは正方形として扱う
    const ray = camera.rayFrom(1200, 300, 1200, 600);
    const ndc = 1 * camera.tanHalf * camera.aspect;
    const expected = camera.fx + camera.rx * ndc;
    expect(ray.dx / Math.hypot(ray.dx, ray.dy, ray.dz)).toBeCloseTo(
      expected / Math.hypot(expected, camera.fy, camera.fz + camera.rz * ndc),
      5,
    );
  });
});

describe('拡大', () => {
  it('決めた範囲より外へは出ない', () => {
    const camera = made();
    for (let i = 0; i < 80; i++) camera.zoomBy(1.5);
    camera.refresh(W, H);
    expect(camera.zoom).toBe(MAX_ZOOM);
    for (let i = 0; i < 200; i++) camera.zoomBy(0.7);
    camera.refresh(W, H);
    expect(camera.zoom).toBe(MIN_ZOOM);
  });

  it('拡大するほど、同じ大きさのものが大きく写る', () => {
    const camera = made();
    const size = () => {
      camera.refresh(W, H);
      const a = camera.project(0, 0, 0, W, H);
      const b = camera.project(0.1, 0, 0, W, H);
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
    const base = size();
    camera.zoom = 4;
    const mid = size();
    camera.zoom = MAX_ZOOM;
    const most = size();
    expect(mid).toBeGreaterThan(base * 3);
    expect(most).toBeGreaterThan(mid * 3);
    // 標準の 15 倍以上まで寄れる
    expect(most / base).toBeGreaterThan(15);
  });

  it('近づく限界まで来たら、そこからは画角を狭めて拡大する', () => {
    const camera = made();
    camera.zoom = MAX_ZOOM;
    camera.refresh(W, H);
    const closest = camera.distance;
    // 石像（半径1ほど）の中には入らない
    expect(closest).toBeGreaterThan(1.1);
    camera.zoom = 1;
    camera.refresh(W, H);
    expect(camera.distance).toBeGreaterThan(closest);
  });

  it('拡大中は同じ指の動きでもゆっくり回る', () => {
    const near = made();
    near.zoom = 1;
    near.refresh(W, H);
    const before = near.yaw;
    near.orbit(0.2, 0);
    const normal = Math.abs(near.yaw - before);

    const far = made();
    far.zoom = 16;
    far.refresh(W, H);
    const start = far.yaw;
    far.orbit(0.2, 0);
    expect(Math.abs(far.yaw - start)).toBeLessThan(normal / 3);
  });

  it('向きを戻すと最初の状態に戻る', () => {
    const camera = made();
    camera.yaw = 3;
    camera.pitch = 1;
    camera.zoom = 9;
    camera.reset();
    camera.refresh(W, H);
    expect(camera.zoom).toBe(1);
    expect(camera.pitch).toBeCloseTo(0.22, 5);
  });
});
