import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BASE_Y = 0.055;
const CANDLE_H = 1.02;
const TOP_Y = BASE_Y + CANDLE_H;
const R_BOTTOM = 0.158;
const R_TOP = 0.14;
const FLAME_H = 0.46;
const IGNITE_DUR = 0.72;
const EXTING_DUR = 1.02;
const EMBER_DUR = 2.7;
const SMOKE_DUR = 2.75;

const UI = {
  unlit: { status: '未燃', button: '点燃', disabled: false, hint: '点击烛芯，或按 Enter / 空格' },
  igniting: { status: '点燃中', button: '点燃中', disabled: true, hint: '火苗正从烛芯升起' },
  burning: { status: '燃烧中', button: '熄灭', disabled: false, hint: '点击火焰，或按 Enter / 空格' },
  extinguishing: { status: '熄灭中', button: '熄灭中', disabled: true, hint: '火苗侧倒，随后散成烟' },
  ember: { status: '余烬', button: '点燃', disabled: false, hint: '烛芯还有余热，可再次点燃' },
};

const els = {
  stage: document.getElementById('stage'),
  status: document.getElementById('status'),
  hint: document.getElementById('hint'),
  action: document.getElementById('action'),
  mute: document.getElementById('mute'),
  blow: document.getElementById('blow'),
  note: document.getElementById('note'),
  fallback: document.getElementById('fallback'),
};

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reduceMotion = motionQuery.matches;

let state = 'unlit';
let stateT = 0;
let time = 0;
let leanSign = 1;
let smokeT = -1;
let smokeKill = false;
let smokeLean = 0.12;

const audio = { ctx: null, master: null, noise: null, muted: false, nextCrackle: 0 };
const mic = {
  on: false,
  stream: null,
  ctx: null,
  analyser: null,
  buf: null,
  baseline: 0.02,
  hold: 0,
  arm: 0,
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
  const ui = UI[state];
  els.status.textContent = ui.status;
  els.action.textContent = ui.button;
  els.action.disabled = ui.disabled;
  els.action.dataset.state = state;
  let hint = ui.hint;
  if (mic.on && state === 'burning') hint = '点击火焰、按空格，或对着麦克风吹气';
  els.hint.textContent = hint;
  document.documentElement.dataset.state = state;
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
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
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
  if (!navigator.mediaDevices?.getUserMedia) {
    setNote('无法使用麦克风，请用熄灭按钮');
    return;
  }
  els.blow.disabled = true;
  els.blow.textContent = '正在请求…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
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
    els.blow.textContent = '关闭吹气';
    els.blow.setAttribute('aria-pressed', 'true');
    setNote('麦克风只在本机分析，不会录音或上传');
    updateUI();
  } catch {
    setNote('无法使用麦克风，请用熄灭按钮');
    els.blow.textContent = '吹气熄灭';
    els.blow.setAttribute('aria-pressed', 'false');
  } finally {
    els.blow.disabled = false;
  }
}

function disableMic() {
  mic.on = false;
  if (mic.stream) mic.stream.getTracks().forEach((t) => t.stop());
  if (mic.ctx) mic.ctx.close().catch(() => {});
  mic.stream = null;
  mic.ctx = null;
  mic.analyser = null;
  els.blow.textContent = '吹气熄灭';
  els.blow.setAttribute('aria-pressed', 'false');
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
      float s = sin(pow(clamp(t, 0.0, 1.0), 0.55) * 3.14159265);
      float r = 0.086 * pow(max(s, 0.0), 0.66);
      r *= smoothstep(0.0, 0.045, t);
      r *= smoothstep(1.0, 0.64, t);
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
      float wob = vnoise(vec3(uTime * 1.63 * motion, yn * 2.4, 2.2)) - 0.5;
      float wob2 = vnoise(vec3(5.1, uTime * 2.21 * motion, yn * 1.7)) - 0.5;
      float x = (p.x - sway.x - uLean * yn - wob * 0.08 * tipW) / max(width, 0.05);
      float z = (p.z - sway.y - wob2 * 0.038 * tipW) / max(width, 0.05);
      float r = length(vec2(x, z));

      vec3 npos = vec3(x * 3.1, yn * 2.15 - uTime * 0.95 * motion, z * 3.1);
      float warp = vnoise(npos);
      float n = fbm(npos * 1.65 + vec3(warp * 0.85, -uTime * 0.28 * motion, 1.3));
      float pr = profile(clamp(yn, 0.0, 1.0));
      float prJ = pr * (1.0 + (n - 0.5) * 0.58 * turb * smoothstep(0.18, 1.0, yn));
      float d = r / max(prJ, 0.0015);

      float shell = smoothstep(1.02, 0.45, d);
      shell *= smoothstep(1.06, 0.72, yn);
      shell *= smoothstep(-0.02, 0.03, yn);
      if (shell < 0.001) return;

      float streaks = fbm(vec3(x * 3.4, yn * 5.5 - uTime * 1.7 * motion, z * 3.4));
      float body = smoothstep(0.82, 0.05, d);
      float core = smoothstep(0.46, 0.0, d);

      vec3 cRed = vec3(1.15, 0.07, 0.0);
      vec3 cOra = vec3(2.4, 0.48, 0.03);
      vec3 cYel = vec3(3.1, 1.45, 0.32);
      vec3 cWht = vec3(5.2, 3.6, 1.55);
      vec3 cBlu = vec3(0.42, 0.58, 0.95);

      vec3 col = cRed;
      col = mix(col, cOra, smoothstep(0.12, 0.55, body));
      col = mix(col, cYel, smoothstep(0.35, 0.88, body) * smoothstep(0.04, 0.22, yn));
      col = mix(col, cWht, core * smoothstep(0.08, 0.28, yn) * smoothstep(0.82, 0.38, yn));
      col *= mix(0.8, 1.15, streaks);

      float blueRing = smoothstep(0.28, 0.55, d) * smoothstep(0.92, 0.6, d);
      float blueH = smoothstep(0.11, 0.0, yn);
      col = mix(col, cBlu, blueRing * blueH * 0.42);

      float pocket = smoothstep(0.016, 0.004, length(p.xz)) * smoothstep(0.09, 0.0, p.y);
      float densOut = shell * mix(0.62, 1.0, streaks);
      densOut *= 1.0 - pocket * 0.82;
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
        float absorb = dens * 11.0;
        float tr = exp(-absorb * dt);
        acc += col * dens * dt * 7.5 * transmit;
        transmit *= tr;
        t += dt;
      }
      acc *= uEnergy;
      acc = min(acc, vec3(7.0));
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

function makeWoodTexture() {
  const w = 512;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#3a2b20';
  g.fillRect(0, 0, w, h);
  const planks = 5;
  for (let i = 0; i < planks; i++) {
    const y = (i / planks) * h;
    const ph = h / planks;
    g.fillStyle = i % 2 === 0 ? '#4a3828' : '#3d2e22';
    g.fillRect(0, y + 1, w, ph - 2);
    for (let k = 0; k < 16; k++) {
      g.strokeStyle = `rgba(40, 22, 10, ${0.05 + Math.random() * 0.07})`;
      g.lineWidth = 1;
      g.beginPath();
      let x = 0;
      let yy = y + 6 + Math.random() * (ph - 12);
      g.moveTo(0, yy);
      while (x < w) {
        x += 16 + Math.random() * 24;
        yy += (Math.random() - 0.5) * 2.5;
        g.lineTo(x, yy);
      }
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.4, 2.4);
  tex.anisotropy = 8;
  return tex;
}

function makeWaxTexture() {
  const w = 256;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#f6e7cc';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 18; i++) {
    g.fillStyle = `rgba(150, 110, 70, ${0.025 + Math.random() * 0.02})`;
    g.fillRect(Math.random() * w, 0, 1 + Math.random() * 2, h);
  }
  const wash = g.createLinearGradient(0, 0, 0, h);
  wash.addColorStop(0, 'rgba(255, 196, 130, 0.22)');
  wash.addColorStop(0.22, 'rgba(255, 228, 190, 0.05)');
  wash.addColorStop(1, 'rgba(80, 52, 28, 0.16)');
  g.fillStyle = wash;
  g.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
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
  const n = 36;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = t * CANDLE_H;
    let r = lerp(R_BOTTOM, R_TOP, t);
    r += Math.sin(t * Math.PI) * 0.0035;
    r += Math.sin(t * 46 + 1.4) * 0.0011;
    pts.push(new THREE.Vector2(Math.max(r, 0.01), y));
  }
  const geo = new THREE.LatheGeometry(pts, 72);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const rad = Math.hypot(x, z);
    if (rad < 0.01) continue;
    const ang = Math.atan2(z, x);
    const nrm = Math.sin(y * 18 + ang * 4) * 0.0014;
    const lobe = (center) => {
      let dA = Math.abs(ang - center);
      if (dA > Math.PI) dA = Math.PI * 2 - dA;
      const angW = Math.exp(-dA * dA * 26);
      const along = (CANDLE_H - 0.012 - y) / 0.18;
      if (along <= 0 || along >= 1) return 0;
      return Math.sin(along * Math.PI) ** 0.75 * angW;
    };
    const drip = lobe(1.05) * 0.018 + lobe(1.85) * 0.011;
    const s = (rad + nrm + drip) / rad;
    pos.setXYZ(i, x * s, y - drip * 0.55, z * s);
  }
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
    const dip = -(1 - d ** 0.48) * 0.058;
    const lip = smoothstep(0.84, 1, d) * 0.014;
    pos.setZ(i, dip + lip);
  }
  geo.computeVertexNormals();
  return geo;
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
} catch {
  els.fallback.hidden = false;
  throw new Error('webgl unavailable');
}

if (!renderer.capabilities.isWebGL2) {
  els.fallback.hidden = false;
  throw new Error('webgl2 required');
}

renderer.debug.onShaderError = (gl, program, _vs, fs) => {
  const log = `${gl.getProgramInfoLog(program) || ''}\n${gl.getShaderInfoLog(fs) || ''}`;
  console.error(log);
  setNote('着色器编译失败');
};

renderer.setClearColor(0x070605, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = false;
els.stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070605);
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);

const hemi = new THREE.HemisphereLight(0x3a342c, 0x070605, 0.11);
scene.add(hemi);

const keyLight = new THREE.PointLight(0xff9444, 0, 0, 2);
keyLight.color.set('#ff9444');
scene.add(keyLight);
const fillLight = new THREE.PointLight(0xff7a32, 0, 0, 2);
fillLight.color.set('#ff7a32');
scene.add(fillLight);
const emberLight = new THREE.PointLight(0xff2a0e, 0, 0.38, 2);
emberLight.color.set('#ff2a0e');
scene.add(emberLight);

const wood = makeWoodTexture();
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(7.5, 64),
  new THREE.MeshStandardMaterial({ map: wood, color: 0xffffff, roughness: 0.9, metalness: 0 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
scene.add(floor);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x14110f, roughness: 1, metalness: 0 });
const backWall = new THREE.Mesh(new THREE.PlaneGeometry(9, 5.2), wallMat);
backWall.position.set(0, 2.4, -2.15);
scene.add(backWall);
const sideWall = new THREE.Mesh(new THREE.PlaneGeometry(8, 5.2), wallMat);
sideWall.position.set(-2.15, 2.4, 0.2);
sideWall.rotation.y = Math.PI / 2;
scene.add(sideWall);

const holderMat = new THREE.MeshPhysicalMaterial({
  color: 0x3a291c,
  roughness: 0.58,
  metalness: 0.08,
  clearcoat: 0.08,
  clearcoatRoughness: 0.6,
});
const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.27, 0.02, 48), holderMat);
plate.position.y = 0.012;
scene.add(plate);
const plateTop = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.016, 48), holderMat);
plateTop.position.y = 0.028;
scene.add(plateTop);

const contactTex = makeRadial();
const contact = new THREE.Mesh(
  new THREE.CircleGeometry(0.42, 48),
  new THREE.MeshBasicMaterial({
    map: contactTex,
    color: 0x000000,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  })
);
contact.rotation.x = -Math.PI / 2;
contact.position.y = 0.003;
contact.renderOrder = 1;
scene.add(contact);

const poolLight = new THREE.Mesh(
  new THREE.CircleGeometry(1.55, 64),
  new THREE.MeshBasicMaterial({
    map: contactTex,
    color: 0xff8a3c,
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
  uEmit: { value: 0 },
  uSpec: { value: 0.18 },
  uTopY: { value: TOP_Y },
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
  uniform float uEmit;
  uniform float uSpec;
  uniform float uTopY;
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
    float heat = smoothstep(uTopY - 0.42, uTopY - 0.02, vWorld.y);
    albedo = mix(albedo, albedo * vec3(1.12, 0.78, 0.42), heat * 0.55);

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
    vec3 col = albedo * (uAmbient + wrap * atten * uLightColor);
    col += vec3(1.0, 0.46, 0.12) * rim * heat * atten * 0.16;
    col += uLightColor * spec * atten * uSpec * mix(1.0, smoothstep(0.45, 0.92, poolRd), step(0.4, uSpec));
    if (uSpec > 0.4) {
      float well = 1.0 - smoothstep(0.0, 0.62, poolRd);
      float meniscus = smoothstep(0.55, 0.84, poolRd) * (1.0 - smoothstep(0.9, 1.05, poolRd));
      col *= mix(1.0, 0.22, well);
      col += vec3(1.25, 0.62, 0.16) * meniscus * (0.45 + uEmit * 1.6);
    } else {
      col += vec3(1.05, 0.48, 0.1) * uEmit * 0.15;
    }

    vec3 Evec = uEmberPos - vWorld;
    float edist = length(Evec);
    float eatten = uEmberIntensity / (0.2 + edist * edist * 8.0);
    col += vec3(1.0, 0.18, 0.03) * eatten * (0.25 + 0.75 * clamp(dot(N, Evec / max(edist, 0.001)), 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
  }
`;

function makeWaxMaterial({ map = null, color = '#ecd7b4', spec = 0.16, emit = 0 } = {}) {
  const uniforms = THREE.UniformsUtils.clone(waxUniforms);
  uniforms.uMap.value = map;
  uniforms.uHasMap.value = map ? 1 : 0;
  uniforms.uColor.value = new THREE.Color(color);
  uniforms.uSpec.value = spec;
  uniforms.uEmit.value = emit;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: waxVert,
    fragmentShader: waxFrag,
    toneMapped: false,
  });
  mat.userData.wax = true;
  return mat;
}

const waxMap = makeWaxTexture();
const waxMat = makeWaxMaterial({ map: waxMap, color: '#ffffff', spec: 0.14 });
const waxSolid = makeWaxMaterial({ color: '#f0d8b4', spec: 0.12 });
const poolMat = makeWaxMaterial({ color: '#c9843a', spec: 0.42, emit: 0 });
const waxMaterials = [waxMat, waxSolid, poolMat];
const candle = new THREE.Mesh(buildCandleGeometry(), waxMat);
candle.position.y = BASE_Y;
scene.add(candle);

const rim = new THREE.Mesh(new THREE.TorusGeometry(R_TOP * 0.97, 0.008, 10, 72), waxSolid);
rim.rotation.x = Math.PI / 2;
rim.position.y = TOP_Y - 0.004;
scene.add(rim);

const pool = new THREE.Mesh(buildPool(R_TOP * 0.94), poolMat);
pool.rotation.x = -Math.PI / 2;
pool.position.y = TOP_Y - 0.02;
scene.add(pool);

const wickCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, TOP_Y - 0.012, 0),
  new THREE.Vector3(0.005, TOP_Y + 0.03, 0.002),
  new THREE.Vector3(0.016, TOP_Y + 0.068, 0.004),
]);
const wick = new THREE.Mesh(
  new THREE.TubeGeometry(wickCurve, 14, 0.0055, 6, false),
  new THREE.MeshStandardMaterial({ color: 0x1a120e, roughness: 0.82, metalness: 0 })
);
scene.add(wick);
const wickTipPos = wickCurve.getPoint(1);
const wickTip = new THREE.Mesh(
  new THREE.SphereGeometry(0.0072, 12, 8),
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
  new THREE.CylinderGeometry(0.075, 0.075, 0.22, 12),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
);
wickHit.position.set(0, TOP_Y + 0.04, 0);
scene.add(wickHit);

const FW = 0.5;
const FH = 0.78;
const flameGeo = new THREE.BoxGeometry(FW, FH, FW);
flameGeo.translate(0, FH / 2, 0);
flameUniforms.uBMin.value.set(-FW / 2, 0, -FW / 2);
flameUniforms.uBMax.value.set(FW / 2, FH, FW / 2);
const flameMesh = new THREE.Mesh(flameGeo, flameMat);
const FLAME_BASE = wickTipPos.y - 0.018;
flameMesh.position.y = FLAME_BASE;
flameMesh.visible = false;
flameMesh.renderOrder = 3;
scene.add(flameMesh);

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

const camLocal = new THREE.Vector3();
const colorWarm = new THREE.Color('#ff8c3e');
const colorHot = new THREE.Color('#ffc48a');

function bulkSway(t, calm) {
  const amp = calm ? 0.012 : 0.055;
  const x = (noise1(t * 0.33) - 0.5) * 2 * amp + (noise1(t * 0.91 + 2.2) - 0.5) * amp * 0.8;
  const z = (noise1(t * 0.29 + 4.1) - 0.5) * 1.7 * amp + (noise1(t * 1.07 + 1.3) - 0.5) * amp * 0.55;
  return { x, z };
}

function flickerEnergy(t, calm) {
  const n = noise1(t * 0.83) * 0.46 + noise1(t * 2.27 + 4.2) * 0.32 + noise1(t * 5.73 + 1.6) * 0.22;
  const amp = calm ? 0.012 : 0.085;
  let e = 1 + (n - 0.5) * 2 * amp;
  if (!calm && noise1(t * 0.41 + 8.2) > 0.84) e *= 0.86;
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

function applyPose(p) {
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
  const keyAmt = p.light * 11.5;
  keyLight.intensity = keyAmt;
  fillLight.intensity = p.light * 3.4 + (state === 'igniting' ? smoothstep(0, 0.1, stateT) * (1 - smoothstep(0.18, 0.42, stateT)) * 2.2 : 0);
  emberLight.intensity = p.ember * 0.38;
  keyLight.color.copy(colorWarm).lerp(colorHot, clamp((p.energy - 0.9) * 2, 0, 1));

  poolLight.material.opacity = p.light * 0.28;
  poolLight.scale.setScalar(0.92 + p.light * 0.12);
  const amb = (state === 'unlit' || state === 'ember') ? 0.11 : 0.03;
  for (const mat of waxMaterials) {
    mat.uniforms.uLightPos.value.copy(keyLight.position);
    mat.uniforms.uLightColor.value.copy(keyLight.color);
    mat.uniforms.uLightIntensity.value = Math.max(p.light * 3.4, state === 'igniting' ? smoothstep(0, 0.15, stateT) * 1.4 : 0);
    mat.uniforms.uEmberPos.value.copy(wickTipPos);
    mat.uniforms.uEmberIntensity.value = p.ember * 0.7;
    mat.uniforms.uAmbient.value = amb;
  }
  poolMat.uniforms.uEmit.value = p.light * 0.55 + p.ember * 0.22;
  const wickGlow = state === 'ember' ? p.ember * 0.95 : Math.max(0, p.wick) * 0.7;
  wickTip.material.emissiveIntensity = wickGlow;
  wickTip.scale.setScalar(state === 'ember' ? 0.85 + p.ember * 0.2 : 1);
  wickTip.material.emissive.set(state === 'ember' ? '#ff2c10' : '#ff4a16');

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
}

function setState(next) {
  state = next;
  stateT = 0;
  updateUI();
}

function startIgnite() {
  if (state !== 'unlit' && state !== 'ember') return;
  unlockAudio();
  playIgnite();
  smokeKill = smokeT >= 0;
  setState('igniting');
}

function startExtinguish() {
  if (state !== 'burning') return;
  unlockAudio();
  playExtinguish();
  leanSign = Math.random() < 0.5 ? -1 : 1;
  smokeLean = leanSign * 0.16;
  smokeT = 0;
  smokeKill = false;
  smokeUniforms.uLean.value = smokeLean;
  setState('extinguishing');
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
  else if (state === 'ember' && stateT >= EMBER_DUR) {
    setState('unlit');
    wickTip.material.emissiveIntensity = 0;
    emberLight.intensity = 0;
    keyLight.intensity = 0;
    fillLight.intensity = 0;
  }
}

function frameCamera() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const narrow = w < 760;
  const short = h < 540;
  camera.fov = narrow ? (short ? 40 : 36) : 32;
  const z = narrow ? (short ? 4.45 : 4.2) : 4.05;
  const camY = narrow ? (short ? 2.2 : 2.32) : 2.48;
  const lookY = narrow ? (short ? 0.58 : 0.5) : 0.42;
  camera.position.set(narrow ? 0.08 : 0.28, camY, z);
  camera.lookAt(0, lookY, 0);
}

let composer;
let bloomPass;
function setupComposer() {
  const pr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 760 ? 1.4 : 1.75);
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.28,
    0.38,
    1.05
  );
  for (const tint of bloomPass.bloomTintColors) tint.set(1, 0.78, 0.48);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio || 1, w < 760 ? 1.4 : 1.75);
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
}

setupComposer();
resize();
updateUI();

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
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
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  let hot = false;
  if (state === 'unlit' || state === 'ember') hot = raycaster.intersectObject(wickHit, false).length > 0;
  else if (state === 'burning' && flameMesh.visible) hot = raycaster.intersectObject(flameMesh, false).length > 0;
  renderer.domElement.style.cursor = hot ? 'pointer' : 'default';
});

els.action.addEventListener('click', () => {
  unlockAudio();
  primary();
});

els.mute.addEventListener('click', () => {
  unlockAudio();
  audio.muted = !audio.muted;
  if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.26;
  els.mute.setAttribute('aria-pressed', String(audio.muted));
  els.mute.textContent = audio.muted ? '开声' : '静音';
});

els.blow.addEventListener('click', () => {
  unlockAudio();
  if (mic.on) disableMic();
  else enableMic();
});

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target && e.target.closest && e.target.closest('button')) return;
  e.preventDefault();
  unlockAudio();
  primary();
});

motionQuery.addEventListener('change', (ev) => {
  reduceMotion = ev.matches;
  updateUI();
});
window.addEventListener('resize', resize);

let last = performance.now();
let slowFrames = 0;
let adapted = false;
let elapsed = 0;

function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  elapsed += dt;
  stepState(dt);
  sampleBlow(dt);
  const p = pose();
  applyPose(p);
  if (state === 'burning' && audio.ctx && !audio.muted && time > audio.nextCrackle) {
    playCrackle();
    audio.nextCrackle = time + 0.09 + Math.random() * 0.26;
  }
  composer.render();
  if (!adapted && elapsed > 2) {
    if (dt > 0.034) slowFrames += 1;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 25) {
      adapted = true;
      flameUniforms.uSteps.value = Math.min(flameUniforms.uSteps.value, 16);
      renderer.setPixelRatio(1);
      composer.setPixelRatio(1);
    }
  }
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
