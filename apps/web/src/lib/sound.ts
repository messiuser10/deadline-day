/**
 * Sound effects, synthesised with the Web Audio API (no audio files to ship or license): a gavel knock
 * when a lot is sold and a referee's whistle at kick-off and full time. Off by default; nothing plays
 * unless the player switched sound on, which also unlocks audio (browsers need a tap first).
 */
import { usePrefs } from './prefs';

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Call from the click that turns sound on, so later effects are allowed to play. */
export function unlockAudio(): void {
  context();
}

function enabled(): AudioContext | null {
  return usePrefs.getState().sound ? context() : null;
}

/** One wooden knock: a short filtered noise burst over a low thump. */
function knock(ac: AudioContext, at: number, gain = 0.6): void {
  const len = Math.floor(ac.sampleRate * 0.08);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1100;
  band.Q.value = 1.2;
  const ng = ac.createGain();
  ng.gain.value = gain;
  noise.connect(band).connect(ng).connect(ac.destination);
  noise.start(at);

  const thump = ac.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(180, at);
  thump.frequency.exponentialRampToValueAtTime(70, at + 0.12);
  const tg = ac.createGain();
  tg.gain.setValueAtTime(gain, at);
  tg.gain.exponentialRampToValueAtTime(0.001, at + 0.16);
  thump.connect(tg).connect(ac.destination);
  thump.start(at);
  thump.stop(at + 0.18);
}

export function playGavel(): void {
  const ac = enabled();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  knock(ac, t, 0.5);
  knock(ac, t + 0.16, 0.7);
}

/** A trilled pea whistle. `blasts` short blasts, the last one long (full time is three). */
export function playWhistle(blasts = 1): void {
  const ac = enabled();
  if (!ac) return;
  let t = ac.currentTime + 0.01;
  for (let i = 0; i < blasts; i++) {
    const long = i === blasts - 1;
    const dur = long ? 0.7 : 0.22;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 2900;
    const trill = ac.createOscillator();
    trill.frequency.value = 28;
    const depth = ac.createGain();
    depth.gain.value = 180;
    trill.connect(depth).connect(osc.frequency);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.02);
    g.gain.setValueAtTime(0.18, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    trill.start(t);
    osc.stop(t + dur);
    trill.stop(t + dur);
    t += dur + 0.12;
  }
}
