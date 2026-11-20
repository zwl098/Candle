import { view } from './experience.js';

let scene;
let flat = false;
function startFlatScene() {
  if (flat) return;
  flat = true;
  const previous = document.documentElement.dataset.state;
  scene?.disposeScene();
  document.documentElement.dataset.render = 'flat';
  view.sound(true);
  document.getElementById('curtain').hidden = true;
  view.els.stage.replaceChildren();
  view.els.fallback.hidden = false;
  let state = 'unlit';
  let cycle = 0;
  const change = (next) => { state = next; view.renderState(next); };
  view.bind({ primary() {
    if (state === 'unlit' || state === 'ember') {
      cycle++;
      change('igniting');
      setTimeout(() => change('burning'), 720);
    } else if (state === 'burning') {
      const currentCycle = cycle;
      change('extinguishing');
      setTimeout(() => {
        change('ember');
        setTimeout(() => {
          if (currentCycle === cycle) view.celebrate();
        }, 400);
      }, 1020);
    }
  } });
  view.ready();
  const continuing = { igniting: 'burning', burning: 'burning', extinguishing: 'ember', ember: 'ember' };
  change(continuing[previous] || 'unlit');
  if (previous === 'extinguishing' || (previous === 'ember' && view.phase !== 'celebrate')) {
    setTimeout(() => { if (cycle === 0) view.celebrate(); }, 400);
  }
}

document.addEventListener('candle:render-failed', startFlatScene);

async function start() {
  try {
    scene = await import('./main.js');
    view.ready();
  } catch (error) {
    console.warn('Using the candle fallback:', error);
    startFlatScene();
  }
}
start();
