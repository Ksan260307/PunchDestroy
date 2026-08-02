/**
 * 表示側に渡す読み取り専用の窓口。
 *
 * 描画・音・HUD はこれ経由でしか状態を見ない。
 * 逆向き（表示側から状態を書き換える）は用意しない。
 */

import { BARRAGE_STEPS, BARRAGE_TRIGGER, RUSH_STEPS } from './constants';
import {
  barrageStepsLeft,
  grainsRemaining,
  grainsDestroyed,
  destroyedRatio,
  finaleProgress,
  isBarrage,
  isRush,
  rushStepsLeft,
  type World,
} from './world';

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
  /** ラッシュの残り具合（0〜1） */
  readonly rushLeft: number;
  /** 乱打中か */
  readonly barrage: boolean;
  /** 乱打の残り具合（0〜1） */
  readonly barrageLeft: number;
  /** 乱打に入るまでの溜まり具合（0〜1） */
  readonly barrageCharge: number;
  /** 総崩れが始まっているか */
  readonly finale: boolean;
  /** 崩れ出すまでの張りつめ具合（0〜1）。1 になると崩れ始める */
  readonly finaleTension: number;
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
    get rushLeft() {
      return Math.min(1, rushStepsLeft(world) / RUSH_STEPS);
    },
    get barrage() {
      return isBarrage(world);
    },
    get barrageLeft() {
      return Math.min(1, barrageStepsLeft(world) / BARRAGE_STEPS);
    },
    get barrageCharge() {
      return Math.min(1, world.recentHits / BARRAGE_TRIGGER);
    },
    get finale() {
      return world.finaleStep >= 0;
    },
    get finaleTension() {
      return finaleProgress(world);
    },
    get cleared() {
      return world.remainingUnits <= 0;
    },
  });
}
