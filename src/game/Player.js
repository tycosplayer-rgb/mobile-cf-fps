import * as THREE from 'three';
import { resolvePlayerCollisions } from './Arena.js';

export class Player {
  constructor(camera, spawn) {
    this.camera = camera;
    this.spawn = spawn.clone();
    this.position = spawn.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = Math.PI;
    this.pitch = 0;
    this.height = 1.6;
    this.radius = 0.35;
    this.speed = 6.5;
    this.adsSpeedMul = 0.55;
    this.jumpSpeed = 7.5;
    this.gravity = 22;
    this.onGround = true;
    this.health = 100;
    this.maxHealth = 100;
    this.alive = true;
    this.respawnAt = 0;
    this.baseFov = 75;
    this.adsFov = 50;

    // Recoil recovery & shake
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.shake = 0;
    this._hurtFlash = 0;

    this.camera.position.copy(this.position);
    this.camera.rotation.order = 'YXZ';
  }

  applyLook(dx, dy) {
    this.yaw -= dx;
    this.pitch -= dy;
    const lim = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  applyRecoilKick(pitch, yaw) {
    // Temporary visual/camera kick only — never bake into look aim (pitch/yaw).
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
    this.shake = Math.min(1, this.shake + 0.35);
    this._applyCameraOrientation();
  }

  _applyCameraOrientation() {
    const lim = Math.PI / 2 - 0.05;
    // Positive recoilPitch kicks view UP; decays back to true aim each frame.
    this.camera.rotation.y = this.yaw + this.recoilYaw;
    this.camera.rotation.x = Math.max(-lim, Math.min(lim, this.pitch + this.recoilPitch));
  }

  takeDamage(amount) {
    if (!this.alive) return false;
    this.health = Math.max(0, this.health - amount);
    this._hurtFlash = 0.35;
    this.shake = Math.min(1, this.shake + 0.5);
    if (this.health <= 0) {
      this.alive = false;
      this.health = 0;
      return true; // died
    }
    return false;
  }

  respawn(spawnPos, yaw = Math.PI) {
    const p = spawnPos || this.spawn;
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.onGround = true;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.shake = 0;
    this.respawnAt = 0;
  }

  update(dt, controls, colliders) {
    // Recoil offset decays toward 0 — true aim (pitch/yaw) stays where the player pointed.
    this.recoilPitch *= Math.pow(0.04, dt);
    this.recoilYaw *= Math.pow(0.04, dt);
    if (Math.abs(this.recoilPitch) < 1e-5) this.recoilPitch = 0;
    if (Math.abs(this.recoilYaw) < 1e-5) this.recoilYaw = 0;
    this.shake = Math.max(0, this.shake - dt * 3.5);
    this._hurtFlash = Math.max(0, this._hurtFlash - dt);

    if (!this.alive) {
      this.camera.position.copy(this.position);
      this._applyCameraOrientation();
      return;
    }

    controls.syncKeyboardMove();
    const look = controls.consumeLook();
    const ads = controls.ads;
    const sensScale = ads ? 0.55 : 1;
    this.applyLook(look.x * sensScale, look.y * sensScale);

    const speed = this.speed * (ads ? this.adsSpeedMul : 1);
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const wish = new THREE.Vector3();
    wish.addScaledVector(right, controls.move.x);
    wish.addScaledVector(forward, controls.move.y);
    if (wish.lengthSq() > 1) wish.normalize();

    this.velocity.x = wish.x * speed;
    this.velocity.z = wish.z * speed;

    if (controls.consumeJump() && this.onGround) {
      this.velocity.y = this.jumpSpeed;
      this.onGround = false;
    }

    this.velocity.y -= this.gravity * dt;

    const next = this.position.clone();
    next.x += this.velocity.x * dt;
    next.z += this.velocity.z * dt;
    const resolved = resolvePlayerCollisions(next, this.radius, colliders);
    this.position.x = resolved.x;
    this.position.z = resolved.z;

    this.position.y += this.velocity.y * dt;
    if (this.position.y <= this.height) {
      this.position.y = this.height;
      this.velocity.y = 0;
      this.onGround = true;
    }

    // Screen shake offset
    const sx = (Math.random() - 0.5) * this.shake * 0.06;
    const sy = (Math.random() - 0.5) * this.shake * 0.06;
    this.camera.position.set(this.position.x + sx, this.position.y + sy, this.position.z);
    this._applyCameraOrientation();

    const targetFov = ads ? this.adsFov : this.baseFov;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
    this.camera.updateProjectionMatrix();
  }

  get moveSpeed01() {
    return Math.min(1, Math.hypot(this.velocity.x, this.velocity.z) / this.speed);
  }
}
