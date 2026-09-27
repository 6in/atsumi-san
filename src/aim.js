import * as THREE from 'three';
import { R, TL, TW, GAP_C, GAP_S, POCKETS } from './constants.js';
import { state } from './state.js';

export function dirVec() {
  const a = THREE.MathUtils.degToRad(state.angle);
  return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
}

export function ghostPos() {
  return state.ob.clone().addScaledVector(dirVec(), -2 * R);
}

// ポケット入口で的球の中心が通れる区間。
// コーナー: 両端はクッションに沿って転がったボールがジョー（クッション端）の真横を通る位置。
// サイド: クッション面の線上で、両ジョーから R 離れた区間。
function pocketMouth(i) {
  const [px, pz] = POCKETS[i];
  const sz = Math.sign(pz);
  if (px === 0) {
    const w = GAP_S - R;
    return [[-w, sz * TW / 2], [w, sz * TW / 2]];
  }
  const sx = Math.sign(px);
  return [
    [sx * (TL / 2 - GAP_C), sz * (TW / 2 - R)],
    [sx * (TL / 2 - R), sz * (TW / 2 - GAP_C)],
  ];
}

// 的球の狙い点。ポケット中心へ向かう線が入口を通れない（クッションに当たる）ときは入口の端へ寄せる
export function aimPoint(i) {
  const [px, pz] = POCKETS[i];
  if (!state.aimCushion) return [px, pz];
  const [[ax, az], [bx, bz]] = pocketMouth(i);
  const ox = state.ob.x, oz = state.ob.z;
  const dx = px - ox, dz = pz - oz;
  const ex = bx - ax, ez = bz - az;
  // O + t*d = A + s*e を解いて入口線上の位置 s を求める
  const den = dx * ez - dz * ex;
  let sPar;
  if (Math.abs(den) < 1e-9) {
    sPar = 0.5;
  } else {
    sPar = ((ax - ox) * dz - (az - oz) * dx) / den;
  }
  sPar = THREE.MathUtils.clamp(sPar, 0, 1);
  return [ax + ex * sPar, az + ez * sPar];
}

// 的球の移動距離: ポケット指定時は的球〜ポケット、手動時は的球〜クッション面
export function obTravel(dir) {
  if (state.aim !== 'manual') {
    const [px, pz] = POCKETS[+state.aim];
    return Math.hypot(px - state.ob.x, pz - state.ob.z);
  }
  return rayToCushion(state.ob.x, state.ob.z, dir.x, dir.z).t;
}

// プレイエリア（クッション面から inset 内側）の矩形内から (dx,dz) 方向に進んだときに当たる壁
export function rayToCushion(x, z, dx, dz, inset = 0) {
  const hx = TL / 2 - inset, hz = TW / 2 - inset;
  let t = Infinity, axis = null;
  if (dx > 1e-9) { const k = (hx - x) / dx; if (k < t) { t = k; axis = 'x'; } }
  if (dx < -1e-9) { const k = (-hx - x) / dx; if (k < t) { t = k; axis = 'x'; } }
  if (dz > 1e-9) { const k = (hz - z) / dz; if (k < t) { t = k; axis = 'z'; } }
  if (dz < -1e-9) { const k = (-hz - z) / dz; if (k < t) { t = k; axis = 'z'; } }
  return { t: Math.max(0, t), axis };
}

export function approachDir(ghostX, ghostZ) {
  const u = new THREE.Vector3(ghostX - state.cb.x, 0, ghostZ - state.cb.z);
  return u.lengthSq() < 1e-9 ? null : u.normalize();
}
