/**
 * 見た目の演出だけを担当する。
 *
 * ここは実時間で動き、実測フレームレートに合わせて量を減らす。
 * 状態には一切書き戻さないので、演出をいくら間引いても
 * ゲームの進行そのものは1ミリも変わらない。
 */

import { GRID, MATERIAL_LEAF, MATERIAL_STEM } from '../core/constants';
import { DisplayRandom } from '../core/random';
import type { StepReport } from '../core/rules';
import { materialKind, surfaceDepth } from '../core/shape';
import type { WorldView } from '../core/view';
import { blockBounds, toUnit } from '../core/world';

export interface QualityBudget {
  /** 同時に出せる破片の上限 */
  particles: number;
  /** 1発あたりの破片数の倍率 */
  burstScale: number;
  /** 光や残光を出すか */
  glow: boolean;
  /** 描画の細かさ（1 が等倍） */
  renderScale: number;
}

export const QUALITY_LEVELS: QualityBudget[] = [
  { particles: 700, burstScale: 0.3, glow: false, renderScale: 0.55 },
  { particles: 1800, burstScale: 0.65, glow: true, renderScale: 0.75 },
  { particles: 3600, burstScale: 1, glow: true, renderScale: 1 },
];

export interface FloatingText {
  /** 画面に対する位置（0..1）。世界に貼りつける場合は使わない */
  sx: number;
  sy: number;
  /** 世界の中の位置 */
  wx: number;
  wy: number;
  wz: number;
  inWorld: boolean;
  rise: number;
  life: number;
  maxLife: number;
  size: number;
  text: string;
  color: string;
}

/** 殴った直後の熱。石像の表面を光らせるのに使う */
export const MAX_GLOW_POINTS = 8;

const PARTICLE_STRIDE = 8;

export class EffectSystem {
  private readonly rng = new DisplayRandom(0x51ed270b);

  readonly capacity: number;
  count = 0;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly size: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly cr: Float32Array;
  readonly cg: Float32Array;
  readonly cb: Float32Array;
  readonly hot: Float32Array;

  /** 描画に渡す詰め直し済みの配列 */
  readonly instances: Float32Array;

  readonly texts: FloatingText[] = [];

  /** 光る点（位置3つ＋強さ） */
  readonly glowPoints = new Float32Array(MAX_GLOW_POINTS * 4);
  private glowCursor = 0;

  shakeX = 0;
  shakeY = 0;
  shakePower = 0;
  /** 総崩れ直前の、絶えず続く震え（0〜1） */
  tremor = 0;
  zoom = 1;
  flash = 0;
  freeze = 0;
  rushGlow = 0;

  quality: QualityBudget = QUALITY_LEVELS[2];
  /** 画面の揺れや明滅の強さ。端末の「視差効果を減らす」設定に合わせて下げる */
  motionScale = 1;

  private comboText: FloatingText | null = null;
  private breakStep = -999;
  private breakCount = 0;

  constructor(capacity = 3600) {
    this.capacity = capacity;
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.pz = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.cr = new Float32Array(capacity);
    this.cg = new Float32Array(capacity);
    this.cb = new Float32Array(capacity);
    this.hot = new Float32Array(capacity);
    this.instances = new Float32Array(capacity * PARTICLE_STRIDE);
  }

  reset(): void {
    this.count = 0;
    this.texts.length = 0;
    this.comboText = null;
    this.breakStep = -999;
    this.breakCount = 0;
    this.glowPoints.fill(0);
    this.glowCursor = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.shakePower = 0;
    this.tremor = 0;
    this.zoom = 1;
    this.flash = 0;
    this.freeze = 0;
    this.rushGlow = 0;
  }

  private get limit(): number {
    return Math.min(this.capacity, this.quality.particles);
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    life: number,
    r: number,
    g: number,
    b: number,
    hot: number,
  ): void {
    const limit = this.limit;
    let i: number;
    if (this.count < limit) {
      i = this.count++;
    } else {
      i = (this.rng.next() * limit) | 0;
    }
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.cr[i] = r;
    this.cg[i] = g;
    this.cb[i] = b;
    this.hot[i] = this.quality.glow ? hot : 0;
  }

  /** 進行結果を受け取って、その回に出す演出を仕込む */
  onStep(report: StepReport, view: WorldView): void {
    for (let i = 0; i < report.hits.length; i++) {
      const hit = report.hits[i];
      this.onHit(hit.x, hit.y, hit.z, hit.radius, hit.removed, hit.kind === 1, view);
      // 乱打の追い打ちも、小さめに散らす
      for (let e = 0; e + 2 < hit.echoes.length; e += 3) {
        this.onEcho(hit.echoes[e], hit.echoes[e + 1], hit.echoes[e + 2], hit.echoRadius, view);
      }
    }

    if (report.hits.length > 0 && report.combo >= 5 && report.combo % 5 === 0) {
      this.pushCombo(report.combo);
      this.flash = Math.min(1, this.flash + 0.08);
    }

    if (report.barrageStarted) {
      this.flash = Math.min(1, this.flash + 0.2 * this.motionScale);
      this.shakePower = Math.max(this.shakePower, 20);
    }

    if (report.collapsing.length > 0) {
      const limit = Math.max(1, Math.round(3 * this.quality.burstScale));
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      for (let i = 0; i < report.collapsing.length; i++) {
        const bounds = blockBounds(report.collapsing[i]);
        sumX += toUnit((bounds.x0 + bounds.x1) / 2);
        sumY += toUnit((bounds.y0 + bounds.y1) / 2);
        sumZ += toUnit((bounds.z0 + bounds.z1) / 2);
        if (i < limit) this.burstBlock(report.collapsing[i], view);
      }
      const count = report.collapsing.length;
      this.shakePower = Math.min(48, this.shakePower + 8 + count * 3);
      this.freeze = Math.max(this.freeze, 0.05);
      this.breakCount += count;
      if (report.step - this.breakStep > 24) {
        const big = this.breakCount >= 5;
        this.pushWorldText(
          sumX / count,
          sumY / count + 0.12,
          sumZ / count,
          big ? 'BREAK!!' : 'CRASH!',
          big ? 40 : 30,
          big ? '#e8344f' : '#f2762a',
        );
        this.breakStep = report.step;
        this.breakCount = 0;
      }
    }

    if (report.finaleStarted) {
      this.pushScreenText(0.5, 0.3, '崩れる……！', 50, '#c92a3f');
      this.tremor = Math.max(this.tremor, 0.22);
    }
    if (report.finaleShaking) {
      this.tremor = Math.min(1, this.tremor + 0.014);
      this.shakeDust(view);
    }

    if (report.rushStarted) {
      this.flash = Math.max(this.flash, 0.6);
      this.shakePower = Math.max(this.shakePower, 22);
      this.rushGlow = 1;
      this.pushScreenText(0.5, 0.24, 'ラッシュ！', 58, '#f0a020');
    }
    if (report.cleared) {
      this.flash = 1;
      this.shakePower = 44;
      this.freeze = Math.max(this.freeze, 0.24);
    }
  }

  private materialColor(view: WorldView, x: number, y: number, z: number): [number, number, number] {
    const index = (z * GRID + y) * GRID + x;
    const packed = view.material[index];
    const kind = materialKind(packed);
    if (kind === MATERIAL_STEM) return [0.42, 0.29, 0.16];
    if (kind === MATERIAL_LEAF) return [0.3, 0.6, 0.24];
    if (surfaceDepth(packed) <= 2) return [0.84, 0.16, 0.18];
    const radius = Math.hypot(toUnit(x), toUnit(y) + 0.03, toUnit(z));
    if (radius < 0.42) return [1, 0.66, 0.2];
    return [0.62, 0.6, 0.62];
  }

  private onHit(
    vx: number,
    vy: number,
    vz: number,
    radius: number,
    removed: number,
    heavy: boolean,
    view: WorldView,
  ): void {
    const wx = toUnit(vx);
    const wy = toUnit(vy);
    const wz = toUnit(vz);
    const worldRadius = (radius / GRID) * 2;
    const [r, g, b] = this.materialColor(view, vx, vy, vz);
    const strength = Math.min(1, removed / 700000);
    const chunks = Math.round((heavy ? 44 : 24) * (0.5 + strength) * this.quality.burstScale);

    for (let i = 0; i < chunks; i++) {
      const dir = this.randomDirection();
      const speed = this.rng.range(0.25, 1.5) * (heavy ? 1.5 : 1);
      const tint = this.rng.range(0.78, 1.22);
      this.spawn(
        wx + dir[0] * worldRadius * 0.5,
        wy + dir[1] * worldRadius * 0.5,
        wz + dir[2] * worldRadius * 0.5,
        dir[0] * speed,
        dir[1] * speed + this.rng.range(0.1, 0.7),
        dir[2] * speed,
        this.rng.range(0.008, 0.03) * (heavy ? 1.5 : 1),
        this.rng.range(0.5, 1.3),
        r * tint,
        g * tint,
        b * tint,
        0,
      );
    }

    const sparks = Math.round((heavy ? 24 : 13) * this.quality.burstScale);
    for (let i = 0; i < sparks; i++) {
      const dir = this.randomDirection();
      const speed = this.rng.range(0.8, 3.0);
      this.spawn(
        wx,
        wy,
        wz,
        dir[0] * speed,
        dir[1] * speed,
        dir[2] * speed,
        this.rng.range(0.005, 0.014),
        this.rng.range(0.14, 0.42),
        1,
        this.rng.range(0.72, 0.95),
        this.rng.range(0.25, 0.5),
        1,
      );
    }

    this.addGlow(wx, wy, wz, heavy ? 1.15 : 0.85);

    this.shakePower = Math.min(44, this.shakePower + (heavy ? 18 : 7) * (0.6 + strength));
    this.zoom = Math.min(1.045, this.zoom + (heavy ? 0.02 : 0.01) * this.motionScale);
    this.flash = Math.min(1, this.flash + (heavy ? 0.12 : 0.045) * this.motionScale);
    this.freeze = Math.max(this.freeze, (heavy ? 0.07 : 0.026) * this.motionScale);
  }

  private randomDirection(): [number, number, number] {
    const z = this.rng.range(-1, 1);
    const a = this.rng.range(0, Math.PI * 2);
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    return [Math.cos(a) * s, z, Math.sin(a) * s];
  }

  /** 崩れ落ちる区画から破片をまき散らす */
  private burstBlock(block: number, view: WorldView): void {
    const bounds = blockBounds(block);
    const count = Math.round(60 * this.quality.burstScale);
    for (let i = 0; i < count; i++) {
      const x = Math.min(bounds.x1, Math.round(this.rng.range(bounds.x0, bounds.x1 + 1)));
      const y = Math.min(bounds.y1, Math.round(this.rng.range(bounds.y0, bounds.y1 + 1)));
      const z = Math.min(bounds.z1, Math.round(this.rng.range(bounds.z0, bounds.z1 + 1)));
      const index = (z * GRID + y) * GRID + x;
      if (view.origin[index] === 0) continue;
      const [r, g, b] = this.materialColor(view, x, y, z);
      this.spawn(
        toUnit(x),
        toUnit(y),
        toUnit(z),
        this.rng.range(-0.5, 0.5),
        this.rng.range(-0.2, 0.9),
        this.rng.range(-0.5, 0.5),
        this.rng.range(0.012, 0.05),
        this.rng.range(0.8, 1.9),
        r,
        g,
        b,
        0,
      );
    }
  }

  /** 乱打の追い打ち。本体より小ぶりに散らす */
  private onEcho(
    vx: number,
    vy: number,
    vz: number,
    radius: number,
    view: WorldView,
  ): void {
    const wx = toUnit(vx);
    const wy = toUnit(vy);
    const wz = toUnit(vz);
    const [r, g, b] = this.materialColor(view, vx, vy, vz);
    const chunks = Math.round(14 * this.quality.burstScale);
    for (let i = 0; i < chunks; i++) {
      const dir = this.randomDirection();
      const speed = this.rng.range(0.3, 1.4);
      this.spawn(
        wx,
        wy,
        wz,
        dir[0] * speed,
        dir[1] * speed + this.rng.range(0.1, 0.5),
        dir[2] * speed,
        this.rng.range(0.006, 0.02),
        this.rng.range(0.3, 0.9),
        r,
        g,
        b,
        0,
      );
    }
    const sparks = Math.round(8 * this.quality.burstScale);
    for (let i = 0; i < sparks; i++) {
      const dir = this.randomDirection();
      const speed = this.rng.range(0.8, 2.4);
      this.spawn(
        wx,
        wy,
        wz,
        dir[0] * speed,
        dir[1] * speed,
        dir[2] * speed,
        this.rng.range(0.004, 0.011),
        this.rng.range(0.1, 0.3),
        1,
        this.rng.range(0.7, 0.95),
        this.rng.range(0.2, 0.45),
        1,
      );
    }
    this.addGlow(wx, wy, wz, 0.7);
    this.shakePower = Math.min(44, this.shakePower + 4);
    void radius;
  }

  /** 震えている間、まだ残っている区画からぱらぱらと粉が落ちる */
  private shakeDust(view: WorldView): void {
    const count = Math.round((1 + this.tremor * 5) * this.quality.burstScale);
    const blocks = view.blockRemaining;
    for (let i = 0; i < count; i++) {
      const block = (this.rng.next() * blocks.length) | 0;
      if (blocks[block] <= 0) continue;
      const bounds = blockBounds(block);
      const x = toUnit(this.rng.range(bounds.x0, bounds.x1 + 1));
      const y = toUnit(this.rng.range(bounds.y0, bounds.y1 + 1));
      const z = toUnit(this.rng.range(bounds.z0, bounds.z1 + 1));
      this.spawn(
        x,
        y,
        z,
        this.rng.range(-0.06, 0.06),
        this.rng.range(-0.3, -0.05),
        this.rng.range(-0.06, 0.06),
        this.rng.range(0.004, 0.012),
        this.rng.range(0.5, 1.2),
        0.66,
        0.64,
        0.66,
        0,
      );
    }
  }

  private addGlow(x: number, y: number, z: number, strength: number): void {
    const slot = this.glowCursor % MAX_GLOW_POINTS;
    this.glowCursor++;
    const o = slot * 4;
    this.glowPoints[o] = x;
    this.glowPoints[o + 1] = y;
    this.glowPoints[o + 2] = z;
    this.glowPoints[o + 3] = strength;
  }

  pushScreenText(sx: number, sy: number, text: string, size: number, color: string): FloatingText {
    if (this.texts.length > 8) this.texts.shift();
    const item: FloatingText = {
      sx,
      sy,
      wx: 0,
      wy: 0,
      wz: 0,
      inWorld: false,
      rise: 0.05,
      life: 0.9,
      maxLife: 0.9,
      size,
      text,
      color,
    };
    this.texts.push(item);
    return item;
  }

  pushWorldText(
    wx: number,
    wy: number,
    wz: number,
    text: string,
    size: number,
    color: string,
  ): FloatingText {
    if (this.texts.length > 8) this.texts.shift();
    const item: FloatingText = {
      sx: 0,
      sy: 0,
      wx,
      wy,
      wz,
      inWorld: true,
      rise: 0.35,
      life: 0.8,
      maxLife: 0.8,
      size,
      text,
      color,
    };
    this.texts.push(item);
    return item;
  }

  private pushCombo(combo: number): void {
    const current = this.comboText;
    if (current && this.texts.includes(current)) {
      current.text = `${combo} COMBO`;
      current.color = comboColor(combo);
      current.life = current.maxLife;
      current.size = Math.min(52, current.size + 2);
      return;
    }
    this.comboText = this.pushScreenText(0.5, 0.15, `${combo} COMBO`, 34, comboColor(combo));
  }

  update(dt: number): void {
    const drag = Math.exp(-2.4 * dt);
    const gravity = 2.2 * dt;

    let alive = 0;
    for (let i = 0; i < this.count; i++) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      const vx = this.vx[i] * drag;
      const vy = this.vy[i] * drag - gravity;
      const vz = this.vz[i] * drag;
      const x = this.px[i] + vx * dt;
      const y = this.py[i] + vy * dt;
      const z = this.pz[i] + vz * dt;
      if (y < -3) continue;

      if (alive !== i) this.copyParticle(i, alive);
      this.px[alive] = x;
      this.py[alive] = y;
      this.pz[alive] = z;
      this.vx[alive] = vx;
      this.vy[alive] = vy;
      this.vz[alive] = vz;
      this.life[alive] = life;
      alive++;
    }
    this.count = alive;

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.texts.splice(i, 1);
        continue;
      }
      if (t.inWorld) t.wy += t.rise * dt;
      else t.sy -= t.rise * dt;
    }

    this.shakePower *= Math.exp(-7 * dt);
    if (this.shakePower < 0.05) this.shakePower = 0;
    this.tremor *= Math.exp(-1.1 * dt);
    if (this.tremor < 0.004) this.tremor = 0;
    const angle = this.rng.range(0, Math.PI * 2);
    // 震えは細かく速い揺れ。打撃の揺れとは別に足す
    const buzz = this.tremor * this.tremor * 16;
    const shake = (this.shakePower + buzz) * this.motionScale;
    this.shakeX = Math.cos(angle) * shake;
    this.shakeY = Math.sin(angle) * shake;

    this.zoom += (1 - this.zoom) * Math.min(1, dt * 9);
    this.flash *= Math.exp(-7.5 * dt);
    this.rushGlow *= Math.exp(-1.6 * dt);

    const cool = Math.exp(-2.2 * dt);
    for (let i = 0; i < MAX_GLOW_POINTS; i++) {
      this.glowPoints[i * 4 + 3] *= cool;
    }
  }

  private copyParticle(from: number, to: number): void {
    this.size[to] = this.size[from];
    this.maxLife[to] = this.maxLife[from];
    this.cr[to] = this.cr[from];
    this.cg[to] = this.cg[from];
    this.cb[to] = this.cb[from];
    this.hot[to] = this.hot[from];
  }

  /** 描画用に詰め直す。戻り値は使う要素数 */
  packInstances(): number {
    const data = this.instances;
    for (let i = 0; i < this.count; i++) {
      const fade = this.life[i] / this.maxLife[i];
      const alpha = fade > 0.55 ? 1 : fade / 0.55;
      const o = i * PARTICLE_STRIDE;
      data[o] = this.px[i];
      data[o + 1] = this.py[i];
      data[o + 2] = this.pz[i];
      data[o + 3] = this.size[i] * (0.5 + 0.5 * fade);
      data[o + 4] = this.cr[i];
      data[o + 5] = this.cg[i];
      data[o + 6] = this.cb[i];
      data[o + 7] = alpha + (this.hot[i] > 0.5 ? 2 : 0);
    }
    return this.count;
  }
}

export function comboColor(combo: number): string {
  if (combo >= 60) return '#e0245e';
  if (combo >= 40) return '#f07818';
  if (combo >= 20) return '#e0a800';
  return '#1f8fd6';
}

/** 大きな数を短く見せる */
export function formatShort(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}兆`;
  if (value >= 1e8) return `${(value / 1e8).toFixed(value >= 1e10 ? 0 : 1)}億`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(0)}万`;
  return `${Math.round(value)}`;
}
