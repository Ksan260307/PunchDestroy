import type { WorldView } from '../../core/view';
import type { OrbitCamera } from '../camera';
import type { EffectSystem } from '../effects';

export interface RenderFrame {
  view: WorldView;
  fx: EffectSystem;
  camera: OrbitCamera;
  /** 起動からの経過秒 */
  time: number;
  width: number;
  height: number;
}

export interface Renderer {
  readonly kind: 'webgl' | 'canvas';
  resize(width: number, height: number, pixelRatio: number): void;
  /** 石像の中身を全部送り直す */
  invalidate(): void;
  /** 変わった範囲だけを送り直す */
  markDirty(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void;
  render(frame: RenderFrame): void;
  dispose(): void;
}
