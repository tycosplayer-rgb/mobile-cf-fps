import * as THREE from 'three';

/**
 * Procedural low-poly humanoid for remotes / practice bots.
 * Feet at local y=0. Hitbox stays independent (capsule radius/height elsewhere).
 */

const SKIN = 0xe8b896;
const SKIN_DARK = 0xc48a6a;
const BOOT = 0x2a2a2a;
const PANTS_DARK = 0x1e2a32;
const GUN_METAL = 0x3a3a3a;
const GUN_DARK = 0x1c1c1c;

function mat(color, extras = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: extras.roughness ?? 0.65,
    metalness: extras.metalness ?? 0.05,
    ...extras,
  });
}

function box(w, h, d, material, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * @param {number} outfitColor hex
 * @param {{ height?: number, showRifle?: boolean, helmet?: boolean }} opts
 * @returns {{
 *   group: THREE.Group,
 *   body: THREE.Mesh,
 *   limbs: { leftLeg: THREE.Group, rightLeg: THREE.Group, leftArm: THREE.Group, rightArm: THREE.Group },
 *   setAnim: (phase: number, speed01: number) => void,
 *   triggerFire: () => void,
 *   updateFire: (dt: number) => void,
 *   flashHit: () => void,
 * }}
 */
export function createHumanoid(outfitColor, opts = {}) {
  const height = opts.height ?? 1.7;
  const showRifle = opts.showRifle !== false;
  const helmet = opts.helmet !== false;
  const scale = height / 1.7;

  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const outfit = mat(outfitColor, { roughness: 0.55 });
  const outfitDark = mat(new THREE.Color(outfitColor).multiplyScalar(0.72).getHex(), { roughness: 0.6 });
  const skin = mat(SKIN, { roughness: 0.7 });
  const skinDark = mat(SKIN_DARK, { roughness: 0.75 });
  const pants = mat(PANTS_DARK, { roughness: 0.7 });
  const boot = mat(BOOT, { roughness: 0.8 });
  const metal = mat(GUN_METAL, { metalness: 0.7, roughness: 0.35 });
  const gunDark = mat(GUN_DARK, { metalness: 0.5, roughness: 0.4 });

  // --- Legs (pivots at hip) ---
  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.12, 0.88, 0);
  leftLeg.add(box(0.16, 0.42, 0.18, pants, 0, -0.22, 0));
  leftLeg.add(box(0.14, 0.36, 0.16, pants, 0, -0.58, 0.01));
  leftLeg.add(box(0.16, 0.1, 0.24, boot, 0, -0.82, 0.04));
  group.add(leftLeg);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.12, 0.88, 0);
  rightLeg.add(box(0.16, 0.42, 0.18, pants, 0, -0.22, 0));
  rightLeg.add(box(0.14, 0.36, 0.16, pants, 0, -0.58, 0.01));
  rightLeg.add(box(0.16, 0.1, 0.24, boot, 0, -0.82, 0.04));
  group.add(rightLeg);

  // --- Pelvis / torso ---
  const pelvis = box(0.34, 0.16, 0.22, pants, 0, 0.92, 0);
  group.add(pelvis);

  const torso = box(0.38, 0.48, 0.24, outfit, 0, 1.22, 0);
  group.add(torso);

  // Chest plate / vest accent
  const vest = box(0.34, 0.36, 0.08, outfitDark, 0, 1.24, 0.12);
  group.add(vest);

  // Shoulders
  group.add(box(0.48, 0.12, 0.22, outfit, 0, 1.46, 0));

  // --- Arms (pivots at shoulder) ---
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.28, 1.42, 0);
  leftArm.add(box(0.12, 0.28, 0.14, outfit, 0, -0.14, 0));
  leftArm.add(box(0.11, 0.26, 0.12, skin, 0, -0.4, 0));
  leftArm.add(box(0.1, 0.1, 0.12, skinDark, 0, -0.55, 0.02)); // hand
  group.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.28, 1.42, 0);
  rightArm.add(box(0.12, 0.28, 0.14, outfit, 0, -0.14, 0));
  rightArm.add(box(0.11, 0.26, 0.12, skin, 0, -0.4, 0));
  const rightHand = box(0.1, 0.1, 0.12, skinDark, 0, -0.55, 0.02);
  rightArm.add(rightHand);
  group.add(rightArm);

  // Default aim-ish pose: arms slightly forward
  leftArm.rotation.x = 0.35;
  rightArm.rotation.x = 0.55;
  rightArm.rotation.z = -0.08;
  leftArm.rotation.z = 0.12;

  // --- Neck / head ---
  group.add(box(0.12, 0.1, 0.12, skin, 0, 1.52, 0));
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.26), skin);
  head.position.set(0, 1.68, 0.02);
  head.castShadow = true;
  group.add(head);

  // Simple face (eyes + mouth hint) on front
  const faceMat = mat(0x1a1a1a, { roughness: 1, metalness: 0 });
  group.add(box(0.05, 0.04, 0.02, faceMat, -0.07, 1.72, 0.15));
  group.add(box(0.05, 0.04, 0.02, faceMat, 0.07, 1.72, 0.15));
  group.add(box(0.08, 0.02, 0.02, faceMat, 0, 1.62, 0.15));

  if (helmet) {
    const helm = box(0.3, 0.14, 0.28, outfitDark, 0, 1.82, 0);
    group.add(helm);
    group.add(box(0.32, 0.06, 0.1, outfit, 0, 1.76, 0.12)); // brim / goggles band
  }

  // Rifle parented to right arm so it swings / recoils with the limb
  let rifle = null;
  if (showRifle) {
    rifle = new THREE.Group();
    // Local to rightArm (shoulder pivot at 0,0,0; hand ~ y=-0.55)
    rifle.position.set(0.02, -0.42, 0.22);
    rifle.rotation.set(-0.55, 0.15, 0.35);
    rifle.add(box(0.06, 0.08, 0.42, metal, 0, 0, -0.05));
    rifle.add(box(0.04, 0.04, 0.28, gunDark, 0, 0.01, -0.38));
    rifle.add(box(0.05, 0.12, 0.08, gunDark, 0, -0.08, 0.12));
    rifle.add(box(0.03, 0.06, 0.06, metal, 0, 0.06, -0.1)); // optic stub
    rightArm.add(rifle);
    // Aim pose: both arms forward holding rifle
    rightArm.rotation.x = 1.05;
    rightArm.rotation.y = -0.25;
    rightArm.rotation.z = -0.08;
    leftArm.rotation.x = 0.85;
    leftArm.rotation.y = 0.35;
    leftArm.rotation.z = 0.15;
  }

  // Idle rest pose offsets stored for anim
  const base = {
    leftLegX: 0,
    rightLegX: 0,
    leftArmX: leftArm.rotation.x,
    rightArmX: rightArm.rotation.x,
    leftArmY: leftArm.rotation.y,
    rightArmY: rightArm.rotation.y,
    leftArmZ: leftArm.rotation.z,
    rightArmZ: rightArm.rotation.z,
  };

  let fireKick = 0; // 0..1, decays over time
  let lastWalkPhase = 0;
  let lastSpeed01 = 0;

  function setAnim(phase, speed01 = 0) {
    lastWalkPhase = phase;
    lastSpeed01 = Math.min(1, Math.max(0, speed01));
    _applyPose();
  }

  function _applyPose() {
    const amp = lastSpeed01 * 0.7;
    const s = Math.sin(lastWalkPhase);
    const c = Math.cos(lastWalkPhase);

    leftLeg.rotation.x = base.leftLegX + s * amp;
    rightLeg.rotation.x = base.rightLegX - s * amp;

    // Fire kick: snap arms up/back briefly (recoil), then settle
    const fk = fireKick;
    const fireRx = fk * 0.55; // pitch up (kick)
    const fireRz = fk * 0.12;

    if (!showRifle) {
      leftArm.rotation.x = base.leftArmX - s * amp * 0.85 - fireRx * 0.4;
      rightArm.rotation.x = base.rightArmX + s * amp * 0.85 - fireRx;
      leftArm.rotation.y = base.leftArmY;
      rightArm.rotation.y = base.rightArmY;
      leftArm.rotation.z = base.leftArmZ;
      rightArm.rotation.z = base.rightArmZ - fireRz;
    } else {
      // Clearer walk sway while keeping rifle aimed mostly forward
      const walkArm = amp * 0.28;
      leftArm.rotation.x = base.leftArmX + c * walkArm - fireRx * 0.35;
      rightArm.rotation.x = base.rightArmX + s * walkArm * 0.55 - fireRx;
      leftArm.rotation.y = base.leftArmY + s * walkArm * 0.25;
      rightArm.rotation.y = base.rightArmY - c * walkArm * 0.15;
      leftArm.rotation.z = base.leftArmZ + s * walkArm * 0.1;
      rightArm.rotation.z = base.rightArmZ - fireRz;
      if (rifle) {
        rifle.rotation.x = -0.55 - fireKick * 0.35;
        rifle.position.z = 0.22 - fireKick * 0.06;
      }
    }
  }

  function triggerFire() {
    fireKick = Math.min(1, fireKick + 0.85);
    _applyPose();
  }

  function updateFire(dt) {
    if (fireKick <= 0) return;
    fireKick = Math.max(0, fireKick - dt * 7.5);
    _applyPose();
  }

  let _flashTimer = null;
  function flashHit() {
    const mats = [torso.material, vest.material];
    for (const m of mats) {
      if (!m.emissive) continue;
      m.emissive.setHex(0xffffff);
      m.emissiveIntensity = 0.65;
    }
    if (_flashTimer) clearTimeout(_flashTimer);
    _flashTimer = setTimeout(() => {
      for (const m of mats) {
        if (!m.emissive) continue;
        m.emissiveIntensity = 0;
      }
    }, 70);
  }

  return {
    group,
    body: torso,
    head,
    limbs: { leftLeg, rightLeg, leftArm, rightArm },
    rifle,
    setAnim,
    triggerFire,
    updateFire,
    flashHit,
  };
}

/**
 * First-person arms + hands + rifle (camera-local).
 * Procedural idle sway, walk bob, fire kick, light reload motion.
 */
export function createViewmodel() {
  const g = new THREE.Group();

  const skin = mat(SKIN, { roughness: 0.72 });
  const skinDark = mat(SKIN_DARK, { roughness: 0.75 });
  const sleeve = mat(0x2d4a3e, { roughness: 0.6 }); // olive tactical sleeve
  const metal = mat(GUN_METAL, { metalness: 0.75, roughness: 0.32 });
  const dark = mat(GUN_DARK, { metalness: 0.55, roughness: 0.4 });
  const plastic = mat(0x1a1a1a, { roughness: 0.55 });
  const accent = mat(0x4a5a4a, { roughness: 0.5 });

  // Right forearm (main holding arm)
  const rArm = new THREE.Group();
  rArm.position.set(0.18, -0.28, -0.28);
  rArm.rotation.set(0.15, 0.05, -0.35);
  rArm.add(box(0.1, 0.1, 0.28, sleeve, 0, 0, 0.06));
  // Wrist
  rArm.add(box(0.09, 0.09, 0.08, skin, 0, 0, -0.12));
  // Hand gripping
  const rHand = box(0.1, 0.08, 0.12, skinDark, 0.01, -0.02, -0.22);
  rHand.rotation.x = 0.4;
  rArm.add(rHand);
  // Fingers curl
  rArm.add(box(0.09, 0.04, 0.08, skin, 0.01, -0.05, -0.3));
  g.add(rArm);

  // Left support forearm (near magwell)
  const lArm = new THREE.Group();
  lArm.position.set(0.02, -0.22, -0.42);
  lArm.rotation.set(0.45, 0.35, 0.55);
  lArm.add(box(0.09, 0.09, 0.22, sleeve, 0, 0, 0));
  lArm.add(box(0.08, 0.07, 0.1, skinDark, 0, -0.01, -0.14));
  g.add(lArm);

  // --- Rifle ---
  const gun = new THREE.Group();
  gun.position.set(0.2, -0.16, -0.5);

  // Receiver
  gun.add(box(0.07, 0.1, 0.32, metal, 0, 0, 0));
  // Handguard
  gun.add(box(0.065, 0.08, 0.22, accent, 0, -0.01, -0.24));
  // Barrel
  gun.add(box(0.035, 0.035, 0.28, dark, 0, 0.01, -0.48));
  // Muzzle tip
  gun.add(box(0.045, 0.045, 0.04, metal, 0, 0.01, -0.62));
  // Mag
  gun.add(box(0.05, 0.16, 0.08, plastic, 0, -0.12, -0.02));
  // Stock
  gun.add(box(0.06, 0.08, 0.18, plastic, 0, 0.01, 0.22));
  gun.add(box(0.055, 0.12, 0.05, plastic, 0, -0.02, 0.3));
  // Grip
  const grip = box(0.055, 0.14, 0.07, plastic, 0, -0.12, 0.1);
  grip.rotation.x = 0.4;
  gun.add(grip);
  // Optic rail + red-dot stub
  gun.add(box(0.04, 0.02, 0.2, dark, 0, 0.06, -0.05));
  gun.add(box(0.05, 0.05, 0.06, metal, 0, 0.1, -0.02));
  gun.add(box(0.02, 0.02, 0.02, mat(0xff2222, { roughness: 0.3, metalness: 0.2 }), 0, 0.12, -0.02));

  g.add(gun);

  const basePos = new THREE.Vector3(0, 0, 0);
  const rArmBase = {
    pos: rArm.position.clone(),
    rot: rArm.rotation.clone(),
  };
  const lArmBase = {
    pos: lArm.position.clone(),
    rot: lArm.rotation.clone(),
  };
  const gunBase = {
    pos: gun.position.clone(),
    rot: new THREE.Euler(0, 0, 0),
  };

  let fireKick = 0;
  let reloadT = 0; // 0 idle, >0 mid-reload progress 0..1 style timer
  let bobPhase = 0;

  /**
   * Drive FP viewmodel each frame.
   * @param {number} dt
   * @param {{
   *   speed01?: number,
   *   ads?: boolean,
   *   reloading?: boolean,
   *   time?: number,
   * }} state
   */
  function update(dt, state = {}) {
    const speed01 = Math.min(1, Math.max(0, state.speed01 ?? 0));
    const ads = !!state.ads;
    const reloading = !!state.reloading;
    const time = state.time ?? 0;

    fireKick = Math.max(0, fireKick - dt * 9);
    bobPhase += dt * (6 + speed01 * 8);

    if (reloading) {
      reloadT = Math.min(1, reloadT + dt * 0.85);
    } else {
      reloadT = Math.max(0, reloadT - dt * 3);
    }

    // Idle breath sway
    const idleX = Math.sin(time * 1.1) * 0.006;
    const idleY = Math.sin(time * 1.7) * 0.008;
    const idleRx = Math.sin(time * 1.3) * 0.012;

    // Walk bob / arm swing
    const bob = speed01 * (ads ? 0.35 : 1);
    const bobY = Math.sin(bobPhase) * 0.018 * bob;
    const bobX = Math.cos(bobPhase * 0.5) * 0.012 * bob;
    const swing = Math.sin(bobPhase) * 0.04 * bob;

    // ADS tuck slightly toward center
    const adsTuckX = ads ? -0.04 : 0;
    const adsTuckY = ads ? 0.02 : 0;
    const adsTuckZ = ads ? 0.06 : 0;

    // Fire kick: gun+arms punch up/back
    const fk = fireKick;
    const kickZ = fk * 0.055;
    const kickY = fk * 0.028;
    const kickRx = -fk * 0.55;
    const kickRy = fk * 0.08;

    // Reload: dip gun, left arm pulls mag
    const rl = reloadT;
    const reloadDip = Math.sin(rl * Math.PI) * 0.1;
    const reloadYaw = Math.sin(rl * Math.PI) * 0.25;

    g.position.set(
      basePos.x + idleX + bobX + adsTuckX,
      basePos.y + idleY + bobY - kickY - reloadDip * 0.5 + adsTuckY,
      basePos.z + kickZ + adsTuckZ
    );
    g.rotation.set(idleRx + kickRx * 0.35 - reloadDip * 0.4, kickRy, swing * 0.3);

    // Right arm follows kick + walk
    rArm.position.set(
      rArmBase.pos.x,
      rArmBase.pos.y + bobY * 0.4 - kickY * 0.5,
      rArmBase.pos.z + kickZ * 0.4
    );
    rArm.rotation.set(
      rArmBase.rot.x + kickRx * 0.5 + swing * 0.15,
      rArmBase.rot.y + kickRy,
      rArmBase.rot.z
    );

    // Left arm: support + reload pull
    lArm.position.set(
      lArmBase.pos.x - reloadYaw * 0.08,
      lArmBase.pos.y - reloadDip * 0.12 + bobY * 0.3,
      lArmBase.pos.z + reloadDip * 0.05
    );
    lArm.rotation.set(
      lArmBase.rot.x + reloadDip * 0.6 - kickRx * 0.2,
      lArmBase.rot.y - reloadYaw * 0.5 + swing * 0.2,
      lArmBase.rot.z + reloadYaw * 0.3
    );

    // Gun kick (aligned with arms so muzzle flash still feels attached)
    gun.position.set(
      gunBase.pos.x,
      gunBase.pos.y - kickY * 0.3 - reloadDip * 0.06,
      gunBase.pos.z + kickZ * 0.7
    );
    gun.rotation.set(kickRx * 0.7 - reloadDip * 0.35, kickRy * 0.5, 0);
  }

  function triggerFire() {
    fireKick = Math.min(1, fireKick + 0.9);
  }

  g.userData.basePos = basePos;
  g.userData.rightArm = rArm;
  g.userData.leftArm = lArm;
  g.userData.gun = gun;
  g.userData.update = update;
  g.userData.triggerFire = triggerFire;

  return g;
}
