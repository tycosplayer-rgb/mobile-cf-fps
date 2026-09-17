import * as THREE from 'three';
import { resolvePlayerCollisions, findSafeSpawn } from './Arena.js';
import { createHumanoid } from './Humanoid.js';

const TARGET_RADIUS = 0.55;
const TARGET_HEIGHT = 1.7;

/**
 * Practice dummy bots — low-poly humanoids that patrol and respawn.
 * Hit tests still use TARGET_RADIUS / TARGET_HEIGHT capsules.
 */
export class TargetManager {
  constructor(scene, colliders = []) {
    this.scene = scene;
    this.colliders = colliders;
    this.targets = [];
    this._tmp = new THREE.Vector3();

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
      respawnAt: 0,
      baseColor: color,
      home: new THREE.Vector3(x, 0, z),
      patrolPhase: Math.random() * Math.PI * 2,
      radius: TARGET_RADIUS,
      height: TARGET_HEIGHT,
    };
  }

  update(dt, time) {
    for (const t of this.targets) {
      if (!t.alive) {
        if (time >= t.respawnAt) {
          t.alive = true;
          t.hp = t.maxHp;
          t.group.visible = true;
          t.group.position.copy(t.home);
          if (t.body?.material?.color) t.body.material.color.setHex(t.baseColor);
        }
        continue;
      }
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
      t.group.rotation.y = Math.atan2(
        Math.cos(t.patrolPhase) * 1.2,
        Math.sin(t.patrolPhase) * 1.8
      );
      // Walk cycle while patrolling
      t.human.setAnim(t.patrolPhase * 3.2, 0.75);
    }
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
      target.respawnAt = now + 3;
      return true;
    }
    return false;
  }
}
