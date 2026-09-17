import * as THREE from 'three';

export class Weapon {
  constructor() {
    this.magSize = 30;
    this.ammoInMag = 30;
    this.reserve = 90;
    this.damage = 28;
    this.headMultiplier = 2.4;
    this.fireInterval = 0.095; // ~630 RPM
    this.reloadTime = 1.55;
    this.baseSpread = 0.01;
    this.adsSpread = 0.0035;
    this.maxBloom = 0.055;
    this.bloomPerShot = 0.0075;
    this.bloomAdsMul = 0.45;
    this.bloomRecover = 0.12; // per second toward 0
    this.recoilPitch = 0.028;
    this.recoilYaw = 0.012;
    this.recoilAdsMul = 0.55;

    this.bloom = 0;
    this._cooldown = 0;
    this._reloading = false;
    this._reloadLeft = 0;
    this._emptyClickCd = 0;

    this.muzzleFlash = null;
    this.muzzleSprite = null;

    /** Pending camera recoil kick applied by Game/Player */
    this.pendingRecoil = { pitch: 0, yaw: 0 };
  }

  get isReloading() {
    return this._reloading;
  }

  attachMuzzleFlash(camera) {
    const light = new THREE.PointLight(0xff9944, 0, 10);
    light.position.set(0.2, -0.15, -1.08);
    camera.add(light);
    this.muzzleFlash = light;

    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffcc66,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.18), flashMat);
    flash.position.set(0.2, -0.15, -1.12);
    camera.add(flash);
    this.muzzleSprite = flash;
  }

  update(dt) {
    if (this._cooldown > 0) this._cooldown -= dt;
    if (this._emptyClickCd > 0) this._emptyClickCd -= dt;
    this.bloom = Math.max(0, this.bloom - this.bloomRecover * dt);

    if (this.muzzleFlash && this.muzzleFlash.intensity > 0) {
      this.muzzleFlash.intensity = Math.max(0, this.muzzleFlash.intensity - dt * 55);
    }
    if (this.muzzleSprite) {
      this.muzzleSprite.material.opacity = Math.max(0, this.muzzleSprite.material.opacity - dt * 12);
      if (this.muzzleSprite.material.opacity > 0) {
        this.muzzleSprite.rotation.z = Math.random() * Math.PI;
        const s = 0.7 + Math.random() * 0.6;
        this.muzzleSprite.scale.setScalar(s);
      }
    }

    if (this._reloading) {
      this._reloadLeft -= dt;
      if (this._reloadLeft <= 0) {
        const need = this.magSize - this.ammoInMag;
        const take = Math.min(need, this.reserve);
        this.ammoInMag += take;
        this.reserve -= take;
        this._reloading = false;
      }
    }
  }

  tryReload() {
    if (this._reloading) return false;
    if (this.ammoInMag >= this.magSize) return false;
    if (this.reserve <= 0) return false;
    this._reloading = true;
    this._reloadLeft = this.reloadTime;
    return true;
  }

  /**
   * @returns {{ origin, direction, empty?: boolean } | null}
   * empty:true means dry-fire click (no bullet)
   */
  tryFire(camera, ads) {
    if (this._reloading) return null;
    if (this._cooldown > 0) return null;

    if (this.ammoInMag <= 0) {
      if (this._emptyClickCd <= 0) {
        this._emptyClickCd = 0.25;
        if (this.reserve > 0) this.tryReload();
        return { empty: true };
      }
      return null;
    }

    this.ammoInMag -= 1;
    this._cooldown = this.fireInterval;

    if (this.muzzleFlash) this.muzzleFlash.intensity = 4.5;
    if (this.muzzleSprite) {
      this.muzzleSprite.material.opacity = 0.95;
      this.muzzleSprite.scale.setScalar(1.1);
    }

    const bloomAdd = this.bloomPerShot * (ads ? this.bloomAdsMul : 1);
    this.bloom = Math.min(this.maxBloom, this.bloom + bloomAdd);

    const recoilMul = ads ? this.recoilAdsMul : 1;
    this.pendingRecoil.pitch += this.recoilPitch * recoilMul * (0.85 + Math.random() * 0.3);
    this.pendingRecoil.yaw += (Math.random() - 0.5) * 2 * this.recoilYaw * recoilMul;

    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    const spread = (ads ? this.adsSpread : this.baseSpread) + this.bloom * (ads ? 0.5 : 1);
    direction.x += (Math.random() - 0.5) * spread * 2;
    direction.y += (Math.random() - 0.5) * spread * 2;
    direction.normalize();

    return { origin, direction, empty: false };
  }

  consumeRecoil() {
    const r = { pitch: this.pendingRecoil.pitch, yaw: this.pendingRecoil.yaw };
    this.pendingRecoil.pitch = 0;
    this.pendingRecoil.yaw = 0;
    return r;
  }

  resetAmmo() {
    this.ammoInMag = this.magSize;
    this.reserve = 90;
    this._reloading = false;
    this._reloadLeft = 0;
    this.bloom = 0;
  }
}
