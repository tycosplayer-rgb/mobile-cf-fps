import * as THREE from 'three';
import { createArena } from './Arena.js';
import { TargetManager } from './Targets.js';
import { Controls } from './Controls.js';
import { Player } from './Player.js';
import { Weapon } from './Weapon.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.running = false;

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
    this.targets = new TargetManager(this.scene);
    this.controls = new Controls();
    this.player = new Player(this.camera, arena.spawn);
    this.weapon = new Weapon();
    this.weapon.attachMuzzleFlash(this.camera);

    // Simple weapon viewmodel (box gun)
    this.viewmodel = this._createViewmodel();
    this.camera.add(this.viewmodel);
    this.scene.add(this.camera);

    // Bullet tracers pool
    this._tracers = [];

    this._bindHud();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
  }

  _createViewmodel() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.35 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.55), mat);
    body.position.set(0.22, -0.18, -0.45);
    g.add(body);
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8, roughness: 0.3 })
    );
    barrel.position.set(0.22, -0.14, -0.78);
    g.add(barrel);
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.18, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
    );
    grip.position.set(0.22, -0.3, -0.35);
    grip.rotation.x = 0.35;
    g.add(grip);
    return g;
  }

  _bindHud() {
    this.elHealthFill = document.getElementById('health-fill');
    this.elHealthText = document.getElementById('health-text');
    this.elAmmoMag = document.getElementById('ammo-mag');
    this.elAmmoReserve = document.getElementById('ammo-reserve');
    this.elCrosshair = document.getElementById('crosshair');
    this.elHitMarker = document.getElementById('hit-marker');
    this.elKillFeed = document.getElementById('kill-feed');
  }

  start() {
    this.running = true;
    this.clock.start();
    this._loop();
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

    this.player.update(dt, this.controls, this.colliders);
    this.weapon.update(dt);
    this.targets.update(dt, time);

    if (this.controls.consumeReload()) {
      this.weapon.tryReload();
    }

    // Fire (hold to spray)
    if (this.controls.fire) {
      const shot = this.weapon.tryFire(this.camera, this.controls.ads);
      if (shot) {
        this.elCrosshair.classList.add('firing');
        setTimeout(() => this.elCrosshair.classList.remove('firing'), 50);
        this._kickViewmodel();
        this._spawnTracer(shot.origin, shot.direction);
        const hit = this.targets.raycast(shot.origin, shot.direction);
        if (hit) {
          const dmg = this.weapon.damage * (hit.headshot ? this.weapon.headMultiplier : 1);
          const killed = this.targets.applyDamage(hit.target, dmg, time);
          this._showHitMarker();
          if (killed) this._pushFeed(hit.headshot ? '爆头击倒目标' : '击倒目标');
        }
      }
    }

    this._updateTracers(dt);
    this._updateHud();
    this.renderer.render(this.scene, this.camera);
  };

  _kickViewmodel() {
    this.viewmodel.rotation.x = -0.08;
    // ease back each frame via small lerp in update — quick setTimeout reset
    clearTimeout(this._kickTimer);
    this._kickTimer = setTimeout(() => {
      this.viewmodel.rotation.x = 0;
    }, 60);
  }

  _spawnTracer(origin, direction) {
    const end = origin.clone().addScaledVector(direction, 40);
    const geom = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const line = new THREE.Line(
      geom,
      new THREE.LineBasicMaterial({ color: 0xffe082, transparent: true, opacity: 0.85 })
    );
    this.scene.add(line);
    this._tracers.push({ line, life: 0.06 });
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

  _showHitMarker() {
    this.elHitMarker.hidden = false;
    this.elHitMarker.classList.remove('show');
    // reflow
    void this.elHitMarker.offsetWidth;
    this.elHitMarker.classList.add('show');
  }

  _pushFeed(text) {
    const row = document.createElement('div');
    row.textContent = text;
    this.elKillFeed.prepend(row);
    setTimeout(() => row.remove(), 2200);
    while (this.elKillFeed.children.length > 4) {
      this.elKillFeed.lastChild.remove();
    }
  }

  _updateHud() {
    const hp = Math.max(0, Math.round(this.player.health));
    this.elHealthFill.style.width = `${(hp / this.player.maxHealth) * 100}%`;
    this.elHealthText.textContent = String(hp);
    this.elAmmoMag.textContent = this.weapon._reloading ? '...' : String(this.weapon.ammoInMag);
    this.elAmmoReserve.textContent = String(this.weapon.reserve);
  }
}
