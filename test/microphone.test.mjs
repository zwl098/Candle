import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMicrophone } from '../src/microphone.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createHarness({ getUserMedia, resume, hidden = false, samples = [] } = {}) {
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  const buttonLabel = { textContent: '试试吹气' };
  const button = {
    disabled: false,
    querySelector: () => buttonLabel,
  };
  const documentRef = { hidden };
  const events = { notes: [], mic: [], levels: [], detects: 0, updates: 0 };
  let context;
  let currentTime = 3;

  class AudioContextMock {
    constructor() {
      context = this;
      this.state = 'running';
      this.closed = false;
    }
    resume() { return resume?.promise || Promise.resolve(); }
    close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
    createAnalyser() {
      return {
        fftSize: 1024,
        getFloatTimeDomainData(buffer) { buffer.fill(samples.at(-1) ?? 0); },
      };
    }
    createMediaStreamSource() { return { connect() {} }; }
  }

  const controller = createMicrophone({
    getState: () => 'burning',
    getTime: () => currentTime,
    onDetect: () => { events.detects++; },
    onNote: (note) => events.notes.push(note),
    onMicChange: (on) => events.mic.push(on),
    onLevel: (level) => events.levels.push(level),
    onUpdate: () => { events.updates++; },
    button,
    documentRef,
    navigatorRef: { mediaDevices: { getUserMedia: getUserMedia || (() => Promise.resolve(stream)) } },
    AudioContextRef: AudioContextMock,
  });

  return { controller, button, buttonLabel, documentRef, events, stream, track, setTime: (time) => { currentTime = time; }, get context() { return context; } };
}

test('late permission grant after cancellation immediately stops the microphone stream', async () => {
  const permission = deferred();
  const h = createHarness({ getUserMedia: () => permission.promise });

  const starting = h.controller.enable();
  assert.ok(h.context, 'AudioContext should start during the user gesture');
  assert.equal(h.button.disabled, true);
  assert.equal(h.buttonLabel.textContent, '等待麦克风…');

  h.controller.disable();
  assert.equal(h.button.disabled, false);
  permission.resolve(h.stream);
  await starting;

  assert.equal(h.track.stopped, true);
  assert.equal(h.context.closed, true);
  assert.equal(h.controller.on, false);
  assert.deepEqual(h.events.mic, [false]);
});

test('cancelling while AudioContext resumes releases both context and stream immediately', async () => {
  const resuming = deferred();
  const h = createHarness({ resume: resuming });

  const starting = h.controller.enable();
  await Promise.resolve();
  assert.ok(h.context);
  assert.equal(h.track.stopped, false);

  h.controller.disable();
  assert.equal(h.track.stopped, true);
  assert.equal(h.context.closed, true);
  assert.equal(h.button.disabled, false);

  resuming.resolve();
  await starting;
  assert.equal(h.controller.on, false);
  assert.deepEqual(h.events.mic, [false]);
});

test('hidden documents cannot request the microphone', async () => {
  let requests = 0;
  const h = createHarness({
    hidden: true,
    getUserMedia: () => { requests++; return Promise.resolve(h.stream); },
  });

  await h.controller.enable();

  assert.equal(requests, 0);
  assert.equal(h.controller.on, false);
  assert.deepEqual(h.events.notes, []);
});

test('sustained audio level triggers one blow event and applies a rearm delay', async () => {
  const h = createHarness({ samples: [0.2] });
  await h.controller.enable();
  h.setTime(4);

  h.controller.sample(0.08);
  assert.equal(h.events.detects, 1);
  assert.equal(h.events.levels.at(-1), 1);
  h.controller.sample(0.2);
  assert.equal(h.events.detects, 1);

  h.controller.disable();
  assert.equal(h.track.stopped, true);
  assert.equal(h.context.closed, true);
  assert.equal(h.events.levels.at(-1), null);
});

test('ambient sound during the arming window does not extinguish the candle', async () => {
  const h = createHarness({ samples: [0.2] });
  await h.controller.enable();

  for (let i = 0; i < 30; i++) h.controller.sample(1 / 60);
  h.setTime(4);
  h.controller.sample(0.08);

  assert.equal(h.events.detects, 0);
  h.controller.disable();
});
