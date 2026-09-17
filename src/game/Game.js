import * as THREE from 'three';
import { createArena, findSafeSpawn, softSeparateXZ, resolvePlayerCollisions } from './Arena.js';
import { TargetManager } from './Targets.js';
import { Controls } from './Controls.js';
import { Player } from './Player.js';
import { Weapon } from './Weapon.js';
import { GameAudio } from './Audio.js';
import { RemotePlayers } from './RemotePlayers.js';
import { createViewmodel } from './Humanoid.js';

const SPAWNS = [
  new THREE.Vector3(0, 1.6, 12),
  new THREE.Vector3(0, 1.6, -12),
  new THREE.Vector3(12, 1.6, 0),
  new THREE.Vector3(-12, 1.6, 0),
  new THREE.Vector3(8, 1.6, 8),
  new THREE.Vector3(-8, 1.6, -8),
];

export class Game {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ mode: 'practice'|'pvp', net?: import('./Net.js').NetSession, audio: GameAudio }} opts
   */
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.mode = opts.mode || 'practice';
    this.net = opts.net || null;
    this.audio = opts.audio;
    this.clock = new THREE.Clock();
    this.running = false;
    this._netAcc = 0;
    this._viewKick = 0;
    this._dmgNums = [];

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87a0b8);
    this.scene.fog = new THREE.Fog(0x87a0b8, 28, 55);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.05,
      120
    );

    const arena = createArena(this.scene);
    this.colliders = arena.colliders;
    this.spawnPoints = SPAWNS;

    this.targets = this.mode === 'practice' ? new TargetManager(this.scene, this.colliders) : null;
    this.remotes = new RemotePlayers(this.scene);
    this.controls = new Controls();

    const mySpawnIdx = this._spawnIndexFor(this.net?.localId);
    const spawnRaw = this.spawnPoints[mySpawnIdx % this.spawnPoints.length].clone();
    const spawn = findSafeSpawn(spawnRaw, 0.35, this.colliders, 1.6);
    this.player = new Player(this.camera, spawn);
    this.player.yaw = mySpawnIdx % 2 === 0 ? Math.PI : 0;
    this.player.ensureSafePosition(this.colliders);

    this.weapon = new Weapon();
    this.weapon.attachMuzzleFlash(this.camera);

    this.viewmodel = this._createViewmodel();
    this.camera.add(this.viewmodel);
    this.scene.add(this.camera);

    this._tracers = [];
    this.kills = 0;
    this.deaths = 0;

    this._bindHud();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);

    if (this.net) {
      this.net.on('net', (msg) => this._onNet(msg));
      this.net.on('peerLeft', ({ id }) => this.remotes.remove(id));
      // Seed remotes from lobby
      for (const p of this.net.players.values()) {
        if (p.id !== this.net.localId) this.remotes.ensure(p.id, p.name);
      }
    }
  }

  _spawnIndexFor(id) {
    if (!id) return 0;
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h % this.spawnPoints.length;
  }

  _createViewmodel() {
    return createViewmodel();
  }

  _bindHud() {
    this.elHealthFill = document.getElementById('health-fill');
    this.elHealthText = document.getElementById('health-text');
    this.elAmmoMag = document.getElementById('ammo-mag');
    this.elAmmoReserve = document.getElementById('ammo-reserve');
    this.elCrosshair = document.getElementById('crosshair');
    this.elHitMarker = document.getElementById('hit-marker');
    this.elKillFeed = document.getElementById('kill-feed');
    this.elHurtVignette = document.getElementById('hurt-vignette');
    this.elDmgLayer = document.getElementById('dmg-numbers');
    this.elScore = document.getElementById('score-panel');
    this.elRespawn = document.getElementById('respawn-overlay');
  }

  start() {
    this.running = true;
    this.clock.start();
    this._loop();
  }

  stop() {
    this.running = false;
  }

  _resize() {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  _loop = () => {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const time = this.clock.elapsedTime;

    // Death / respawn
    if (!this.player.alive) {
      if (this.player.respawnAt && time >= this.player.respawnAt) {
        const idx = this._spawnIndexFor(this.net?.localId || 'local');
        const spawnRaw = this.spawnPoints[(idx + this.deaths) % this.spawnPoints.length].clone();
        const spawn = findSafeSpawn(spawnRaw, this.player.radius, this.colliders, this.player.height);
        this.player.respawn(spawn, (idx + this.deaths) % 2 === 0 ? Math.PI : 0, this.colliders);
        this.weapon.resetAmmo();
        if (this.elRespawn) this.elRespawn.classList.add('hidden');
        this._sendNet({
          type: 'respawn',
          x: this.player.position.x,
          y: this.player.position.y,
          z: this.player.position.z,
          yaw: this.player.yaw,
        });
      }
    }

    this.player.update(dt, this.controls, this.colliders);
    this._separateFromRemotes();
    this.weapon.update(dt);
    if (this.targets) this.targets.update(dt, time);

    // Viewmodel settle
    this._viewKick = Math.max(0, this._viewKick - dt * 8);
    this.viewmodel.rotation.x = -this._viewKick * 0.9;
    this.viewmodel.position.z = this._viewKick * 0.04;
    this.viewmodel.position.y = -this._viewKick * 0.02;

    // Crosshair bloom visual
    const bloomPx = 4 + this.weapon.bloom * 180;
    if (this.elCrosshair) {
      this.elCrosshair.style.setProperty('--spread', `${bloomPx}px`);
      this.elCrosshair.classList.toggle('ads', this.controls.ads);
    }

    if (this.player.alive && this.controls.consumeReload()) {
      if (this.weapon.tryReload()) this.audio.playReload();
    }

    if (this.player.alive && this.controls.fire) {
      const shot = this.weapon.tryFire(this.camera, this.controls.ads);
      if (shot) {
        if (shot.empty) {
          this.audio.playEmpty();
        } else {
          this.audio.playFire();
          const recoil = this.weapon.consumeRecoil();
          this.player.applyRecoilKick(recoil.pitch, recoil.yaw);
          this._viewKick = Math.min(1, this._viewKick + 0.55);
          this.elCrosshair?.classList.add('firing');
          setTimeout(() => this.elCrosshair?.classList.remove('firing'), 45);
          this._spawnTracer(shot.origin, shot.direction);
          this._handleShot(shot, time);
          this._sendNet({
            type: 'shoot',
            ox: shot.origin.x,
            oy: shot.origin.y,
            oz: shot.origin.z,
            dx: shot.direction.x,
            dy: shot.direction.y,
            dz: shot.direction.z,
          });
        }
      }
    }

    // Footsteps
    if (this.player.alive && this.player.onGround) {
      this.audio.updateFootsteps(dt, this.player.moveSpeed01);
    }

    // Net state sync
    if (this.net && this.player.alive) {
      this._netAcc += dt;
      if (this._netAcc >= 1 / 20) {
        this._netAcc = 0;
        this._sendNet({
          type: 'state',
          x: this.player.position.x,
          y: this.player.position.y,
          z: this.player.position.z,
          yaw: this.player.yaw,
          pitch: this.player.pitch,
          hp: this.player.health,
          alive: this.player.alive,
          name: this.net.playerName,
        });
      }
    }

    this._updateTracers(dt);
    this._updateDmgNumbers(dt);
    this._updateHud();
    this.renderer.render(this.scene, this.camera);
  };

  _handleShot(shot, time) {
    // PvP remotes first
    if (this.mode === 'pvp') {
      const hit = this.remotes.raycast(shot.origin, shot.direction, 80, this.net?.localId);
      if (hit) {
        const dmg = Math.round(this.weapon.damage * (hit.headshot ? this.weapon.headMultiplier : 1));
        this._showHitMarker(hit.headshot);
        this._spawnDmgNumber(dmg, hit.headshot);
        this.audio.playHit(hit.headshot);
        this._sendNet({
          type: 'damage',
          targetId: hit.remote.id,
          amount: dmg,
          headshot: hit.headshot,
        });
        return;
      }
    }

    if (this.targets) {
      const hit = this.targets.raycast(shot.origin, shot.direction);
      if (hit) {
        const dmg = this.weapon.damage * (hit.headshot ? this.weapon.headMultiplier : 1);
        const killed = this.targets.applyDamage(hit.target, dmg, time);
        this._showHitMarker(hit.headshot);
        this._spawnDmgNumber(Math.round(dmg), hit.headshot);
        this.audio.playHit(hit.headshot);
        if (killed) {
          this.audio.playKill();
          this._pushFeed(hit.headshot ? '爆头击倒靶子' : '击倒靶子');
        }
      }
    }
  }

  _onNet(msg) {
    if (!msg || msg.from === this.net?.localId) return;
    switch (msg.type) {
      case 'state': {
        this.remotes.applyState(msg.from, msg, msg.name, this.colliders);
        break;
      }
      case 'shoot': {
        const origin = new THREE.Vector3(msg.ox, msg.oy, msg.oz);
        const dir = new THREE.Vector3(msg.dx, msg.dy, msg.dz);
        this._spawnTracer(origin, dir);
        break;
      }
      case 'damage': {
        if (msg.targetId === this.net?.localId && this.player.alive) {
          const died = this.player.takeDamage(msg.amount);
          this.audio.playHurt();
          if (died) {
            this.deaths += 1;
            this.player.respawnAt = this.clock.elapsedTime + 3;
            if (this.elRespawn) {
              this.elRespawn.classList.remove('hidden');
              this.elRespawn.querySelector('.respawn-text').textContent = '你被击倒 · 3 秒后重生';
            }
            this._sendNet({ type: 'died', killerId: msg.from, headshot: !!msg.headshot });
            this._pushFeed(`${this._nameOf(msg.from)} 击杀了你`);
          }
        }
        break;
      }
      case 'died': {
        if (msg.killerId === this.net?.localId) {
          this.kills += 1;
          this.audio.playKill();
          this._showHitMarker(true, true);
          this._pushFeed(msg.headshot ? '爆头击杀！' : '击杀敌人');
        }
        this.remotes.setAlive(msg.from, false, 0);
        const killer = this._nameOf(msg.killerId);
        const victim = this._nameOf(msg.from);
        if (msg.killerId !== this.net?.localId) {
          this._pushFeed(`${killer} 击杀 ${victim}`);
        }
        break;
      }
      case 'respawn': {
        this.remotes.applyState(
          msg.from,
          { x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, alive: true, hp: 100 },
          this._nameOf(msg.from),
          this.colliders
        );
        break;
      }
      default:
        break;
    }
  }

  _separateFromRemotes() {
    if (!this.player.alive) return;
    let pushed = false;
    for (const r of this.remotes.remotes.values()) {
      if (!r.alive) continue;
      if (softSeparateXZ(this.player.position, { x: r.x, z: r.z }, this.player.radius, r.radius, 0.5)) {
        pushed = true;
      }
    }
    if (!pushed) return;
    const depen = resolvePlayerCollisions(this.player.position, this.player.radius, this.colliders);
    this.player.position.x = depen.x;
    this.player.position.z = depen.z;
    // Keep camera in sync after soft push (player.update already placed it)
    this.camera.position.x = this.player.position.x;
    this.camera.position.z = this.player.position.z;
  }

  _nameOf(id) {
    if (!id) return '未知';
    if (id === this.net?.localId) return this.net.playerName || '你';
    const p = this.net?.players.get(id);
    if (p) return p.name;
    const r = this.remotes.remotes.get(id);
    return r?.name || '玩家';
  }

  _sendNet(payload) {
    if (this.net) this.net.send(payload);
  }

  _kickViewmodel() {
    this._viewKick = Math.min(1, this._viewKick + 0.55);
  }

  _spawnTracer(origin, direction) {
    const end = origin.clone().addScaledVector(direction, 45);
    const geom = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const line = new THREE.Line(
      geom,
      new THREE.LineBasicMaterial({ color: 0xffe082, transparent: true, opacity: 0.8 })
    );
    this.scene.add(line);
    this._tracers.push({ line, life: 0.05 });
  }

  _updateTracers(dt) {
    for (let i = this._tracers.length - 1; i >= 0; i--) {
      const t = this._tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this._tracers.splice(i, 1);
      }
    }
  }

  _showHitMarker(headshot = false, kill = false) {
    if (!this.elHitMarker) return;
    this.elHitMarker.hidden = false;
    this.elHitMarker.classList.remove('show', 'headshot', 'kill');
    void this.elHitMarker.offsetWidth;
    if (kill) this.elHitMarker.classList.add('kill');
    else if (headshot) this.elHitMarker.classList.add('headshot');
    this.elHitMarker.classList.add('show');
  }

  _spawnDmgNumber(amount, headshot) {
    if (!this.elDmgLayer) return;
    const el = document.createElement('div');
    el.className = 'dmg-num' + (headshot ? ' headshot' : '');
    el.textContent = String(amount);
    const ox = (Math.random() - 0.5) * 80;
    const oy = (Math.random() - 0.5) * 40 - 20;
    el.style.setProperty('--ox', `${ox}px`);
    el.style.setProperty('--oy', `${oy}px`);
    this.elDmgLayer.appendChild(el);
    this._dmgNums.push({ el, life: 0.7 });
  }

  _updateDmgNumbers(dt) {
    for (let i = this._dmgNums.length - 1; i >= 0; i--) {
      const d = this._dmgNums[i];
      d.life -= dt;
      if (d.life <= 0) {
        d.el.remove();
        this._dmgNums.splice(i, 1);
      }
    }
  }

  _pushFeed(text) {
    if (!this.elKillFeed) return;
    const row = document.createElement('div');
    row.textContent = text;
    this.elKillFeed.prepend(row);
    setTimeout(() => row.remove(), 2500);
    while (this.elKillFeed.children.length > 5) {
      this.elKillFeed.lastChild.remove();
    }
  }

  _updateHud() {
    const hp = Math.max(0, Math.round(this.player.health));
    if (this.elHealthFill) this.elHealthFill.style.width = `${(hp / this.player.maxHealth) * 100}%`;
    if (this.elHealthText) this.elHealthText.textContent = String(hp);
    if (this.elAmmoMag) {
      this.elAmmoMag.textContent = this.weapon.isReloading ? '...' : String(this.weapon.ammoInMag);
    }
    if (this.elAmmoReserve) this.elAmmoReserve.textContent = String(this.weapon.reserve);
    if (this.elHurtVignette) {
      this.elHurtVignette.style.opacity = String(Math.min(0.85, this.player._hurtFlash * 2.2));
    }
    if (this.elScore) {
      this.elScore.textContent =
        this.mode === 'pvp' ? `击杀 ${this.kills} · 死亡 ${this.deaths}` : `练习模式`;
    }
    if (!this.player.alive && this.elRespawn && !this.elRespawn.classList.contains('hidden')) {
      const left = Math.max(0, (this.player.respawnAt || 0) - this.clock.elapsedTime);
      const t = this.elRespawn.querySelector('.respawn-text');
      if (t) t.textContent = `你被击倒 · ${left.toFixed(1)} 秒后重生`;
    }
  }
}
