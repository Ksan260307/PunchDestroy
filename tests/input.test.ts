/**
 * 指とキーボードの操作の確認。
 *
 * 実際のブラウザがなくても確かめられるよう、
 * 出来事を受け取るだけの入れ物を用意して流し込む。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHARGE_MS,
  DRAG_RATIO,
  KeyboardInput,
  PINCH_RATIO,
  PointerInput,
  type PunchRequest,
} from '../src/game/input';

const W = 900;
const H = 900;

interface Listener {
  (event: unknown): void;
}

/** addEventListener を覚えておくだけの入れ物 */
class FakeElement {
  readonly handlers = new Map<string, Listener[]>();
  captured: number[] = [];

  addEventListener(type: string, handler: Listener): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  removeEventListener(type: string, handler: Listener): void {
    const list = this.handlers.get(type) ?? [];
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  }

  setPointerCapture(id: number): void {
    this.captured.push(id);
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: W, height: H };
  }

  emit(type: string, event: Record<string, unknown>): void {
    const base = { preventDefault: () => {}, target: this, ...event };
    for (const handler of this.handlers.get(type) ?? []) handler(base);
  }
}

interface Recorded {
  punches: Array<PunchRequest & { heavy: boolean }>;
  orbits: Array<[number, number]>;
  zooms: number[];
  releases: number;
  touched: number;
}

function setup() {
  const element = new FakeElement();
  const log: Recorded = { punches: [], orbits: [], zooms: [], releases: 0, touched: 0 };
  const input = new PointerInput(
    element as unknown as HTMLElement,
    () => ({ width: W, height: H }),
    {
      punch: (request, heavy) => log.punches.push({ ...request, heavy }),
      orbit: (dx, dy) => log.orbits.push([dx, dy]),
      zoom: (factor) => log.zooms.push(factor),
      release: () => log.releases++,
      firstTouch: () => log.touched++,
    },
  );
  input.setEnabled(true);
  return { element, input, log };
}

const down = (element: FakeElement, id: number, x: number, y: number, target?: unknown) =>
  element.emit('pointerdown', { pointerId: id, clientX: x, clientY: y, ...(target ? { target } : {}) });
const move = (element: FakeElement, id: number, x: number, y: number) =>
  element.emit('pointermove', { pointerId: id, clientX: x, clientY: y });
const up = (element: FakeElement, id: number, x: number, y: number) =>
  element.emit('pointerup', { pointerId: id, clientX: x, clientY: y });

describe('指で殴る', () => {
  it('触れた瞬間に1発入る', () => {
    const { element, log } = setup();
    down(element, 1, 400, 400);
    expect(log.punches).toEqual([{ x: 400, y: 400, heavy: false }]);
    up(element, 1, 400, 400);
    expect(log.releases).toBe(1);
  });

  it('指の数だけ同時に殴れる', () => {
    const { element, log } = setup();
    down(element, 1, 300, 300);
    down(element, 2, 500, 300);
    down(element, 3, 400, 500);
    down(element, 4, 600, 500);
    expect(log.punches).toHaveLength(4);
    expect(log.punches.map((p) => p.x)).toEqual([300, 500, 400, 600]);
    expect(log.zooms).toEqual([]);
  });

  it('2本指で叩いても寄り引きにはならない', () => {
    const { element, input, log } = setup();
    down(element, 1, 300, 400);
    down(element, 2, 500, 400);
    // わずかに動く程度では寄り引きに入らない
    move(element, 1, 302, 401);
    move(element, 2, 498, 399);
    expect(log.zooms).toEqual([]);
    expect(input.isPinching).toBe(false);
    expect(log.punches).toHaveLength(2);
  });

  it('はっきり広げたら寄り引きに切り替わる', () => {
    const { element, input, log } = setup();
    down(element, 1, 400, 400);
    down(element, 2, 500, 400);
    const spread = Math.min(W, H) * PINCH_RATIO + 20;
    move(element, 2, 500 + spread, 400);
    expect(input.isPinching).toBe(true);
    move(element, 2, 500 + spread + 40, 400);
    expect(log.zooms.length).toBeGreaterThan(0);
    expect(log.zooms[0]).toBeGreaterThan(1);
  });

  it('寄り引き中は殴らない', () => {
    const { element, input, log } = setup();
    down(element, 1, 400, 400);
    down(element, 2, 500, 400);
    const spread = Math.min(W, H) * PINCH_RATIO + 20;
    move(element, 2, 500 + spread, 400);
    expect(input.isPinching).toBe(true);
    const before = log.punches.length;
    down(element, 3, 200, 200);
    expect(log.punches).toHaveLength(before);
  });

  it('受け取りの固定に失敗しても殴れる', () => {
    const { element, log } = setup();
    // 2本目以降の指で固定に失敗する端末を想定する
    element.setPointerCapture = (id: number) => {
      if (id > 1) throw new Error('固定できません');
    };
    down(element, 1, 300, 300);
    down(element, 2, 500, 300);
    down(element, 3, 400, 500);
    expect(log.punches).toHaveLength(3);
  });

  it('全部の指を離すと寄り引きが解ける', () => {
    const { element, input } = setup();
    down(element, 1, 400, 400);
    down(element, 2, 500, 400);
    move(element, 2, 500 + Math.min(W, H) * PINCH_RATIO + 20, 400);
    expect(input.isPinching).toBe(true);
    up(element, 1, 400, 400);
    up(element, 2, 600, 400);
    expect(input.isPinching).toBe(false);
    expect(input.pointerCount).toBe(0);
  });
});

describe('なぞって回す', () => {
  it('少し動かしただけでは回さない', () => {
    const { element, log } = setup();
    down(element, 1, 400, 400);
    move(element, 1, 400 + Math.min(W, H) * DRAG_RATIO * 0.5, 400);
    expect(log.orbits).toEqual([]);
  });

  it('しきい値を超えたら回る', () => {
    const { element, log } = setup();
    down(element, 1, 400, 400);
    move(element, 1, 400 + Math.min(W, H) * DRAG_RATIO + 5, 400);
    expect(log.orbits.length).toBeGreaterThan(0);
    expect(log.orbits[0][0]).toBeGreaterThan(0);
  });

  it('回している間は溜めが進まない', () => {
    const { element, input } = setup();
    down(element, 1, 400, 400);
    move(element, 1, 700, 400);
    expect(input.charge).toBe(0);
  });
});

describe('長押しの渾身の一撃', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('溜まりきると強打が出る', () => {
    const { element, input, log } = setup();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    down(element, 1, 400, 400);
    expect(log.punches).toHaveLength(1);

    now += CHARGE_MS - 10;
    input.update(now);
    expect(log.punches).toHaveLength(1);

    now += 20;
    input.update(now);
    expect(log.punches).toHaveLength(2);
    expect(log.punches[1].heavy).toBe(true);
  });

  it('指ごとに別々に溜まる', () => {
    const { element, input, log } = setup();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    down(element, 1, 300, 400);
    down(element, 2, 500, 400);
    now += CHARGE_MS + 5;
    input.update(now);
    const heavy = log.punches.filter((p) => p.heavy);
    expect(heavy).toHaveLength(2);
  });

  it('溜まり具合が 0 から 1 へ上がる', () => {
    const { element, input } = setup();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    down(element, 1, 400, 400);
    expect(input.charge).toBeCloseTo(0, 2);
    now += CHARGE_MS / 2;
    expect(input.charge).toBeCloseTo(0.5, 1);
    now += CHARGE_MS;
    expect(input.charge).toBe(1);
  });
});

describe('ボタンの上での操作', () => {
  it('ボタンを押しても殴らない', () => {
    const { element, log } = setup();
    const button = { closest: (selector: string) => (selector.includes('button') ? {} : null) };
    down(element, 1, 400, 400, button);
    expect(log.punches).toEqual([]);
    // 音を出せるようにする合図は届いている
    expect(log.touched).toBe(1);
  });

  it('画面の外にあるものは無視する（要素でない場合）', () => {
    const { element, log } = setup();
    down(element, 1, 400, 400, { nothing: true });
    // closest を持たない相手なら、ふつうの殴打として扱う
    expect(log.punches).toHaveLength(1);
  });
});

describe('操作を止めているとき', () => {
  it('受け付けを切ると何も起きない', () => {
    const { element, input, log } = setup();
    input.setEnabled(false);
    down(element, 1, 400, 400);
    move(element, 1, 700, 400);
    expect(log.punches).toEqual([]);
    expect(log.orbits).toEqual([]);
    expect(input.pointerCount).toBe(0);
  });
});

describe('キーボード', () => {
  function keySetup() {
    const listeners = new Map<string, Listener[]>();
    const fakeWindow = {
      addEventListener: (type: string, handler: Listener) => {
        const list = listeners.get(type) ?? [];
        list.push(handler);
        listeners.set(type, list);
      },
      removeEventListener: () => {},
    };
    vi.stubGlobal('window', fakeWindow);
    const log = { punches: 0, heavy: 0, orbits: 0, zooms: [] as number[], restart: 0, title: 0 };
    const keys = new KeyboardInput({
      punchCenter: (heavy) => {
        log.punches++;
        if (heavy) log.heavy++;
      },
      orbit: () => log.orbits++,
      zoom: (factor) => log.zooms.push(factor),
      restart: () => log.restart++,
      title: () => log.title++,
    });
    keys.setEnabled(true);
    const press = (code: string, extra: Record<string, unknown> = {}) => {
      for (const handler of listeners.get('keydown') ?? []) {
        handler({ code, repeat: false, preventDefault: () => {}, ...extra });
      }
    };
    const release = (code: string) => {
      for (const handler of listeners.get('keyup') ?? []) handler({ code });
    };
    return { keys, log, press, release };
  }

  it('スペースで殴る。Shift を足すと強打', () => {
    const { log, press } = keySetup();
    press('Space');
    expect(log.punches).toBe(1);
    expect(log.heavy).toBe(0);
    press('Space', { shiftKey: true });
    expect(log.heavy).toBe(1);
  });

  it('方向キーを押している間だけ回る', () => {
    const { keys, log, press, release } = keySetup();
    keys.update(1 / 60);
    expect(log.orbits).toBe(0);
    press('ArrowLeft');
    keys.update(1 / 60);
    expect(log.orbits).toBe(1);
    release('ArrowLeft');
    keys.update(1 / 60);
    expect(log.orbits).toBe(1);
  });

  it('+ と - で寄り引きする', () => {
    const { keys, log, press, release } = keySetup();
    press('Equal');
    keys.update(1 / 60);
    expect(log.zooms[0]).toBeGreaterThan(1);
    release('Equal');
    press('Minus');
    keys.update(1 / 60);
    expect(log.zooms[1]).toBeLessThan(1);
  });

  it('R でやり直し、Esc でタイトルへ', () => {
    const { log, press } = keySetup();
    press('KeyR');
    expect(log.restart).toBe(1);
    press('Escape');
    expect(log.title).toBe(1);
  });

  it('受け付けを切っても Esc だけは効く', () => {
    const { keys, log, press } = keySetup();
    keys.setEnabled(false);
    press('Space');
    press('KeyR');
    expect(log.punches).toBe(0);
    expect(log.restart).toBe(0);
    press('Escape');
    expect(log.title).toBe(1);
  });

  it('押しっぱなしの繰り返し通知は数えない', () => {
    const { log, press } = keySetup();
    press('Space', { repeat: true });
    expect(log.punches).toBe(0);
  });
});
