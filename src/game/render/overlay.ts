/**
 * 合図の文字と、画面全体の明滅を重ねる層。
 * 立体表示が使えるかどうかに関わらず、ここは常に同じ。
 */

import type { OrbitCamera } from '../camera';
import type { EffectSystem } from '../effects';

export class OverlayLayer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private ratio = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('描画領域を用意できません');
    this.ctx = ctx;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.ratio = pixelRatio;
    const w = Math.max(1, Math.round(width * pixelRatio));
    const h = Math.max(1, Math.round(height * pixelRatio));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  render(fx: EffectSystem, camera: OrbitCamera): void {
    const ctx = this.ctx;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    if (fx.rushGlow > 0.02) {
      const gradient = ctx.createRadialGradient(
        this.width / 2,
        this.height / 2,
        Math.min(this.width, this.height) * 0.22,
        this.width / 2,
        this.height / 2,
        Math.max(this.width, this.height) * 0.7,
      );
      gradient.addColorStop(0, 'rgba(255,150,40,0)');
      gradient.addColorStop(1, `rgba(255,120,30,${(0.42 * fx.rushGlow).toFixed(3)})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    if (fx.flash > 0.01) {
      ctx.globalAlpha = Math.min(0.28, fx.flash * 0.2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.globalAlpha = 1;
    }

    const small = Math.min(this.width, this.height) < 620 ? 0.74 : 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const text of fx.texts) {
      const t = text.life / text.maxLife;
      let x: number;
      let y: number;
      let scale = 1;
      if (text.inWorld) {
        const p = camera.project(text.wx, text.wy, text.wz, this.width, this.height);
        if (p.depth <= 0.01) continue;
        x = p.x;
        y = p.y;
        scale = Math.min(1.3, Math.max(0.6, p.scale / (this.height * 0.4)));
      } else {
        x = text.sx * this.width;
        y = text.sy * this.height;
      }
      const pop = t > 0.82 ? 1 + (1 - t) * 3.4 : 1;
      const size = text.size * pop * scale * small;
      ctx.globalAlpha = Math.min(1, t * 2.6);
      ctx.font = `900 ${size}px "Arial Black", "Hiragino Sans", "Yu Gothic", sans-serif`;
      ctx.lineWidth = Math.max(3, size * 0.16);
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineJoin = 'round';
      ctx.strokeText(text.text, x + fx.shakeX, y + fx.shakeY);
      ctx.fillStyle = text.color;
      ctx.fillText(text.text, x + fx.shakeX, y + fx.shakeY);
    }
    ctx.globalAlpha = 1;
  }
}
