import * as THREE from 'three';
import { R, TL, TW } from './constants.js';
import { state } from './state.js';
import { container, renderer, camera, controls } from './scene.js';
import { obBall, cueBall } from './objects.js';
import { updateScene } from './update.js';
import { syncUI } from './ui.js';

// ボール上で押したときだけドラッグ。OrbitControls より先に捕まえるため親要素の capture で受ける。
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -R);
const hitPt = new THREE.Vector3();
let dragging = null;

function setRay(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}

export function initDrag() {
  container.addEventListener('pointerdown', e => {
    if (!e.isPrimary) return;
    setRay(e);
    const hit = raycaster.intersectObjects([cueBall, obBall], false)[0];
    if (!hit) return;
    dragging = { key: hit.object === cueBall ? 'cb' : 'ob', id: e.pointerId };
    controls.enabled = false;
    container.setPointerCapture(e.pointerId);
    e.stopPropagation();
  }, { capture: true });

  container.addEventListener('pointermove', e => {
    if (!dragging || e.pointerId !== dragging.id) return;
    setRay(e);
    if (!raycaster.ray.intersectPlane(dragPlane, hitPt)) return;
    const v = state[dragging.key];
    v.x = THREE.MathUtils.clamp(Math.round(hitPt.x * 2) / 2, -TL / 2 + R, TL / 2 - R);
    v.z = THREE.MathUtils.clamp(Math.round(hitPt.z * 2) / 2, -TW / 2 + R, TW / 2 - R);
    syncUI();
    updateScene();
  });

  function endDrag(e) {
    if (!dragging || e.pointerId !== dragging.id) return;
    dragging = null;
    controls.enabled = true;
  }
  container.addEventListener('pointerup', endDrag);
  container.addEventListener('pointercancel', endDrag);
}
