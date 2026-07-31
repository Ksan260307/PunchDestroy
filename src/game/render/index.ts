import { CanvasRenderer } from './canvasRenderer';
import { WebGLRenderer } from './webglRenderer';
import type { Renderer } from './types';

export { OverlayLayer } from './overlay';
export type { Renderer, RenderFrame } from './types';

/** 使える方の描画を選ぶ */
export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  try {
    return new WebGLRenderer(canvas);
  } catch (error) {
    console.warn('簡易表示に切り替えます:', error);
    return new CanvasRenderer(canvas);
  }
}
