import * as THREE from 'three';
import { R } from './constants.js';
import { state } from './state.js';

// ---------- throw (Alciatore TP A.14) ----------
// ボール間摩擦: μ(v_rel) = a + b·exp(−c·v_rel)  [m/s]
// スロウ角: θ = atan( min(μ·v·cosφ / v_rel, 1/7) · |接線方向の滑り| / (v·cosφ) )
// 段階 10 の初速 [m/s]: 頭側クッションに接した手球を中央撞点で撞くと、長辺を二往復して頭側クッションで止まる速さ
// （simulation.js の摩擦・クッションのモデルで逆算。モデルを変えたら求め直す）。1〜10 はこれに比例
const SPEED_MAX = 8.31;
export const shotSpeedMS = () => SPEED_MAX * state.shotSpeed / 10;   // m/s
export const R_M = R / 100;                           // ボール半径 [m]
export const muBall = vr => 9.951e-3 + 0.108 * Math.exp(-1.088 * vr);

// 的球の進行方向 n（ゴースト→的球）と手球の進入方向 u に対するスロウ後の的球方向を返す
export function throwResult(n, u) {
  const v = shotSpeedMS();
  const cosPhi = THREE.MathUtils.clamp(u.x * n.x + u.z * n.z, -1, 1);
  if (cosPhi <= 1e-3) return null;               // 90°以上のカットは当たらない
  const tx = -n.z, tz = n.x;                      // 接線方向（n に直交する水平単位ベクトル）
  // 横回転: 右ひねり（進行方向の右側を撞く）はトルク r×F が +y → 上から見て反時計回り（ω_y > 0）。
  // 撞点 b=R/2 のとき ω = 5/2·v·b/R² = 1.25·v/R
  const wy = state.throwSide * 1.25 * v / R_M;
  // 接点（手球表面の n 方向）の回転による速度 ω × R·n = ω_y·R·(n_z, 0, −n_x)
  const spinT = wy * R_M * (n.z * tx - n.x * tz);
  const slideT = v * (u.x * tx + u.z * tz) + spinT;   // 接線方向の滑り（符号付き）
  const wx = state.throwFollow * v / R_M;             // 縦回転（自然転がりで ω = v/R）
  const vRel = Math.hypot(slideT, R_M * wx * cosPhi);
  if (vRel < 1e-9) return { theta: 0, dx: n.x, dz: n.z, phi: Math.acos(cosPhi) };
  const k = Math.min(muBall(vRel) * v * cosPhi / vRel, 1 / 7);
  const theta = Math.atan(k * Math.abs(slideT) / (v * cosPhi));
  const sgn = Math.sign(slideT);
  // 的球は手球表面が滑る向きへ引きずられる
  const dx = n.x * Math.cos(theta) + sgn * tx * Math.sin(theta);
  const dz = n.z * Math.cos(theta) + sgn * tz * Math.sin(theta);
  return { theta: sgn * theta, dx, dz, phi: Math.acos(cosPhi) };
}
