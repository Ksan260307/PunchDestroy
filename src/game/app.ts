/**
 * 進行と表示をつなぐ場所。
 *
 * 進めるのは常に一定の刻みで、実時間のばらつきはここで吸収する。
 * 表示側が重くて描画を間引いても、進行の刻みは変わらない。
 *
 * カメラは表示側の持ち物。殴る位置だけは、そこから伸ばした線が
 * 当たったマス座標として記録され、以後の進行はカメラに左右されない。
 */

import { HIT_JAB, HIT_SMASH, STEP_MS } from '../core/constants';
import type { StepReport } from '../core/rules';
import { RecordPlayer, Session, type SessionRecord } from '../core/session';
import { traceSurface } from '../core/trace';
import { createView, type WorldView } from '../core/view';
import { SoundKit } from './audio';
import { OrbitCamera } from './camera';
import { EffectSystem } from './effects';
import { Hud } from './hud';
import { PointerInput } from './input';
import { PerformanceWatch } from './quality';
import { createRenderer, OverlayLayer, type Renderer } from './render';

type Mode = 'title' | 'play' | 'result' | 'replay';

const STEP_SECONDS = STEP_MS / 1000;
/** 殴る位置を表面からどれだけ内側へ食い込ませるか */
const JAB_BITE = 0.055;
const SMASH_BITE = 0.1;

export class Game {
  private readonly renderer: Renderer;
  private readonly overlay: OverlayLayer;
  private readonly camera = new OrbitCamera();
  private readonly fx = new EffectSystem();
  private readonly hud = new Hud();
  private readonly sound = new SoundKit();
  private readonly watch = new PerformanceWatch();
  private readonly input: PointerInput;

  private session: Session | null = null;
  private player: RecordPlayer | null = null;
  private view: WorldView | null = null;
  private record: SessionRecord | null = null;

  private mode: Mode = 'title';
  private accumulator = 0;
  private lastFrame = 0;
  private elapsed = 0;
  private width = 1;
  private height = 1;
  private appliedScale = 0;
  private lastBuzz = 0;
  private frameHandle = 0;

  constructor(
    private readonly stage: HTMLElement,
    scene: HTMLCanvasElement,
    overlay: HTMLCanvasElement,
  ) {
    this.renderer = createRenderer(scene);
    this.overlay = new OverlayLayer(overlay);
    this.input = new PointerInput(
      stage,
      () => ({ width: this.width, height: this.height }),
      {
        punch: (request, heavy) => this.punch(request.x, request.y, heavy),
        orbit: (dx, dy) => this.camera.orbit(dx, dy),
        zoom: (factor) => this.camera.zoomBy(factor),
        release: () => {},
        firstTouch: () => this.sound.unlock(),
      },
    );

    this.measure();
    window.addEventListener('resize', this.measure);
    window.addEventListener('orientationchange', this.measure);
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  get hasRecord(): boolean {
    return this.record !== null;
  }

  get soundOn(): boolean {
    return this.sound.enabled;
  }

  toggleSound(): boolean {
    this.sound.setMuted(this.sound.enabled);
    return this.sound.enabled;
  }

  recenter(): void {
    this.camera.reset();
  }

  /** 新しく始める */
  begin(seed = Math.floor(Math.random() * 0x7fffffff)): void {
    this.sound.unlock();
    this.session = new Session(seed);
    this.player = null;
    this.view = createView(this.session.world);
    this.record = null;
    this.mode = 'play';
    this.accumulator = 0;
    this.elapsed = 0;
    this.fx.reset();
    this.camera.reset();
    this.hud.reset(this.view);
    this.hud.setVisible(true);
    this.hud.showTitle(false);
    this.hud.hideResult();
    this.hud.showReplayBadge(false);
    this.hud.setHint('タップで殴る／なぞって回す／長押しで渾身の一撃');
    this.watch.reset();
    this.renderer.invalidate();
    this.input.setEnabled(true);
  }

  /** 直前のプレイを、記録から作り直して見返す */
  replayLast(): void {
    if (!this.record) return;
    this.player = new RecordPlayer(this.record);
    this.session = null;
    this.view = createView(this.player.world);
    this.mode = 'replay';
    this.accumulator = 0;
    this.fx.reset();
    this.hud.reset(this.view);
    this.hud.hideResult();
    this.hud.setVisible(true);
    this.hud.showReplayBadge(true);
    this.hud.setHint('記録から作り直しています（なぞると見る角度を変えられます）');
    this.renderer.invalidate();
    this.input.setEnabled(true);
  }

  showTitle(): void {
    this.mode = 'title';
    this.hud.showTitle(true);
    this.hud.hideResult();
    this.hud.setVisible(false);
    this.hud.showReplayBadge(false);
    this.input.setEnabled(false);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('resize', this.measure);
    window.removeEventListener('orientationchange', this.measure);
    this.input.dispose();
    this.renderer.dispose();
  }

  private measure = (): void => {
    this.width = this.stage.clientWidth || window.innerWidth;
    this.height = this.stage.clientHeight || window.innerHeight;
    this.appliedScale = 0;
    this.applyScale();
  };

  private applyScale(): void {
    const scale = this.watch.pixelRatio * this.watch.budget.renderScale;
    if (Math.abs(scale - this.appliedScale) < 0.01) return;
    this.appliedScale = scale;
    this.renderer.resize(this.width, this.height, scale);
    this.overlay.resize(this.width, this.height, Math.min(this.watch.pixelRatio, 2));
  }

  private punch(sx: number, sy: number, heavy: boolean): void {
    if (this.mode !== 'play' || !this.session) return;
    const ray = this.camera.rayFrom(sx, sy, this.width, this.height);
    const hit = traceSurface(
      this.session.world,
      ray.ox,
      ray.oy,
      ray.oz,
      ray.dx,
      ray.dy,
      ray.dz,
      heavy ? SMASH_BITE : JAB_BITE,
    );
    if (!hit) return;
    this.session.queueHit(hit.x, hit.y, hit.z, heavy ? HIT_SMASH : HIT_JAB);
    this.camera.kick(
      heavy ? 0.02 : 0.008,
      (sx / this.width - 0.5) * 0.6,
      (0.5 - sy / this.height) * 0.6,
    );
  }

  private frame = (now: number): void => {
    this.frameHandle = requestAnimationFrame(this.frame);
    if (this.lastFrame === 0) this.lastFrame = now;
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    this.watch.sample(dt);
    this.fx.quality = this.watch.budget;
    this.applyScale();

    if (this.mode === 'play') this.input.update(now);

    if (this.fx.freeze > 0) {
      this.fx.freeze = Math.max(0, this.fx.freeze - dt);
    } else if (this.mode === 'play' || this.mode === 'replay') {
      const speed = this.mode === 'replay' ? 2.2 : 1;
      this.accumulator += dt * speed;
      if (this.mode === 'play') this.elapsed += dt;
      let steps = 0;
      while (this.accumulator >= STEP_SECONDS && steps < 8) {
        this.accumulator -= STEP_SECONDS;
        steps++;
        const report = this.mode === 'replay' ? this.player!.advance() : this.session!.advance();
        this.consume(report);
        if (this.fx.freeze > 0) break;
        if (this.mode !== 'play' && this.mode !== 'replay') break;
      }
      if (steps >= 8) this.accumulator = 0;
      if (this.mode === 'replay' && this.player?.finished) this.endReplay();
    }

    this.fx.update(dt);
    this.camera.update(dt);
    this.camera.refresh(this.width, this.height);

    const view = this.view;
    if (view) {
      this.hud.update(view, dt);
      this.hud.setCharge(this.mode === 'play' ? this.input.charge : 0);
      this.renderer.render({
        view,
        fx: this.fx,
        camera: this.camera,
        time: now / 1000,
        width: this.width,
        height: this.height,
      });
      this.overlay.render(this.fx, this.camera);
    }

    this.hud.setStats(
      `${this.renderer.kind === 'webgl' ? '立体表示' : '簡易表示'} ${this.watch.fps.toFixed(0)}fps`,
    );
  };

  private consume(report: StepReport): void {
    const view = this.view;
    if (!view) return;

    if (report.dirtyValid) {
      this.renderer.markDirty(
        report.dirtyX0,
        report.dirtyY0,
        report.dirtyZ0,
        report.dirtyX1,
        report.dirtyY1,
        report.dirtyZ1,
      );
    }
    this.fx.onStep(report, view);

    for (const hit of report.hits) {
      this.sound.punch(hit.kind === HIT_SMASH, report.combo, hit.removed / 700000);
      this.buzz(hit.kind === HIT_SMASH ? 22 : 8);
    }
    if (report.collapsing.length > 0) {
      this.sound.crumble();
      this.buzz(38);
    }
    if (report.rushStarted) this.sound.rush();
    if (report.cleared) {
      this.sound.clear();
      this.buzz(120);
      this.finish();
    }
  }

  private buzz(ms: number): void {
    if (!('vibrate' in navigator)) return;
    const now = performance.now();
    if (now - this.lastBuzz < 40) return;
    this.lastBuzz = now;
    navigator.vibrate?.(ms);
  }

  private finish(): void {
    if (!this.session || !this.view) return;
    this.record = this.session.toRecord();
    this.mode = 'result';
    this.input.setEnabled(false);
    const view = this.view;
    window.setTimeout(() => {
      this.hud.showResult({
        seconds: this.elapsed,
        hits: view.hitCount,
        bestCombo: view.bestCombo,
        score: view.score,
        cleared: true,
      });
    }, 900);
  }

  private endReplay(): void {
    const view = this.view;
    this.mode = 'result';
    this.input.setEnabled(false);
    this.hud.showReplayBadge(false);
    if (view) {
      this.hud.showResult({
        seconds: this.elapsed,
        hits: view.hitCount,
        bestCombo: view.bestCombo,
        score: view.score,
        cleared: view.cleared,
      });
    }
  }
}
