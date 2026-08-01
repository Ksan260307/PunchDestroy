import './styles.css';
import { Game } from './game/app';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`画面の要素が見つかりません: ${id}`);
  return found as T;
}

const stage = element<HTMLDivElement>('stage');
const scene = element<HTMLCanvasElement>('scene');
const overlay = element<HTMLCanvasElement>('overlay');

const game = new Game(stage, scene, overlay);
game.showTitle();

function onClick(id: string, action: () => void): void {
  element<HTMLButtonElement>(id).addEventListener('click', (event) => {
    event.stopPropagation();
    action();
  });
}

onClick('start', () => game.begin());
onClick('again', () => game.begin());
onClick('watch', () => game.replayLast());
onClick('back', () => game.showTitle());
onClick('recenter', () => game.recenter());
onClick('restart', () => game.restart());
onClick('home', () => game.showTitle());

const muteButton = element<HTMLButtonElement>('mute');
muteButton.addEventListener('click', (event) => {
  event.stopPropagation();
  muteButton.classList.toggle('off', !game.toggleSound());
});

// スクロールや拡大でゲームがずれないようにする
document.addEventListener(
  'touchmove',
  (event) => {
    if (event.touches.length > 1) event.preventDefault();
  },
  { passive: false },
);
document.addEventListener('gesturestart', (event) => event.preventDefault());
document.addEventListener('dblclick', (event) => event.preventDefault());
