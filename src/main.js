import './style.css';
import { Game } from './game/Game.js';

const canvas = document.getElementById('game-canvas');
const overlay = document.getElementById('orient-overlay');
const btnStart = document.getElementById('btn-start');

const game = new Game(canvas);

function tryLockLandscape() {
  const el = document.documentElement;
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(() => {});
  }
  // Fullscreen helps on mobile
  if (el.requestFullscreen) {
    el.requestFullscreen().catch(() => {});
  } else if (el.webkitRequestFullscreen) {
    el.webkitRequestFullscreen();
  }
}

btnStart.addEventListener('click', () => {
  overlay.classList.add('hidden');
  tryLockLandscape();
  // Pointer lock for desktop testing
  if (!('ontouchstart' in window)) {
    game.controls.requestPointerLock();
  }
  if (!game.running) game.start();
});

// Click canvas again to re-acquire pointer lock on desktop
canvas.addEventListener('click', () => {
  if (!('ontouchstart' in window) && game.running) {
    game.controls.requestPointerLock();
  }
});

// Prevent page scroll / bounce on iOS
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.target.closest && e.target.closest('#btn-start')) return;
    if (!overlay.classList.contains('hidden')) return;
    e.preventDefault();
  },
  { passive: false }
);
