/**
 * Shared look-sensitivity settings (touch + mouse).
 * UI scale 1–10 (default 5 ≈ current feel); maps to multiplier 0.3–2.5.
 */

export const LOOK_SENS_STORAGE_KEY = 'mcfps-look-sens';
export const BASE_TOUCH_SENS = 0.0035;
export const BASE_MOUSE_SENS = 0.0032;
export const DEFAULT_LOOK_SCALE = 5;
export const LOOK_SCALE_MIN = 1;
export const LOOK_SCALE_MAX = 10;

export function clampLookScale(scale) {
  const n = Number(scale);
  if (Number.isNaN(n)) return DEFAULT_LOOK_SCALE;
  return Math.min(LOOK_SCALE_MAX, Math.max(LOOK_SCALE_MIN, Math.round(n * 10) / 10));
}

/** Piecewise: 1→0.3, 5→1.0, 10→2.5 */
export function lookScaleToMultiplier(scale) {
  const s = clampLookScale(scale);
  if (s <= 5) return 0.3 + ((s - 1) / 4) * 0.7;
  return 1.0 + ((s - 5) / 5) * 1.5;
}

export function loadLookScale() {
  try {
    const raw = localStorage.getItem(LOOK_SENS_STORAGE_KEY);
    if (raw != null && raw !== '') {
      return clampLookScale(parseFloat(raw));
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_LOOK_SCALE;
}

export function saveLookScale(scale) {
  const s = clampLookScale(scale);
  try {
    localStorage.setItem(LOOK_SENS_STORAGE_KEY, String(s));
  } catch {
    /* ignore */
  }
  return s;
}

export function formatLookScaleLabel(scale) {
  const s = clampLookScale(scale);
  const mul = lookScaleToMultiplier(s);
  return `${s.toFixed(s % 1 === 0 ? 0 : 1)}（×${mul.toFixed(2)}）`;
}
