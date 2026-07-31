/**
 * 画面まわりの表示。数字は目標値へ向けて滑らかに動かす。
 * 状態を読むだけで、こちらから書き換えることはない。
 */

import type { WorldView } from '../core/view';

function need<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`画面の要素が見つかりません: ${id}`);
  return element as T;
}

export interface ResultStats {
  seconds: number;
  hits: number;
  bestCombo: number;
  score: number;
  cleared: boolean;
}

export class Hud {
  private readonly root = need('hud');
  private readonly grains = need('grains');
  private readonly barFill = need('bar-fill');
  private readonly percent = need('percent');
  private readonly score = need('score');
  private readonly comboChip = need('combo-chip');
  private readonly comboCount = need('combo-count');
  private readonly hint = need('hint');
  private readonly stats = need('stats');
  private readonly charge = need('charge');
  private readonly chargeFill = need('charge-fill');
  private readonly replayBadge = need('replay-badge');
  private readonly titleScreen = need('title');
  private readonly resultScreen = need('result');

  private shownGrains = 0;
  private shownScore = 0;
  private lastCombo = -1;

  reset(view: WorldView): void {
    this.shownGrains = view.grainsLeft;
    this.shownScore = 0;
    this.lastCombo = -1;
    this.comboChip.classList.add('hidden');
  }

  setVisible(value: boolean): void {
    this.root.classList.toggle('hidden', !value);
  }

  showTitle(value: boolean): void {
    this.titleScreen.classList.toggle('hidden', !value);
  }

  showReplayBadge(value: boolean): void {
    this.replayBadge.classList.toggle('hidden', !value);
  }

  setHint(text: string): void {
    this.hint.textContent = text;
  }

  setCharge(ratio: number): void {
    if (ratio <= 0.04) {
      this.charge.classList.add('hidden');
      return;
    }
    this.charge.classList.remove('hidden');
    this.chargeFill.style.width = `${Math.min(100, ratio * 100)}%`;
  }

  setStats(text: string): void {
    this.stats.textContent = text;
  }

  update(view: WorldView, dt: number): void {
    const ease = Math.min(1, dt * 14);
    this.shownGrains += (view.grainsLeft - this.shownGrains) * ease;
    if (Math.abs(view.grainsLeft - this.shownGrains) < 1) this.shownGrains = view.grainsLeft;
    this.shownScore += (view.score - this.shownScore) * ease;

    this.grains.textContent = Math.round(this.shownGrains).toLocaleString('ja-JP');
    this.score.textContent = Math.round(this.shownScore).toLocaleString('ja-JP');

    const done = view.destroyed;
    this.barFill.style.width = `${(done * 100).toFixed(2)}%`;
    this.percent.innerHTML = `${(done * 100).toFixed(2)}<small>%</small>`;

    const combo = view.combo;
    if (combo !== this.lastCombo) {
      if (combo >= 2) {
        this.comboChip.classList.remove('hidden');
        this.comboCount.textContent = String(combo);
        this.comboChip.classList.remove('pop');
        void this.comboChip.offsetWidth;
        this.comboChip.classList.add('pop');
      } else {
        this.comboChip.classList.add('hidden');
      }
      this.lastCombo = combo;
    }
  }

  showResult(stats: ResultStats): void {
    need('result-title').textContent = stats.cleared ? '完全破壊！' : 'ここまで';
    need('r-time').textContent = `${stats.seconds.toFixed(1)}秒`;
    need('r-hits').textContent = `${stats.hits.toLocaleString('ja-JP')}回`;
    need('r-combo').textContent = `${stats.bestCombo}`;
    need('r-score').textContent = stats.score.toLocaleString('ja-JP');
    this.resultScreen.classList.remove('hidden');
  }

  hideResult(): void {
    this.resultScreen.classList.add('hidden');
  }
}
