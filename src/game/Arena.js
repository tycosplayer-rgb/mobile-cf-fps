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

/**
 * Axis-aligned capsule vs AABB collision for player XZ movement.
 */
export function resolvePlayerCollisions(pos, radius, colliders) {
  const out = pos.clone();
  for (const c of colliders) {
    // Only collide with lower solid bodies (player mid-height ~1.0)
    if (c.max.y < 0.3) continue;
    const closestX = Math.max(c.min.x, Math.min(out.x, c.max.x));
    const closestZ = Math.max(c.min.z, Math.min(out.z, c.max.z));
    const dx = out.x - closestX;
    const dz = out.z - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < radius * radius) {
      const dist = Math.sqrt(distSq) || 0.0001;
      const push = radius - dist;
      out.x += (dx / dist) * push;
      out.z += (dz / dist) * push;
    }
  }
  // Soft arena clamp
  out.x = Math.max(-19, Math.min(19, out.x));
  out.z = Math.max(-19, Math.min(19, out.z));
  return out;
}
