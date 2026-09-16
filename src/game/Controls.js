/**
 * Touch (CF Mobile layout) + keyboard/mouse controls.
 */
export class Controls {
  constructor() {
    this.move = { x: 0, y: 0 }; // joystick / WASD, -1..1
    this.lookDelta = { x: 0, y: 0 };
    this.fire = false;
    this.reload = false;
    this.jump = false;
    this.ads = false;

    this._keys = new Set();
    this._lookPointerId = null;
    this._lookLast = null;
    this._joyPointerId = null;
    this._joyOrigin = { x: 0, y: 0 };
    // Tuned for quicker look response while keeping ADS comparatively controlled.
    this._sensitivity = 0.0035;
    this._mouseSens = 0.0032;

    this._joystickBase = document.getElementById('joystick-base');
    this._joystickStick = document.getElementById('joystick-stick');
    this._joystickZone = document.getElementById('joystick-zone');
    this._lookZone = document.getElementById('look-zone');
    this._btnFire = document.getElementById('btn-fire');
    this._btnReload = document.getElementById('btn-reload');
    this._btnJump = document.getElementById('btn-jump');
    this._btnAds = document.getElementById('btn-ads');

    this._bindTouch();
    this._bindKeyboard();
    this._bindMouse();
  }

  _bindTouch() {
    const maxRadius = 48;

    const onJoyStart = (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this._joyPointerId = t.identifier;
      const rect = this._joystickBase.getBoundingClientRect();
      this._joyOrigin.x = rect.left + rect.width / 2;
      this._joyOrigin.y = rect.top + rect.height / 2;
      this._updateJoy(t.clientX, t.clientY, maxRadius);
    };
    const onJoyMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._joyPointerId) {
          e.preventDefault();
          this._updateJoy(t.clientX, t.clientY, maxRadius);
        }
      }
    };
    const onJoyEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._joyPointerId) {
          this._joyPointerId = null;
          this.move.x = 0;
          this.move.y = 0;
          this._joystickStick.style.transform = 'translate(0px, 0px)';
        }
      }
    };

    this._joystickZone.addEventListener('touchstart', onJoyStart, { passive: false });
    this._joystickZone.addEventListener('touchmove', onJoyMove, { passive: false });
    this._joystickZone.addEventListener('touchend', onJoyEnd, { passive: false });
    this._joystickZone.addEventListener('touchcancel', onJoyEnd, { passive: false });

    // Look zone
    this._lookZone.addEventListener(
      'touchstart',
      (e) => {
        // Ignore if hitting action buttons (they're on top with higher z)
        const t = e.changedTouches[0];
        this._lookPointerId = t.identifier;
        this._lookLast = { x: t.clientX, y: t.clientY };
      },
      { passive: false }
    );
    this._lookZone.addEventListener(
      'touchmove',
      (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === this._lookPointerId && this._lookLast) {
            e.preventDefault();
            this.lookDelta.x += (t.clientX - this._lookLast.x) * this._sensitivity;
            this.lookDelta.y += (t.clientY - this._lookLast.y) * this._sensitivity;
            this._lookLast = { x: t.clientX, y: t.clientY };
          }
        }
      },
      { passive: false }
    );
    const endLook = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._lookPointerId) {
          this._lookPointerId = null;
          this._lookLast = null;
        }
      }
    };
    this._lookZone.addEventListener('touchend', endLook, { passive: false });
    this._lookZone.addEventListener('touchcancel', endLook, { passive: false });

    const hold = (btn, setOn, setOff) => {
      const start = (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('active');
        setOn();
      };
      const end = (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.remove('active');
        setOff();
      };
      btn.addEventListener('touchstart', start, { passive: false });
      btn.addEventListener('touchend', end, { passive: false });
      btn.addEventListener('touchcancel', end, { passive: false });
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        start(e);
      });
      btn.addEventListener('mouseup', end);
      btn.addEventListener('mouseleave', end);
    };

    hold(
      this._btnFire,
      () => {
        this.fire = true;
      },
      () => {
        this.fire = false;
      }
    );
    hold(
      this._btnJump,
      () => {
        this.jump = true;
      },
      () => {}
    );
    hold(
      this._btnReload,
      () => {
        this.reload = true;
      },
      () => {}
    );
    hold(
      this._btnAds,
      () => {
        this.ads = true;
      },
      () => {
        this.ads = false;
      }
    );
  }

  _updateJoy(clientX, clientY, maxRadius) {
    let dx = clientX - this._joyOrigin.x;
    let dy = clientY - this._joyOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > maxRadius) {
      dx = (dx / len) * maxRadius;
      dy = (dy / len) * maxRadius;
    }
    this._joystickStick.style.transform = `translate(${dx}px, ${dy}px)`;
    this.move.x = dx / maxRadius;
    this.move.y = -dy / maxRadius; // forward is up on screen
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      this._keys.add(e.code);
      if (e.code === 'KeyR') this.reload = true;
      if (e.code === 'Space') {
        e.preventDefault();
        this.jump = true;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.ads = true;
    });
    window.addEventListener('keyup', (e) => {
      this._keys.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.ads = false;
    });
  }

  _bindMouse() {
    const canvas = document.getElementById('game-canvas');
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.ads = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.ads = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.lookDelta.x += e.movementX * this._mouseSens;
        this.lookDelta.y += e.movementY * this._mouseSens;
      }
    });
  }

  requestPointerLock() {
    const canvas = document.getElementById('game-canvas');
    if (canvas.requestPointerLock) canvas.requestPointerLock();
  }

  /** Call once per frame after reading lookDelta. */
  consumeLook() {
    const d = { x: this.lookDelta.x, y: this.lookDelta.y };
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    return d;
  }

  consumeJump() {
    const j = this.jump;
    this.jump = false;
    return j;
  }

  consumeReload() {
    const r = this.reload;
    this.reload = false;
    return r;
  }

  /** Merge keyboard into move each frame. */
  syncKeyboardMove() {
    if (this._joyPointerId != null) return; // touch wins
    let x = 0;
    let y = 0;
    if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) x -= 1;
    if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) x += 1;
    if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) y += 1;
    if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) y -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.move.x = x;
    this.move.y = y;
  }
}
