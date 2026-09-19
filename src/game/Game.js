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
    this._dmgDirArcs = [];

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
    /** Ignore round-wipe checks briefly after a shared respawn (avoids re-trigger loops). */
    this._respawnGraceUntil = 0;

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
    this.elDamageDir = document.getElementById('damage-dir');
    this.elDmgLayer = document.getElementById('dmg-numbers');
    this.elScore = document.getElementById('score-panel');
    this.elEnemyCount = document.getElementById('enemy-count');
    this.elInvulnerability = document.getElementById('invulnerability-status');
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

    // Death / respawn — PvP round wipe (dead wait; last survivor also ends the round).
    // Practice bots use TargetManager wave/all-clear (see Targets.js).
    if (!this.player.alive || (this.mode === 'pvp' && this._roundWipeReady())) {
      this._updateRoundRespawn(time);
    }

    this.player.update(dt, this.controls, this.colliders);
    this._separateFromRemotes();
    this.weapon.update(dt);
    if (this.targets) {
      this.targets.update(dt, time, {
        playerAlive: this.player.alive,
        playerEye: this.player.position,
        playerRadius: this.player.radius,
        playerHeight: this.player.height,
        onBotShot: (shot) => this._onBotShot(shot),
      });
    }

    // FP viewmodel: idle sway, walk bob/swing, fire kick, reload motion
    if (this.viewmodel?.userData?.update) {
      this.viewmodel.userData.update(dt, {
        speed01: this.player.alive ? this.player.moveSpeed01 : 0,
        ads: this.controls.ads,
        reloading: this.weapon.isReloading,
        time,
      });
    }
    // Third-person remote arm fire-kick decay
    this.remotes.update(dt);

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
          if (this.viewmodel?.userData?.triggerFire) this.viewmodel.userData.triggerFire();
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
          spawnProtected: this.player.isInvulnerable,
          name: this.net.playerName,
        });
      }
    }

    this._updateTracers(dt);
    this._updateDmgNumbers(dt);
    this._updateDamageDir(dt);
    this._updateHud();
    this.renderer.render(this.scene, this.camera);
  };

  _handleShot(shot, time) {
    // PvP remotes first
    if (this.mode === 'pvp') {
      const hit = this.remotes.raycast(shot.origin, shot.direction, 80, this.net?.localId);
      if (hit) {
        if (hit.remote.spawnProtected) return;
        const dmg = Math.round(this.weapon.damage * (hit.headshot ? this.weapon.headMultiplier : 1));
        this._showHitMarker(hit.headshot);
        this._spawnDmgNumber(dmg, hit.headshot);
        this.audio.playHit(hit.headshot);
        this._sendNet({
          type: 'damage',
          targetId: hit.remote.id,
          amount: dmg,
          headshot: hit.headshot,
          ox: shot.origin.x,
          oy: shot.origin.y,
          oz: shot.origin.z,
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
        this.remotes.triggerFire(msg.from);
        break;
      }
      case 'damage': {
        if (msg.targetId === this.net?.localId && this.player.alive) {
          let fromPos = null;
          if (typeof msg.ox === 'number' && typeof msg.oz === 'number') {
            fromPos = { x: msg.ox, y: msg.oy ?? this.player.position.y, z: msg.oz };
          } else {
            const attacker = this.remotes.remotes.get(msg.from);
            if (attacker) fromPos = { x: attacker.x, y: attacker.y, z: attacker.z };
          }
          this._applyLocalDamage(msg.amount, fromPos, {
            killerId: msg.from,
            headshot: !!msg.headshot,
            pvp: true,
          });
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
          {
            x: msg.x,
            y: msg.y,
            z: msg.z,
            yaw: msg.yaw,
            alive: true,
            hp: 100,
            spawnProtected: msg.spawnProtected !== false,
          },
          this._nameOf(msg.from),
          this.colliders
        );
        break;
      }
      default:
        break;
    }
  }

  /** Count living combatants (local + remotes). */
  _aliveCount() {
    let n = this.player.alive ? 1 : 0;
    for (const r of this.remotes.remotes.values()) {
      if (r.alive) n += 1;
    }
    return n;
  }

  /**
   * Round should end when nobody is left fighting:
   * - 0 alive (everyone dead), or
   * - ≤1 alive with 2+ participants (last survivor → round wipe so dead are not stuck).
   * Solo PvP (no remotes): dead local may self-respawn after the shared delay.
   */
  _roundWipeReady() {
    if (this.clock.elapsedTime < this._respawnGraceUntil) return false;
    if (this.mode !== 'pvp') return !this.player.alive;
    const alive = this._aliveCount();
    const participants = 1 + this.remotes.remotes.size;
    if (participants < 2) return !this.player.alive;
    return alive <= 1;
  }

  /**
   * PvP round wipe: dead players spectate until the round is over (all eliminated
   * or only one left), then a short shared delay and everyone respawns.
   * Practice bots use TargetManager wave/all-clear respawn instead.
   */
  _updateRoundRespawn(time) {
    const wipe = this._roundWipeReady();
    if (!wipe) {
      this.player.respawnAt = 0;
      return;
    }
    if (!this.player.respawnAt) {
      this.player.respawnAt = time + 2.5;
    }
    if (time < this.player.respawnAt) return;

    // If we were the last survivor, still force a round respawn with the others
    const idx = this._spawnIndexFor(this.net?.localId || 'local');
    const spawnRaw = this.spawnPoints[(idx + this.deaths) % this.spawnPoints.length].clone();
    const spawn = findSafeSpawn(spawnRaw, this.player.radius, this.colliders, this.player.height);
    this.player.respawn(spawn, (idx + this.deaths) % 2 === 0 ? Math.PI : 0, this.colliders);
    this.weapon.resetAmmo();
    this._respawnGraceUntil = time + 4;
    this.player.respawnAt = 0;
    if (this.elRespawn) this.elRespawn.classList.add('hidden');
    this._sendNet({
      type: 'respawn',
      x: this.player.position.x,
      y: this.player.position.y,
      z: this.player.position.z,
      yaw: this.player.yaw,
      spawnProtected: this.player.isInvulnerable,
    });
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

  _onBotShot(shot) {
    this._spawnTracer(shot.origin, shot.direction);
    // Soft fire cue so practice bots feel armed
    this.audio.playFire();
    if (shot.hitPlayer && shot.damage > 0 && this.player.alive) {
      this._applyLocalDamage(shot.damage, shot.origin, { pvp: false });
    }
  }

  /**
   * Apply damage to the local player (NPC or remote). Shows hurt VFX/SFX,
   * red damage-direction arc, and handles death / wipe wait overlay.
   * @param {number} amount
   * @param {{x:number,y?:number,z:number}|null} fromWorldPos
   * @param {{ killerId?: string, headshot?: boolean, pvp?: boolean }} [meta]
   */
  _applyLocalDamage(amount, fromWorldPos = null, meta = {}) {
    if (!this.player.alive || amount <= 0 || this.player.isInvulnerable) return false;
    const died = this.player.takeDamage(amount);
    this.audio.playHurt();
    if (fromWorldPos) this._showDamageDir(fromWorldPos);

    if (died) {
      this.deaths += 1;
      this.player.respawnAt = 0; // armed by round-wipe / practice delay
      if (this.elRespawn) {
        this.elRespawn.classList.remove('hidden');
        const t = this.elRespawn.querySelector('.respawn-text');
        if (t) {
          t.textContent =
            this.mode === 'pvp'
              ? '你被击倒 · 等待全部淘汰后重生'
              : '你被击倒 · 等待回合结束后重生';
        }
      }
      if (meta.pvp && meta.killerId) {
        this._sendNet({
          type: 'died',
          killerId: meta.killerId,
          headshot: !!meta.headshot,
        });
        this._pushFeed(`${this._nameOf(meta.killerId)} 击杀了你`);
      } else if (!meta.pvp) {
        this._pushFeed('被练习靶击倒');
      }
    }
    return died;
  }

  /**
   * Red ring arc toward attacker azimuth relative to look yaw (0 = forward/top).
   */
  _showDamageDir(fromWorldPos) {
    if (!this.elDamageDir || !fromWorldPos) return;
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const yaw = this.player.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const toX = fromWorldPos.x - px;
    const toZ = fromWorldPos.z - pz;
    if (toX * toX + toZ * toZ < 1e-6) return;
    const forwardDot = toX * fx + toZ * fz;
    const rightDot = toX * rx + toZ * rz;
    // 0 = front (screen top), + = right (clockwise) — matches CSS conic-gradient
    const angDeg = (Math.atan2(rightDot, forwardDot) * 180) / Math.PI;

    const el = document.createElement('div');
    el.className = 'damage-dir-arc';
    el.style.setProperty('--ang', `${angDeg}deg`);
    this.elDamageDir.appendChild(el);
    this._dmgDirArcs.push({ el, life: 1.0 });
    // Cap simultaneous arcs (mobile perf)
    while (this._dmgDirArcs.length > 8) {
      const oldArc = this._dmgDirArcs.shift();
      oldArc.el.remove();
    }
  }

  _updateDamageDir(dt) {
    for (let i = this._dmgDirArcs.length - 1; i >= 0; i--) {
      const a = this._dmgDirArcs[i];
      a.life -= dt;
      if (a.life <= 0) {
        a.el.remove();
        this._dmgDirArcs.splice(i, 1);
      }
    }
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
    if (this.viewmodel?.userData?.triggerFire) this.viewmodel.userData.triggerFire();
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
    if (this.elEnemyCount) {
      if (this.targets) {
        const total = this.targets.targets.length;
        const alive = this.targets.targets.reduce((count, target) => count + (target.alive ? 1 : 0), 0);
        this.elEnemyCount.textContent = `敌人 ${alive}/${total}`;
      } else {
        const opponents = [...this.remotes.remotes.values()];
        const alive = opponents.reduce((count, opponent) => count + (opponent.alive ? 1 : 0), 0);
        this.elEnemyCount.textContent = `对手 ${alive}/${opponents.length}`;
      }
    }
    if (this.elInvulnerability) {
      const remaining = this.player.invulnerabilityRemaining;
      this.elInvulnerability.hidden = remaining <= 0;
      if (remaining > 0) this.elInvulnerability.textContent = `无敌 · ${remaining.toFixed(1)}s`;
    }
    if (!this.player.alive && this.elRespawn && !this.elRespawn.classList.contains('hidden')) {
      const t = this.elRespawn.querySelector('.respawn-text');
      if (t) {
        if (this.player.respawnAt && this._roundWipeReady()) {
          const left = Math.max(0, this.player.respawnAt - this.clock.elapsedTime);
          t.textContent = `回合结束 · ${left.toFixed(1)} 秒后共同重生`;
        } else {
          t.textContent = '你被击倒 · 等待全部淘汰后重生';
        }
      }
    }
  }
}
