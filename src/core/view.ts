/**
 * 表示側に渡す読み取り専用の窓口。
 *
 * 描画・音・HUD はこれ経由でしか状態を見ない。
 * 逆向き（表示側から状態を書き換える）は用意しない。
 */

import { grainsRemaining, grainsDestroyed, destroyedRatio, isRush, type World } from './world';

export interface WorldView {
  readonly step: number;
  readonly density: Uint8Array;
  readonly origin: Uint8Array;
  readonly material: Uint8Array;
  readonly blockRemaining: Int32Array;
  readonly blockState: Uint8Array;
  readonly remainingUnits: number;
  readonly totalUnits: number;
  readonly grainsPerUnit: number;
  readonly grainsLeft: number;
  readonly grainsGone: number;
  readonly destroyed: number;
  readonly score: number;
  readonly combo: number;
  readonly bestCombo: number;
  readonly hitCount: number;
  readonly rush: boolean;
  readonly cleared: boolean;
}

export function createView(world: World): WorldView {
  return Object.freeze({
    get step() {
      return world.step;
    },
    get density() {
      return world.density;
    },
    get origin() {
      return world.origin;
    },
    get material() {
      return world.material;
    },
    get blockRemaining() {
      return world.blockRemaining;
    },
    get blockState() {
      return world.blockState;
    },
    get remainingUnits() {
      return world.remainingUnits;
    },
    get totalUnits() {
      return world.totalUnits;
    },
    get grainsPerUnit() {
      return world.grainsPerUnit;
    },
    get grainsLeft() {
      return grainsRemaining(world);
    },
    get grainsGone() {
      return grainsDestroyed(world);
    },
    get destroyed() {
      return destroyedRatio(world);
    },
    get score() {
      return world.score;
    },
    get combo() {
      return world.combo;
    },
    get bestCombo() {
      return world.bestCombo;
    },
    get hitCount() {
      return world.hitCount;
    },
    get rush() {
      return isRush(world);
    },
    get cleared() {
      return world.remainingUnits <= 0;
    },
  });
}
