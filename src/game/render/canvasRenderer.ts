/**
 * 立体表示が使えない環境向けの描画。
 *
 * 同じ考え方の線たどりを、粗い解像度で計算して拡大して貼る。
 * 見た目は控えめだが、どの角度からでも遊べる。
 */

import { BLOCKS, GRID, MATERIAL_LEAF, MATERIAL_STEM, SOLID_THRESHOLD } from '../../core/constants';
import { materialKind, surfaceDepth } from '../../core/shape';
import type { OrbitCamera } from '../camera';
import type { RenderFrame, Renderer } from './types';

const BOUND = 1.06;
const VOXEL = 2 / GRID;
const COARSE = 2 / BLOCKS;

export class CanvasRenderer implements Renderer {
  readonly kind = 'canvas' as const;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly surface: HTMLCanvasElement;
  private readonly surfaceCtx: CanvasRenderingContext2D;
  private image: ImageData;
  private innerW = 0;
  private innerH = 0;
  private width = 1;
  private height = 1;
  private ratio = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('描画領域を用意できません');
    this.ctx = ctx;
    this.surface = document.createElement('canvas');
    const surfaceCtx = this.surface.getContext('2d', { alpha: true });
    if (!surfaceCtx) throw new Error('描画領域を用意できません');
    this.surfaceCtx = surfaceCtx;
    this.image = surfaceCtx.createImageData(1, 1);
    this.setInternalSize(150, 150);
  }

  private setInternalSize(w: number, h: number): void {
    if (this.innerW === w && this.innerH === h) return;
    this.innerW = w;
    this.innerH = h;
    this.surface.width = w;
    this.surface.height = h;
    this.image = this.surfaceCtx.createImageData(w, h);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.ratio = Math.min(pixelRatio, 2);
    const w = Math.max(1, Math.round(width * this.ratio));
    const h = Math.max(1, Math.round(height * this.ratio));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const longest = Math.max(width, height);
    const factor = Math.min(0.26, 150 / Math.max(1, longest));
    this.setInternalSize(
      Math.max(64, Math.round(width * factor)),
      Math.max(64, Math.round(height * factor)),
    );
  }

  invalidate(): void {
    /* 毎回描き直しているので合図は要らない */
  }

  markDirty(): void {
    /* 同上 */
  }

  render(frame: RenderFrame): void {
    const ctx = this.ctx;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    this.march(frame);
    this.surfaceCtx.putImageData(this.image, 0, 0);

    const fx = frame.fx;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.surface, fx.shakeX, fx.shakeY, this.width, this.height);

    this.drawParticles(frame);
  }

  /** 粗い解像度で線をたどる */
  private march(frame: RenderFrame): void {
    const { view, camera } = frame;
    const density = view.density;
    const meta = view.material;
    const blocks = view.blockRemaining;
    const data = this.image.data;
    const innerW = this.innerW;
    const innerH = this.innerH;
    const tanY = camera.tanHalf * frame.fx.zoom;
    const tanX = tanY * camera.aspect;

    for (let py = 0; py < innerH; py++) {
      const ndcY = 1 - ((py + 0.5) / innerH) * 2;
      for (let px = 0; px < innerW; px++) {
        const out = (py * innerW + px) * 4;
        const ndcX = ((px + 0.5) / innerW) * 2 - 1;

        let dx = camera.fx + camera.rx * ndcX * tanX + camera.ux * ndcY * tanY;
        let dy = camera.fy + camera.ry * ndcX * tanX + camera.uy * ndcY * tanY;
        let dz = camera.fz + camera.rz * ndcX * tanX + camera.uz * ndcY * tanY;
        const len = Math.hypot(dx, dy, dz) || 1;
        dx /= len;
        dy /= len;
        dz /= len;

        const ox = camera.px;
        const oy = camera.py;
        const oz = camera.pz;
        const b = ox * dx + oy * dy + oz * dz;
        const c = ox * ox + oy * oy + oz * oz - BOUND * BOUND;
        const disc = b * b - c;
        if (disc <= 0) {
          data[out + 3] = 0;
          continue;
        }
        const root = Math.sqrt(disc);
        let t = Math.max(-b - root, 0);
        const tEnd = -b + root;

        let hitIndex = -1;
        let guard = 0;
        while (t < tEnd && guard++ < 400) {
          const x = ox + dx * t;
          const y = oy + dy * t;
          const z = oz + dz * t;
          const bx = ((x + 1) * 0.5 * BLOCKS) | 0;
          const by = ((y + 1) * 0.5 * BLOCKS) | 0;
          const bz = ((z + 1) * 0.5 * BLOCKS) | 0;
          if (
            bx < 0 ||
            by < 0 ||
            bz < 0 ||
            bx >= BLOCKS ||
            by >= BLOCKS ||
            bz >= BLOCKS ||
            blocks[(bz * BLOCKS + by) * BLOCKS + bx] <= 0
          ) {
            t += COARSE * 0.34;
            continue;
          }
          const vx = ((x + 1) * 0.5 * GRID) | 0;
          const vy = ((y + 1) * 0.5 * GRID) | 0;
          const vz = ((z + 1) * 0.5 * GRID) | 0;
          const index = (vz * GRID + vy) * GRID + vx;
          if (density[index] >= SOLID_THRESHOLD) {
            hitIndex = index;
            break;
          }
          t += VOXEL * 0.8;
        }

        if (hitIndex < 0) {
          data[out + 3] = 0;
          continue;
        }

        const vx = hitIndex % GRID;
        const vy = ((hitIndex / GRID) | 0) % GRID;
        const vz = (hitIndex / (GRID * GRID)) | 0;
        const gx = sample(density, vx + 1, vy, vz) - sample(density, vx - 1, vy, vz);
        const gy = sample(density, vx, vy + 1, vz) - sample(density, vx, vy - 1, vz);
        const gz = sample(density, vx, vy, vz + 1) - sample(density, vx, vy, vz - 1);
        const glen = Math.hypot(gx, gy, gz) || 1;
        const nx = -gx / glen;
        const ny = -gy / glen;
        const nz = -gz / glen;

        const ndl = Math.max(0, nx * -0.42 + ny * 0.78 + nz * 0.46);
        const sky = 0.5 + 0.5 * ny;
        const ambient = 0.34 + 0.42 * sky;
        const light = ambient + ndl;

        const packed = meta[hitIndex];
        const kind = materialKind(packed);
        const depth = surfaceDepth(packed);
        let r: number;
        let g: number;
        let bl: number;
        if (kind === MATERIAL_STEM) {
          r = 0.46;
          g = 0.33;
          bl = 0.2;
        } else if (kind === MATERIAL_LEAF) {
          r = 0.34;
          g = 0.58;
          bl = 0.28;
        } else if (depth <= 2) {
          r = 0.84;
          g = 0.14;
          bl = 0.17;
        } else if (depth > 20) {
          r = 0.9;
          g = 0.6;
          bl = 0.22;
        } else {
          r = 0.58;
          g = 0.57;
          bl = 0.6;
        }

        data[out] = clamp255(r * light * 255);
        data[out + 1] = clamp255(g * light * 255);
        data[out + 2] = clamp255(bl * light * 255);
        data[out + 3] = 255;
      }
    }
  }

  private drawParticles(frame: RenderFrame): void {
    const ctx = this.ctx;
    const fx = frame.fx;
    const camera: OrbitCamera = frame.camera;
    for (let i = 0; i < fx.count; i++) {
      const fade = fx.life[i] / fx.maxLife[i];
      const alpha = fade > 0.55 ? 1 : fade / 0.55;
      if (alpha <= 0.03) continue;
      const p = camera.project(fx.px[i], fx.py[i], fx.pz[i], this.width, this.height);
      if (p.depth <= 0.01) continue;
      const size = Math.max(1, fx.size[i] * p.scale * (0.5 + 0.5 * fade));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgb(${clamp255(fx.cr[i] * 255)},${clamp255(fx.cg[i] * 255)},${clamp255(fx.cb[i] * 255)})`;
      ctx.fillRect(p.x + fx.shakeX - size / 2, p.y + fx.shakeY - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  dispose(): void {
    /* 解放するものはない */
  }
}

function sample(density: Uint8Array, x: number, y: number, z: number): number {
  if (x < 0 || y < 0 || z < 0 || x >= GRID || y >= GRID || z >= GRID) return 0;
  return density[(z * GRID + y) * GRID + x];
}

function clamp255(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value | 0;
}
