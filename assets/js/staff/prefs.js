// Picture and camera choices, kept on this phone.
//   camera:   'phone' = the phone's own camera app (natural look, default)
//             'app'   = the quick camera inside this app (many shots in a row)
//   touchUp:  gentle automatic brightness and colour fix (off by default)
//   pro:      manual ISO / shutter / focus / colour in the in-app camera (off)
//   pack:     social media pack size: 'best' 2160 px (default) or 'standard' 1080 px
const KEY = 'picture-prefs';
const DEFAULTS = { camera: 'phone', touchUp: false, pro: false, pack: 'best' };

export function prefs() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { return { ...DEFAULTS }; }
}
export function setPref(key, value) {
  const p = prefs();
  p[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* blocked: default next time */ }
  return p;
}
