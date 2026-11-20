function closeContext(context) {
  if (!context || context.state === 'closed') return;
  try {
    const closing = context.close();
    closing?.catch?.(() => {});
  } catch {}
}

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function createMicrophone({
  getState,
  getTime,
  onDetect,
  onNote,
  onMicChange,
  onLevel,
  onUpdate,
  button,
  documentRef = globalThis.document,
  navigatorRef = globalThis.navigator,
  AudioContextRef = globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext,
}) {
  const mic = {
    on: false,
    stream: null,
    context: null,
    analyser: null,
    buffer: null,
    baseline: 0.02,
    hold: 0,
    arm: 0,
    request: 0,
    pending: null,
  };

  function requestIsCurrent(request, resources) {
    return request === mic.request
      && mic.pending === resources
      && getState() === 'burning'
      && !documentRef.hidden;
  }

  async function enable() {
    if (getState() !== 'burning' || documentRef.hidden || mic.on || mic.pending) return;
    if (!navigatorRef.mediaDevices?.getUserMedia) {
      onNote('无法使用麦克风，请用熄灭按钮');
      return;
    }

    button.disabled = true;
    button.querySelector('span:last-child').textContent = '等待麦克风…';
    const request = ++mic.request;
    const resources = { stream: null, context: null };
    mic.pending = resources;

    try {
      const Context = AudioContextRef;
      if (!Context) throw new Error('AudioContext unavailable');
      // Resume during the button click so the browser still grants user activation.
      resources.context = new Context();
      const resume = Promise.resolve(resources.context.resume()).then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      );
      resources.stream = await navigatorRef.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      if (!requestIsCurrent(request, resources)) {
        stopStream(resources.stream);
        return;
      }

      const resumeResult = await resume;
      if (!resumeResult.ok) throw resumeResult.error;
      if (!requestIsCurrent(request, resources)) {
        stopStream(resources.stream);
        closeContext(resources.context);
        return;
      }

      const analyser = resources.context.createAnalyser();
      analyser.fftSize = 1024;
      const source = resources.context.createMediaStreamSource(resources.stream);
      source.connect(analyser);
      mic.on = true;
      mic.stream = resources.stream;
      mic.context = resources.context;
      mic.analyser = analyser;
      mic.buffer = new Float32Array(analyser.fftSize);
      mic.baseline = 0.02;
      mic.hold = 0;
      mic.arm = getTime() + 0.5;
      mic.pending = null;
      onMicChange(true);
      onNote('仅在本机感受声音，吹灭后会自动关闭麦克风。');
      onUpdate();
    } catch {
      stopStream(resources.stream);
      closeContext(resources.context);
      if (request === mic.request) {
        mic.pending = null;
        onNote('暂时听不到你的声音，点击按钮也能吹灭。');
        onMicChange(false);
      }
    } finally {
      if (request === mic.request) {
        button.disabled = false;
        if (!mic.on) onMicChange(false);
      }
    }
  }

  function disable() {
    mic.request++;
    mic.on = false;
    button.disabled = false;
    const resources = mic.pending;
    mic.pending = null;
    stopStream(resources?.stream || mic.stream);
    closeContext(resources?.context || mic.context);
    mic.stream = null;
    mic.context = null;
    mic.analyser = null;
    mic.buffer = null;
    onMicChange(false);
    onLevel(null);
    onNote('');
    onUpdate();
  }

  function sample(dt) {
    if (!mic.on || !mic.analyser || getState() !== 'burning') {
      mic.hold = 0;
      return;
    }

    mic.analyser.getFloatTimeDomainData(mic.buffer);
    let sum = 0;
    for (let i = 0; i < mic.buffer.length; i++) sum += mic.buffer[i] * mic.buffer[i];
    const rms = Math.sqrt(sum / mic.buffer.length);
    onLevel(Math.min(1, Math.max(0.2, rms * 12)));
    const calibrating = getTime() < mic.arm;
    const baselineRate = calibrating ? Math.min(1, 1 - Math.exp(-dt * 12)) : 0.018;
    mic.baseline += (rms - mic.baseline) * baselineRate;
    if (calibrating) {
      mic.hold = 0;
      return;
    }
    if (rms - mic.baseline > 0.05 && rms > 0.07) {
      mic.hold += dt;
      if (mic.hold > 0.075) {
        mic.hold = 0;
        mic.arm = getTime() + 0.6;
        onDetect();
      }
    } else {
      mic.hold = Math.max(0, mic.hold - dt);
    }
  }

  return { enable, disable, sample, get on() { return mic.on; } };
}
