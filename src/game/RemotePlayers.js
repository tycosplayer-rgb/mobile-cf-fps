import * as THREE from 'three';
import { resolvePlayerCollisions } from './Arena.js';
import { createHumanoid } from './Humanoid.js';

const HEIGHT = 1.7;
const RADIUS = 0.4;
const EYE = 1.6;

/**
 * Visual + hit proxies for remote PvP players.
 * State y is eye height (same as local Player.position.y).
 * Visual is a low-poly humanoid; hit tests still use capsule RADIUS/HEIGHT.
 */
export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.remotes = new Map();
    this._tmp = new THREE.Vector3();
  }

  ensure(id, name, colorHex) {
    if (this.remotes.has(id)) return this.remotes.get(id);
    const color = colorHex ?? this._colorForId(id);
    const human = createHumanoid(color, { height: HEIGHT, showRifle: true, helmet: true });
    const group = human.group;

    const nameSprite = this._makeNameSprite(name || '玩家');
    nameSprite.position.y = HEIGHT + 0.45;
    group.add(nameSprite);

    group.visible = false;
    this.scene.add(group);

    const remote = {
      id,
      name: name || '玩家',
      group,
      body: human.body,
      human,
      nameSprite,
      alive: true,
      hp: 100,
      x: 0,
      y: EYE,
      z: 0,
      yaw: 0,
      pitch: 0,
      radius: RADIUS,
      height: HEIGHT,
      lastUpdate: 0,
      _prevX: 0,
      _prevZ: 0,
      _animPhase: Math.random() * Math.PI * 2,
      _speed01: 0,
    };
    this.remotes.set(id, remote);
    return remote;
  }

  _colorForId(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    const palette = [0xe53935, 0x1e88e5, 0x43a047, 0xfb8c00, 0x8e24aa, 0x00acc1];
    return palette[h % palette.length];
  }

  _makeNameSprite(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(8, 12, 240, 40);
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(String(text).slice(0, 12), 128, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(1.6, 0.4, 1);
    return spr;
  }

  remove(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.scene.remove(r.group);
    this.remotes.delete(id);
  }

  clear() {
    for (const id of [...this.remotes.keys()]) this.remove(id);
  }

  /**
   * Apply remote state. If colliders provided, clamp XZ against map so bad sync
   * does not leave the mesh visually stuck inside walls.
   */
  applyState(id, state, name, colliders = null) {
    const r = this.ensure(id, name);
    if (name && name !== r.name) r.name = name;
    let x = state.x;
    let z = state.z;
    if (colliders) {
      const out = resolvePlayerCollisions(new THREE.Vector3(x, state.y, z), r.radius, colliders);
      x = out.x;
      z = out.z;
    }

    const dx = x - r.x;
    const dz = z - r.z;
    const dist = Math.hypot(dx, dz);
    // Heuristic speed from state deltas (~20 Hz net)
    r._speed01 = Math.min(1, dist / 0.35);

    r.x = x;
    r.y = state.y;
    r.z = z;
    r.yaw = state.yaw;
    r.pitch = state.pitch ?? 0;
    r.alive = state.alive !== false;
    if (typeof state.hp === 'number') r.hp = state.hp;
    r.group.visible = r.alive;
    const feetY = r.y - EYE;
    r.group.position.set(r.x, feetY, r.z);
    r.group.rotation.y = r.yaw;
    r.lastUpdate = performance.now();

    r._animPhase += 0.35 + r._speed01 * 0.55;
    r.human.setAnim(r._animPhase, r._speed01);
  }

  /** Trigger shoot pose / arm recoil on a remote (from net shoot events). */
  triggerFire(id) {
    const r = this.remotes.get(id);
    if (!r?.human?.triggerFire) return;
    r.human.triggerFire();
  }

  /** Decay fire kick on all remotes each frame. */
  update(dt) {
    for (const r of this.remotes.values()) {
      if (r.human?.updateFire) r.human.updateFire(dt);
    }
  }

  setAlive(id, alive, hp) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.alive = alive;
    if (typeof hp === 'number') r.hp = hp;
    r.group.visible = !!alive;
  }

  raycast(origin, direction, maxDist = 80, ignoreId = null) {
    let best = null;
    let bestDist = maxDist;
    for (const r of this.remotes.values()) {
      if (!r.alive) continue;
      if (ignoreId && r.id === ignoreId) continue;

      const feetY = r.y - EYE;
      const bodyCenterY = feetY + r.height * 0.5;
      const center = this._tmp.set(r.x, bodyCenterY, r.z);

      const toCenter = center.clone().sub(origin);
      const proj = toCenter.dot(direction);
      if (proj < 0 || proj > bestDist) continue;

      const closest = origin.clone().addScaledVector(direction, proj);
      const dx = closest.x - r.x;
      const dz = closest.z - r.z;
      const horiz = Math.sqrt(dx * dx + dz * dz);
      if (horiz > r.radius + 0.22) continue;

      const y = closest.y;
      if (y < feetY - 0.1 || y > feetY + r.height + 0.3) continue;

      bestDist = proj;
      const headshot = y > feetY + r.height - 0.48;
      best = { remote: r, distance: proj, headshot, point: closest };
    }
    return best;
  }
}
