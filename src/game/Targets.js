import * as THREE from 'three';
import { resolvePlayerCollisions, findSafeSpawn, hasLineOfSight, raycastAabb } from './Arena.js';
import { createHumanoid } from './Humanoid.js';

const TARGET_RADIUS = 0.55;
const TARGET_HEIGHT = 1.7;

/** Balance knobs for practice-bot combat */
export const BOT_DAMAGE = 14;
export const BOT_HEAD_MULT = 1.6;
export const BOT_FIRE_MIN = 0.55;
export const BOT_FIRE_MAX = 0.95;
export const BOT_SPREAD = 0.045;
export const BOT_RANGE = 26;
export const BOT_ENGAGE = 22;
export const BOT_MUZZLE_Y = 1.35;

/**
 * Practice dummy bots — low-poly humanoids that patrol and fight the player.
 * Respawn rule (wave / all-clear): a dead bot stays dead until EVERY bot
 * is eliminated, then all respawn together after a short delay.
 * Hit tests still use TARGET_RADIUS / TARGET_HEIGHT capsules.
 */
export class TargetManager {
  constructor(scene, colliders = []) {
    this.scene = scene;
    this.colliders = colliders;
    this.targets = [];
    this._tmp = new THREE.Vector3();
    this._aim = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    /** @type {number} elapsedTime when the whole wave should revive (0 = none) */
    this.waveRespawnAt = 0;
    this.waveRespawnDelay = 2.5;

    const spots = [
      { x: -8, z: -6, color: 0xe53935 },
      { x: 6, z: -8, color: 0x1e88e5 },
      { x: -3, z: 4, color: 0x43a047 },
      { x: 10, z: 6, color: 0xfb8c00 },
      { x: 0, z: -14, color: 0x8e24aa },
      { x: -12, z: 8, color: 0xc62828 },
    ];

    for (const s of spots) {
      let x = s.x;
      let z = s.z;
      if (this.colliders.length) {
        const safe = findSafeSpawn(new THREE.Vector3(x, 0, z), TARGET_RADIUS, this.colliders, 0);
        x = safe.x;
        z = safe.z;
      }
      this.targets.push(this._spawn(x, z, s.color));
    }
  }

  _spawn(x, z, color) {
    const human = createHumanoid(color, { height: TARGET_HEIGHT, showRifle: true, helmet: true });
    const group = human.group;
    group.position.set(x, 0, z);

    // Soft white halo ring so bots stay readable as practice targets
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.035, 6, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);

    this.scene.add(group);

    return {
      group,
      body: human.body,
      human,
      alive: true,
      hp: 100,
      maxHp: 100,
      baseColor: color,
      home: new THREE.Vector3(x, 0, z),
      patrolPhase: Math.random() * Math.PI * 2,
      _fireCd: 0.8 + Math.random() * 1.4,
      _engage: false,
      radius: TARGET_RADIUS,
      height: TARGET_HEIGHT,
    };
  }

  /**
   * @param {number} dt
   * @param {number} time
   * @param {{
   *   playerAlive: boolean,
   *   playerEye: THREE.Vector3,
   *   playerRadius?: number,
   *   playerHeight?: number,
   *   onBotShot?: (shot: {
   *     origin: THREE.Vector3,
   *     direction: THREE.Vector3,
   *     damage: number,
   *     hitPlayer: boolean,
   *     headshot: boolean,
   *   }) => void,
   * }} [ctx]
   */
  update(dt, time, ctx = null) {
    // Wave clear: when every bot is dead, schedule one shared respawn
    const anyAlive = this.targets.some((t) => t.alive);
    if (!anyAlive && this.targets.length) {
      if (!this.waveRespawnAt) {
        this.waveRespawnAt = time + this.waveRespawnDelay;
      } else if (time >= this.waveRespawnAt) {
        this._respawnAll();
        this.waveRespawnAt = 0;
      }
    } else {
      this.waveRespawnAt = 0;
    }

    const playerAlive = !!ctx?.playerAlive;
    const playerEye = ctx?.playerEye;
    const playerRadius = ctx?.playerRadius ?? 0.35;
    const playerHeight = ctx?.playerHeight ?? 1.6;
    const onBotShot = ctx?.onBotShot;

    for (const t of this.targets) {
      if (!t.alive) continue;

      t._fireCd = (t._fireCd ?? 1) - dt;

      let engaging = false;
      let distToPlayer = Infinity;
      let faceX = 0;
      let faceZ = 1;

      if (playerAlive && playerEye) {
        const dx = playerEye.x - t.group.position.x;
        const dz = playerEye.z - t.group.position.z;
        distToPlayer = Math.hypot(dx, dz);
        if (distToPlayer > 0.01 && distToPlayer <= BOT_ENGAGE) {
          this._muzzle.set(
            t.group.position.x,
            t.group.position.y + BOT_MUZZLE_Y,
            t.group.position.z
          );
          const los = hasLineOfSight(this._muzzle, playerEye, this.colliders, 0.4);
          if (los) {
            engaging = true;
            faceX = dx;
            faceZ = dz;
          }
        }
      }

      t._engage = engaging;

      if (engaging) {
        // Face the player (humanoid +Z is forward)
        t.group.rotation.y = Math.atan2(faceX, faceZ);

        // Light strafe / hold near home while aiming
        t.patrolPhase += dt * 0.55;
        const strafe = Math.sin(t.patrolPhase * 1.4) * 0.55;
        const rightX = faceZ / Math.max(0.01, distToPlayer);
        const rightZ = -faceX / Math.max(0.01, distToPlayer);
        let x = t.home.x + rightX * strafe;
        let z = t.home.z + rightZ * strafe;
        // Nudge slightly toward / away to avoid standing still
        const toward = Math.sin(t.patrolPhase * 0.7) * 0.35;
        x += (faceX / Math.max(0.01, distToPlayer)) * toward;
        z += (faceZ / Math.max(0.01, distToPlayer)) * toward;
        if (this.colliders.length) {
          const resolved = resolvePlayerCollisions(
            new THREE.Vector3(x, 0, z),
            t.radius,
            this.colliders
          );
          x = resolved.x;
          z = resolved.z;
        }
        t.group.position.x = x;
        t.group.position.z = z;
        t.human.setAnim(t.patrolPhase * 2.4, 0.25);

        // Aim + shoot at player
        if (t._fireCd <= 0 && distToPlayer <= BOT_RANGE) {
          t._fireCd = BOT_FIRE_MIN + Math.random() * (BOT_FIRE_MAX - BOT_FIRE_MIN);
          if (t.human.triggerFire) t.human.triggerFire();

          this._muzzle.set(
            t.group.position.x,
            t.group.position.y + BOT_MUZZLE_Y,
            t.group.position.z
          );
          // Aim at torso/chest (slightly below eye) with spread
          const aimY = playerEye.y - 0.25 + (Math.random() - 0.5) * 0.35;
          this._aim.set(
            playerEye.x - this._muzzle.x,
            aimY - this._muzzle.y,
            playerEye.z - this._muzzle.z
          ).normalize();
          this._aim.x += (Math.random() - 0.5) * 2 * BOT_SPREAD;
          this._aim.y += (Math.random() - 0.5) * 2 * BOT_SPREAD;
          this._aim.z += (Math.random() - 0.5) * 2 * BOT_SPREAD;
          this._aim.normalize();

          // Don't hit player through solid AABB walls
          const wallDist = this.colliders.length
            ? raycastAabb(this._muzzle, this._aim, BOT_RANGE, this.colliders)
            : null;

          let hitPlayer = false;
          let headshot = false;
          let damage = 0;

          const hit = this._raycastPlayer(
            this._muzzle,
            this._aim,
            playerEye,
            playerRadius,
            playerHeight,
            BOT_RANGE
          );
          if (hit && (wallDist === null || hit.distance < wallDist - 0.05)) {
            hitPlayer = true;
            headshot = hit.headshot;
            damage = Math.round(BOT_DAMAGE * (headshot ? BOT_HEAD_MULT : 1));
          }

          if (onBotShot) {
            onBotShot({
              origin: this._muzzle.clone(),
              direction: this._aim.clone(),
              damage,
              hitPlayer,
              headshot,
            });
          }
        }
      } else {
        // Patrol when not engaging
        t.patrolPhase += dt * 0.7;
        let x = t.home.x + Math.sin(t.patrolPhase) * 1.8;
        let z = t.home.z + Math.cos(t.patrolPhase * 0.85) * 1.2;
        if (this.colliders.length) {
          const resolved = resolvePlayerCollisions(
            new THREE.Vector3(x, 0, z),
            t.radius,
            this.colliders
          );
          x = resolved.x;
          z = resolved.z;
        }
        t.group.position.x = x;
        t.group.position.z = z;
        // Face (+Z) along patrol tangent so rifle aims outward, not at spawn
        const vx = Math.cos(t.patrolPhase) * 1.8;
        const vz = -Math.sin(t.patrolPhase * 0.85) * 1.02;
        t.group.rotation.y = Math.atan2(vx, vz);
        t.human.setAnim(t.patrolPhase * 3.2, 0.75);
      }

      if (t.human.updateFire) t.human.updateFire(dt);
    }
  }

  /**
   * Capsule hit test against the local player (eye-height position).
   */
  _raycastPlayer(origin, direction, playerEye, playerRadius, playerHeight, maxDist) {
    const feetY = playerEye.y - playerHeight;
    const bodyCenterY = feetY + playerHeight * 0.5;
    const center = this._tmp.set(playerEye.x, bodyCenterY, playerEye.z);
    const toCenter = center.clone().sub(origin);
    const proj = toCenter.dot(direction);
    if (proj < 0 || proj > maxDist) return null;

    const closest = origin.clone().addScaledVector(direction, proj);
    const dx = closest.x - playerEye.x;
    const dz = closest.z - playerEye.z;
    const horiz = Math.sqrt(dx * dx + dz * dz);
    if (horiz > playerRadius + 0.22) return null;

    const y = closest.y;
    if (y < feetY - 0.1 || y > feetY + playerHeight + 0.3) return null;

    const headshot = y > feetY + playerHeight - 0.48;
    return { distance: proj, headshot, point: closest };
  }

  _respawnAll() {
    for (const t of this.targets) {
      t.alive = true;
      t.hp = t.maxHp;
      t.group.visible = true;
      t.group.position.copy(t.home);
      t.patrolPhase = Math.random() * Math.PI * 2;
      t._fireCd = 0.8 + Math.random() * 1.4;
      t._engage = false;
      if (t.body?.material?.color) t.body.material.color.setHex(t.baseColor);
    }
  }

  /** Optional: play a shoot pose on a bot (practice feedback). */
  triggerFire(target) {
    if (target?.human?.triggerFire) target.human.triggerFire();
  }

  raycast(origin, direction, maxDist = 80) {
    let best = null;
    let bestDist = maxDist;

    for (const t of this.targets) {
      if (!t.alive) continue;
      const center = this._tmp.set(
        t.group.position.x,
        t.group.position.y + t.height * 0.5,
        t.group.position.z
      );
      const toCenter = center.clone().sub(origin);
      const proj = toCenter.dot(direction);
      if (proj < 0 || proj > bestDist) continue;

      const closest = origin.clone().addScaledVector(direction, proj);
      const dx = closest.x - t.group.position.x;
      const dz = closest.z - t.group.position.z;
      const horiz = Math.sqrt(dx * dx + dz * dz);
      if (horiz > t.radius + 0.15) continue;

      const y = closest.y;
      if (y < t.group.position.y || y > t.group.position.y + t.height + 0.2) continue;

      bestDist = proj;
      const headshot = y > t.group.position.y + t.height - 0.45;
      best = { target: t, distance: proj, headshot, point: closest };
    }
    return best;
  }

  applyDamage(target, amount, now = 0) {
    if (!target.alive) return false;
    target.hp -= amount;
    if (target.human?.flashHit) {
      target.human.flashHit();
    } else if (target.body?.material) {
      target.body.material.emissive = new THREE.Color(0xffffff);
      target.body.material.emissiveIntensity = 0.6;
      setTimeout(() => {
        if (target.body.material) target.body.material.emissiveIntensity = 0;
      }, 60);
    }

    if (target.hp <= 0) {
      target.alive = false;
      target.group.visible = false;
      // Stay dead until all bots are cleared (wave respawn in update)
      return true;
    }
    return false;
  }
}
