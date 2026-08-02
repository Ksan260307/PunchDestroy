/**
 * 音の仕組みの立ち上げ直し。
 *
 * 携帯端末では画面を閉じている間に音が止められ、戻ってきても
 * そのままでは鳴らないことがある。起こす・だめなら作り直す、
 * の2段構えがきちんと働くかを確かめる。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundKit } from '../src/game/audio';

type State = 'running' | 'suspended' | 'interrupted' | 'closed';

const created: FakeContext[] = [];

class FakeContext {
  state: State = 'suspended';
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  closed = false;
  resumeCalls = 0;
  /** resume を失敗させたいときに立てる */
  failResume = false;
  private listeners: Array<() => void> = [];

  constructor() {
    created.push(this);
  }

  addEventListener(_name: string, handler: () => void): void {
    this.listeners.push(handler);
  }

  emitStateChange(state: State): void {
    this.state = state;
    for (const handler of this.listeners) handler();
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.failResume) return Promise.reject(new Error('起こせません'));
    this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    this.state = 'closed';
    return Promise.resolve();
  }

  createGain() {
    return { gain: { value: 0, setTargetAtTime: vi.fn() }, connect: (next: unknown) => next };
  }

  createDynamicsCompressor() {
    return {
      threshold: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      connect: (next: unknown) => next,
    };
  }

  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('音の立ち上げ', () => {
  beforeEach(() => {
    created.length = 0;
    vi.stubGlobal('window', { AudioContext: FakeContext });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('最初の操作で用意され、止まっていれば起こす', async () => {
    const sound = new SoundKit();
    expect(sound.running).toBe(false);
    sound.unlock();
    await flush();
    expect(created).toHaveLength(1);
    expect(sound.running).toBe(true);
  });

  it('割り込みで止められても、戻ってきたら起こす', async () => {
    const sound = new SoundKit();
    sound.unlock();
    await flush();

    created[0].state = 'interrupted';
    expect(sound.running).toBe(false);
    sound.resume();
    await flush();
    expect(sound.running).toBe(true);
    expect(created).toHaveLength(1);
  });

  it('起こせなかったら作り直す', async () => {
    const sound = new SoundKit();
    sound.unlock();
    await flush();

    created[0].failResume = true;
    created[0].state = 'suspended';
    sound.resume();
    await flush();
    await flush();

    expect(created.length).toBeGreaterThan(1);
    expect(created[0].closed).toBe(true);
    expect(sound.running).toBe(true);
  });

  it('閉じられていたら作り直す', async () => {
    const sound = new SoundKit();
    sound.unlock();
    await flush();

    created[0].state = 'closed';
    sound.resume();
    await flush();
    expect(created).toHaveLength(2);
    expect(sound.running).toBe(true);
  });

  it('自分から止まったときも起こしにいく', async () => {
    const sound = new SoundKit();
    sound.unlock();
    await flush();
    const ctx = created[0];
    const before = ctx.resumeCalls;
    ctx.emitStateChange('suspended');
    await flush();
    expect(ctx.resumeCalls).toBeGreaterThan(before);
    expect(sound.running).toBe(true);
  });

  it('消音の設定は作り直しても引き継ぐ', async () => {
    const sound = new SoundKit();
    sound.setMuted(true);
    expect(sound.enabled).toBe(false);
    sound.unlock();
    await flush();
    created[0].state = 'closed';
    sound.resume();
    await flush();
    expect(sound.enabled).toBe(false);
  });

  it('音の仕組みが無い環境でも落ちない', () => {
    vi.stubGlobal('window', {});
    const sound = new SoundKit();
    expect(() => sound.unlock()).not.toThrow();
    expect(() => sound.resume()).not.toThrow();
    expect(() => sound.punch(true, 3, 1)).not.toThrow();
    expect(() => sound.rumble(1)).not.toThrow();
    expect(sound.running).toBe(false);
  });
});
