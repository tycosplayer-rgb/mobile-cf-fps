import * as THREE from 'three';
import { resolvePlayerCollisions } from './Arena.js';

export class Player {
  constructor(camera, spawn) {
    this.camera = camera;
    this.position = spawn.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = Math.PI; // face toward -Z / arena center from z=12
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
    this.baseFov = 75;
    this.adsFov = 50;

    this.camera.position.copy(this.position);
    this.camera.rotation.order = 'YXZ';
  }

  applyLook(dx, dy) {
    this.yaw -= dx;
    this.pitch -= dy;
    const lim = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  update(dt, controls, colliders) {
    controls.syncKeyboardMove();
    const look = controls.consumeLook();
    const ads = controls.ads;
    // Slightly lower look sens when ADS
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

    // Integrate XZ with collision
    const next = this.position.clone();
    next.x += this.velocity.x * dt;
    next.z += this.velocity.z * dt;
    const resolved = resolvePlayerCollisions(next, this.radius, colliders);
    this.position.x = resolved.x;
    this.position.z = resolved.z;

    // Y
    this.position.y += this.velocity.y * dt;
    if (this.position.y <= this.height) {
      this.position.y = this.height;
      this.velocity.y = 0;
      this.onGround = true;
    }

    this.camera.position.copy(this.position);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // FOV blend for ADS
    const targetFov = ads ? this.adsFov : this.baseFov;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
    this.camera.updateProjectionMatrix();
  }
}
