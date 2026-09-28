import * as THREE from 'three';
import { R, TW, CUSHION_W, RAIL_W } from './constants.js';
import { $, ui } from './dom.js';
import { renderer, scene, camera, controls } from './scene.js';
import { obBall, cueBall } from './objects.js';
import { startSim } from './simulation.js';
import { updateScene } from './update.js';
import { placeBall } from './drag.js';

// VR（WebXR）。シーンは cm 単位のまま、カメラとコントローラーを 100 倍したリグに入れて実物大にする
// （XR の 1 m = シーンの 100 cm）。台の横（+Z 側の長辺）に立ち、台の方（−Z）を向いて始まる。
// 操作は WebXR の select（Quest のトリガー / Vision Pro の視線＋ピンチ）で統一:
// ボールに当てて押している間はドラッグで配置、浮いているパネルのボタンでショット・停止。
const TABLE_H = 80;       // 床からラシャ面まで [cm]
const EYE_H = 160;        // local-floor が使えないときに想定する目の高さ [cm]
const STAND_Z = TW / 2 + CUSHION_W + RAIL_W + 40;

const rig = new THREE.Group();
rig.scale.setScalar(100);
scene.add(rig);

// 操作パネル（情報表示とボタン）。手前のレールの少し上、右寄りに浮かべ、開始時の頭の位置に向ける
const PANEL_W = 40, PANEL_H = 20;
const panelCanvas = document.createElement('canvas');
panelCanvas.width = 1024; panelCanvas.height = 512;
const panelTex = new THREE.CanvasTexture(panelCanvas);
panelTex.colorSpace = THREE.SRGBColorSpace;
const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H),
  new THREE.MeshBasicMaterial({ map: panelTex, transparent: true }));
panel.position.set(30, 38, TW / 2 + CUSHION_W + RAIL_W + 6);
panel.visible = false;
scene.add(panel);

// ボタンの領域（キャンバス座標）
const BUTTONS = [
  { id: 'shot', label: 'ショット', x: 40, w: 452, color: '#ff9f1a', text: '#1b1e22' },
  { id: 'stop', label: '停止', x: 532, w: 452, color: '#3a3f46', text: '#f2f2f2' },
];
const BTN_Y = 290, BTN_H = 180;
let panelText = null;

function drawPanel(lines) {
  const ctx = panelCanvas.getContext('2d');
  ctx.clearRect(0, 0, 1024, 512);
  ctx.fillStyle = 'rgba(24, 27, 31, 0.92)';
  ctx.beginPath(); ctx.roundRect(0, 0, 1024, 512, 36); ctx.fill();
  ctx.fillStyle = '#f2f2f2';
  ctx.font = '600 40px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  lines.forEach((t, i) => ctx.fillText(t, 40, 36 + i * 60, 944));
  ctx.fillStyle = '#9aa3ad';
  ctx.font = '500 32px system-ui, sans-serif';
  ctx.fillText('ボタンやボールを見て指でつまむ（Quest はトリガー）', 40, 226, 944);
  for (const b of BUTTONS) {
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.roundRect(b.x, BTN_Y, b.w, BTN_H, 28); ctx.fill();
    ctx.fillStyle = b.text;
    ctx.font = '700 72px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(b.label, b.x + b.w / 2, BTN_Y + BTN_H / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  }
  panelTex.needsUpdate = true;
}

// パネル上の当たり位置（uv）→ ボタン
function buttonAt(uv) {
  const x = uv.x * 1024, y = (1 - uv.y) * 512;
  return BUTTONS.find(b => x >= b.x && x <= b.x + b.w && y >= BTN_Y && y <= BTN_Y + BTN_H)?.id;
}

const raycaster = new THREE.Raycaster();
const rot = new THREE.Matrix4();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -R);
const hitPt = new THREE.Vector3();
let drag = null;   // { c: コントローラー, key: 'cb' | 'ob' }
let lastDrop = '';

function setRay(c) {
  c.updateMatrixWorld(true);
  rot.extractRotation(c.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rot).normalize();
}

function onSelectStart(c) {
  setRay(c);
  const hit = raycaster.intersectObjects([panel, cueBall, obBall], false)[0];
  if (!hit) return;
  if (hit.object === panel) {
    const id = buttonAt(hit.uv);
    if (id === 'shot') startSim();
    else if (id === 'stop') { updateScene(); ui.simInfo.textContent = 'リセットしました'; }
    return;
  }
  drag = { c, key: hit.object === cueBall ? 'cb' : 'ob' };
  lastDrop = '';
}

function makeController(i) {
  const c = renderer.xr.getController(i);
  // レイ（トラッキングされたコントローラー・手のときだけ表示。Vision Pro の視線入力は出さない）
  const ray = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -3)]),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
  ray.visible = false;
  c.add(ray);
  c.addEventListener('connected', e => { ray.visible = e.data.targetRayMode === 'tracked-pointer'; });
  c.addEventListener('disconnected', () => { ray.visible = false; if (drag?.c === c) drag = null; });
  c.addEventListener('selectstart', () => onSelectStart(c));
  c.addEventListener('selectend', () => { if (drag?.c === c) drag = null; });
  c.addEventListener('squeezestart', () => startSim());   // Quest のグリップでもショット
  rig.add(c);
}

// 毎フレーム（VR 中のみ）: ドラッグ中のボールを動かし、パネルの表示を更新
export function xrTick() {
  // リグを拡大していると three.js が両目をまとめた視錐台を誤って求め、近くの小さい物体を描画対象から外してしまう。
  // シーンは小さいので VR 中はカリングを止める（矢印・軌跡など途中で作られる物体もあるので毎フレーム）
  scene.traverse(o => { o.frustumCulled = false; });
  if (drag) {
    setRay(drag.c);
    if (raycaster.ray.intersectPlane(dragPlane, hitPt)) {
      const key = `${Math.round(hitPt.x * 2)},${Math.round(hitPt.z * 2)}`;
      if (key !== lastDrop) { lastDrop = key; placeBall(drag.key, hitPt); }
    }
  }
  const text = [ui.cutInfo.textContent, ui.simInfo.textContent].join('\n');
  if (text !== panelText) { panelText = text; drawPanel(text.split('\n').filter(Boolean)); }
}

let saved = null;

function onSessionStart(floor) {
  saved = {
    pos: camera.position.clone(), quat: camera.quaternion.clone(), target: controls.target.clone(),
    near: camera.near, far: camera.far,
  };
  controls.enabled = false;
  // XR の near/far はメートル
  camera.near = 0.02; camera.far = 50;
  camera.position.set(0, 0, 0); camera.quaternion.identity();
  rig.add(camera);
  rig.position.set(0, floor ? -TABLE_H : EYE_H - TABLE_H, STAND_Z);
  panel.lookAt(0, EYE_H - TABLE_H, STAND_Z);
  panel.visible = true;
  panelText = null;
}

function onSessionEnd() {
  drag = null;
  panel.visible = false;
  rig.remove(camera);
  camera.near = saved.near; camera.far = saved.far;
  camera.position.copy(saved.pos); camera.quaternion.copy(saved.quat);
  camera.updateProjectionMatrix();
  controls.target.copy(saved.target);
  controls.enabled = true;
  controls.update();
}

// VR 対応の端末でだけ「VR」ボタンを出す（Capacitor の WebView や未対応ブラウザでは出さない）
export async function initXR() {
  if (!navigator.xr) return;
  let ok = false;
  try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch { ok = false; }
  if (!ok) return;

  renderer.xr.enabled = true;
  // 入力は最大 4 つ受ける（Vision Pro の視線＋ピンチは手の入力の後ろの番号で来ることがある）
  [0, 1, 2, 3].forEach(makeController);
  renderer.xr.addEventListener('sessionend', onSessionEnd);

  const btn = $('vrBtn');
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    if (renderer.xr.isPresenting) { renderer.xr.getSession().end(); return; }
    let session;
    try {
      session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    } catch (err) {
      $('err').textContent = 'VR を開始できません: ' + err.message;
      return;
    }
    // 床の高さが分かる local-floor を優先し、使えなければ local（開始時の頭の位置が原点）
    const floor = session.enabledFeatures ? session.enabledFeatures.includes('local-floor') : true;
    renderer.xr.setReferenceSpaceType(floor ? 'local-floor' : 'local');
    onSessionStart(floor);
    try {
      await renderer.xr.setSession(session);
    } catch (err) {
      $('err').textContent = 'VR を開始できません: ' + err.message;
      session.end();
    }
  });
}
