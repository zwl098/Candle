import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText.js';
import confetti from 'canvas-confetti';
import { view } from './experience.js';

gsap.registerPlugin(SplitText);

const CAKE_R = 0.5;
const CAKE_TOP = 0.37;
const BASE_Y = CAKE_TOP + 0.012;
const CANDLE_H = 0.52;
const TOP_Y = BASE_Y + CANDLE_H;
const R_BOTTOM = 0.034;
const R_TOP = 0.029;
const FLAME_H = 0.26;
const IGNITE_DUR = 0.72;
const EXTING_DUR = 1.02;
const EMBER_DUR = 2.7;
const SMOKE_DUR = 2.75;

const els = view.els;

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reduceMotion = motionQuery.matches;

let state = 'unlit';
let stateT = 0;
let time = 0;
let leanSign = 1;
let smokeT = -1;
let smokeKill = false;
let smokeLean = 0.12;
let celebrationPending = false;

const audio = { ctx: null, master: null, noise: null, music: null, voices: [], muted: true, nextCrackle: 0 };
const mic = {
  on: false,
  stream: null,
  ctx: null,
  analyser: null,
  buf: null,
  baseline: 0.02,
  hold: 0,
  arm: 0,
  request: 0,
};

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function easeOutCubic(t) { return 1 - (1 - t) ** 3; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2; }
function hash1(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}

function setNote(text) {
  els.note.textContent = text || '';
}

function updateUI() {
  view.renderState(state);
  if (mic.on && state === 'burning') els.hint.textContent = '对着麦克风轻轻吹一口气';
  document.documentElement.dataset.motion = reduceMotion ? 'reduce' : 'full';
}

function unlockAudio() {
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

function playIgnite() {
  noiseBurst({ dur: 0.1, type: 'highpass', freq: 1400, q: 0.6, gain: 0.07 });
  tone(210, 0.14, 'sine', 0.035);
}

function playExtinguish() {
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

function playMelody() {
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

function stopMelody() {
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

function playCelebrate() {
  if (!audio.ctx || audio.muted) return;
  noiseBurst({ dur: 0.18, type: 'bandpass', freq: 2400, freqEnd: 900, q: 0.7, gain: 0.12 });
  const bus = musicBus();
  const now = audio.ctx.currentTime;
  bus.gain.cancelScheduledValues(now);
  bus.gain.setValueAtTime(0.55, now);
  ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => chime(noteFreq(n), now + 0.08 + i * 0.075, 0.09, bus));
}

function playCrackle() {
  noiseBurst({
    dur: 0.025 + Math.random() * 0.04,
    type: 'bandpass',
    freq: 700 + Math.random() * 2200,
    q: 0.8,
    gain: 0.012 + Math.random() * 0.03,
  });
}

async function enableMic() {
  if (state !== 'burning') return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setNote('无法使用麦克风，请用熄灭按钮');
    return;
  }
  els.blow.disabled = true;
  els['blow-label'].textContent = '等待麦克风…';
  const request = ++mic.request;
  let stream;
  let ctx;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    if (request !== mic.request || state !== 'burning') {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctx();
    await ctx.resume();
    if (request !== mic.request || state !== 'burning') {
      stream.getTracks().forEach((track) => track.stop());
      await ctx.close();
      return;
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    mic.on = true;
    mic.stream = stream;
    mic.ctx = ctx;
    mic.analyser = analyser;
    mic.buf = new Float32Array(analyser.fftSize);
    mic.baseline = 0.02;
    mic.hold = 0;
    mic.arm = time + 0.5;
    view.mic(true);
    setNote('仅在本机感受声音，吹灭后会自动关闭麦克风。');
    updateUI();
  } catch {
    stream?.getTracks().forEach((track) => track.stop());
    if (ctx) ctx.close().catch(() => {});
    if (request === mic.request) {
      setNote('暂时听不到你的声音，点击按钮也能吹灭。');
      view.mic(false);
    }
  } finally {
    if (request === mic.request) {
      els.blow.disabled = false;
      if (!mic.on) view.mic(false);
    }
  }
}

function disableMic() {
  mic.request++;
  mic.on = false;
  els.blow.disabled = false;
  if (mic.stream) mic.stream.getTracks().forEach((t) => t.stop());
  if (mic.ctx) mic.ctx.close().catch(() => {});
  mic.stream = null;
  mic.ctx = null;
  mic.analyser = null;
  view.mic(false);
  els.blow.style.removeProperty('--mic-level');
  setNote('');
  updateUI();
}

function sampleBlow(dt) {
  if (!mic.on || !mic.analyser || state !== 'burning' || time < mic.arm) {
    mic.hold = 0;
    return;
  }
  mic.analyser.getFloatTimeDomainData(mic.buf);
  let sum = 0;
  for (let i = 0; i < mic.buf.length; i++) sum += mic.buf[i] * mic.buf[i];
  const rms = Math.sqrt(sum / mic.buf.length);
  els.blow.style.setProperty('--mic-level', String(clamp(rms * 12, 0.2, 1)));
  mic.baseline += (rms - mic.baseline) * 0.018;
  if (rms - mic.baseline > 0.05 && rms > 0.07) {
    mic.hold += dt;
    if (mic.hold > 0.075) {
      mic.hold = 0;
      mic.arm = time + 0.6;
      startExtinguish();
    }
  } else {
    mic.hold = Math.max(0, mic.hold - dt);
  }
}

const NOISE_GLSL = /* glsl */ `
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.52;
  v += a * vnoise(p); a *= 0.5; p = p * 2.05 + vec3(1.7, 9.2, 2.8);
  v += a * vnoise(p); a *= 0.5; p = p * 2.02 + vec3(4.2, 1.4, 8.1);
  v += a * vnoise(p);
  return v;
}
`;

const flameUniforms = {
  uTime: { value: 0 },
  uCam: { value: new THREE.Vector3() },
  uBMin: { value: new THREE.Vector3() },
  uBMax: { value: new THREE.Vector3() },
  uGrow: { value: 0 },
  uWidth: { value: 1 },
  uIntensity: { value: 0 },
  uFlatten: { value: 0 },
  uLean: { value: 0 },
  uTurb: { value: 1 },
  uTip: { value: 1 },
  uSway: { value: new THREE.Vector2() },
  uEnergy: { value: 1 },
  uCalm: { value: 0 },
  uSteps: { value: 32 },
  uBaseH: { value: FLAME_H },
};

const flameMat = new THREE.ShaderMaterial({
  name: 'CandleFlame',
  uniforms: flameUniforms,
  transparent: true,
  depthWrite: false,
  depthTest: true,
  toneMapped: false,
  side: THREE.FrontSide,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  vertexShader: /* glsl */ `
    varying vec3 vObj;
    void main() {
      vObj = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: NOISE_GLSL + /* glsl */ `
    uniform float uTime;
    uniform vec3 uCam;
    uniform vec3 uBMin;
    uniform vec3 uBMax;
    uniform float uGrow;
    uniform float uWidth;
    uniform float uIntensity;
    uniform float uFlatten;
    uniform float uLean;
    uniform float uTurb;
    uniform float uTip;
    uniform vec2 uSway;
    uniform float uEnergy;
    uniform float uCalm;
    uniform float uSteps;
    uniform float uBaseH;
    varying vec3 vObj;

    float profile(float t) {
      float s = sin(pow(clamp(t, 0.0, 1.0), 0.62) * 3.14159265);
      float r = 0.046 * pow(max(s, 0.0), 0.72);
      r *= smoothstep(0.0, 0.055, t);
      r *= smoothstep(1.0, 0.7, t);
      return r;
    }

    float rayExit(vec3 ro, vec3 rd) {
      vec3 invRd = 1.0 / rd;
      vec3 t0s = (uBMin - ro) * invRd;
      vec3 t1s = (uBMax - ro) * invRd;
      vec3 tsm = min(t0s, t1s);
      vec3 tbg = max(t0s, t1s);
      return min(min(tbg.x, tbg.y), tbg.z);
    }

    void sampleFlame(vec3 p, out vec3 color, out float dens) {
      float motion = mix(1.0, 0.2, uCalm);
      float flatK = mix(1.0, 2.55, uFlatten);
      float y = p.y * flatK;
      float h = max(uGrow * uBaseH * uTip, 0.004);
      float yn = y / h;
      color = vec3(0.0);
      dens = 0.0;
      if (yn < -0.02 || yn > 1.06 || uIntensity < 0.001 || uGrow < 0.001) return;

      float width = mix(0.42, 1.0, clamp(uWidth, 0.0, 1.0));
      width *= mix(1.0, 1.72, uFlatten);
      float turb = uTurb * mix(0.16, 1.0, 1.0 - uCalm);
      float yn2 = yn * yn;
      vec2 sway = uSway * yn2;
      float tipW = turb * yn2;
      float wob = vnoise(vec3(uTime * 1.35 * motion, yn * 2.1, 2.2)) - 0.5;
      float wob2 = vnoise(vec3(5.1, uTime * 1.78 * motion, yn * 1.55)) - 0.5;
      float x = (p.x - sway.x - uLean * yn - wob * 0.055 * tipW) / max(width, 0.05);
      float z = (p.z - sway.y - wob2 * 0.03 * tipW) / max(width, 0.05);
      float r = length(vec2(x, z));

      vec3 npos = vec3(x * 2.7, yn * 1.95 - uTime * 0.72 * motion, z * 2.7);
      float warp = vnoise(npos);
      float n = fbm(npos * 1.45 + vec3(warp * 0.65, -uTime * 0.22 * motion, 1.3));
      float pr = profile(clamp(yn, 0.0, 1.0));
      float prJ = pr * (1.0 + (n - 0.5) * 0.38 * turb * smoothstep(0.22, 1.0, yn));
      float d = r / max(prJ, 0.0015);

      float shell = smoothstep(1.12, 0.38, d);
      shell *= smoothstep(1.05, 0.78, yn);
      shell *= smoothstep(-0.02, 0.04, yn);
      if (shell < 0.001) return;

      float streaks = fbm(vec3(x * 2.8, yn * 4.4 - uTime * 1.25 * motion, z * 2.8));
      float body = smoothstep(0.92, 0.08, d);
      float core = smoothstep(0.52, 0.0, d);
      float softHalo = smoothstep(1.1, 0.7, d) * (1.0 - body * 0.7);

      vec3 cAmber = vec3(1.15, 0.5, 0.16);
      vec3 cHoney = vec3(1.75, 1.05, 0.45);
      vec3 cCream = vec3(2.45, 1.9, 1.15);
      vec3 cCore = vec3(2.95, 2.55, 1.95);
      vec3 cBlue = vec3(0.55, 0.72, 1.05);

      vec3 col = cAmber;
      col = mix(col, cHoney, smoothstep(0.08, 0.62, body) * smoothstep(0.02, 0.18, yn));
      col = mix(col, cCream, smoothstep(0.28, 0.9, body) * smoothstep(0.06, 0.32, yn));
      col = mix(col, cCore, core * smoothstep(0.1, 0.34, yn) * smoothstep(0.78, 0.42, yn));
      col *= mix(0.92, 1.06, streaks);

      float blueRing = smoothstep(0.32, 0.58, d) * smoothstep(0.9, 0.62, d);
      float blueH = smoothstep(0.085, 0.0, yn);
      col = mix(col, cBlue, blueRing * blueH * 0.16);

      float pocket = smoothstep(0.014, 0.003, length(p.xz)) * smoothstep(0.08, 0.0, p.y);
      float densOut = shell * mix(0.58, 0.95, streaks) + softHalo * 0.12;
      densOut *= 1.0 - pocket * 0.75;
      densOut *= uIntensity;
      color = col;
      dens = densOut;
    }

    void main() {
      vec3 rd = normalize(vObj - uCam);
      float t0 = length(vObj - uCam);
      float t1 = rayExit(uCam, rd);
      float travel = t1 - t0;
      if (travel <= 0.0001) discard;
      float steps = clamp(uSteps, 8.0, 40.0);
      float dt = travel / steps;
      float jitter = hash13(vec3(gl_FragCoord.xy, fract(uTime * 17.0)));
      float t = t0 + jitter * dt;
      vec3 acc = vec3(0.0);
      float transmit = 1.0;
      for (int i = 0; i < 40; i++) {
        if (float(i) >= steps || t >= t1 || transmit < 0.035) break;
        vec3 p = uCam + rd * t;
        vec3 col;
        float dens;
        sampleFlame(p, col, dens);
        float absorb = dens * 8.2;
        float tr = exp(-absorb * dt);
        acc += col * dens * dt * 5.4 * transmit;
        transmit *= tr;
        t += dt;
      }
      acc *= mix(0.92, 1.08, clamp(uEnergy, 0.7, 1.3));
      acc = min(acc, vec3(3.6));
      if (dot(acc, vec3(0.299, 0.587, 0.114)) < 0.004) discard;
      gl_FragColor = vec4(acc, 1.0);
    }
  `,
});
flameMat.precision = 'highp';

const smokeUniforms = {
  uCam: { value: new THREE.Vector3() },
  uBMin: { value: new THREE.Vector3() },
  uBMax: { value: new THREE.Vector3() },
  uAge: { value: 0 },
  uOpacity: { value: 0 },
  uLean: { value: 0.1 },
  uCalm: { value: 0 },
  uSteps: { value: 18 },
};

const smokeMat = new THREE.ShaderMaterial({
  name: 'CandleSmoke',
  uniforms: smokeUniforms,
  transparent: true,
  depthWrite: false,
  depthTest: true,
  toneMapped: false,
  side: THREE.FrontSide,
  vertexShader: /* glsl */ `
    varying vec3 vObj;
    void main() {
      vObj = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: NOISE_GLSL + /* glsl */ `
    uniform vec3 uCam;
    uniform vec3 uBMin;
    uniform vec3 uBMax;
    uniform float uAge;
    uniform float uOpacity;
    uniform float uLean;
    uniform float uCalm;
    uniform float uSteps;
    varying vec3 vObj;

    float rayExit(vec3 ro, vec3 rd) {
      vec3 invRd = 1.0 / rd;
      vec3 t0s = (uBMin - ro) * invRd;
      vec3 t1s = (uBMax - ro) * invRd;
      vec3 tbg = max(min(t0s, t1s), max(t0s, t1s));
      return min(min(tbg.x, tbg.y), tbg.z);
    }

    void main() {
      if (uOpacity < 0.004) discard;
      vec3 rd = normalize(vObj - uCam);
      float t0 = length(vObj - uCam);
      float t1 = rayExit(uCam, rd);
      if (t1 <= t0) discard;
      float steps = clamp(uSteps, 8.0, 24.0);
      float dt = (t1 - t0) / steps;
      float t = t0 + hash13(vec3(gl_FragCoord.xy, uAge)) * dt;
      float alpha = 0.0;
      vec3 col = vec3(0.0);
      float motion = mix(1.0, 0.35, uCalm);
      for (int i = 0; i < 24; i++) {
        if (float(i) >= steps || t >= t1) break;
        vec3 p = uCam + rd * t;
        float age = clamp(uAge / 2.15, 0.0, 1.0);
        float head = mix(0.34, 0.98, smoothstep(0.0, 0.72, age));
        float column = smoothstep(0.0, 0.04, p.y) * (1.0 - smoothstep(head - 0.2, head + 0.04, p.y));
        float wander = p.y * mix(0.04, 0.38, age);
        float cx = sin(p.y * 2.4 + uAge * 0.6 * motion) * wander + uLean * p.y * 0.9;
        float cz = cos(p.y * 1.8 + 1.4 + uAge * 0.45 * motion) * wander * 0.7;
        float rad = length(p.xz - vec2(cx, cz));
        float radius = mix(0.03, 0.07, age) + p.y * mix(0.05, 0.22, age);
        float d = smoothstep(radius, radius * 0.2, rad);
        float n = fbm(vec3(p.x * 2.6, p.y * 1.7 - uAge * 0.28 * motion, p.z * 2.6));
        float wisps = mix(0.72, 1.0, smoothstep(0.18, 0.55, n));
        wisps *= mix(1.0, smoothstep(0.34, 0.66, n), age * smoothstep(0.2, 0.75, p.y));
        d *= wisps * column * mix(1.2, 0.42, age);
        vec3 sCol = mix(vec3(0.82, 0.78, 0.72), vec3(0.58, 0.55, 0.52), smoothstep(0.05, 0.6, p.y));
        float a = d * dt * 5.2;
        col += sCol * a * (1.0 - alpha);
        alpha += a * (1.0 - alpha);
        t += dt;
      }
      float coverage = clamp(alpha, 0.0, 1.0) * uOpacity * 0.72;
      if (coverage < 0.02) discard;
      vec3 straight = col / max(alpha, 0.001);
      gl_FragColor = vec4(straight, coverage);
    }
  `,
});

function canvasTexture(draw, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeFrostBump() {
  const tex = canvasTexture((g, w, h) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 170; i++) {
      const x = Math.random() * w;
      const sw = 2 + Math.random() * 9;
      const light = Math.random() < 0.5;
      const grad = g.createLinearGradient(x - sw, 0, x + sw, 0);
      grad.addColorStop(0, 'rgba(128,128,128,0)');
      grad.addColorStop(0.5, light ? 'rgba(255,255,255,0.34)' : 'rgba(0,0,0,0.34)');
      grad.addColorStop(1, 'rgba(128,128,128,0)');
      g.fillStyle = grad;
      g.fillRect(x - sw, Math.random() * h * 0.2, sw * 2, h * (0.6 + Math.random() * 0.4));
    }
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  }, 512, 256);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  return tex;
}

function makeRadial() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const img = g.createImageData(s, s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = ((x + 0.5) / s) * 2 - 1;
      const v = ((y + 0.5) / s) * 2 - 1;
      const d = Math.hypot(u, v);
      const a = d >= 1 ? 0 : (1 - d) ** 2.15;
      const i = (y * s + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildCandleGeometry() {
  const pts = [new THREE.Vector2(0.001, 0)];
  const n = 32;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = t * CANDLE_H;
    let r = lerp(R_BOTTOM, R_TOP, t);
    r += Math.sin(t * Math.PI) * 0.0007;
    pts.push(new THREE.Vector2(Math.max(r, 0.008), y));
  }
  const geo = new THREE.LatheGeometry(pts, 48);
  geo.computeVertexNormals();
  return geo;
}

function buildPool(radius) {
  const geo = new THREE.CircleGeometry(radius, 72);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const d = Math.min(1, Math.hypot(x, y) / radius);
    const dip = -(1 - d ** 0.55) * Math.min(0.008, radius * 0.2);
    const lip = smoothstep(0.84, 1, d) * 0.002;
    pos.setZ(i, dip + lip);
  }
  geo.computeVertexNormals();
  return geo;
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
} catch {
  throw new Error('webgl unavailable');
}

if (!renderer.capabilities.isWebGL2) {
  renderer.dispose();
  throw new Error('webgl2 required');
}

renderer.debug.onShaderError = (gl, program, _vs, fs) => {
  const log = `${gl.getProgramInfoLog(program) || ''}\n${gl.getShaderInfoLog(fs) || ''}`;
  console.error(log);
  setNote('着色器编译失败');
};

const ROOM_BG = 0x100d0b;
const AMBIENT_TINT = new THREE.Color('#ffe3c6');

renderer.setClearColor(ROOM_BG, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
let shadowsLive = true;
let shadowEvery = 2;
let shadowTick = 0;
els.stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(ROOM_BG);
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);

scene.fog = new THREE.Fog(ROOM_BG, 5.4, 9.2);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.28;

const hemi = new THREE.HemisphereLight(0xffe0c2, 0x2a170d, 0.12);
scene.add(hemi);

const garlandLight = new THREE.PointLight(0xffc896, 0, 0, 1.6);
garlandLight.position.set(-0.75, 1.0, -1.25);
scene.add(garlandLight);

const keyLight = new THREE.PointLight(0xffb070, 0, 5.2, 1.85);
keyLight.color.set('#ffb070');
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(512, 512);
keyLight.shadow.camera.near = 0.03;
keyLight.shadow.camera.far = 3.5;
keyLight.shadow.bias = -0.0006;
keyLight.shadow.normalBias = 0.01;
keyLight.shadow.radius = 5;
scene.add(keyLight);
const fillLight = new THREE.PointLight(0xffc08a, 0, 2.6, 2);
fillLight.color.set('#ffc08a');
scene.add(fillLight);
const emberLight = new THREE.PointLight(0xff2a0e, 0, 0.38, 2);
emberLight.color.set('#ff2a0e');
scene.add(emberLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(6, 96),
  new THREE.MeshStandardMaterial({
    color: 0x080605,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0,
  })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const contactTex = makeRadial();
const contact = new THREE.Mesh(
  new THREE.CircleGeometry(1.0, 48),
  new THREE.MeshBasicMaterial({
    map: contactTex,
    color: 0x000000,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
);
contact.rotation.x = -Math.PI / 2;
contact.position.y = 0.003;
contact.renderOrder = 1;
scene.add(contact);

const poolLight = new THREE.Mesh(
  new THREE.CircleGeometry(1.8, 64),
  new THREE.MeshBasicMaterial({
    map: contactTex,
    color: 0xffc896,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
);
poolLight.rotation.x = -Math.PI / 2;
poolLight.position.y = 0.006;
poolLight.renderOrder = 2;
scene.add(poolLight);

const waxUniforms = {
  uMap: { value: null },
  uHasMap: { value: 0 },
  uColor: { value: new THREE.Color('#ecd7b4') },
  uLightPos: { value: new THREE.Vector3() },
  uLightColor: { value: new THREE.Color('#ff9a4a') },
  uLightIntensity: { value: 0 },
  uEmberPos: { value: new THREE.Vector3() },
  uEmberIntensity: { value: 0 },
  uAmbient: { value: 0.1 },
  uAmbientColor: { value: AMBIENT_TINT },
  uEmit: { value: 0 },
  uSpec: { value: 0.18 },
  uTopY: { value: TOP_Y },
  uReflect: { value: new THREE.Vector2() },
  uStripes: { value: 0 },
};

const waxVert = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const waxFrag = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform vec3 uColor;
  uniform vec3 uLightPos;
  uniform vec3 uLightColor;
  uniform float uLightIntensity;
  uniform vec3 uEmberPos;
  uniform float uEmberIntensity;
  uniform float uAmbient;
  uniform vec3 uAmbientColor;
  uniform float uEmit;
  uniform float uSpec;
  uniform float uTopY;
  uniform vec2 uReflect;
  uniform float uStripes;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 albedo = uColor;
    if (uHasMap > 0.5) {
      vec3 tex = texture2D(uMap, vUv).rgb;
      tex = pow(max(tex, vec3(0.0)), vec3(2.2));
      albedo *= tex;
    }
    if (uStripes > 0.5) {
      float s = fract(vUv.x + vUv.y * 4.6);
      vec3 dye = vec3(1.0, 0.96, 0.9);
      float line = smoothstep(0.0, 0.015, s) * (1.0 - smoothstep(0.1, 0.125, s));
      dye = mix(dye, vec3(0.93, 0.74, 0.44), line * 0.8);
      albedo *= pow(max(dye, vec3(0.0)), vec3(2.2));
    }
    float heat = smoothstep(uTopY - 0.1, uTopY - 0.008, vWorld.y);
    albedo = mix(albedo, albedo * vec3(1.04, 0.9, 0.72), heat * 0.22);

    vec3 Lvec = uLightPos - vWorld;
    float dist = length(Lvec);
    vec3 L = Lvec / max(dist, 0.001);
    float atten = min(uLightIntensity / (1.25 + dist * dist * 2.1), 1.35);
    float ndl = dot(N, L);
    float wrap = clamp((ndl + 0.72) / 1.72, 0.0, 1.0);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 H = normalize(L + V);
    float spec = pow(clamp(dot(N, H), 0.0, 1.0), 48.0) * clamp(ndl, 0.0, 1.0);
    float rim = pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0, 1.0), 2.0);
    float poolRd = length(vUv - vec2(0.5)) * 2.0;
    if (uSpec > 0.4) {
      vec3 deep = vec3(0.22, 0.055, 0.01);
      vec3 molten = vec3(0.72, 0.24, 0.03);
      vec3 lipCol = vec3(1.05, 0.52, 0.12);
      albedo = mix(deep, molten, smoothstep(0.0, 0.5, poolRd));
      albedo = mix(albedo, lipCol, smoothstep(0.58, 0.96, poolRd));
    }
    float sky = 0.65 + 0.35 * N.y;
  vec3 lightC = mix(uLightColor, vec3(1.0, 0.88, 0.7), 0.55);
    vec3 col = albedo * (uAmbient * sky * uAmbientColor + wrap * atten * lightC);
    col += vec3(1.0, 0.62, 0.28) * rim * heat * atten * 0.1;
    col += albedo * uAmbientColor * rim * uAmbient * 1.4;
    col += uLightColor * spec * atten * uSpec * mix(1.0, smoothstep(0.45, 0.92, poolRd), step(0.4, uSpec));
    if (uSpec > 0.4) {
      float well = 1.0 - smoothstep(0.0, 0.62, poolRd);
      float meniscus = smoothstep(0.55, 0.84, poolRd) * (1.0 - smoothstep(0.9, 1.05, poolRd));
      col *= mix(1.0, 0.22, well);
      col += vec3(1.25, 0.62, 0.16) * meniscus * (0.45 + uEmit * 1.6);
      vec2 rv = (vUv - vec2(0.5)) - uReflect;
      float streak = exp(-pow(rv.x / 0.032, 2.0));
      streak *= exp(-pow((rv.y + 0.055) / 0.075, 2.0));
      streak *= smoothstep(0.18, 0.04, length(rv));
      col += vec3(1.85, 0.92, 0.34) * streak * uEmit * 2.4;
    } else {
      col += vec3(1.0, 0.7, 0.35) * uEmit * 0.1;
    }

    vec3 Evec = uEmberPos - vWorld;
    float edist = length(Evec);
    float eatten = uEmberIntensity / (0.2 + edist * edist * 8.0);
    col += vec3(1.0, 0.18, 0.03) * eatten * (0.25 + 0.75 * clamp(dot(N, Evec / max(edist, 0.001)), 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
  }
`;

const waxMaterials = [];

function makeWaxMaterial({ map = null, color = '#ecd7b4', spec = 0.16, emit = 0, stripes = false } = {}) {
  const uniforms = THREE.UniformsUtils.clone(waxUniforms);
  uniforms.uMap.value = map;
  uniforms.uHasMap.value = map ? 1 : 0;
  uniforms.uColor.value = new THREE.Color(color);
  uniforms.uSpec.value = spec;
  uniforms.uEmit.value = emit;
  uniforms.uStripes.value = stripes ? 1 : 0;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: waxVert,
    fragmentShader: waxFrag,
    toneMapped: false,
  });
  mat.userData.wax = true;
  waxMaterials.push(mat);
  return mat;
}

const waxMat = makeWaxMaterial({ color: '#ffffff', spec: 0.1, stripes: true });
const waxSolid = makeWaxMaterial({ color: '#fff1df', spec: 0.1 });
const poolMat = makeWaxMaterial({ color: '#ffe1b8', spec: 0.2, emit: 0 });

const PLATE_TOP = 0.028;
const GANACHE = new THREE.Color('#2a120b');

const plateMat = new THREE.MeshPhysicalMaterial({
  color: 0xf3ede4,
  roughness: 0.2,
  clearcoat: 0.7,
  clearcoatRoughness: 0.14,
});
const goldMat = new THREE.MeshPhysicalMaterial({ color: 0xe3b862, metalness: 1, roughness: 0.26 });
const creamMat = new THREE.MeshPhysicalMaterial({
  color: 0xf2dcbc,
  roughness: 0.6,
  sheen: 0.9,
  sheenRoughness: 0.4,
  sheenColor: new THREE.Color('#ffd7a8'),
  bumpMap: makeFrostBump(),
  bumpScale: 0.012,
});
const ganacheMat = new THREE.MeshPhysicalMaterial({
  color: GANACHE,
  roughness: 0.2,
  clearcoat: 1,
  clearcoatRoughness: 0.07,
});
const berryMat = new THREE.MeshPhysicalMaterial({
  color: 0x9a1230,
  roughness: 0.4,
  clearcoat: 0.55,
  clearcoatRoughness: 0.3,
  sheen: 0.5,
  sheenColor: new THREE.Color('#ff7090'),
});
const leafMat = new THREE.MeshPhysicalMaterial({ color: 0x2e6a3d, roughness: 0.45, sheen: 0.5, sheenColor: new THREE.Color('#9bd68a') });
const pearlMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.2,
  metalness: 0.12,
  clearcoat: 1,
  clearcoatRoughness: 0.1,
});

function shadowed(mesh, cast = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

const platePts = [
  [0.001, 0], [0.44, 0], [0.5, 0.006], [0.72, 0.022], [0.8, 0.038], [0.806, 0.046],
  [0.79, 0.051], [0.74, 0.04], [0.62, PLATE_TOP], [0.001, PLATE_TOP],
].map(([r, y]) => new THREE.Vector2(r, y));
shadowed(new THREE.Mesh(new THREE.LatheGeometry(platePts, 128), plateMat), false);

const plateRim = new THREE.Mesh(new THREE.TorusGeometry(0.792, 0.0042, 10, 160), goldMat);
plateRim.rotation.x = Math.PI / 2;
plateRim.position.y = 0.047;
scene.add(plateRim);

const cakeH = CAKE_TOP - PLATE_TOP;
const cakeBody = new THREE.Mesh(new THREE.CylinderGeometry(CAKE_R, CAKE_R * 1.004, cakeH, 128, 1), creamMat);
cakeBody.position.y = PLATE_TOP + cakeH / 2;
shadowed(cakeBody);

const goldBand = new THREE.Mesh(new THREE.TorusGeometry(CAKE_R + 0.002, 0.0036, 10, 160), goldMat);
goldBand.rotation.x = Math.PI / 2;
goldBand.position.y = 0.19;
scene.add(goldBand);

const PEARLS = 58;
const pearls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0125, 20, 14), pearlMat, PEARLS);
{
  const dummy = new THREE.Object3D();
  const pc = new THREE.Color();
  for (let i = 0; i < PEARLS; i++) {
    const ang = (i / PEARLS) * Math.PI * 2;
    dummy.position.set(Math.cos(ang) * (CAKE_R + 0.016), PLATE_TOP + 0.0125, Math.sin(ang) * (CAKE_R + 0.016));
    dummy.updateMatrix();
    pearls.setMatrixAt(i, dummy.matrix);
    pc.set(i % 4 === 0 ? '#e8bd62' : '#fff2e0');
    pearls.setColorAt(i, pc);
  }
}
shadowed(pearls);

const capPts = [
  [CAKE_R + 0.003, -0.004], [CAKE_R + 0.003, 0.003], [CAKE_R - 0.002, 0.0095], [CAKE_R - 0.016, 0.0112],
  [0.4, 0.0125], [0.3, 0.0148], [0.18, 0.0168], [0.08, 0.0178], [0.001, 0.018],
].map(([r, y]) => new THREE.Vector2(r, y));
const ganacheCap = new THREE.Mesh(new THREE.LatheGeometry(capPts, 128), ganacheMat);
ganacheCap.position.y = CAKE_TOP;
shadowed(ganacheCap, false);

function domeY(r) {
  const t = clamp(r / CAKE_R, 0, 1);
  return lerp(0.018, 0.0112, smoothstep(0, 0.9, t));
}

const dripSpecs = [];
for (let i = 0; i < 11; i++) {
  dripSpecs.push({
    a: (i / 11) * Math.PI * 2 + (hash1(i * 5.3) - 0.5) * 0.35,
    w: 0.075 + hash1(i * 2.9 + 1) * 0.05,
    L: 0.045 + hash1(i * 7.7 + 3) ** 1.4 * 0.17,
  });
}

function dripLength(ang) {
  let len = 0.02 + 0.008 * Math.sin(ang * 3 + 1) + 0.005 * Math.sin(ang * 7);
  for (const d of dripSpecs) {
    let da = Math.abs(ang - d.a);
    if (da > Math.PI) da = Math.PI * 2 - da;
    if (da < d.w) len = Math.max(len, d.L * Math.sqrt(1 - (da / d.w) ** 2));
  }
  return len;
}

function buildDripSkirt(radius, topY) {
  const SEG = 360;
  const RINGS = [0, 0.22, 0.5, 0.78, 1];
  const BULGE = [0.0075, 0.0062, 0.0058, 0.0068, 0.0036];
  const R = RINGS.length;
  const pos = [];
  for (let i = 0; i < SEG; i++) {
    const ang = (i / SEG) * Math.PI * 2;
    const len = dripLength(ang);
    for (let j = 0; j < R; j++) {
      const r = radius + BULGE[j];
      pos.push(Math.cos(ang) * r, topY - len * RINGS[j], Math.sin(ang) * r);
    }
  }
  const idx = [];
  for (let i = 0; i < SEG; i++) {
    const n = (i + 1) % SEG;
    for (let j = 0; j < R - 1; j++) {
      const a = i * R + j;
      const b = a + 1;
      const c = n * R + j;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const skirtMat = ganacheMat.clone();
skirtMat.side = THREE.DoubleSide;
shadowed(new THREE.Mesh(buildDripSkirt(CAKE_R, CAKE_TOP + 0.006), skirtMat));

for (const d of dripSpecs) {
  if (d.L < 0.1) continue;
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0105 + d.L * 0.02, 18, 14), ganacheMat);
  bead.scale.set(0.8, 1.3, 1);
  bead.rotation.y = -d.a;
  bead.position.set(
    Math.cos(d.a) * (CAKE_R + 0.0065),
    CAKE_TOP + 0.006 - d.L + 0.002,
    Math.sin(d.a) * (CAKE_R + 0.0065)
  );
  shadowed(bead);
}

function buildBerry() {
  const geo = new THREE.SphereGeometry(0.034, 36, 28);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = v.length();
    const lat = Math.asin(clamp(v.y / r, -1, 1));
    const lon = Math.atan2(v.z, v.x);
    const cells = Math.sin(lon * 7 + lat * 3) * Math.sin(lat * 12 + 1.2);
    const k = (r + 0.0036 * Math.abs(cells) ** 0.6) / r;
    pos.setXYZ(i, v.x * k, v.y * k * 0.92, v.z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

const berryGeo = buildBerry();
[
  [0.4, 0.27, 1.0], [1.5, 0.31, 0.9], [2.5, 0.26, 1.05], [3.7, 0.32, 0.95], [4.8, 0.28, 1.0], [5.6, 0.34, 0.85],
].forEach(([a, r, s], i) => {
  const berry = new THREE.Mesh(berryGeo, berryMat);
  berry.scale.setScalar(s);
  berry.position.set(Math.cos(a) * r, CAKE_TOP + domeY(r) + 0.026 * s, Math.sin(a) * r);
  berry.rotation.set(hash1(i + 2) * 6, hash1(i + 9) * 6, 0);
  shadowed(berry);
});

[[0.9, 0.3, 0.2], [2.0, 0.29, -0.3], [3.1, 0.33, 0.1], [5.2, 0.3, 0.35]].forEach(([a, r, tilt], i) => {
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), leafMat);
  leaf.scale.set(0.05, 0.005, 0.022);
  leaf.position.set(Math.cos(a) * r, CAKE_TOP + domeY(r) + 0.008, Math.sin(a) * r);
  leaf.rotation.set(0, -a + 1.2 + i, tilt);
  shadowed(leaf);
});

const flakeMat = goldMat.clone();
flakeMat.side = THREE.DoubleSide;
for (let i = 0; i < 16; i++) {
  const a = hash1(i * 4.1 + 5) * Math.PI * 2;
  const r = 0.11 + hash1(i * 6.7 + 2) * (CAKE_R - 0.17);
  const flake = new THREE.Mesh(new THREE.CircleGeometry(0.008 + hash1(i * 3.3) * 0.009, 5), flakeMat);
  flake.rotation.set(-Math.PI / 2 + (hash1(i * 1.9) - 0.5) * 0.3, 0, hash1(i * 8.8) * 6);
  flake.position.set(Math.cos(a) * r, CAKE_TOP + domeY(r) + 0.0016, Math.sin(a) * r);
  shadowed(flake, false);
}

const candle = new THREE.Mesh(buildCandleGeometry(), waxMat);
candle.position.y = BASE_Y;
scene.add(candle);

const rim = new THREE.Mesh(new THREE.TorusGeometry(R_TOP * 0.92, 0.0032, 8, 40), waxSolid);
rim.rotation.x = Math.PI / 2;
rim.position.y = TOP_Y - 0.002;
scene.add(rim);

const pool = new THREE.Mesh(buildPool(R_TOP * 0.86), poolMat);
pool.rotation.x = -Math.PI / 2;
pool.position.y = TOP_Y - 0.001;
scene.add(pool);

const DUST_N = 40;
const dustMotes = [];
const dustPositions = new Float32Array(DUST_N * 3);
const dustColors = new Float32Array(DUST_N * 3);
function resetMote(mote, scatterY) {
  const ang = Math.random() * Math.PI * 2;
  const rad = 0.16 + Math.random() * 0.38;
  mote.x = Math.cos(ang) * rad;
  mote.z = Math.sin(ang) * rad;
  mote.y = scatterY ? CAKE_TOP + 0.12 + Math.random() * 1.15 : CAKE_TOP + 0.08 + Math.random() * 0.1;
  mote.speed = 0.04 + Math.random() * 0.045;
  mote.phase = Math.random() * Math.PI * 2;
  mote.gain = 0.35 + Math.random() * 0.65;
}
for (let i = 0; i < DUST_N; i++) {
  const mote = {};
  resetMote(mote, true);
  dustMotes.push(mote);
  dustPositions[i * 3] = mote.x;
  dustPositions[i * 3 + 1] = mote.y;
  dustPositions[i * 3 + 2] = mote.z;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
dustGeo.setAttribute('color', new THREE.BufferAttribute(dustColors, 3));
const dust = new THREE.Points(
  dustGeo,
  new THREE.PointsMaterial({
    map: makeRadial(),
    size: 0.011,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    toneMapped: false,
  })
);
dust.renderOrder = 2;
dust.visible = false;
scene.add(dust);

const wickCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, TOP_Y - 0.004, 0),
  new THREE.Vector3(0.002, TOP_Y + 0.016, 0.001),
  new THREE.Vector3(0.008, TOP_Y + 0.04, 0.002),
]);
const wick = new THREE.Mesh(
  new THREE.TubeGeometry(wickCurve, 12, 0.0036, 5, false),
  new THREE.MeshStandardMaterial({ color: 0x1a120e, roughness: 0.82, metalness: 0 })
);
scene.add(wick);
const wickTipPos = wickCurve.getPoint(1);
const wickTip = new THREE.Mesh(
  new THREE.SphereGeometry(0.0052, 12, 8),
  new THREE.MeshStandardMaterial({
    color: 0x2a1008,
    emissive: new THREE.Color('#ff3a12'),
    emissiveIntensity: 0,
    roughness: 0.55,
  })
);
wickTip.position.copy(wickTipPos);
scene.add(wickTip);

const wickHit = new THREE.Mesh(
  new THREE.CylinderGeometry(0.09, 0.09, 0.28, 12),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
);
wickHit.position.set(0, TOP_Y + 0.04, 0);
scene.add(wickHit);

const FW = 0.5;
const FH = 0.46;
const flameGeo = new THREE.BoxGeometry(FW, FH, FW);
flameGeo.translate(0, FH / 2, 0);
flameUniforms.uBMin.value.set(-FW / 2, 0, -FW / 2);
flameUniforms.uBMax.value.set(FW / 2, FH, FW / 2);
const flameMesh = new THREE.Mesh(flameGeo, flameMat);
const FLAME_BASE = wickTipPos.y - 0.01;
flameMesh.position.y = FLAME_BASE;
flameMesh.visible = false;
flameMesh.renderOrder = 3;
scene.add(flameMesh);

const flameDepthProxy = new THREE.Mesh(
  new THREE.CylinderGeometry(0.02, 0.05, 1, 10).translate(0, 0.5, 0),
  new THREE.MeshBasicMaterial()
);
flameDepthProxy.position.y = FLAME_BASE;
flameDepthProxy.visible = false;
scene.add(flameDepthProxy);

const SW = 1.2;
const SH = 1.15;
const smokeGeo = new THREE.BoxGeometry(SW, SH, SW);
smokeGeo.translate(0, SH / 2, 0);
smokeUniforms.uBMin.value.set(-SW / 2, 0, -SW / 2);
smokeUniforms.uBMax.value.set(SW / 2, SH, SW / 2);
const smokeMesh = new THREE.Mesh(smokeGeo, smokeMat);
smokeMesh.position.y = wickTipPos.y - 0.02;
smokeMesh.visible = false;
smokeMesh.renderOrder = 4;
scene.add(smokeMesh);

const roomLight = { level: 0 };

const CONFETTI_COLORS = ['#f6cd7c', '#ffe8c2', '#f2b48a', '#ffd9b0'];
const confettiGeo = new THREE.PlaneGeometry(0.03, 0.016);
const confettiPieces = [];

function spawnConfetti(piece, mode) {
  const ang = Math.random() * Math.PI * 2;
  if (mode === 'burst') {
    const rad = 0.02 + Math.random() * 0.06;
    piece.x = Math.cos(ang) * rad;
    piece.z = Math.sin(ang) * rad;
    piece.y = TOP_Y + 0.04 + Math.random() * 0.05;
    piece.vx = (Math.random() - 0.5) * 0.16;
    piece.vy = 0.32 + Math.random() * 0.38;
    piece.vz = (Math.random() - 0.5) * 0.16;
    piece.life = 0;
    piece.dur = 1.55 + Math.random() * 0.7;
    piece.fade = 1;
    piece.active = true;
  } else {
    const rad = 0.16 + Math.random() * 0.48;
    piece.x = Math.cos(ang) * rad;
    piece.z = Math.sin(ang) * rad;
    piece.y = CAKE_TOP + 0.2 + Math.random() * 0.9;
    piece.vx = (Math.random() - 0.5) * 0.025;
    piece.vy = 0.03 + Math.random() * 0.035;
    piece.vz = (Math.random() - 0.5) * 0.025;
    piece.fade = 1;
    piece.active = true;
  }
}

function makeConfetti(ambient) {
  const mat = new THREE.MeshBasicMaterial({
    color: CONFETTI_COLORS[confettiPieces.length % CONFETTI_COLORS.length],
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(confettiGeo, mat);
  const piece = {
    mesh,
    ambient,
    rx: Math.random() * Math.PI,
    ry: Math.random() * Math.PI,
    rz: Math.random() * Math.PI,
    sx: (Math.random() - 0.5) * 2.4,
    sy: (Math.random() - 0.5) * 3.1,
    sz: (Math.random() - 0.5) * 1.8,
    active: false,
    fade: 0,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    dur: 1,
  };
  mesh.scale.setScalar(0.75 + Math.random() * 0.7);
  spawnConfetti(piece, ambient ? 'ambient' : 'burst');
  if (!ambient) piece.active = false;
  scene.add(mesh);
  confettiPieces.push(piece);
}

for (let i = 0; i < 12; i++) makeConfetti(false);

function stepConfetti(p, dt) {
  const pace = p.calm ? 0.05 : 1;
  for (const piece of confettiPieces) {
    if (!piece.active) {
      piece.mesh.material.opacity = 0;
      continue;
    }
    piece.x += piece.vx * dt * pace;
    piece.y += piece.vy * dt * pace;
    piece.z += piece.vz * dt * pace;
    if (!p.calm) {
      piece.rx += piece.sx * dt;
      piece.ry += piece.sy * dt;
      piece.rz += piece.sz * dt;
    }
    const radial = Math.hypot(piece.x, piece.z);
    if (piece.ambient) {
      piece.x += Math.sin(time * 0.55 + piece.ry) * 0.012 * dt * pace;
      if (piece.y > 1.72 || (piece.y < CAKE_TOP && radial < CAKE_R)) spawnConfetti(piece, 'ambient');
      if (radial > 0.82) {
        piece.x *= 0.82 / radial;
        piece.z *= 0.82 / radial;
      }
    } else {
      piece.life += dt;
      piece.vy -= 0.16 * dt * pace;
      piece.fade = 1 - smoothstep(piece.dur * 0.4, piece.dur, piece.life);
      if (piece.life > piece.dur || (piece.y < CAKE_TOP && radial < CAKE_R)) piece.active = false;
    }
    const dist = Math.hypot(piece.x - keyLight.position.x, piece.y - keyLight.position.y, piece.z - keyLight.position.z);
    const illum = p.light * Math.exp(-dist * 1.05);
    piece.mesh.position.set(piece.x, piece.y, piece.z);
    piece.mesh.rotation.set(piece.rx, piece.ry, piece.rz);
    piece.mesh.material.opacity = clamp(illum * piece.fade, 0, 1);
  }
}

const camLocal = new THREE.Vector3();
const colorWarm = new THREE.Color('#ffb070');
const colorHot = new THREE.Color('#ffe0b8');

function bulkSway(t, calm) {
  const amp = calm ? 0.01 : 0.038;
  const x = (noise1(t * 0.28) - 0.5) * 2 * amp + (noise1(t * 0.72 + 2.2) - 0.5) * amp * 0.7;
  const z = (noise1(t * 0.24 + 4.1) - 0.5) * 1.5 * amp + (noise1(t * 0.86 + 1.3) - 0.5) * amp * 0.45;
  return { x, z };
}

function flickerEnergy(t, calm) {
  const n = noise1(t * 0.62) * 0.55 + noise1(t * 1.55 + 4.2) * 0.3 + noise1(t * 3.8 + 1.6) * 0.15;
  const amp = calm ? 0.008 : 0.045;
  let e = 1 + (n - 0.5) * 2 * amp;
  if (!calm && noise1(t * 0.33 + 8.2) > 0.9) e *= 0.94;
  return e;
}

function pose() {
  const calm = reduceMotion;
  const energy = flickerEnergy(time, calm);
  const tip = calm ? 1 : 0.95 + noise1(time * 0.46 + 1.2) * 0.07 + noise1(time * 1.33) * 0.035;
  const sway = bulkSway(time, calm);
  let grow = 0;
  let width = 1;
  let intensity = 0;
  let flatten = 0;
  let lean = 0;
  let turb = 1;
  let wick = 0;
  let ember = 0;
  let light = 0;

  if (state === 'igniting') {
    const spark = smoothstep(0, 0.12, stateT);
    const u = clamp((stateT - 0.08) / 0.46, 0, 1);
    grow = easeOutCubic(u);
    if (stateT > 0.52) grow = lerp(Math.min(grow, 1) * 1.07, 1, clamp((stateT - 0.52) / 0.2, 0, 1));
    width = lerp(0.38, 1, easeOutCubic(clamp((stateT - 0.12) / 0.52, 0, 1)));
    intensity = easeOutCubic(clamp((stateT - 0.05) / 0.28, 0, 1));
    turb = lerp(0.2, 1, grow);
    wick = Math.min(1, spark * 1.15);
    light = intensity * energy;
  } else if (state === 'burning') {
    grow = 1;
    width = 1;
    intensity = 1;
    turb = 1;
    wick = 0.85 + (calm ? 0 : (noise1(time * 7.5) - 0.4) * 0.18);
    light = energy;
  } else if (state === 'extinguishing') {
    const u = clamp(stateT / EXTING_DUR, 0, 1);
    flatten = easeInOut(clamp(u / 0.46, 0, 1));
    lean = easeInOut(clamp((u - 0.02) / 0.4, 0, 1)) * leanSign * (calm ? 0.1 : 0.22);
    if (!calm) lean += flatten * (noise1(time * 8.4) - 0.5) * 0.04;
    const fade = 1 - smoothstep(0.48, 0.92, u);
    const shrink = lerp(1, 0.28, smoothstep(0.42, 0.95, u));
    grow = shrink;
    width = lerp(1, 1.15, flatten);
    intensity = fade;
    turb = lerp(1, 1.45, flatten);
    wick = 1;
    light = fade * energy * lerp(1, 0.45, flatten);
  } else if (state === 'ember') {
    ember = Math.exp(-stateT * 1.05) * (calm ? 1 : 0.86 + noise1(time * 6.2) * 0.14);
    wick = ember;
  }

  return { calm, energy, tip, sway, grow, width, intensity, flatten, lean, turb, wick, ember, light };
}

function applyPose(p, dt) {
  flameUniforms.uTime.value = time;
  flameUniforms.uGrow.value = p.grow;
  flameUniforms.uWidth.value = p.width;
  flameUniforms.uIntensity.value = p.intensity;
  flameUniforms.uFlatten.value = p.flatten;
  flameUniforms.uLean.value = p.lean;
  flameUniforms.uTurb.value = p.turb;
  flameUniforms.uTip.value = p.tip;
  flameUniforms.uSway.value.set(p.sway.x, p.sway.z);
  flameUniforms.uEnergy.value = p.intensity > 0 ? p.energy : 1;
  flameUniforms.uCalm.value = p.calm ? 1 : 0;
  flameMesh.visible = p.intensity > 0.02 && p.grow > 0.02;

  const flameH = FLAME_H * Math.max(p.grow, 0) * p.tip / lerp(1, 2.55, p.flatten);
  const coreY = FLAME_BASE + flameH * 0.36;
  const sx = p.sway.x * 0.13 + p.lean * 0.36;
  const sz = p.sway.z * 0.13;
  keyLight.position.set(sx, Math.max(FLAME_BASE + 0.02, coreY), sz);
  fillLight.position.set(sx * 0.4, FLAME_BASE + 0.02, sz * 0.4);
  emberLight.position.copy(wickTipPos);
  const keyAmt = p.light * 0.28;
  keyLight.intensity = keyAmt;
  fillLight.intensity = p.light * 0.06 + (state === 'igniting' ? smoothstep(0, 0.1, stateT) * (1 - smoothstep(0.18, 0.42, stateT)) * 0.08 : 0);
  emberLight.intensity = p.ember * 0.01;
  keyLight.color.copy(colorWarm).lerp(colorHot, clamp((p.energy - 0.94) * 2.5, 0, 1));

  poolLight.material.opacity = p.light * 0.07;
  poolLight.scale.setScalar(0.95 + p.light * 0.08);
  const room = roomLight.level;
  hemi.intensity = 0.04 + room * 0.1;
  garlandLight.intensity = room * 0.55;
  const amb = 0.05 + room * 0.15 + (1 - clamp(p.light, 0, 1)) * 0.03;
  for (const mat of waxMaterials) {
    mat.uniforms.uLightPos.value.copy(keyLight.position);
    mat.uniforms.uLightColor.value.copy(keyLight.color);
    mat.uniforms.uLightIntensity.value = Math.max(p.light * 2.6, state === 'igniting' ? smoothstep(0, 0.15, stateT) * 1.1 : 0);
    mat.uniforms.uEmberPos.value.copy(wickTipPos);
    mat.uniforms.uEmberIntensity.value = p.ember * 0.7;
    mat.uniforms.uAmbient.value = amb;
  }
  poolMat.uniforms.uEmit.value = p.light * 0.55 + p.ember * 0.22;
  stepConfetti(p, dt);
  flameDepthProxy.scale.set(Math.max(p.width, 0.3), Math.max(flameH, 0.001), Math.max(p.width, 0.3));
  flameDepthProxy.position.x = p.lean * 0.5;
  const wickGlow = state === 'ember' ? p.ember * 0.75 : Math.max(0, p.wick) * 0.42;
  wickTip.material.emissiveIntensity = wickGlow;
  wickTip.scale.setScalar(state === 'ember' ? 0.85 + p.ember * 0.2 : 1);
  wickTip.material.emissive.set(state === 'ember' ? '#ff4a22' : '#ff8a4a');

  camLocal.copy(camera.position);
  flameMesh.worldToLocal(camLocal);
  flameUniforms.uCam.value.copy(camLocal);
  const smokeCam = camLocal.copy(camera.position);
  smokeMesh.worldToLocal(smokeCam);
  smokeUniforms.uCam.value.copy(smokeCam);
  smokeUniforms.uCalm.value = p.calm ? 1 : 0;
  smokeUniforms.uAge.value = Math.max(0, smokeT);
  const envIn = smokeT < 0 ? 0 : smoothstep(0, 0.12, smokeT) * (1 - smoothstep(1.85, SMOKE_DUR, smokeT));
  const op = smokeKill ? Math.max(0, smokeUniforms.uOpacity.value - 0.05) : envIn;
  smokeUniforms.uOpacity.value = op;
  smokeMesh.visible = op > 0.01;

  const gleam = p.light * (0.62 + 0.38 * clamp(p.energy, 0.7, 1.25));
  poolMat.uniforms.uReflect.value.set(sx * 1.15 * gleam, sz * 0.45 * gleam);
  const lit = p.light;
  dust.visible = lit > 0.04;
  const pace = (p.calm ? 0.22 : 1) * dt;
  const pos = dustGeo.attributes.position;
  const col = dustGeo.attributes.color;
  for (let i = 0; i < DUST_N; i++) {
    const mote = dustMotes[i];
    mote.y += mote.speed * pace;
    mote.x += Math.sin(time * 0.31 + mote.phase) * 0.012 * pace;
    mote.z += Math.cos(time * 0.27 + mote.phase * 1.3) * 0.012 * pace;
    if (mote.y > 1.82) resetMote(mote, false);
    const radial = Math.hypot(mote.x, mote.z);
    if (mote.y < CAKE_TOP && radial < CAKE_R) mote.y = CAKE_TOP + 0.06;
    if (radial < 0.06 && mote.y < TOP_Y && mote.y > BASE_Y) {
      const push = 0.06 / Math.max(radial, 0.001);
      mote.x *= push;
      mote.z *= push;
    }
    pos.setXYZ(i, mote.x, mote.y, mote.z);
    const beam = smoothstep(0.72, 0.1, radial);
    const band = smoothstep(0.16, 0.4, mote.y) * (1 - smoothstep(1.25, 1.78, mote.y));
    const b = beam * band * lit * (0.45 + 0.55 * clamp(p.energy, 0.6, 1.3)) * mote.gain * 1.15;
    col.setXYZ(i, b, b * 0.72, b * 0.38);
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

function setState(next) {
  state = next;
  stateT = 0;
  updateUI();
  if (next === 'burning') playMelody();
}

const rig = { dolly: 0, lift: 0, orbit: 0, aim: 0 };
const ROOM_LIGHT_REST = 0.24;

function moveRig(vars, duration, ease = 'power2.inOut') {
  gsap.killTweensOf(rig);
  if (reduceMotion) gsap.set(rig, vars);
  else gsap.to(rig, { ...vars, duration, ease });
}

function setRoomLight(level, duration) {
  gsap.to(roomLight, { level: level, duration, ease: 'sine.inOut', overwrite: true });
}

function startIgnite() {
  if (state !== 'unlit' && state !== 'ember') return;
  celebrationPending = false;
  unlockAudio();
  playIgnite();
  smokeKill = smokeT >= 0;
  for (const piece of confettiPieces) {
    piece.active = false;
  }
  confettiFx.reset();
  if (celebrationLightTl) celebrationLightTl.kill();
  if (celebrateTl) {
    celebrateTl.kill();
    celebrateTl = null;
  }
  moveRig({ dolly: 0.2, lift: -0.02, orbit: 0, aim: 0 }, 2.2);
  setRoomLight(0.16, 1.6);
  setState('igniting');
}

function startExtinguish() {
  if (state !== 'burning') return;
  disableMic();
  unlockAudio();
  playExtinguish();
  stopMelody();
  leanSign = Math.random() < 0.5 ? -1 : 1;
  smokeLean = leanSign * 0.16;
  smokeT = 0;
  smokeKill = false;
  smokeUniforms.uLean.value = smokeLean;
  celebrationPending = true;
  setState('extinguishing');
}

const CONFETTI_PALETTE = ['#f6cd7c', '#ffe8c2', '#f2b48a', '#fff3e2', '#e9c58a', '#f7d9d0'];
const confettiFx = confetti.create(document.getElementById('confetti'), { resize: true, useWorker: true });
const celebrateEl = document.getElementById('celebrate');
const wishTitle = celebrateEl.querySelector('.wish-title');
const wishSub = celebrateEl.querySelector('.wish-message');
let wishSplit = null;
let celebrateTl = null;
let celebrationLightTl = null;
const cakeScreen = new THREE.Vector3();

function cakeOrigin() {
  cakeScreen.set(0, TOP_Y, 0).project(camera);
  const rect = els.stage.getBoundingClientRect();
  return { x: (rect.left + (cakeScreen.x + 1) / 2 * rect.width) / window.innerWidth, y: (rect.top + (1 - cakeScreen.y) / 2 * rect.height) / window.innerHeight };
}

function fireConfetti() {
  const base = { colors: CONFETTI_PALETTE, shapes: ['square', 'circle'], disableForReducedMotion: true };
  confettiFx({ ...base, particleCount: 85, spread: 100, startVelocity: 28, scalar: 0.75, gravity: 0.65, ticks: 190, origin: cakeOrigin() });
}

function celebrate() {
  celebrationPending = false;
  view.celebrate();
  playCelebrate();
  if (!reduceMotion) fireConfetti();

  celebrationLightTl = gsap.timeline()
    .to(roomLight, { level: 0.48, duration: 0.8, ease: 'power2.out' })
    .to(roomLight, { level: ROOM_LIGHT_REST, duration: 2.2, ease: 'sine.inOut' }, 4.2);
  moveRig({ dolly: -0.12, lift: 0.02, orbit: 0, aim: 0 }, 1.6, 'power3.out');

  if (celebrateTl) celebrateTl.kill();
  if (!wishSplit) wishSplit = new SplitText(wishTitle, { type: 'chars', charsClass: 'char' });
  gsap.set(celebrateEl, { autoAlpha: 1, y: 0 });
  celebrateTl = gsap.timeline();
  if (reduceMotion) {
    gsap.set([wishSplit.chars, wishSub], { clearProps: 'all' });
    celebrateTl.fromTo(celebrateEl, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6 });
  } else {
    celebrateTl
      .fromTo(wishSplit.chars, {
        yPercent: 90,
        rotateX: -15,
        scale: 0.97,
        autoAlpha: 0,
        filter: 'blur(4px)',
      }, {
        yPercent: 0,
        rotateX: 0,
        scale: 1,
        autoAlpha: 1,
        filter: 'blur(0px)',
        duration: 0.9,
        ease: 'power3.out',
        stagger: 0.07,
      })
      .fromTo(wishSub,
        { y: 14, autoAlpha: 0, filter: 'blur(6px)' },
        { y: 0, autoAlpha: 1, filter: 'blur(0px)', duration: 0.9, ease: 'power2.out' },
        '-=0.5');
  }
}

function primary() {
  if (state === 'unlit' || state === 'ember') startIgnite();
  else if (state === 'burning') startExtinguish();
}

function stepState(dt) {
  stateT += dt;
  if (smokeT >= 0) {
    smokeT += dt;
    if (smokeKill) {
      smokeUniforms.uOpacity.value = Math.max(0, smokeUniforms.uOpacity.value - dt * 2.2);
      if (smokeUniforms.uOpacity.value <= 0.01) smokeT = -1;
    } else if (smokeT > SMOKE_DUR) {
      smokeT = -1;
    }
  }
  if (state === 'igniting' && stateT >= IGNITE_DUR) setState('burning');
  else if (state === 'extinguishing' && stateT >= EXTING_DUR) setState('ember');
  else if (state === 'ember' && celebrationPending && stateT >= 0.45) celebrate();
  else if (state === 'ember' && stateT >= EMBER_DUR) {
    setState('unlit');
    wickTip.material.emissiveIntensity = 0;
    emberLight.intensity = 0;
    keyLight.intensity = 0;
    fillLight.intensity = 0;
  }
}

function frameCamera() {
  const narrow = window.innerWidth <= 760;
  const { width, height } = els.stage.getBoundingClientRect();
  const aspect = width / Math.max(height, 1);
  camera.fov = 32;
  const z = narrow ? 3.0 : 3.6;
  // Both the plate width and the top of the flame must fit the scene's own viewport.
  const distance = Math.max(z, 1.04 / (Math.tan(THREE.MathUtils.degToRad(16)) * aspect));
  camBase.pos.set(narrow ? 0 : 0.1, 1.4, distance);
  camBase.look.set(0, 0.62, 0);
}

const camBase = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
const camDir = new THREE.Vector3();
const camLook = new THREE.Vector3();
const focusTarget = new THREE.Vector3(0, TOP_Y - 0.04, 0);

function updateCamera(dt) {
  const follow = reduceMotion ? 1 : 1 - Math.exp(-dt * 2.2);
  pointer.sx += ((reduceMotion ? 0 : pointer.x) - pointer.sx) * follow;
  pointer.sy += ((reduceMotion ? 0 : pointer.y) - pointer.sy) * follow;
  const drift = reduceMotion ? 0 : Math.sin(time * 0.21) * 0.025;
  camDir.subVectors(camBase.look, camBase.pos).normalize();
  camera.position.copy(camBase.pos).addScaledVector(camDir, rig.dolly);
  camera.position.y += rig.lift - pointer.sy * 0.12;
  const ang = rig.orbit + pointer.sx * 0.07 + drift;
  const dx = camera.position.x - camBase.look.x;
  const dz = camera.position.z - camBase.look.z;
  camera.position.x = camBase.look.x + dx * Math.cos(ang) + dz * Math.sin(ang);
  camera.position.z = camBase.look.z - dx * Math.sin(ang) + dz * Math.cos(ang);
  camLook.copy(camBase.look);
  camLook.y += rig.lift * 0.35 + rig.aim;
  camera.lookAt(camLook);
  if (focusPass) {
    camera.getWorldDirection(camDir);
    focusPass.uniforms.focus.value = camDir.dot(camLook.subVectors(focusTarget, camera.position));
  }
}

const WarmGradeShader = {
  name: 'WarmGrade',
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 col = src.rgb * vec3(1.015, 1.0, 0.97);
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += vec3(0.004, 0.003, 0.002) * (1.0 - smoothstep(0.0, 0.35, lum));
      vec3 grey = vec3(lum);
      col = mix(grey, col, mix(1.08, 0.96, smoothstep(0.55, 2.4, lum)));
      gl_FragColor = vec4(max(col, 0.0), src.a);
    }
  `,
};

class FocusPass extends BokehPass {
  constructor(sceneRef, cameraRef, params, hidden) {
    super(sceneRef, cameraRef, params);
    this.hidden = hidden;
    this.saved = [];
    this.uniforms.range = { value: params.range };
    this.materialBokeh.fragmentShader = this.materialBokeh.fragmentShader
      .replace('uniform float focus;', 'uniform float focus;\nuniform float range;')
      .replace(
        'float factor = ( focus + viewZ );',
        'float gap = focus + viewZ;\nfloat factor = sign( gap ) * max( abs( gap ) - range, 0.0 );'
      );
  }

  setSize(width, height) {
    super.setSize(width, height);
    this.renderTargetDepth.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1));
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const flameOn = flameMesh.visible;
    this.saved.length = 0;
    for (const obj of this.hidden) {
      this.saved.push(obj.visible);
      obj.visible = false;
    }
    flameDepthProxy.visible = flameOn;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    flameDepthProxy.visible = false;
    this.hidden.forEach((obj, i) => { obj.visible = this.saved[i]; });
  }
}

let composer;
let bloomPass;
let focusPass = null;
function setupComposer() {
  const pr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 760 ? 1.25 : 1.5);
  const { width, height } = els.stage.getBoundingClientRect();
  renderer.setPixelRatio(pr);
  renderer.setSize(width, height);
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  focusPass = new FocusPass(scene, camera, { focus: 4, aperture: 0.02, maxblur: 0.034, range: 0.7 }, [
    flameMesh, smokeMesh, wickHit, dust, poolLight, contact,
    ...confettiPieces.map((piece) => piece.mesh),
  ]);
  composer.addPass(focusPass);
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.22,
    0.78,
    1.05
  );
  for (const tint of bloomPass.bloomTintColors) tint.set(1, 0.86, 0.68);
  composer.addPass(bloomPass);
  composer.addPass(new ShaderPass(WarmGradeShader));
  composer.addPass(new OutputPass());
}

let prCap = 2;
let tier = 0;
function resize() {
  const w = Math.max(1, els.stage.clientWidth);
  const h = Math.max(1, els.stage.clientHeight);
  const pr = Math.min(window.devicePixelRatio || 1, w < 760 ? 1.25 : 1.5, prCap);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  frameCamera();
  camera.updateProjectionMatrix();
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  wickHit.scale.set(coarse ? 1.4 : 1, coarse ? 1.15 : 1, coarse ? 1.4 : 1);
  flameUniforms.uSteps.value = w < 760 ? 22 : 32;
  smokeUniforms.uSteps.value = w < 760 ? 14 : 18;
  if (tier >= 1) flameUniforms.uSteps.value = Math.min(flameUniforms.uSteps.value, tier >= 2 ? 16 : 24);
  if (tier >= 2) smokeUniforms.uSteps.value = Math.min(smokeUniforms.uSteps.value, 10);
}

setupComposer();
resize();
updateUI();

function intro() {
  const curtain = document.getElementById('curtain');
  if (reduceMotion) {
    gsap.set(curtain, { autoAlpha: 0 });
    roomLight.level = ROOM_LIGHT_REST;
    return;
  }
  gsap.set(rig, { dolly: -0.35, lift: 0.1, orbit: -0.05 });
  gsap.timeline({ delay: 0.15 })
    .to(curtain, { autoAlpha: 0, duration: 1, ease: 'power2.out' })
    .to(rig, { dolly: 0, lift: 0, orbit: 0, duration: 2, ease: 'power3.out' }, 0)
    .to(roomLight, { level: ROOM_LIGHT_REST, duration: 1.6, ease: 'sine.inOut' }, 0.2);
}
intro();

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

let lastChromeInput = performance.now();
let chromeQuiet = false;

function setChromeQuiet(quiet) {
  if (quiet === chromeQuiet) return;
  chromeQuiet = quiet;
  document.documentElement.dataset.chrome = quiet ? 'quiet' : 'awake';
}

function revealChrome() {
  lastChromeInput = performance.now();
  setChromeQuiet(false);
}

function updateChrome() {
  const settled = state === 'burning' && stateT > 2.8 && !els.note.textContent;
  const idle = performance.now() - lastChromeInput > 3200;
  const focused = document.activeElement?.closest?.('button, a');
  setChromeQuiet(settled && idle && !focused);
}

revealChrome();

renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  revealChrome();
  unlockAudio();
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  if (state === 'unlit' || state === 'ember') {
    if (raycaster.intersectObject(wickHit, false).length) primary();
  } else if (state === 'burning') {
    if (raycaster.intersectObject(flameMesh, false).length) primary();
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' || e.pointerType === 'pen') revealChrome();
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  if (e.pointerType === 'mouse') {
    pointer.x = ndc.x;
    pointer.y = ndc.y;
  }
  raycaster.setFromCamera(ndc, camera);
  let hot = false;
  if (state === 'unlit' || state === 'ember') hot = raycaster.intersectObject(wickHit, false).length > 0;
  else if (state === 'burning' && flameMesh.visible) hot = raycaster.intersectObject(flameMesh, false).length > 0;
  renderer.domElement.style.cursor = hot ? 'pointer' : 'default';
});

view.bind({
  primary,
  sound() {
    unlockAudio();
    audio.muted = !audio.muted;
    if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.26;
    view.sound(audio.muted);
    if (!audio.muted && state === 'burning') playMelody();
  },
  mic() {
    if (mic.on) disableMic();
    else enableMic();
  },
});
view.sound(audio.muted);

window.addEventListener('pointerdown', revealChrome);
window.addEventListener('keydown', revealChrome);

function onMotionChange(ev) {
  reduceMotion = ev.matches;
  if (reduceMotion) {
    gsap.killTweensOf(rig);
    gsap.set(rig, { dolly: 0, lift: 0, orbit: 0, aim: 0 });
    confettiFx.reset();
    if (celebrateTl) celebrateTl.progress(1);
  }
  updateUI();
}
motionQuery.addEventListener('change', onMotionChange);
window.addEventListener('resize', resize);
const stageResize = new ResizeObserver(resize);
stageResize.observe(els.stage);

function onVisibilityChange() {
  if (document.hidden) {
    disableMic();
    audio.ctx?.suspend().catch(() => {});
  } else if (!audio.muted) audio.ctx?.resume().catch(() => {});
}
document.addEventListener('visibilitychange', onVisibilityChange);

let last = performance.now();
let elapsed = 0;

let frameAvg = 1 / 60;
let sinceAdapt = 0;

function setQuality(next) {
  tier = next;
  if (tier >= 1) {
    shadowEvery = 3;
    prCap = 1.25;
    flameUniforms.uSteps.value = Math.min(flameUniforms.uSteps.value, 24);
  }
  if (tier >= 2) {
    prCap = 1;
    focusPass.enabled = false;
    flameUniforms.uSteps.value = Math.min(flameUniforms.uSteps.value, 16);
    smokeUniforms.uSteps.value = Math.min(smokeUniforms.uSteps.value, 10);
  }
  if (tier >= 3) {
    shadowsLive = false;
    bloomPass.enabled = false;
  }
  const pr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 760 ? 1.25 : 1.5, prCap);
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  composer.setSize(els.stage.clientWidth, els.stage.clientHeight);
}

function adaptQuality(dt) {
  if (elapsed < 2.5 || tier >= 3) return;
  frameAvg += (dt - frameAvg) * 0.05;
  sinceAdapt += dt;
  if (sinceAdapt > 1.2 && frameAvg > 0.0215) {
    sinceAdapt = 0;
    setQuality(tier + 1);
  }
}

let running = true;
let frameId;
function tick(now) {
  if (!running) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  elapsed += dt;
  stepState(dt);
  sampleBlow(dt);
  updateCamera(dt);
  const p = pose();
  applyPose(p, dt);
  updateChrome();
  if (state === 'burning' && audio.ctx && !audio.muted && time > audio.nextCrackle) {
    playCrackle();
    audio.nextCrackle = time + 0.09 + Math.random() * 0.26;
  }
  if (shadowsLive && p.light > 0.02 && ++shadowTick >= shadowEvery) {
    shadowTick = 0;
    renderer.shadowMap.needsUpdate = true;
  }
  composer.render();
  adaptQuality(dt);
  frameId = requestAnimationFrame(tick);
}

renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  document.dispatchEvent(new Event('candle:render-failed'));
});

export function disposeScene() {
  if (!running) return;
  running = false;
  cancelAnimationFrame(frameId);
  stageResize.disconnect();
  window.removeEventListener('resize', resize);
  window.removeEventListener('pointerdown', revealChrome);
  window.removeEventListener('keydown', revealChrome);
  motionQuery.removeEventListener('change', onMotionChange);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  disableMic();
  audio.ctx?.close().catch(() => {});
  gsap.killTweensOf(rig);
  if (celebrateTl) celebrateTl.kill();
  if (celebrationLightTl) celebrationLightTl.kill();
  wishSplit?.revert();
  gsap.set([celebrateEl, wishSub], { clearProps: 'all' });
  confettiFx.reset();
  composer.dispose();
  for (const pass of composer.passes) pass.dispose?.();
  renderer.dispose();
}
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) disposeScene();
});
frameId = requestAnimationFrame(tick);
