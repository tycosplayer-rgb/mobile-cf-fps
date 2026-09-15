import * as THREE from 'three';

export class Weapon {
  constructor() {
    this.magSize = 30;
    this.ammoInMag = 30;
    this.reserve = 90;
    this.damage = 34;
    this.headMultiplier = 2.2;
    this.fireInterval = 0.1; // 600 RPM-ish
    this.reloadTime = 1.6;
    this.spread = 0.012;
    this.adsSpread = 0.004;

    this._cooldown = 0;
    this._reloading = false;
    this._reloadLeft = 0;

    this.muzzleFlash = null;
  }

  get isReloading() {
    return this._reloading;
  }

  attachMuzzleFlash(camera) {
    const light = new THREE.PointLight(0xffaa55, 0, 8);
    light.position.set(0.25, -0.15, -0.6);
    camera.add(light);
    this.muzzleFlash = light;
  }

  update(dt) {
    if (this._cooldown > 0) this._cooldown -= dt;
    if (this.muzzleFlash && this.muzzleFlash.intensity > 0) {
      this.muzzleFlash.intensity = Math.max(0, this.muzzleFlash.intensity - dt * 40);
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
   * Attempt a shot. Returns { origin, direction } or null.
   */
  tryFire(camera, ads) {
    if (this._reloading) return null;
    if (this._cooldown > 0) return null;
    if (this.ammoInMag <= 0) {
      this.tryReload();
      return null;
    }

    this.ammoInMag -= 1;
    this._cooldown = this.fireInterval;
    if (this.muzzleFlash) this.muzzleFlash.intensity = 2.5;

    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    const spread = ads ? this.adsSpread : this.spread;
    direction.x += (Math.random() - 0.5) * spread * 2;
    direction.y += (Math.random() - 0.5) * spread * 2;
    direction.normalize();

    return { origin, direction };
  }
}
