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

  // Optional rifle held across front-right
  if (showRifle) {
    const rifle = new THREE.Group();
    rifle.position.set(0.12, 1.15, 0.28);
    rifle.rotation.set(-0.15, 0.35, 0.05);
    rifle.add(box(0.06, 0.08, 0.42, metal, 0, 0, -0.05));
    rifle.add(box(0.04, 0.04, 0.28, gunDark, 0, 0.01, -0.38));
    rifle.add(box(0.05, 0.12, 0.08, gunDark, 0, -0.08, 0.12));
    rifle.add(box(0.03, 0.06, 0.06, metal, 0, 0.06, -0.1)); // optic stub
    group.add(rifle);
    // Tweak right arm toward rifle
    rightArm.rotation.x = 1.05;
    rightArm.rotation.y = -0.25;
    leftArm.rotation.x = 0.85;
    leftArm.rotation.y = 0.2;
  }

  // Idle rest pose offsets stored for anim
  const base = {
    leftLegX: 0,
    rightLegX: 0,
    leftArmX: leftArm.rotation.x,
    rightArmX: rightArm.rotation.x,
  };

  function setAnim(phase, speed01 = 0) {
    const amp = Math.min(1, Math.max(0, speed01)) * 0.55;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    leftLeg.rotation.x = base.leftLegX + s * amp;
    rightLeg.rotation.x = base.rightLegX - s * amp;
    // Arms counter-swing lightly (keep rifle pose mostly)
    if (!showRifle) {
      leftArm.rotation.x = base.leftArmX - s * amp * 0.7;
      rightArm.rotation.x = base.rightArmX + s * amp * 0.7;
    } else {
      leftArm.rotation.x = base.leftArmX + c * amp * 0.12;
      rightArm.rotation.x = base.rightArmX + s * amp * 0.08;
    }
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
    setAnim,
    flashHit,
  };
}

/**
 * First-person arms + hands + rifle (camera-local).
 * Readable FPS viewmodel — not a full body.
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

  g.userData.basePos = new THREE.Vector3(0, 0, 0);
  g.userData.rightArm = rArm;
  g.userData.leftArm = lArm;
  g.userData.gun = gun;
  return g;
}
