import './style.css';
import { Game } from './game/Game.js';
import { GameAudio } from './game/Audio.js';
import { NetSession } from './game/Net.js';

const canvas = document.getElementById('game-canvas');
const overlay = document.getElementById('orient-overlay');
const btnPractice = document.getElementById('btn-practice');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');
const btnStartMatch = document.getElementById('btn-start-match');
const btnLeaveLobby = document.getElementById('btn-leave-lobby');
const btnMute = document.getElementById('btn-mute');
const inputName = document.getElementById('input-name');
const inputRoom = document.getElementById('input-room');
const menuStatus = document.getElementById('menu-status');
const lobbyPanel = document.getElementById('lobby-panel');
const lobbyCodeText = document.getElementById('lobby-code-text');
const lobbyPlayers = document.getElementById('lobby-players');

const audio = new GameAudio();
let net = null;
let game = null;

try {
  const saved = localStorage.getItem('mcfps-name');
  if (saved) inputName.value = saved;
} catch {
  /* ignore */
}

function saveName() {
  try {
    localStorage.setItem('mcfps-name', (inputName.value || '').trim());
  } catch {
    /* ignore */
  }
}

function setStatus(text, isError = false) {
  if (!text) {
    menuStatus.hidden = true;
    menuStatus.textContent = '';
    return;
  }
  menuStatus.hidden = false;
  menuStatus.textContent = text;
  menuStatus.classList.toggle('error', isError);
}

function playerName() {
  return (inputName.value || '玩家').trim().slice(0, 12) || '玩家';
}

function syncMuteBtn() {
  btnMute.textContent = audio.muted ? '🔇' : '🔊';
  btnMute.classList.toggle('muted', audio.muted);
}
syncMuteBtn();

btnMute.addEventListener('click', (e) => {
  e.stopPropagation();
  audio.toggleMute();
  syncMuteBtn();
  audio.playUi();
});

function tryLockLandscape() {
  const el = document.documentElement;
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(() => {});
  }
  if (el.requestFullscreen) {
    el.requestFullscreen().catch(() => {});
  } else if (el.webkitRequestFullscreen) {
    el.webkitRequestFullscreen();
  }
}

function renderLobby(snap) {
  lobbyPanel.classList.remove('hidden');
  lobbyCodeText.textContent = snap.roomCode;
  lobbyPlayers.innerHTML = '';
  for (const p of snap.players) {
    const li = document.createElement('li');
    li.textContent = p.name || '玩家';
    if (p.host) li.classList.add('host');
    if (p.id === snap.localId) li.textContent += '（你）';
    lobbyPlayers.appendChild(li);
  }
  btnStartMatch.hidden = !snap.isHost;
  btnStartMatch.disabled = snap.players.length < 1;
  setStatus(snap.isHost ? '等待好友加入，人数够了可开始' : '已加入，等待房主开始…');
}

function hideMenuExtras() {
  document.querySelector('.menu-actions')?.classList.add('hidden');
  document.querySelector('.join-row')?.classList.add('hidden');
  document.querySelector('.field')?.classList.add('hidden');
}

function showMenuExtras() {
  document.querySelector('.menu-actions')?.classList.remove('hidden');
  document.querySelector('.join-row')?.classList.remove('hidden');
  document.querySelector('.field')?.classList.remove('hidden');
  lobbyPanel.classList.add('hidden');
}

async function beginPlay(mode) {
  await audio.unlock();
  audio.playUi();
  saveName();
  overlay.classList.add('hidden');
  document.body.classList.add('playing');
  tryLockLandscape();

  game = new Game(canvas, { mode, net: mode === 'pvp' ? net : null, audio });
  if (!('ontouchstart' in window)) {
    game.controls.requestPointerLock();
  }
  game.start();
}

function wireNetEvents(session) {
  session.on('lobby', (snap) => renderLobby(snap));
  session.on('error', (err) => setStatus(String(err), true));
  session.on('start', async () => {
    setStatus('对战开始！');
    await beginPlay('pvp');
  });
}

btnPractice.addEventListener('click', async () => {
  btnPractice.disabled = true;
  setStatus('加载中…');
  try {
    if (net) {
      net.destroy();
      net = null;
    }
    await beginPlay('practice');
  } catch (e) {
    setStatus(e.message || String(e), true);
    btnPractice.disabled = false;
  }
});

btnCreate.addEventListener('click', async () => {
  btnCreate.disabled = true;
  btnJoin.disabled = true;
  saveName();
  setStatus('正在创建房间（连接 PeerJS 信令）…');
  try {
    await audio.unlock();
    audio.playUi();
    if (net) net.destroy();
    net = new NetSession();
    wireNetEvents(net);
    const code = await net.createRoom(playerName());
    hideMenuExtras();
    renderLobby(net._lobbySnapshot());
    setStatus(`房间已创建：${code}`);
  } catch (e) {
    setStatus(e.message || String(e), true);
    btnCreate.disabled = false;
    btnJoin.disabled = false;
  }
});

btnJoin.addEventListener('click', async () => {
  const code = (inputRoom.value || '').trim();
  if (code.length < 4) {
    setStatus('请输入 4 位房间码', true);
    return;
  }
  btnCreate.disabled = true;
  btnJoin.disabled = true;
  saveName();
  setStatus('正在加入房间…');
  try {
    await audio.unlock();
    audio.playUi();
    if (net) net.destroy();
    net = new NetSession();
    wireNetEvents(net);
    await net.joinRoom(code, playerName());
    hideMenuExtras();
    renderLobby(net._lobbySnapshot());
  } catch (e) {
    setStatus(e.message || '加入失败，请检查房间码与网络', true);
    btnCreate.disabled = false;
    btnJoin.disabled = false;
    if (net) {
      net.destroy();
      net = null;
    }
  }
});

btnStartMatch.addEventListener('click', async () => {
  if (!net || !net.isHost) return;
  audio.playUi();
  net.startMatch();
});

btnLeaveLobby.addEventListener('click', () => {
  audio.playUi();
  if (net) {
    net.destroy();
    net = null;
  }
  showMenuExtras();
  btnCreate.disabled = false;
  btnJoin.disabled = false;
  btnPractice.disabled = false;
  setStatus('');
});

canvas.addEventListener('click', () => {
  if (!('ontouchstart' in window) && game?.running) {
    game.controls.requestPointerLock();
  }
});

document.addEventListener(
  'touchmove',
  (e) => {
    if (e.target.closest && (e.target.closest('input') || e.target.closest('button'))) return;
    if (!overlay.classList.contains('hidden')) return;
    e.preventDefault();
  },
  { passive: false }
);

// Allow CSS .hidden on menu sections
const style = document.createElement('style');
style.textContent = `.menu-actions.hidden, .join-row.hidden, .field.hidden { display: none !important; }`;
document.head.appendChild(style);
