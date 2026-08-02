/**
 * 実測の速さに応じた演出量の調整。
 * 落ちてきたら減らし、余裕が戻ったら増やすこと。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUALITY_LEVELS } from '../src/game/effects';
import { PerformanceWatch } from '../src/game/quality';

function feed(watch: PerformanceWatch, fps: number, seconds: number): void {
  const dt = 1 / fps;
  for (let t = 0; t < seconds; t += dt) watch.sample(dt);
}

describe('速さの見張り', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('最初はいちばん良い見た目から始まる', () => {
    const watch = new PerformanceWatch();
    expect(watch.level).toBe(QUALITY_LEVELS.length - 1);
    expect(watch.budget).toBe(QUALITY_LEVELS[QUALITY_LEVELS.length - 1]);
  });

  it('遅くなったら段を下げる', () => {
    const watch = new PerformanceWatch();
    feed(watch, 20, 12);
    expect(watch.level).toBeLessThan(QUALITY_LEVELS.length - 1);
    expect(watch.fps).toBeLessThan(45);
  });

  it('いちばん下より下がらない', () => {
    const watch = new PerformanceWatch();
    feed(watch, 12, 60);
    expect(watch.level).toBe(0);
  });

  it('余裕が戻れば段を上げる', () => {
    const watch = new PerformanceWatch();
    feed(watch, 20, 12);
    const low = watch.level;
    feed(watch, 60, 40);
    expect(watch.level).toBeGreaterThan(low);
  });

  it('いちばん上より上がらない', () => {
    const watch = new PerformanceWatch();
    feed(watch, 120, 60);
    expect(watch.level).toBe(QUALITY_LEVELS.length - 1);
  });

  it('ありえない間隔は数えない', () => {
    const watch = new PerformanceWatch();
    const before = watch.fps;
    watch.sample(0);
    watch.sample(-1);
    watch.sample(10);
    expect(watch.fps).toBe(before);
  });

  it('段が下がると描く細かさも下がる', () => {
    vi.stubGlobal('window', { devicePixelRatio: 3 });
    const watch = new PerformanceWatch();
    const best = watch.pixelRatio;
    feed(watch, 15, 30);
    expect(watch.pixelRatio).toBeLessThan(best);
    expect(watch.budget.renderScale).toBeLessThan(1);
  });

  it('端末の細かさ以上には上げない', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const watch = new PerformanceWatch();
    expect(watch.pixelRatio).toBeLessThanOrEqual(1);
  });

  it('やり直すと最初の状態に戻る', () => {
    const watch = new PerformanceWatch();
    feed(watch, 15, 30);
    watch.reset();
    expect(watch.level).toBe(QUALITY_LEVELS.length - 1);
    expect(watch.fps).toBe(60);
  });
});
