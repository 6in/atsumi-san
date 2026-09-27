import * as THREE from 'three';
import { TL, TW, CUSHION_W, RAIL_W, RAIL_H, POCKETS } from './constants.js';
import { renderer, camera } from './scene.js';

// ポケットラベル表示
const pocketLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
// コーナーは台の外角、サイドはレール外縁の上
const LABEL_EDGE_X = TL / 2 + CUSHION_W + RAIL_W, LABEL_EDGE_Z = TW / 2 + CUSHION_W + RAIL_W;
const labelAnchors = POCKETS.map(([px, pz]) => new THREE.Vector3(
  px === 0 ? 0 : Math.sign(px) * LABEL_EDGE_X, RAIL_H + 2, Math.sign(pz) * LABEL_EDGE_Z));
const labelSpans = pocketLabels.map(t => {
  const span = document.createElement('span');
  span.textContent = t;
  span.className = 'pocket-label';
  span.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-50%,-50%);' +
    'color:#ffff00;font-weight:900;text-shadow:0 0 8px rgba(0,0,0,0.9), 0 0 4px rgba(255,255,0,0.5);';
  document.getElementById('pocketLabels').appendChild(span);
  return span;
});
const _lp = new THREE.Vector3();
export function updatePocketLabels() {
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  labelAnchors.forEach((a, i) => {
    _lp.copy(a).project(camera);
    const s = labelSpans[i];
    if (_lp.z > 1) { s.style.display = 'none'; return; }
    s.style.display = '';
    s.style.left = `${(_lp.x * 0.5 + 0.5) * w}px`;
    s.style.top = `${(-_lp.y * 0.5 + 0.5) * h}px`;
  });
}
