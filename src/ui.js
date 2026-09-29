import { state } from './state.js';
import { $, ui } from './dom.js';
import { controls } from './scene.js';
import { updateScene } from './update.js';
import { setView, refreshEyeView } from './views.js';
import { scheduleAutosave, saveLayout } from './persistence.js';
import { startSim, applySimCueAlpha } from './simulation.js';

function setManualAngle(deg) {
  state.aim = 'manual';
  ui.aim.value = 'manual';
  state.angle = Math.round((((deg % 360) + 360) % 360) * 100) / 100 % 360;
  ui.ang.value = state.angle;
  updateScene();
}

function syncCueAlphaLabel() {
  $('simCueAlphav').value = state.simCueAlpha === 0 ? '不透明' : `${state.simCueAlpha}%`;
}

// フォーム・ボタンのイベント
export function initUI() {
  $('aimCushion').addEventListener('change', e => { state.aimCushion = e.target.checked; updateScene(); });
  $('cbLine').addEventListener('change', e => { state.cbLine = e.target.checked; updateScene(); });
  $('cpLine').addEventListener('change', e => { state.cpLine = e.target.checked; updateScene(); });
  $('thickOn').addEventListener('change', e => { state.thickOn = e.target.checked; updateScene(); });
  $('thickWallOn').addEventListener('change', e => { state.thickWallOn = e.target.checked; updateScene(); });
  $('triOn').addEventListener('change', e => { state.triOn = e.target.checked; updateScene(); });
  $('tanOn').addEventListener('change', e => { state.tanOn = e.target.checked; updateScene(); });
  $('throwOn').addEventListener('change', e => { state.throwOn = e.target.checked; updateScene(); });
  $('tSpeed').addEventListener('input', e => { state.shotSpeed = +e.target.value; updateScene(); });
  $('tFollow').addEventListener('input', e => { state.throwFollow = +e.target.value; updateScene(); });
  $('tSide').addEventListener('input', e => { state.throwSide = +e.target.value; updateScene(); });
  ui.aim.addEventListener('change', () => { state.aim = ui.aim.value; updateScene(); });
  $('obNum').addEventListener('change', e => { state.obNumber = +e.target.value; updateScene(); });
  document.querySelectorAll('input[name=eye]').forEach(el => el.addEventListener('change', () => {
    state.eye = el.value;
    refreshEyeView();
  }));
  ui.ang.addEventListener('input', () => setManualAngle(+ui.ang.value));
  // ±0.01° 。押し続けると連続で変化
  for (const [id, delta] of [['angDec', -0.01], ['angInc', 0.01]]) {
    const btn = $(id);
    let timer = 0;
    const stop = () => { clearTimeout(timer); clearInterval(timer); timer = 0; };
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      stop();
      setManualAngle(state.angle + delta);
      timer = setTimeout(() => { timer = setInterval(() => setManualAngle(state.angle + delta), 50); }, 400);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, stop));
    btn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setManualAngle(state.angle + delta); }
    });
  }
  $('transparent').addEventListener('change', e => { state.transparent = e.target.checked; updateScene(); });
  $('arrowOn').addEventListener('change', e => { state.arrowOn = e.target.checked; syncArrowUI(); updateScene(); });
  document.querySelectorAll('input[name=csize]').forEach(el =>
    el.addEventListener('change', () => { state.contactSize = +el.value; updateScene(); }));
  document.querySelectorAll('input[name=acount]').forEach(el =>
    el.addEventListener('change', () => { state.arrowCount = +el.value; updateScene(); }));
  document.querySelectorAll('input[name=astyle]').forEach(el =>
    el.addEventListener('change', () => { state.arrowStyle = el.value; updateScene(); }));
  document.querySelectorAll('input[name=aheight]').forEach(el =>
    el.addEventListener('change', () => { state.arrowHeight = el.value; updateScene(); }));
  document.querySelectorAll('input[name=grid]').forEach(el =>
    el.addEventListener('change', () => { state.grid = el.value; updateScene(); }));
  $('viewBehind').addEventListener('click', () => {
    setView('behind');
  });
  $('viewCue').addEventListener('click', () => {
    setView('cue');
  });
  controls.addEventListener('change', () => scheduleAutosave());
  $('viewTop').addEventListener('click', () => {
    setView('top');
  });
  $('viewSide').addEventListener('click', () => {
    setView('side');
  });
  $('saveBtn').addEventListener('click', saveLayout);
  $('simShot').addEventListener('click', startSim);
  $('simReset').addEventListener('click', () => { updateScene(); ui.simInfo.textContent = 'リセットしました'; });
  $('simLoop').addEventListener('change', e => { state.simLoop = e.target.checked; scheduleAutosave(); });
  $('simPause').addEventListener('change', e => { state.simPause = e.target.checked; scheduleAutosave(); });
  $('simCueAlpha').addEventListener('input', e => {
    state.simCueAlpha = +e.target.value;
    syncCueAlphaLabel();
    applySimCueAlpha();
    scheduleAutosave();
  });
}

// state → フォーム
export function syncUI() {
  ui.aim.value = state.aim; ui.ang.value = state.angle;
  $('obNum').value = state.obNumber;
  $('cbLine').checked = state.cbLine;
  $('cpLine').checked = state.cpLine;
  $('thickOn').checked = state.thickOn;
  $('thickWallOn').checked = state.thickWallOn;
  $('aimCushion').checked = state.aimCushion;
  $('triOn').checked = state.triOn;
  $('tanOn').checked = state.tanOn;
  $('throwOn').checked = state.throwOn;
  $('simLoop').checked = state.simLoop;
  $('simPause').checked = state.simPause;
  $('simCueAlpha').value = state.simCueAlpha;
  syncCueAlphaLabel();
  $('tFollow').value = state.throwFollow;
  $('tSide').value = state.throwSide;
  $('transparent').checked = state.transparent;
  $('arrowOn').checked = state.arrowOn;
  const radio = (name, val) => {
    const el = document.querySelector(`input[name=${name}][value="${val}"]`);
    if (el) el.checked = true;
  };
  radio('eye', state.eye);
  radio('csize', state.contactSize);
  radio('acount', state.arrowCount);
  radio('aheight', state.arrowHeight);
  radio('astyle', state.arrowStyle);
  $('tSpeed').value = state.shotSpeed;
  radio('grid', state.grid);
}

export function syncArrowUI() {
  document.querySelectorAll('input[name=acount], input[name=aheight], input[name=astyle]').forEach(el => { el.disabled = !state.arrowOn; });
}
