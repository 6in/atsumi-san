import * as THREE from 'three';
import { R, CONTACT_SIZES, PIERCE_WIDTHS, PIERCE_TAIL, ARROW_TOP_Y } from './constants.js';
import { state } from './state.js';
import { $, ui } from './dom.js';
import { camera } from './scene.js';
import { gridPoint, gridHalf } from './table.js';
import { ballColor, obTexture } from './textures.js';
import {
  obBall, cueBall, ghost, ghostMat, ghostCenter, outline, groundContact, ballContact, groundRing,
  arrowGroup, arrowMats, makeWall, makeArrow, disposeGroup,
  cbLine, cbLineMat, cbBackDot, cpLine, cpLineMat, cpDots,
  thickCue, thickGhost, thickParts, thickWall, placeThickSplit,
  TRI_Y, ARC_N, triLine, triRight, triArc, TAN_MAX_PTS, tanLine, tanEnd, throwLine, compGhost, compAimLine,
} from './objects.js';
import { dirVec, ghostPos, aimPoint, obTravel, rayToCushion, approachDir } from './aim.js';
import { shotSpeedMS, throwResult } from './throw.js';
import { stopSim, trailMats } from './simulation.js';
import { scheduleAutosave } from './persistence.js';

const tmp = new THREE.Vector3();
// 直角三角形の角度ラベル（画面座標に追従）
export const triLabel = { pos: new THREE.Vector3(), visible: false };

export function updateScene() {
  stopSim();
  const obMap = obTexture(state.obNumber);
  if (obBall.material.map !== obMap) {
    obBall.material.map = obMap;
    obBall.material.needsUpdate = true;
    trailMats[1].color.setHex(ballColor(state.obNumber));
  }
  if (state.aim !== 'manual') {
    const [px, pz] = aimPoint(+state.aim);
    let deg = THREE.MathUtils.radToDeg(Math.atan2(pz - state.ob.z, px - state.ob.x));
    state.angle = (deg + 360) % 360;
    ui.ang.value = state.angle;
  }

  const dir = dirVec();
  const gp = ghostPos();
  obBall.position.copy(state.ob);
  ghost.position.copy(gp);

  // ゴーストボール表示モード
  const t = state.transparent;
  ghostMat.transparent = t;
  ghostMat.opacity = t ? 0.18 : 1;
  ghostMat.depthWrite = !t;
  ghostMat.needsUpdate = true;
  ghost.castShadow = !t;
  ghost.renderOrder = t ? 2 : 0;
  ghostCenter.visible = outline.visible = groundContact.visible = ballContact.visible = groundRing.visible = t;
  ghost.visible = true;

  ghostCenter.position.copy(gp);
  const s = CONTACT_SIZES[state.contactSize];
  groundContact.scale.setScalar(s);
  groundContact.position.set(gp.x, 0.07, gp.z);   // 接地円の線（0.06）より少し上
  groundRing.position.set(gp.x, 0, gp.z);
  ballContact.scale.setScalar(s);
  ballContact.position.copy(gp).add(state.ob).multiplyScalar(0.5);

  // 矢印
  disposeGroup(arrowGroup);
  arrowGroup.visible = state.arrowOn;
  if (state.arrowOn) {
    const back = 4 * R;
    // 壁はボールの高さ（直径）ちょうど、線は球に埋もれないよう少し上に浮かせる
    const wall = state.arrowStyle === 'wall';
    const y = state.arrowHeight === 'center' ? R : wall ? 2 * R : ARROW_TOP_Y;
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const offsets = state.arrowCount === 3 ? [0, -R, R] : [0];
    for (const off of offsets) {
      const kind = off === 0 ? 'center' : 'side';
      // ゴースト中心の横位置から、クッション面（ポケットでは開口部）に達するまで
      const front = rayToCushion(gp.x + perp.x * off, gp.z + perp.z * off, dir.x, dir.z).t;
      const length = back + Math.max(front, 2 * R);
      const a = wall ? makeWall(length, y, kind) : makeArrow(length, arrowMats[kind]);
      a.position.copy(gp).addScaledVector(dir, -back).addScaledVector(perp, off);
      a.position.y = wall ? 0 : y;
      a.rotation.y = -THREE.MathUtils.degToRad(state.angle);
      arrowGroup.add(a);
    }
  }

  // キューボールとライン
  cueBall.position.copy(state.cb);
  // 貫き線: 手球を貫いて背面の抜け点に印を付け、さらに後方へ延長
  const cue = new THREE.Vector3(gp.x - state.cb.x, 0, gp.z - state.cb.z);
  const hasCue = cue.lengthSq() > 1e-6;
  if (hasCue) cue.normalize();
  cbLineMat.linewidth = PIERCE_WIDTHS[state.contactSize];
  cpLineMat.linewidth = PIERCE_WIDTHS[state.contactSize] + 0.5;
  cbBackDot.scale.setScalar(s);
  cpDots.forEach(d => d.scale.setScalar(s));
  cbLine.visible = cbBackDot.visible = state.cbLine && hasCue;
  if (cbLine.visible) {
    cbBackDot.position.copy(state.cb).addScaledVector(cue, -R);
    const tail = cbBackDot.position.clone().addScaledVector(cue, -PIERCE_TAIL);
    cbLine.geometry.setPositions([tail.x, R, tail.z, gp.x, R, gp.z]);
    cbLine.computeLineDistances();
  }
  // 手球後方から見た接点ラインの横ずれ R·sinθ と、縁までの幅 w = R(1 − sinθ)
  const along = hasCue ? dir.dot(cue) : 0;
  const lateral = dir.clone().addScaledVector(cue, -along);
  const sinCut = lateral.length();
  const canSplit = hasCue && along > 1e-6;
  const thickVisible = state.thickOn && canSplit;
  thickParts.forEach(o => { o.visible = thickVisible; });
  thickWall.visible = state.thickWallOn && canSplit;
  if (canSplit) {
    // 接点側の横方向。フルヒット（横ずれ 0）は切断面が反対側の縁に来るのでどちら向きでもよい
    const side = sinCut > 1e-6 ? lateral.clone().divideScalar(sinCut) : new THREE.Vector3(-cue.z, 0, cue.x);
    // 球の中心から切断面まで: 接点側の縁 R から厚み 2R(1 − sinθ) 内側。
    // 撞く方向に沿って見ると、的球の輪郭がちょうどこの面の位置に来る
    const d = R * (2 * sinCut - 1);
    if (thickVisible) {
      placeThickSplit(thickCue, state.cb, side, d, 1);
      placeThickSplit(thickGhost, gp, side, d, -1);
    }
    if (thickWall.visible) {
      // 手球の背面から PIERCE_TAIL 後方 〜 的球の縁まで。
      // 的球は壁の面に接しており、その接点は的球中心を撞く方向へ投影した位置
      const start = state.cb.clone().addScaledVector(side, d).addScaledVector(cue, -(R + PIERCE_TAIL));
      const length = state.ob.clone().sub(state.cb).dot(cue) + R + PIERCE_TAIL;
      thickWall.position.set(start.x, 0, start.z);
      thickWall.rotation.y = -Math.atan2(cue.z, cue.x);
      thickWall.scale.set(length, 2 * R, 1);
    }
  }
  const cpOn = state.cpLine && hasCue;
  cpLine.visible = cpOn;
  cpDots.forEach(d => { d.visible = cpOn; });
  if (cpOn) {
    const [front, target, back] = cpDots.map(d => d.position);
    front.copy(state.cb).addScaledVector(dir, R);
    target.copy(gp).addScaledVector(dir, R);
    // 手球を貫いて背面へ抜ける点、さらに後方へ延長
    back.copy(front).addScaledVector(cue, -2 * R * dir.dot(cue));
    const tail = back.clone().addScaledVector(cue, -PIERCE_TAIL);
    cpLine.geometry.setPositions([tail.x, tail.y, tail.z, target.x, target.y, target.z]);
  }
  updateTriangle(gp, dir);
  updateTangent(gp, dir);
  updateThrow(gp, dir);

  const toGhost = gp.clone().sub(state.cb);
  const dist = toGhost.length();
  if (dist < 2 * R - 1e-6) {
    ui.cutInfo.textContent = '手球がゴーストボールと重なっています';
  } else {
    const cut = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(toGhost.normalize().dot(dir), -1, 1)));
    ui.cutInfo.innerHTML = cut >= 90
      ? `カット角 <b>${cut.toFixed(1)}°</b>（90°以上: 狙えません）`
      : `カット角 <b>${cut.toFixed(1)}°</b>　厚み <b>${(1 - Math.sin(THREE.MathUtils.degToRad(cut))).toFixed(2)}</b>　距離 <b>${dist.toFixed(1)}cm</b>`;
  }

  gridPoint.visible = state.grid !== 'off';
  gridHalf.visible = state.grid === 'half';

  ui.angv.value = state.angle.toFixed(2) + '°';
  $('tSpeedv').value = `${state.shotSpeed}（${shotSpeedMS().toFixed(2)}m/s）`;
  const f = state.throwFollow, sd = state.throwSide;
  $('tFollowv').value = f === 0 ? 'ストップ' : (f > 0 ? '押し' : '引き') + Math.abs(f);
  $('tSidev').value = sd === 0 ? 'なし' : (sd > 0 ? '右' : '左') + Math.abs(sd);

  scheduleAutosave();
}

function updateTriangle(gp, dir) {
  const on = state.triOn;
  triLine.visible = triRight.visible = triArc.visible = on;
  triLabel.visible = false;
  ui.triInfo.textContent = '';
  if (!on) return;

  const G = new THREE.Vector3(gp.x, TRI_Y, gp.z);
  const C = new THREE.Vector3(state.cb.x, TRI_Y, state.cb.z);
  const t = C.clone().sub(G).dot(dir);
  const F = G.clone().addScaledVector(dir, t);
  const gf = F.clone().sub(G), gc = C.clone().sub(G), fc = C.clone().sub(F);
  const lenGF = gf.length(), lenGC = gc.length(), lenFC = fc.length();

  triLine.geometry.setPositions([G.x, G.y, G.z, F.x, F.y, F.z, C.x, C.y, C.z, G.x, G.y, G.z]);

  // 直角マーク
  const m = Math.min(2.5, lenGF * 0.4, lenFC * 0.4);
  if (m > 0.2) {
    const u = gf.clone().negate().normalize(), v = fc.clone().normalize();
    const a = F.clone().addScaledVector(u, m), b = a.clone().addScaledVector(v, m), c = F.clone().addScaledVector(v, m);
    triRight.geometry.setPositions([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z]);
    triRight.visible = true;
  } else {
    triRight.visible = false;
  }

  if (lenGF < 1e-3 || lenGC < 1e-3) {
    triArc.visible = false;
    ui.triInfo.textContent = lenGC < 1e-3 ? '' : 'ゴースト側の角 90.0°（手球が延長線の真横）';
    return;
  }

  // ゴースト側の角 = GF と GC のなす角
  const u1 = gf.clone().normalize(), u2 = gc.clone().normalize();
  const ang = Math.acos(THREE.MathUtils.clamp(u1.dot(u2), -1, 1));
  const deg = THREE.MathUtils.radToDeg(ang);

  // 角の円弧（u1 から u2 へ回す）
  const r = Math.max(1.5, Math.min(4 * R, lenGF * 0.6, lenGC * 0.6));
  const a0 = Math.atan2(u1.z, u1.x);
  let da = Math.atan2(u2.z, u2.x) - a0;
  if (da > Math.PI) da -= 2 * Math.PI;
  if (da < -Math.PI) da += 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= ARC_N; i++) {
    const th = a0 + (da * i) / ARC_N;
    pts.push(G.x + Math.cos(th) * r, TRI_Y, G.z + Math.sin(th) * r);
  }
  triArc.geometry.setPositions(pts);

  const mid = a0 + da / 2, lr = r + 3.5;
  triLabel.pos.set(G.x + Math.cos(mid) * lr, TRI_Y, G.z + Math.sin(mid) * lr);
  triLabel.visible = true;
  ui.triLabel.textContent = deg.toFixed(1) + '°';

  ui.triInfo.innerHTML = `ゴースト側の角 <b>${deg.toFixed(1)}°</b>　底辺 <b>${lenGF.toFixed(1)}cm</b>　高さ <b>${lenFC.toFixed(1)}cm</b>` +
    (t > 0 ? '（手球が的球側にあり、延長線の前方で交わります）' : '');
}

function updateTangent(gp, dir) {
  tanLine.visible = tanEnd.visible = false;
  ui.tanInfo.textContent = '';
  if (!state.tanOn) return;

  const cue = new THREE.Vector3(gp.x - state.cb.x, 0, gp.z - state.cb.z);
  if (cue.length() < 2 * R) { ui.tanInfo.textContent = 'タンジェント: 手球がゴーストボールと重なっています'; return; }
  cue.normalize();
  // 手球が分離していく側の接線方向
  let tx = -dir.z, tz = dir.x;
  const side = tx * cue.x + tz * cue.z;
  if (Math.abs(side) < 1e-4) { ui.tanInfo.textContent = 'タンジェント: 厚み 1（真っ直ぐ）なので接線方向がありません'; return; }
  if (side < 0) { tx = -tx; tz = -tz; }

  // ゴーストボール中心（＝分離後の手球中心）の軌道。中心はクッション面から R 手前で反射する
  let x = gp.x, z = gp.z;
  let remain = obTravel(dir);
  const total = remain;
  const pts = [x, R, z];
  let bounces = 0;
  while (remain > 1e-6 && pts.length / 3 < TAN_MAX_PTS) {
    const { t, axis } = rayToCushion(x, z, tx, tz, R);
    const step = Math.min(t, remain);
    x += tx * step; z += tz * step; remain -= step;
    pts.push(x, R, z);
    if (remain <= 1e-6) break;
    if (axis === 'x') tx = -tx; else tz = -tz;
    bounces++;
  }
  // 固定長の頂点バッファを末尾の点で埋める
  while (pts.length / 3 < TAN_MAX_PTS) pts.push(x, R, z);
  tanLine.geometry.setPositions(pts);
  tanLine.visible = true;
  tanEnd.position.set(x, R, z);
  tanEnd.visible = true;
  ui.tanInfo.innerHTML = `タンジェント長 <b>${total.toFixed(1)}cm</b>（${state.aim === 'manual' ? '的球〜クッション' : '的球〜ポケット'}）　反射 <b>${bounces}</b> 回`;
}

function updateThrow(gp, dir) {
  throwLine.visible = compGhost.visible = compAimLine.visible = false;
  ui.throwInfo.textContent = '';
  if (!state.throwOn) return;

  const u = approachDir(gp.x, gp.z);
  const r = u && gp.distanceTo(state.cb) >= 2 * R ? throwResult(dir, u) : null;
  if (!r) { ui.throwInfo.textContent = 'この配置では手球が的球に当たりません'; return; }

  const travel = obTravel(dir);
  throwLine.geometry.setPositions([state.ob.x, R, state.ob.z, state.ob.x + r.dx * travel, R, state.ob.z + r.dz * travel]);
  throwLine.visible = true;

  // 補正ゴースト: スロウ後の方向が狙いの方向 dir に一致する n を反復で求める
  const aimA = Math.atan2(dir.z, dir.x);
  let a = aimA, comp = null;
  for (let i = 0; i < 20; i++) {
    const n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const gx = state.ob.x - 2 * R * n.x, gz = state.ob.z - 2 * R * n.z;
    const uu = approachDir(gx, gz);
    const rr = uu ? throwResult(n, uu) : null;
    if (!rr) { comp = null; break; }
    const err = Math.atan2(rr.dz, rr.dx) - aimA;
    const e = Math.atan2(Math.sin(err), Math.cos(err));
    comp = { a, gx, gz };
    if (Math.abs(e) < 1e-6) break;
    a -= e;
  }

  const thetaDeg = THREE.MathUtils.radToDeg(Math.abs(r.theta));
  let html = `スロウ <b>${thetaDeg.toFixed(2)}°</b>　${state.aim === 'manual' ? 'クッション' : 'ポケット'}位置でのずれ <b>${(travel * Math.tan(Math.abs(r.theta))).toFixed(1)}cm</b>`;
  if (comp) {
    compGhost.position.set(comp.gx, R, comp.gz);
    compGhost.visible = true;
    compAimLine.geometry.setPositions([state.cb.x, R, state.cb.z, comp.gx, R, comp.gz]);
    compAimLine.computeLineDistances();
    compAimLine.visible = true;
    const d = THREE.MathUtils.radToDeg(Math.atan2(Math.sin(comp.a - aimA), Math.cos(comp.a - aimA)));
    const shift = 2 * R * Math.abs(Math.sin(comp.a - aimA)) * 10;   // mm
    html += `<br>補正: 当て方向を <b>${Math.abs(d).toFixed(2)}°</b>（ゴースト位置で <b>${shift.toFixed(1)}mm</b>）ずらす`;
  } else {
    html += '<br>補正ゴースト: 解なし';
  }
  ui.throwInfo.innerHTML = html;
}

// 角度ラベルを画面座標に追従させる
const projV = new THREE.Vector3();
export function updateTriLabel() {
  const el = ui.triLabel;
  if (!triLabel.visible) { el.hidden = true; return; }
  projV.copy(triLabel.pos).project(camera);
  if (projV.z > 1 || projV.z < -1) { el.hidden = true; return; }
  el.hidden = false;
  el.style.left = ((projV.x + 1) / 2) * window.innerWidth + 'px';
  el.style.top = ((1 - projV.y) / 2) * window.innerHeight + 'px';
}

// 透視投影でのシルエット円（カメラから見た輪郭）を毎フレーム合わせる
const eyePos = new THREE.Vector3();
export function updateOutline() {
  if (!outline.visible) return;
  const c = ghost.position;
  const eye = camera.getWorldPosition(eyePos);   // VR 中はカメラがリグの子になるのでワールド座標で
  tmp.subVectors(eye, c);
  const d = tmp.length();
  if (d <= R) { outline.visible = false; return; }
  tmp.normalize();
  const r = (R * Math.sqrt(d * d - R * R)) / d;
  outline.position.copy(c).addScaledVector(tmp, (R * R) / d);
  outline.scale.setScalar(r);
  outline.lookAt(eye);
}
