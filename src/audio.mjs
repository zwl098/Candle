const audio = {
  ctx: null,
  master: null,
  noise: null,
  music: null,
  voices: [],
  muted: true,
  nextCrackle: 0,
};

export { audio };

export function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audio.ctx) {
    audio.ctx = new Ctx();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = audio.muted ? 0 : 0.26;
    audio.master.connect(audio.ctx.destination);
    const len = audio.ctx.sampleRate;
    const buf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    audio.noise = buf;
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
}

function tone(freq, dur, type, gain) {
  if (!audio.ctx || audio.muted) return;
  const t0 = audio.ctx.currentTime;
  const osc = audio.ctx.createOscillator();
  const g = audio.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  osc.connect(g);
  g.connect(audio.master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseBurst({ dur, type, freq, q, gain, freqEnd }) {
  if (!audio.ctx || audio.muted || !audio.noise) return;
  const t0 = audio.ctx.currentTime;
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.noise;
  const filter = audio.ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t0);
  if (freqEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + dur);
  filter.Q.value = q;
  const g = audio.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(audio.master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

export function playIgnite() {
  noiseBurst({ dur: 0.1, type: 'highpass', freq: 1400, q: 0.6, gain: 0.07 });
  tone(210, 0.14, 'sine', 0.035);
}

export function playExtinguish() {
  noiseBurst({ dur: 0.32, type: 'lowpass', freq: 1600, freqEnd: 180, q: 0.5, gain: 0.09 });
}

const MELODY = [
  ['G4', 0.75], ['G4', 0.25], ['A4', 1], ['G4', 1], ['C5', 1], ['B4', 2],
  ['G4', 0.75], ['G4', 0.25], ['A4', 1], ['G4', 1], ['D5', 1], ['C5', 2],
  ['G4', 0.75], ['G4', 0.25], ['G5', 1], ['E5', 1], ['C5', 1], ['B4', 1], ['A4', 2],
  ['F5', 0.75], ['F5', 0.25], ['E5', 1], ['C5', 1], ['D5', 1], ['C5', 3],
];
const NOTE_SEMI = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };

function noteFreq(name) {
  const semi = NOTE_SEMI[name[0]] + (Number(name[1]) - 4) * 12;
  return 440 * 2 ** (semi / 12);
}

function musicBus() {
  if (audio.music) return audio.music;
  const ctx = audio.ctx;
  const bus = ctx.createGain();
  const delay = ctx.createDelay(1);
  const feedback = ctx.createGain();
  const tail = ctx.createBiquadFilter();
  delay.delayTime.value = 0.23;
  feedback.gain.value = 0.32;
  tail.type = 'lowpass';
  tail.frequency.value = 2600;
  bus.connect(audio.master);
  bus.connect(delay);
  delay.connect(tail);
  tail.connect(feedback);
  feedback.connect(delay);
  tail.connect(audio.master);
  audio.music = bus;
  return bus;
}

function chime(freq, at, gain, out) {
  const ctx = audio.ctx;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0006, at + 1.5);
  g.connect(out);
  for (const [mul, amp] of [[1, 1], [2.01, 0.32], [4.03, 0.1]]) {
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * mul;
    og.gain.value = amp;
    osc.connect(og);
    og.connect(g);
    osc.start(at);
    osc.stop(at + 1.55);
    audio.voices.push(osc);
  }
}

export function playMelody() {
  if (!audio.ctx || audio.muted) return;
  stopMelody();
  const bus = musicBus();
  bus.gain.cancelScheduledValues(audio.ctx.currentTime);
  bus.gain.setValueAtTime(0.55, audio.ctx.currentTime);
  const beat = 0.44;
  let at = audio.ctx.currentTime + 0.25;
  for (const [name, beats] of MELODY) {
    chime(noteFreq(name), at, 0.16, bus);
    at += beats * beat;
  }
}

export function stopMelody() {
  if (!audio.ctx || !audio.music) return;
  const now = audio.ctx.currentTime;
  audio.music.gain.cancelScheduledValues(now);
  audio.music.gain.setValueAtTime(audio.music.gain.value, now);
  audio.music.gain.linearRampToValueAtTime(0, now + 0.35);
  for (const osc of audio.voices) {
    try { osc.stop(now + 0.4); } catch {}
  }
  audio.voices = [];
}

export function playCelebrate() {
  if (!audio.ctx || audio.muted) return;
  noiseBurst({ dur: 0.18, type: 'bandpass', freq: 2400, freqEnd: 900, q: 0.7, gain: 0.12 });
  const bus = musicBus();
  const now = audio.ctx.currentTime;
  bus.gain.cancelScheduledValues(now);
  bus.gain.setValueAtTime(0.55, now);
  ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => chime(noteFreq(n), now + 0.08 + i * 0.075, 0.09, bus));
}

export function playCrackle() {
  noiseBurst({
    dur: 0.025 + Math.random() * 0.04,
    type: 'bandpass',
    freq: 700 + Math.random() * 2200,
    q: 0.8,
    gain: 0.012 + Math.random() * 0.03,
  });
}

