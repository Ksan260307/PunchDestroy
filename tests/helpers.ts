import { HIT_JAB, HIT_SMASH } from '../src/core/constants';
import { traceSurface, type TraceHit } from '../src/core/trace';
import type { Hit } from '../src/core/rules';
import type { Session } from '../src/core/session';
import type { World } from '../src/core/world';

/** 検証用の並べ替えと乱数。毎回同じ結果になる */
export class TestShuffler {
  private state: number;

  constructor(seed = 12345) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  shuffle<T>(items: T[]): T[] {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  direction(): [number, number, number] {
    const z = this.range(-1, 1);
    const a = this.range(0, Math.PI * 2);
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    return [Math.cos(a) * s, z, Math.sin(a) * s];
  }
}

/**
 * 適当な方向から石像を狙って、当たったマスを返す。
 * 実際の遊び方（見る角度を変えながら殴る）に近い当て方になる。
 */
export function aim(world: World, rng: TestShuffler, spread = 0.7): TraceHit | null {
  const dir = rng.direction();
  const ox = dir[0] * 3;
  const oy = dir[1] * 3;
  const oz = dir[2] * 3;
  const tx = rng.range(-spread, spread);
  const ty = rng.range(-spread, spread);
  const tz = rng.range(-spread, spread);
  let dx = tx - ox;
  let dy = ty - oy;
  let dz = tz - oz;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  return traceSurface(world, ox, oy, oz, dx, dy, dz, 0.06);
}

/** いろいろな角度から狙って、表面のマスを集める */
export function sampleTargets(world: World, count = 60, seed = 4321): TraceHit[] {
  const rng = new TestShuffler(seed);
  const found: TraceHit[] = [];
  for (let i = 0; i < count * 4 && found.length < count; i++) {
    const target = aim(world, rng);
    if (target) found.push(target);
  }
  return found;
}

export function makeHit(step: number, x: number, y: number, z: number, kind = HIT_JAB): Hit {
  return { step, x, y, z, kind };
}

export interface ScriptOptions {
  /** 何回の刻みごとに殴るか */
  every?: number;
  /** 何刻みまで進めるか */
  maxSteps?: number;
  /** 狙いを散らす種 */
  seed?: number;
}

/**
 * 石像をいろいろな角度から殴り続ける台本。
 * 同じ引数からは必ず同じ操作列になる。
 */
export function playScript(session: Session, options: ScriptOptions = {}): number {
  const every = options.every ?? 3;
  const maxSteps = options.maxSteps ?? 40000;
  const rng = new TestShuffler(options.seed ?? 20260801);
  let punches = 0;

  for (let step = 0; step < maxSteps; step++) {
    if (step % every === 0) {
      const target = aim(session.world, rng);
      if (target) {
        punches++;
        session.queueHit(
          target.x,
          target.y,
          target.z,
          punches % 7 === 0 ? HIT_SMASH : HIT_JAB,
        );
      }
    }
    session.advance();
    if (session.world.remainingUnits <= 0) return step + 1;
  }
  return maxSteps;
}
