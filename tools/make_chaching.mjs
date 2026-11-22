// Makes assets/sounds/cha-ching.wav: a short cash-register "cha-ching"
// (two mechanical clacks, then a bright bell). Synthesised here so the
// sound is the shop's own, with no licence questions.
//   node tools/make_chaching.mjs
import { writeFileSync } from 'node:fs';

const RATE = 22050;
const LEN = 1.35;
const n = Math.round(RATE * LEN);
const out = new Float32Array(n);
let seed = 7;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1;

// "cha": two quick clacks of filtered noise.
function clack(at, gain) {
  let lp = 0;
  const start = Math.round(at * RATE);
  for (let i = 0; i < 0.06 * RATE; i++) {
    const t = i / RATE;
    const x = noise();
    lp += 0.55 * (x - lp);
    const hp = x - lp; // bright, papery
    out[start + i] += gain * hp * Math.exp(-t * 70) + gain * 0.5 * Math.sin(2 * Math.PI * 900 * t) * Math.exp(-t * 90);
  }
}
clack(0.0, 0.7);
clack(0.075, 0.55);

// "ching": a bell, inharmonic partials with long decays, struck twice.
function bell(at, f0, gain) {
  const partials = [[1, 1, 3.2], [2.0, 0.5, 4.5], [2.76, 0.42, 5], [4.07, 0.22, 7], [5.4, 0.16, 9], [6.8, 0.08, 11]];
  const start = Math.round(at * RATE);
  for (let i = 0; start + i < n; i++) {
    const t = i / RATE;
    const attack = Math.min(1, t / 0.003);
    let s = 0;
    for (const [r, a, d] of partials) s += a * Math.sin(2 * Math.PI * f0 * r * t + r) * Math.exp(-t * d);
    out[start + i] += gain * attack * s;
  }
}
bell(0.15, 1568, 0.32); // G6
bell(0.17, 2093, 0.26); // C7, slightly after: the "ch-ing" shimmer

// Normalise and fade the tail.
let peak = 0;
for (const v of out) peak = Math.max(peak, Math.abs(v));
const pcm = Buffer.alloc(44 + n * 2);
for (let i = 0; i < n; i++) {
  const fade = i > n - 0.15 * RATE ? (n - i) / (0.15 * RATE) : 1;
  pcm.writeInt16LE(Math.round((out[i] / peak) * 0.89 * fade * 32767), 44 + i * 2);
}
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + n * 2, 4); pcm.write('WAVE', 8);
pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(RATE, 24); pcm.writeUInt32LE(RATE * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
pcm.write('data', 36); pcm.writeUInt32LE(n * 2, 40);
writeFileSync(new URL('../assets/sounds/cha-ching.wav', import.meta.url), pcm);
console.log('wrote assets/sounds/cha-ching.wav', pcm.length, 'bytes');
