/**
 * 進行を決める側のソースに、結果を揺らすものが混ざっていないかを
 * ソースコードそのものを読んで確かめる。
 *
 * 実行時のテストは「たまたま通った」ことがあるが、
 * これは書いた瞬間に落ちるので、後から壊れにくい。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CORE_DIR = new URL('../src/core/', import.meta.url);

function coreFiles(): Array<{ name: string; text: string }> {
  return readdirSync(CORE_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, text: readFileSync(new URL(name, CORE_DIR), 'utf8') }));
}

/** 使っていると結果が実行ごとに変わりうるもの */
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /Math\.random/, why: '結果が毎回変わってしまう' },
  { pattern: /Date\.now/, why: '実時刻に左右される' },
  { pattern: /performance\.now/, why: '実測時間に左右される' },
  { pattern: /\bnew Date\b/, why: '実時刻に左右される' },
  { pattern: /requestAnimationFrame/, why: '描画の都合が混ざる' },
  { pattern: /setTimeout|setInterval/, why: '実時間が混ざる' },
  { pattern: /\bdocument\./, why: '画面に依存する' },
  { pattern: /\bwindow\./, why: '実行環境に依存する' },
  { pattern: /\bnavigator\./, why: '実行環境に依存する' },
  { pattern: /localStorage|sessionStorage/, why: '外部の保存内容に依存する' },
  { pattern: /\bfetch\s*\(/, why: '外部の応答に依存する' },
];

describe('進行を決める側の独立性', () => {
  const files = coreFiles();

  it('対象のファイルが読めている', () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  for (const { pattern, why } of FORBIDDEN) {
    it(`${pattern.source} を使っていない（${why}）`, () => {
      const offenders = files.filter((file) => pattern.test(file.text)).map((file) => file.name);
      expect(offenders).toEqual([]);
    });
  }

  it('表示側のファイルを読み込んでいない', () => {
    const offenders = files
      .filter((file) => /from\s+'\.\.\/game/.test(file.text))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it('割り算の結果はかならず整数に落としてから使っている', () => {
    const rules = files.find((file) => file.name === 'rules.ts');
    expect(rules).toBeDefined();
    // 「/」を含む行は、Math.floor か |0 か >> のいずれかで整数に丸めていること
    const lines = rules!.text.split('\n');
    const suspicious = lines.filter((line) => {
      const code = line
        .replace(/'[^']*'/g, "''")
        .replace(/"[^"]*"/g, '""')
        .replace(/\/\/.*$/, '');
      if (!/[^/*]\/[^/*]/.test(code)) return false;
      return !(/Math\.floor/.test(code) || /\|\s*0/.test(code) || />>/.test(code));
    });
    expect(suspicious).toEqual([]);
  });
});

describe('数の扱い', () => {
  it('残り量も削り量も整数のまま扱える範囲に収まっている', async () => {
    const {
      MAX_DENSITY,
      SMASH_POWER,
      JAB_RADIUS,
      SMASH_RADIUS,
      VOXEL_COUNT,
      RUSH_RADIUS_SCALE,
      RUSH_POWER_PERCENT,
    } = await import('../src/core/constants');
    const maxRadius = (SMASH_RADIUS + 60 / 24) * RUSH_RADIUS_SCALE;
    const maxPower = Math.max(1, RUSH_POWER_PERCENT / 100) * (SMASH_POWER + 60 * 4);
    const r2 = maxRadius * maxRadius;
    // 削り量の計算の途中で出る最大値
    expect(maxPower * r2 * r2).toBeLessThan(Number.MAX_SAFE_INTEGER);
    // 減衰を重ねる途中の掛け算も安全な範囲に収まる
    expect(maxPower * r2).toBeLessThan(Number.MAX_SAFE_INTEGER);
    // 全部詰まっていても合計が安全に扱える
    expect(VOXEL_COUNT * MAX_DENSITY).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(MAX_DENSITY).toBe(255);
    expect(JAB_RADIUS).toBeLessThan(SMASH_RADIUS);
  });

  it('材質・深さ・網目の印を1バイトに詰めて取り出せる', async () => {
    const { MAX_PACKED_DEPTH, materialKind, onNet, surfaceDepth } = await import(
      '../src/core/shape'
    );
    for (let kind = 0; kind < 4; kind++) {
      for (let depth = 0; depth <= MAX_PACKED_DEPTH; depth += 3) {
        for (const net of [0, 128]) {
          const packed = kind | (depth << 2) | net;
          expect(packed).toBeLessThan(256);
          expect(materialKind(packed)).toBe(kind);
          expect(surfaceDepth(packed)).toBe(depth);
          expect(onNet(packed)).toBe(net !== 0);
        }
      }
    }
  });
});
