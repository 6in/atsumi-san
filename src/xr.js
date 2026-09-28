import * as THREE from 'three';
import { R, TL, TW, CUSHION_W, RAIL_W } from './constants.js';
import { state } from './state.js';
import { $, ui } from './dom.js';
import { renderer, scene, camera, controls } from './scene.js';
import { obBall, cueBall } from './objects.js';
import { startSim } from './simulation.js';
import { updateScene } from './update.js';
import { placeBall } from './drag.js';
import { ghostPos } from './aim.js';

// VR（WebXR）。シーンは cm 単位のまま、カメラとコントローラーを 100 倍したリグに入れて実物大にする
// （XR の 1 m = シーンの 100 cm）。台の横（+Z 側の長辺）に立ち、台の方（−Z）を向いて始まる。
// 操作は WebXR の select（Quest のトリガー / Vision Pro の視線＋ピンチ）で統一:
// ボールに当てて押している間はドラッグで配置、浮いているパネルのボタンでショット・停止・立ち位置の切り替え。
// 立ち位置はリグを動かして変える（Vision Pro は開始位置から歩いて離れると現実の風景が重なるため）。
const TABLE_H = 70;       // 床からラシャ面まで [cm]
const EYE_H = 160;        // local-floor が使えないときに想定する目の高さ [cm]
const OUTER_X = TL / 2 + CUSHION_W + RAIL_W, OUTER_Z = TW / 2 + CUSHION_W + RAIL_W;   // 台の外枠
const STAND_GAP = 40;     // 外枠から立つ位置まで [cm]

const rig = new THREE.Group();
rig.scale.setScalar(100);
scene.add(rig);

// 操作パネル（情報表示とボタン）。立ち位置の右前、ラシャ面の少し上に浮かべて頭の方へ向ける
const PANEL_W = 40, PANEL_H = 25;
const CW = 1024, CH = 640;   // キャンバス
const panelCanvas = document.createElement('canvas');
panelCanvas.width = CW; panelCanvas.height = CH;
const panelTex = new THREE.CanvasTexture(panelCanvas);
panelTex.colorSpace = THREE.SRGBColorSpace;
const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H),
  new THREE.MeshBasicMaterial({ map: panelTex, transparent: true }));
panel.visible = false;
scene.add(panel);

// ボタンの領域（キャンバス座標）
const ROW1 = { y: 236, h: 170, font: 72 }, ROW2 = { y: 436, h: 164, font: 56 };
const BUTTONS = [
  { id: 'shot', label: 'ショット', x: 40, w: 452, ...ROW1, color: '#ff9f1a', text: '#1b1e22' },
  { id: 'stop', label: '停止', x: 532, w: 452, ...ROW1, color: '#3a3f46', text: '#f2f2f2' },
  { id: 'near', label: '手前', x: 40, w: 292, ...ROW2, color: '#2c4f6e', text: '#f2f2f2' },
  { id: 'far', label: '奥', x: 366, w: 292, ...ROW2, color: '#2c4f6e', text: '#f2f2f2' },
  { id: 'cue', label: '手球の後ろ', x: 692, w: 292, ...ROW2, color: '#2c4f6e', text: '#f2f2f2' },
];
let panelText = null;

function drawPanel(lines) {
  const ctx = panelCanvas.getContext('2d');
  ctx.clearRect(0, 0, CW, CH);
  ctx.fillStyle = 'rgba(24, 27, 31, 0.92)';
  ctx.beginPath(); ctx.roundRect(0, 0, CW, CH, 36); ctx.fill();
  ctx.fillStyle = '#f2f2f2';
  ctx.font = '600 40px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  lines.forEach((t, i) => ctx.fillText(t, 40, 30 + i * 56, 944));
  ctx.fillStyle = '#9aa3ad';
  ctx.font = '500 30px system-ui, sans-serif';
  ctx.fillText('ボタンやボールを見て指でつまむ（Quest はトリガー）', 40, 160, 944);
  for (const b of BUTTONS) {
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 28); ctx.fill();
    ctx.fillStyle = b.text;
    ctx.font = `700 ${b.font}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  }
  panelTex.needsUpdate = true;
}

// パネル上の当たり位置（uv）→ ボタン
function buttonAt(uv) {
  const x = uv.x * CW, y = (1 - uv.y) * CH;
  return BUTTONS.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)?.id;
}

// 立ち位置（台の座標 [cm] と向いている水平方向）
function stanceFor(kind) {
  if (kind === 'near') return { x: 0, z: OUTER_Z + STAND_GAP, dx: 0, dz: -1 };
  if (kind === 'far') return { x: 0, z: -(OUTER_Z + STAND_GAP), dx: 0, dz: 1 };
  // 手球の後ろ: 手球→ゴーストの延長線を手球から後ろへたどり、台の外枠を出たところに立って撞く方向を向く
  const gp = ghostPos(), cb = state.cb;
  let dx = gp.x - cb.x, dz = gp.z - cb.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) { dx = 0; dz = -1; } else { dx /= len; dz /= len; }
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (cb.x + OUTER_X) / dx);
  if (dx < -1e-9) t = Math.min(t, (cb.x - OUTER_X) / dx);
  if (dz > 1e-9) t = Math.min(t, (cb.z + OUTER_Z) / dz);
  if (dz < -1e-9) t = Math.min(t, (cb.z - OUTER_Z) / dz);
  t += STAND_GAP;
  return { x: cb.x - dx * t, z: cb.z - dz * t, dx, dz };
}

const euler = new THREE.Euler();
// 今の頭の位置・向き（リグ内、メートル）を打ち消して、頭がちょうど立ち位置に来て指定の方向を向くようにリグを置く
function applyStance(kind) {
  const s = stanceFor(kind);
  const headYaw = euler.setFromQuaternion(camera.quaternion, 'YXZ').y;
  const ry = Math.atan2(-s.dx, -s.dz) - headYaw;
  const c = Math.cos(ry), sn = Math.sin(ry);
  const hx = camera.position.x * 100, hz = camera.position.z * 100;
  rig.rotation.y = ry;
  rig.position.x = s.x - (hx * c + hz * sn);
  rig.position.z = s.z - (-hx * sn + hz * c);
  // パネルは立ち位置から見て右 30cm・前 34cm、ラシャ面から 38cm 上
  const rx = -s.dz, rz = s.dx;
  panel.position.set(s.x + rx * 30 + s.dx * 34, 38, s.z + rz * 30 + s.dz * 34);
  panel.lookAt(s.x, EYE_H - TABLE_H, s.z);
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
    else if (id) applyStance(id);
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
  rig.position.y = floor ? -TABLE_H : EYE_H - TABLE_H;
  applyStance('near');
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
