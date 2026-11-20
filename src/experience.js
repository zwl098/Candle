import { gift } from './gift.js';

const els = Object.fromEntries([
  'stage', 'status', 'hint', 'action', 'action-label', 'mute', 'sound-label', 'blow', 'blow-label',
  'replay', 'note', 'fallback', 'opening', 'wishing', 'celebrate', 'greeting', 'scene-caption', 'secondary-actions', 'visual',
].map((id) => [id, document.getElementById(id)]));
let handlers = {};
let phase = 'welcome';
let phaseVersion = 0;
let currentState = 'loading';

for (const el of document.querySelectorAll('[data-recipient]')) el.textContent = gift.recipient;
for (const el of document.querySelectorAll('[data-sender]')) el.textContent = gift.sender;
document.title = `${gift.recipient} · 烛光来信`;
const dedication = document.getElementById('dedication');
dedication.replaceChildren(...gift.dedication.flatMap((line, i) => i ? [document.createElement('br'), document.createTextNode(line)] : [document.createTextNode(line)]));
const message = document.getElementById('wish-message');
message.replaceChildren(...gift.message.map((text) => {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}));

function showPhase(next) {
  phase = next;
  phaseVersion++;
  document.documentElement.dataset.phase = next;
  els.opening.hidden = next !== 'welcome';
  els.wishing.hidden = next !== 'wish';
  els.celebrate.hidden = next !== 'celebrate';
  const index = ['welcome', 'wish', 'celebrate'].indexOf(next);
  for (const [i, chapter] of [...document.querySelectorAll('.chapters li')].entries()) {
    if (i === index) chapter.setAttribute('aria-current', 'step');
    else chapter.removeAttribute('aria-current');
  }
}

const states = {
  unlit: { status: '生日烛光已准备好', label: '点亮这一刻', caption: '让今天，从一个小小的仪式开始。', hint: '此刻的微光，只为你留。', disabled: false },
  igniting: { status: '正在点亮烛光', label: '烛光正在亮起', caption: '把世界调慢一点，把愿望放近一点。', hint: '这一束微光，为你而亮', disabled: true },
  burning: { status: '烛光已点亮，可以许愿了', label: '许好了，吹灭蜡烛', caption: '准备好了，就让愿望随烛光出发。', hint: '愿这一刻，慢一点过去。', disabled: false },
  extinguishing: { status: '愿望已经许下', label: '愿望正在出发', caption: '嘘，有一封来信，正等着你。', hint: '愿你所愿，慢慢实现', disabled: true },
  ember: { status: '烛光化作余温', label: '再点一次烛光', caption: '让这一点余温，陪你走进新的一岁。', hint: '', disabled: false },
};
const sceneDescriptions = {
  unlit: '生日蛋糕上插着一支等待点亮的蜡烛',
  igniting: '生日蛋糕上的蜡烛正在点亮',
  burning: '生日蛋糕上的蜡烛已点亮，可以许愿',
  extinguishing: '蜡烛正在熄灭，愿望即将寄出',
  ember: '生日蜡烛已熄灭，烛芯还留着余温',
};

function renderState(state) {
  currentState = state;
  const ui = states[state];
  if (!ui) return;
  if ((state === 'igniting' || state === 'burning') && phase !== 'wish') showPhase('wish');
  document.documentElement.dataset.state = state;
  els.visual.setAttribute('aria-label', sceneDescriptions[state]);
  els.status.textContent = ui.status;
  els.action.dataset.state = state;
  els['action-label'].textContent = phase === 'celebrate' ? '珍藏这份祝福' : ui.label;
  els.action.disabled = phase === 'celebrate' ? false : ui.disabled;
  if (phase !== 'celebrate' && !ui.disabled) els.action.setAttribute('aria-keyshortcuts', 'Enter Space');
  else els.action.removeAttribute('aria-keyshortcuts');
  els.greeting.textContent = ui.caption;
  els.hint.textContent = phase === 'celebrate' ? '把这份心意，留在你的相册里' : ui.hint;
  if (document.documentElement.dataset.render === 'flat' && (state === 'unlit' || state === 'burning') && phase !== 'celebrate') {
    els.hint.textContent = '';
  }
  els.blow.hidden = state !== 'burning' || document.documentElement.dataset.render === 'flat';
  els.replay.hidden = phase !== 'celebrate';
  els['secondary-actions'].hidden = els.blow.hidden && els.replay.hidden;
  els['scene-caption'].textContent = phase === 'celebrate' ? '烛光会熄灭，心意不会' : '一点微光，万千心意';
}

function sound(muted) {
  document.documentElement.dataset.sound = muted ? 'off' : 'on';
  els.mute.setAttribute('aria-pressed', String(!muted));
  els.mute.setAttribute('aria-label', '声音');
  els['sound-label'].textContent = muted ? '开启声音' : '声音已开启';
}

function mic(on) {
  els.blow.setAttribute('aria-pressed', String(on));
  els['blow-label'].textContent = on ? '正在聆听 · 关闭' : '试试吹气';
  if (on) els.hint.textContent = '对着麦克风轻轻吹一口气';
  else renderState(currentState);
}

function wrapText(ctx, text, width) {
  const lines = [];
  let line = '';
  const noStart = /^[，。！？、；：…）》】」』〕〉,.!?;:%”’]/u;
  const noEnd = /[（《【「『〔〈“‘(]$/u;
  for (const char of Array.from(text)) {
    if (char === '\n' || (line && ctx.measureText(line + char).width > width)) {
      if (char === '\n') {
        lines.push(line);
        line = '';
        continue;
      }
      const previous = Array.from(line);
      let carry = noStart.test(char) ? previous.pop() : '';
      while (previous.length && (noStart.test(carry) || noEnd.test(previous.at(-1)))) carry = previous.pop() + carry;
      if (previous.length) lines.push(previous.join(''));
      line = carry + char;
    } else line += char;
  }
  if (line) lines.push(line);
  return lines;
}

async function saveCard() {
  const version = phaseVersion;
  const label = els['action-label'];
  els.action.disabled = true;
  label.textContent = '正在珍藏…';
  try {
    await document.fonts.ready;
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    const ctx = canvas.getContext('2d');
    ctx.font = '34px "Microsoft YaHei", sans-serif';
    const paragraphs = gift.message.map((p) => wrapText(ctx, p, 780));
    ctx.font = '42px "Microsoft YaHei", sans-serif';
    const recipientLines = wrapText(ctx, gift.recipient, 780);
    ctx.font = '30px "Microsoft YaHei", sans-serif';
    const senderLines = wrapText(ctx, gift.sender, 780);
    canvas.height = Math.max(1500, 1060 + recipientLines.length * 64 + paragraphs.reduce((n, p) => n + p.length * 68 + 30, 0) + senderLines.length * 52);
    ctx.fillStyle = '#100d0b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#64513a'; ctx.lineWidth = 1; ctx.strokeRect(64, 64, 952, canvas.height - 128);
    ctx.textAlign = 'center'; ctx.fillStyle = '#b9a58a'; ctx.font = '22px Georgia, serif';
    ctx.fillText('A LITTLE LIGHT, JUST FOR YOU', 540, 165);
    ctx.fillStyle = '#e8c78f';
    ctx.beginPath(); ctx.moveTo(540, 225); ctx.bezierCurveTo(580, 286, 570, 315, 540, 315); ctx.bezierCurveTo(509, 315, 507, 284, 540, 225); ctx.fill();
    ctx.fillStyle = '#e7d6b9'; ctx.fillRect(532, 337, 16, 100);
    let y = 525;
    ctx.fillStyle = '#c1b3a2'; ctx.font = '42px "Microsoft YaHei", sans-serif';
    for (const line of recipientLines) { ctx.fillText(line, 540, y); y += 64; }
    y += 56; ctx.fillStyle = '#e8c78f'; ctx.font = '76px SimSun, serif'; ctx.fillText('生日快乐', 540, y);
    y += 105; ctx.textAlign = 'left'; ctx.fillStyle = '#f4ebdd'; ctx.font = '34px "Microsoft YaHei", sans-serif';
    for (const lines of paragraphs) { for (const line of lines) { ctx.fillText(line, 150, y); y += 68; } y += 30; }
    ctx.textAlign = 'right'; ctx.fillStyle = '#c1b3a2'; ctx.font = '30px "Microsoft YaHei", sans-serif'; y += 35;
    for (const line of senderLines) { ctx.fillText(line, 930, y); y += 52; }
    ctx.textAlign = 'center'; ctx.fillStyle = '#b9a58a'; ctx.font = '24px SimSun, serif';
    ctx.fillText('烛光会熄灭，心意不会', 540, canvas.height - 135);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('image unavailable');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = '烛光来信-生日祝福.png'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    if (version === phaseVersion) els.note.textContent = '祝福已备好。愿这一束光，长久陪着你。';
  } catch {
    if (version === phaseVersion) els.note.textContent = '暂时无法保存，可以先截图留住这份祝福。';
  } finally {
    if (version === phaseVersion) {
      els.action.disabled = false;
      label.textContent = '珍藏这份祝福';
    } else renderState(currentState);
  }
}

els.action.addEventListener('click', () => phase === 'celebrate' ? saveCard() : handlers.primary?.());
els.replay.addEventListener('click', () => {
  if (currentState !== 'unlit' && currentState !== 'ember') return;
  els.note.textContent = '';
  handlers.primary?.();
});
els.mute.addEventListener('click', () => handlers.sound?.());
els.blow.addEventListener('click', () => handlers.mic?.());
window.addEventListener('keydown', (e) => {
  if (e.repeat || !['Enter', ' '].includes(e.key) || e.target.closest?.('button, a, input, textarea, select, [contenteditable]')) return;
  if (phase === 'celebrate') return;
  e.preventDefault();
  handlers.primary?.();
});

export const view = {
  els,
  bind(next) { handlers = next; },
  renderState, sound, mic,
  ready() {
    document.documentElement.dataset.ready = 'true';
    if (currentState === 'loading') renderState('unlit');
  },
  celebrate() {
    showPhase('celebrate');
    renderState(currentState);
    els.status.textContent = '生日快乐，给你的来信已展开。';
    document.getElementById('wish-title').focus({ preventScroll: true });
    if (window.innerWidth <= 760 && window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  },
  get phase() { return phase; },
};
