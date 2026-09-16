import * as THREE from 'three';

/**
 * Small enclosed arena with cover props.
 */
export function createArena(scene) {
  const colliders = [];

  // Floor
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x3a4654,
    roughness: 0.9,
    metalness: 0.05,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Grid helper for depth feel
  const grid = new THREE.GridHelper(40, 40, 0x5a6a7a, 0x2a343f);
  grid.position.y = 0.01;
  scene.add(grid);

  // Ceiling light wash
  const hemi = new THREE.HemisphereLight(0xb8d0ff, 0x3a2a1a, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d6, 1.1);
  sun.position.set(8, 18, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 50;
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  scene.add(sun);

  // Outer walls
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x5c6b7a,
    roughness: 0.85,
  });
  const wallH = 4;
  const wallT = 0.6;
  const half = 20;

  function addBox(w, h, d, x, y, z, mat = wallMat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push({
      min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
      mesh,
    });
    return mesh;
  }

  addBox(40 + wallT * 2, wallH, wallT, 0, wallH / 2, -half);
  addBox(40 + wallT * 2, wallH, wallT, 0, wallH / 2, half);
  addBox(wallT, wallH, 40, -half, wallH / 2, 0);
  addBox(wallT, wallH, 40, half, wallH / 2, 0);

  // Cover crates / low walls
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.7 });
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x7a8490, roughness: 0.9 });

  addBox(3, 1.4, 1.2, -6, 0.7, -4, crateMat);
  addBox(2.2, 1.8, 2.2, 5, 0.9, 3, crateMat);
  addBox(4, 1.2, 1, 0, 0.6, 8, concreteMat);
  addBox(1.2, 2.2, 3.5, -10, 1.1, 2, concreteMat);
  addBox(2.5, 1.1, 2.5, 8, 0.55, -7, crateMat);
  addBox(1.5, 1.5, 1.5, -2, 0.75, -10, crateMat);
  addBox(6, 0.9, 0.8, 2, 0.45, -2, concreteMat);

  // Accent pillars
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x455a64 });
  addBox(1, 4, 1, -14, 2, -14, pillarMat);
  addBox(1, 4, 1, 14, 2, -14, pillarMat);
  addBox(1, 4, 1, -14, 2, 14, pillarMat);
  addBox(1, 4, 1, 14, 2, 14, pillarMat);

  // Spawn marker
  const spawnPad = new THREE.Mesh(
    new THREE.CircleGeometry(1.2, 24),
    new THREE.MeshBasicMaterial({ color: 0x4caf50, transparent: true, opacity: 0.25 })
  );
  spawnPad.rotation.x = -Math.PI / 2;
  spawnPad.position.set(0, 0.03, 12);
  scene.add(spawnPad);

  return {
    colliders,
    spawn: new THREE.Vector3(0, 1.6, 12),
  };
}

const ARENA_LIMIT = 19;
const EPS = 1e-6;

/**
 * True if a horizontal disk of `radius` at (x,z) overlaps any solid collider.
 * Capsule mid-height (~1.0) is assumed — skip very low props.
 */
export function isBlockedXZ(x, z, radius, colliders) {
  const r2 = radius * radius;
  for (const c of colliders) {
    if (c.max.y < 0.3) continue;
    const closestX = Math.max(c.min.x, Math.min(x, c.max.x));
    const closestZ = Math.max(c.min.z, Math.min(z, c.max.z));
    const dx = x - closestX;
    const dz = z - closestZ;
    if (dx * dx + dz * dz < r2 - EPS) return true;
  }
  if (Math.abs(x) > ARENA_LIMIT || Math.abs(z) > ARENA_LIMIT) return true;
  return false;
}

/**
 * Resolve circle (player XZ capsule) vs AABB solid bodies.
 * Handles both exterior overlap AND fully-inside cases (min-penetration axis),
 * then multi-pass so pushing out of one box doesn't leave you in another.
 */
export function resolvePlayerCollisions(pos, radius, colliders, passes = 4) {
  const out = pos.clone();
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (const c of colliders) {
      if (c.max.y < 0.3) continue;
      if (_resolveCircleVsAabb(out, radius, c)) moved = true;
    }
    // Soft arena clamp
    const cx = Math.max(-ARENA_LIMIT, Math.min(ARENA_LIMIT, out.x));
    const cz = Math.max(-ARENA_LIMIT, Math.min(ARENA_LIMIT, out.z));
    if (cx !== out.x || cz !== out.z) {
      out.x = cx;
      out.z = cz;
      moved = true;
    }
    if (!moved) break;
  }
  return out;
}

/**
 * Push circle center out of one AABB. Returns true if position changed.
 */
function _resolveCircleVsAabb(out, radius, c) {
  const inside =
    out.x > c.min.x + EPS &&
    out.x < c.max.x - EPS &&
    out.z > c.min.z + EPS &&
    out.z < c.max.z - EPS;

  if (inside) {
    // Minimum translation along X or Z to exit the box, then add radius clearance.
    const penLeft = out.x - c.min.x;
    const penRight = c.max.x - out.x;
    const penNear = out.z - c.min.z;
    const penFar = c.max.z - out.z;
    const minPen = Math.min(penLeft, penRight, penNear, penFar);
    if (minPen === penLeft) out.x = c.min.x - radius;
    else if (minPen === penRight) out.x = c.max.x + radius;
    else if (minPen === penNear) out.z = c.min.z - radius;
    else out.z = c.max.z + radius;
    return true;
  }

  const closestX = Math.max(c.min.x, Math.min(out.x, c.max.x));
  const closestZ = Math.max(c.min.z, Math.min(out.z, c.max.z));
  let dx = out.x - closestX;
  let dz = out.z - closestZ;
  const distSq = dx * dx + dz * dz;
  if (distSq >= radius * radius) return false;

  if (distSq < EPS) {
    // Degenerate: on the surface edge/corner with near-zero vector — pick axis.
    const toCenterX = out.x - (c.min.x + c.max.x) * 0.5;
    const toCenterZ = out.z - (c.min.z + c.max.z) * 0.5;
    if (Math.abs(toCenterX) > Math.abs(toCenterZ)) {
      out.x = toCenterX >= 0 ? c.max.x + radius : c.min.x - radius;
    } else {
      out.z = toCenterZ >= 0 ? c.max.z + radius : c.min.z - radius;
    }
    return true;
  }

  const dist = Math.sqrt(distSq);
  const push = radius - dist;
  out.x += (dx / dist) * push;
  out.z += (dz / dist) * push;
  return true;
}

/**
 * Sweep XZ from `from` toward `to` in substeps so sprint + low FPS cannot tunnel
 * through thin walls. Each step advances from the last *resolved* position.
 * On block, tries axis-separated slides so you can glide along walls.
 */
export function sweepPlayerMove(from, to, radius, colliders) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  const out = from.clone();
  out.y = to.y;
  if (dist < EPS) {
    return resolvePlayerCollisions(out, radius, colliders);
  }
  const stepSize = Math.max(radius * 0.4, 0.06);
  const steps = Math.max(1, Math.ceil(dist / stepSize));
  const stepX = dx / steps;
  const stepZ = dz / steps;

  for (let i = 0; i < steps; i++) {
    const beforeX = out.x;
    const beforeZ = out.z;
    let resolved = resolvePlayerCollisions(
      new THREE.Vector3(beforeX + stepX, to.y, beforeZ + stepZ),
      radius,
      colliders
    );

    // If diagonal move was heavily blocked, try sliding on each axis
    const blocked =
      Math.hypot(resolved.x - (beforeX + stepX), resolved.z - (beforeZ + stepZ)) > 1e-4;
    if (blocked) {
      const slideX = resolvePlayerCollisions(
        new THREE.Vector3(beforeX + stepX, to.y, beforeZ),
        radius,
        colliders
      );
      const slideZ = resolvePlayerCollisions(
        new THREE.Vector3(beforeX, to.y, beforeZ + stepZ),
        radius,
        colliders
      );
      const prog = (p) => Math.hypot(p.x - beforeX, p.z - beforeZ);
      const best = [resolved, slideX, slideZ].sort((a, b) => prog(b) - prog(a))[0];
      resolved = best;
    }

    out.x = resolved.x;
    out.z = resolved.z;
  }
  return out;
}


/**
 * Find a free spawn near `desired` (eye-height Vector3). Nudges in a spiral if blocked.
 */
export function findSafeSpawn(desired, radius, colliders, eyeY = 1.6) {
  const r = radius + 0.05;
  const tryPos = desired.clone();
  tryPos.y = eyeY;
  if (!isBlockedXZ(tryPos.x, tryPos.z, r, colliders)) {
    return resolvePlayerCollisions(tryPos, radius, colliders);
  }

  const rings = 12;
  const perRing = 10;
  for (let ring = 1; ring <= rings; ring++) {
    const rad = ring * 0.55;
    for (let i = 0; i < perRing; i++) {
      const ang = (i / perRing) * Math.PI * 2 + ring * 0.35;
      const x = desired.x + Math.cos(ang) * rad;
      const z = desired.z + Math.sin(ang) * rad;
      if (!isBlockedXZ(x, z, r, colliders)) {
        const p = new THREE.Vector3(x, eyeY, z);
        return resolvePlayerCollisions(p, radius, colliders);
      }
    }
  }

  // Last resort: arena center
  const fallback = new THREE.Vector3(0, eyeY, 0);
  return resolvePlayerCollisions(fallback, radius, colliders);
}

export function softSeparateXZ(a, b, radiusA, radiusB, strength = 0.55) {
  const minDist = radiusA + radiusB;
  let dx = a.x - b.x;
  let dz = a.z - b.z;
  let dist = Math.hypot(dx, dz);
  if (dist >= minDist) return false;
  if (dist < EPS) {
    dx = 1;
    dz = 0;
    dist = 1;
  }
  const overlap = minDist - dist;
  const push = overlap * strength;
  a.x += (dx / dist) * push;
  a.z += (dz / dist) * push;
  return true;
}
