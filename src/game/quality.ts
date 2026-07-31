/**
 * 実測の描画速度を見て、演出の量と解像度を調整する。
 *
 * ここで測った値はゲームの進行には一切渡さない。
 * 重い端末で演出が減っても、壊れ方も点数もまったく同じになる。
 */

import { QUALITY_LEVELS, type QualityBudget } from './effects';

export class PerformanceWatch {
  private average = 60;
  private hold = 0;
  private index = QUALITY_LEVELS.length - 1;

  get fps(): number {
    return this.average;
  }

  get level(): number {
    return this.index;
  }

  get budget(): QualityBudget {
    return QUALITY_LEVELS[this.index];
  }

  /** 端末の解像度をどこまで使うか */
  get pixelRatio(): number {
    const device = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    if (this.index >= 2) return Math.min(device, 2);
    if (this.index === 1) return Math.min(device, 1.5);
    return 1;
  }

  sample(dt: number): void {
    if (dt <= 0 || dt > 0.5) return;
    const fps = 1 / dt;
    this.average += (fps - this.average) * 0.06;

    if (this.hold > 0) {
      this.hold -= dt;
      return;
    }
    if (this.average < 44 && this.index > 0) {
      this.index--;
      this.hold = 2.5;
    } else if (this.average > 57 && this.index < QUALITY_LEVELS.length - 1) {
      this.index++;
      this.hold = 4;
    }
  }

  reset(): void {
    this.average = 60;
    this.hold = 0;
    this.index = QUALITY_LEVELS.length - 1;
  }
}
