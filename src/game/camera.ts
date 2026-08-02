/**
 * 石像を見まわすためのカメラ。
 *
 * これは完全に表示側の持ち物。ここをどう動かしても進行は変わらない。
 * 殴る位置だけは、ここから伸ばした線が当たったマス座標として記録される。
 */

export interface Ray {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
}

export interface Projected {
  x: number;
  y: number;
  depth: number;
  scale: number;
}

const MIN_PITCH = -1.35;
const MAX_PITCH = 1.35;

/** 標準の引き具合 */
const BASE_DISTANCE = 4.6;
/** これ以上は近づかない（近づきすぎて中に入らないため） */
const MIN_DISTANCE = 1.35;
const MAX_DISTANCE = 7.5;

/**
 * 拡大はまず「近づく」ことで、それ以上は「画角を狭める」ことで進める。
 * 石像の中へ入り込まずに、細かいところまで大きく見られる。
 */
export const MIN_ZOOM = 0.62;
export const MAX_ZOOM = 18;
/** 近づくだけで届く倍率。これを超えたら画角を狭めていく */
const PULL_LIMIT = BASE_DISTANCE / MIN_DISTANCE;

export class OrbitCamera {
  yaw = 0.55;
  pitch = 0.22;
  /** 1 が標準。大きいほど拡大 */
  zoom = 1;
  fov = (34 * Math.PI) / 180;

  private spinYaw = 0;
  private spinPitch = 0;
  private kickYaw = 0;
  private kickPitch = 0;

  /** 視点の位置 */
  px = 0;
  py = 0;
  pz = 0;
  /** 前・右・上の向き */
  fx = 0;
  fy = 0;
  fz = 0;
  rx = 1;
  ry = 0;
  rz = 0;
  ux = 0;
  uy = 1;
  uz = 0;

  tanHalf = Math.tan(this.fov / 2);
  aspect = 1;
  distance = BASE_DISTANCE;

  /** いまの拡大倍率（標準を 1 とする見かけの大きさ） */
  get magnification(): number {
    return this.zoom;
  }

  /**
   * 見え方を作り直す。
   * `aspect` は実際に描いている面の縦横比。端末が描画面を切り詰めることがあるので、
   * 画面の大きさから決めうちにせず、描く側から受け取る。
   */
  refresh(width: number, height: number, aspect = width / Math.max(1, height)): void {
    this.aspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;

    const zoom = clamp(this.zoom, MIN_ZOOM, MAX_ZOOM);
    this.zoom = zoom;
    this.distance = clamp(BASE_DISTANCE / zoom, MIN_DISTANCE, MAX_DISTANCE);
    // 近づける限界を超えたぶんは画角を狭めて拡大する
    const narrow = zoom > PULL_LIMIT ? PULL_LIMIT / zoom : 1;
    this.tanHalf = Math.tan(this.fov / 2) * narrow;

    const yaw = this.yaw + this.kickYaw;
    const pitch = clamp(this.pitch + this.kickPitch, MIN_PITCH, MAX_PITCH);
    const cp = Math.cos(pitch);
    const dirX = cp * Math.sin(yaw);
    const dirY = Math.sin(pitch);
    const dirZ = cp * Math.cos(yaw);

    this.px = dirX * this.distance;
    this.py = dirY * this.distance;
    this.pz = dirZ * this.distance;

    this.fx = -dirX;
    this.fy = -dirY;
    this.fz = -dirZ;

    // 右 = 前 × 上（世界の上は Y+）
    let rx = -this.fz;
    let rz = this.fx;
    const rlen = Math.hypot(rx, rz) || 1;
    rx /= rlen;
    rz /= rlen;
    this.rx = rx;
    this.ry = 0;
    this.rz = rz;

    // 上 = 右 × 前
    this.ux = this.ry * this.fz - this.rz * this.fy;
    this.uy = this.rz * this.fx - this.rx * this.fz;
    this.uz = this.rx * this.fy - this.ry * this.fx;
  }

  /** 指の動きで回す。拡大しているほどゆっくり回して狙いを付けやすくする */
  orbit(dx: number, dy: number): void {
    const slow = 1 / Math.max(1, Math.sqrt(this.zoom));
    const ax = dx * slow;
    const ay = dy * slow;
    this.yaw -= ax;
    this.pitch = clamp(this.pitch + ay, MIN_PITCH, MAX_PITCH);
    this.spinYaw = -ax * 12;
    this.spinPitch = ay * 12;
  }

  zoomBy(factor: number): void {
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  }

  /** 殴った反動でわずかに揺らす */
  kick(strength: number, dirX: number, dirY: number): void {
    this.kickYaw += dirX * strength;
    this.kickPitch += dirY * strength;
  }

  update(dt: number): void {
    // 指を離したあとの惰性
    this.yaw -= this.spinYaw * dt;
    this.pitch = clamp(this.pitch + this.spinPitch * dt, MIN_PITCH, MAX_PITCH);
    const friction = Math.exp(-4.5 * dt);
    this.spinYaw *= friction;
    this.spinPitch *= friction;
    if (Math.abs(this.spinYaw) < 0.0004) this.spinYaw = 0;
    if (Math.abs(this.spinPitch) < 0.0004) this.spinPitch = 0;

    const settle = Math.exp(-11 * dt);
    this.kickYaw *= settle;
    this.kickPitch *= settle;
  }

  stopSpin(): void {
    this.spinYaw = 0;
    this.spinPitch = 0;
  }

  reset(): void {
    this.yaw = 0.55;
    this.pitch = 0.22;
    this.zoom = 1;
    this.distance = BASE_DISTANCE;
    this.spinYaw = 0;
    this.spinPitch = 0;
    this.kickYaw = 0;
    this.kickPitch = 0;
  }

  /** 画面上の点から伸びる線 */
  rayFrom(sx: number, sy: number, width: number, height: number): Ray {
    const ndcX = (sx / width) * 2 - 1;
    const ndcY = 1 - (sy / height) * 2;
    const ax = ndcX * this.tanHalf * this.aspect;
    const ay = ndcY * this.tanHalf;
    let dx = this.fx + this.rx * ax + this.ux * ay;
    let dy = this.fy + this.ry * ax + this.uy * ay;
    let dz = this.fz + this.rz * ax + this.uz * ay;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    return { ox: this.px, oy: this.py, oz: this.pz, dx, dy, dz };
  }

  /** 立体の中の点を画面上の位置へ */
  project(x: number, y: number, z: number, width: number, height: number): Projected {
    const vx = x - this.px;
    const vy = y - this.py;
    const vz = z - this.pz;
    const depth = vx * this.fx + vy * this.fy + vz * this.fz;
    if (depth <= 0.001) return { x: -9999, y: -9999, depth, scale: 0 };
    const ndcX = (vx * this.rx + vy * this.ry + vz * this.rz) / (depth * this.tanHalf * this.aspect);
    const ndcY = (vx * this.ux + vy * this.uy + vz * this.uz) / (depth * this.tanHalf);
    return {
      x: ((ndcX + 1) / 2) * width,
      y: ((1 - ndcY) / 2) * height,
      depth,
      scale: height / (2 * depth * this.tanHalf),
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
