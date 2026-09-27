import * as THREE from 'three';
import { R } from './constants.js';
import { state } from './state.js';
import { camera, controls } from './scene.js';
import { dirVec, ghostPos } from './aim.js';
import { scheduleAutosave } from './persistence.js';

const EYE_HALF_IPD = 3.2;   // cm
let currentView = null;
// 撞く方向 u（水平単位ベクトル）に対して、選んだ目の側へカメラをずらす
function applyEye(u) {
  const k = state.eye === 'left' ? -1 : state.eye === 'right' ? 1 : 0;
  camera.position.x += -u.z * EYE_HALF_IPD * k;
  camera.position.z += u.x * EYE_HALF_IPD * k;
}
export function setView(kind) {
  currentView = kind;
  const dir = dirVec();
  const mid = ghostPos().add(state.ob).multiplyScalar(0.5);
  controls.target.copy(mid);
  if (kind === 'cue') {
    // 手球の真後ろからゴーストボール中心を見る。
    // 手球を見下ろす角 CAM_ELEV、ゴーストとの見下ろし角の差が VIEW_SPREAD 以内（画角 ±22.5° に収める）
    // になるよう後方距離を決める。最低でもボール4個分後方。
    const CAM_ELEV = THREE.MathUtils.degToRad(25), VIEW_SPREAD = THREE.MathUtils.degToRad(16);
    const gp = ghostPos();
    const u = new THREE.Vector3(gp.x - state.cb.x, 0, gp.z - state.cb.z);
    const D = u.length();
    if (D < 1e-6) u.copy(dir); else u.divideScalar(D);
    const tA = Math.tan(CAM_ELEV), tB = Math.tan(CAM_ELEV - VIEW_SPREAD);
    const back = Math.max(8 * R, (D * tB) / (tA - tB));
    controls.target.copy(gp);
    camera.position.copy(state.cb).addScaledVector(u, -back);
    camera.position.y = R + back * tA;
    applyEye(u);
  } else if (kind === 'top') {
    camera.position.set(mid.x, 90, mid.z + 0.01);
  } else if (kind === 'side') {
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    camera.position.copy(mid).addScaledVector(perp, 40);
    camera.position.y = R + 0.5;
  } else {
    // ゴーストボールの真後ろ（手球→ゴーストの延長線上）から、ボール中心の高さで水平に見る（厚みの確認用）。
    // 手球が視線をさえぎらないよう、手球が近いときはゴースト寄りにカメラを置く
    const gp = ghostPos();
    const u = new THREE.Vector3(gp.x - state.cb.x, 0, gp.z - state.cb.z);
    const D = u.length();
    if (D < 1e-6) u.copy(dir); else u.divideScalar(D);
    const back = Math.min(6 * R, Math.max(D - 1.3 * R, 1.5 * R));
    controls.target.copy(gp);
    camera.position.copy(gp).addScaledVector(u, -back);
    camera.position.y = R;
    applyEye(u);
  }
  controls.update();
  scheduleAutosave();
}

// 利き目の変更: 撞く方向に沿った視点ならそのまま付け直す
export function refreshEyeView() {
  if (currentView === 'cue' || currentView === 'behind') setView(currentView); else scheduleAutosave();
}
