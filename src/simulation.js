import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { R, TL, TW, GAP_C, GAP_S, CONTACT_SIZES } from './constants.js';
import { state } from './state.js';
import { ui } from './dom.js';
import { scene } from './scene.js';
import {
  obBall, cueBall, ghost, ghostCenter, outline, groundContact, groundRing, ballContact, arrowGroup,
  cbLine, cbBackDot, cpLine, cpDots, thickParts, thickWall, triLine, triRight, triArc,
  tanLine, tanEnd, throwLine, compGhost, compAimLine, simContact,
} from './objects.js';
import { ghostPos, approachDir } from './aim.js';
import { shotSpeedMS, R_M, muBall } from './throw.js';
import { updateScene, triLabel } from './update.js';

// 2D の簡易剛体シミュレーション（SI 単位、y 上向き）。
// ラシャ: 滑り摩擦 → 自然転がり → 転がり抵抗で減速。横回転は一定の角減速。
// 球同士: 法線方向は反発係数、接線方向は速度依存摩擦（スロウと同じモデル、滑り停止で頭打ち）。
// クッション: 反発係数＋横回転による接線方向の摩擦撃力（簡易）。
const SIM = {
  dt: 0.0005, maxT: 20, sampleEvery: 8,
  g: 9.81, muSlide: 0.2, muRoll: 0.01, spinDecel: 10,   // rad/s²
  eBall: 0.95, eCush: 0.75, muCush: 0.2,
};
const HALF_L = TL / 200, HALF_W = TW / 200;   // m
const GC = GAP_C / 100, GS = GAP_S / 100;

function makeSimBall(xcm, zcm) {
  return { x: xcm / 100, z: zcm / 100, vx: 0, vz: 0, wx: 0, wy: 0, wz: 0, pocketed: false };
}

function stepCloth(b, dt) {
  if (b.pocketed) return;
  const { g, muSlide, muRoll, spinDecel } = SIM;
  // 接地点の滑り u = v + ω × (0,−R,0) = (vx + Rωz, vz − Rωx)
  const ux = b.vx + R_M * b.wz, uz = b.vz - R_M * b.wx;
  const um = Math.hypot(ux, uz);
  if (um > 1e-6) {
    // 滑りは (7/2)μg で減る。1 ステップで止まる分だけ適用して自然転がりにスナップ
    const f = Math.min(1, um / (3.5 * muSlide * g * dt));
    const a = muSlide * g * dt * f;
    const nx = ux / um, nz = uz / um;
    b.vx -= a * nx; b.vz -= a * nz;
    b.wx += 2.5 * a * nz / R_M;
    b.wz -= 2.5 * a * nx / R_M;
  } else {
    const v = Math.hypot(b.vx, b.vz);
    const dv = muRoll * g * dt;
    if (v <= dv) { b.vx = b.vz = 0; }
    else { b.vx -= dv * b.vx / v; b.vz -= dv * b.vz / v; }
    b.wx = b.vz / R_M; b.wz = -b.vx / R_M;
  }
  const dw = spinDecel * dt;
  b.wy = Math.abs(b.wy) <= dw ? 0 : b.wy - Math.sign(b.wy) * dw;
  b.x += b.vx * dt; b.z += b.vz * dt;
}

// 3D 外積（y 上向き）
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function collideBalls(a, b) {
  if (a.pocketed || b.pocketed) return false;
  let nx = b.x - a.x, nz = b.z - a.z;
  const d = Math.hypot(nx, nz);
  if (d >= 2 * R_M || d < 1e-9) return false;
  nx /= d; nz /= d;
  const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  // 重なりを解消
  const push = (2 * R_M - d) / 2;
  a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
  if (vn <= 0) return false;
  const Jn = vn * (1 + SIM.eBall) / 2;          // 単位質量あたり
  // 接点の滑り（3D）: (v_a + ω_a × Rn) − (v_b + ω_b × (−Rn))
  const rn = [R_M * nx, 0, R_M * nz];
  const sa = cross([a.wx, a.wy, a.wz], rn), sb = cross([b.wx, b.wy, b.wz], rn);
  let s = [a.vx + sa[0] - b.vx + sb[0], sa[1] + sb[1], a.vz + sa[2] - b.vz + sb[2]];
  const sn = s[0] * nx + s[2] * nz;
  s = [s[0] - sn * nx, s[1], s[2] - sn * nz];     // 接線成分のみ
  const sm = Math.hypot(s[0], s[1], s[2]);
  let Jt = 0, t = [0, 0, 0];
  if (sm > 1e-9) {
    Jt = Math.min(muBall(sm) * Jn, sm / 7);      // 滑り停止で頭打ち（2 球の有効質量 7/m）
    t = [s[0] / sm, s[1] / sm, s[2] / sm];
  }
  // b に +J、a に −J。速度は水平成分のみ
  const J = [Jn * nx + Jt * t[0], Jt * t[1], Jn * nz + Jt * t[2]];
  a.vx -= J[0]; a.vz -= J[2];
  b.vx += J[0]; b.vz += J[2];
  // 角速度: Δω = r × J / I、I = 2/5·R²（単位質量）
  const k = 1 / (0.4 * R_M * R_M);
  const ta = cross(rn, [-J[0], -J[1], -J[2]]);
  const tb = cross([-rn[0], 0, -rn[2]], J);
  a.wx += ta[0] * k; a.wy += ta[1] * k; a.wz += ta[2] * k;
  b.wx += tb[0] * k; b.wy += tb[1] * k; b.wz += tb[2] * k;
  return true;
}

function bounceCushion(b, nx, nz) {
  // nx,nz: クッションへ向かう法線（単位）
  const vn = b.vx * nx + b.vz * nz;
  if (vn <= 0) return false;
  const tx = -nz, tz = nx;
  const Jn = vn * (1 + SIM.eCush);
  // 接点（ボール中心から R·n）の接線方向の滑り: v_t + (ω_y ŷ × R n)_t
  const spin = cross([0, b.wy, 0], [R_M * nx, 0, R_M * nz]);
  const st = b.vx * tx + b.vz * tz + spin[0] * tx + spin[2] * tz;
  const Jt = -Math.sign(st) * Math.min(SIM.muCush * Jn, Math.abs(st) / 3.5);   // 1 球の有効質量 (2/7)m
  b.vx += -Jn * nx + Jt * tx; b.vz += -Jn * nz + Jt * tz;
  const tq = cross([R_M * nx, 0, R_M * nz], [Jt * tx, 0, Jt * tz]);
  b.wy += tq[1] / (0.4 * R_M * R_M);
  return true;
}

function handleRails(b) {
  if (b.pocketed) return null;
  const ax = Math.abs(b.x), az = Math.abs(b.z);
  // ポケット判定: コーナーは入口線を越えたら、サイドは開口部でクッション線に達したら
  if ((HALF_L - ax) + (HALF_W - az) < GC || ax > HALF_L || az > HALF_W ||
      (ax < GS - 0.3 * R_M && az > HALF_W - R_M)) {
    b.pocketed = true; b.vx = b.vz = 0;
    return 'pocket';
  }
  let hit = false;
  if (az > HALF_W - R_M && ax > GS && ax < HALF_L - GC) hit = bounceCushion(b, 0, Math.sign(b.z)) || hit;
  if (ax > HALF_L - R_M && az < HALF_W - GC) hit = bounceCushion(b, Math.sign(b.x), 0) || hit;
  return hit ? 'cushion' : null;
}

function runSimulation() {
  const gp = ghostPos();
  const u = approachDir(gp.x, gp.z);
  if (!u) return null;
  const v = shotSpeedMS();
  const cb = makeSimBall(state.cb.x, state.cb.z);
  const ob = makeSimBall(state.ob.x, state.ob.z);
  cb.vx = v * u.x; cb.vz = v * u.z;
  cb.wx = state.throwFollow * cb.vz / R_M;
  cb.wz = -state.throwFollow * cb.vx / R_M;
  cb.wy = state.throwSide * 1.25 * v / R_M;
  const balls = [cb, ob];
  const frames = [];
  const events = { firstHit: null, hitPos: null, cushions: [0, 0], pocket: [null, null] };
  // 姿勢: ワールド軸の角速度 ω を毎ステップ積分（q ← exp(ω dt) · q）
  const quats = balls.map(() => new THREE.Quaternion());
  const dq = new THREE.Quaternion(), axis = new THREE.Vector3();
  const snap = t => frames.push({ t, p: balls.map((b, i) => [b.x * 100, b.z * 100, b.pocketed, quats[i].clone()]) });
  let t = 0, step = 0;
  snap(0);
  while (t < SIM.maxT) {
    for (const b of balls) stepCloth(b, SIM.dt);
    balls.forEach((b, i) => {
      if (b.pocketed) return;
      const w = Math.hypot(b.wx, b.wy, b.wz);
      if (w < 1e-9) return;
      dq.setFromAxisAngle(axis.set(b.wx / w, b.wy / w, b.wz / w), w * SIM.dt);
      quats[i].premultiply(dq);
    });
    if (collideBalls(cb, ob) && events.firstHit === null) {
      events.firstHit = t;
      events.hitPos = [(cb.x + ob.x) * 50, (cb.z + ob.z) * 50];   // 中心の中点 = 接点 [cm]
    }
    balls.forEach((b, i) => {
      const r = handleRails(b);
      if (r === 'cushion') events.cushions[i]++;
      if (r === 'pocket') events.pocket[i] = t;
    });
    t += SIM.dt; step++;
    if (step % SIM.sampleEvery === 0) snap(t);
    const moving = balls.some(b => !b.pocketed && (Math.hypot(b.vx, b.vz) > 1e-4 || Math.abs(b.wy) > 1e-2));
    if (!moving) break;
  }
  snap(t);
  return { frames, events, duration: t };
}

export const trailMats = [
  new LineMaterial({ color: 0xf7f5ec, linewidth: 2, transparent: true, opacity: 0.85 }),
  new LineMaterial({ color: 0xf5c400, linewidth: 2, transparent: true, opacity: 0.85 }),
];
let sim = null;   // { frames, events, duration, t, trails }

// 再生中だけ手球を透過する（設定の変更は再生中でもすぐ反映）
export function applySimCueAlpha() {
  const a = sim ? 1 - state.simCueAlpha / 100 : 1;
  const m = cueBall.material;
  if (m.opacity === a && m.transparent === a < 1) return;
  m.transparent = a < 1;
  m.opacity = a;
  m.depthWrite = a >= 1;
  m.needsUpdate = true;
  cueBall.renderOrder = a < 1 ? 2 : 0;   // 的球より後に描いて透けて見えるように
}

export function stopSim() {
  if (!sim) return;
  sim.trails.forEach(l => { scene.remove(l); l.geometry.dispose(); });
  sim = null;
  simContact.visible = false;
  applySimCueAlpha();
  cueBall.visible = obBall.visible = true;
  cueBall.quaternion.identity();
  obBall.quaternion.identity();
}

export function startSim() {
  updateScene();   // 配置に戻してから
  const res = runSimulation();
  if (!res) { ui.simInfo.textContent = '手球とゴーストボールが重なっていて撞けません'; return; }
  // 補助表示を隠す
  [ghost, ghostCenter, outline, groundContact, groundRing, ballContact, arrowGroup, cbLine, cbBackDot, cpLine, ...cpDots, ...thickParts, thickWall, triLine, triRight, triArc,
   tanLine, tanEnd, throwLine, compGhost, compAimLine].forEach(o => { o.visible = false; });
  triLabel.visible = false;
  const trails = [0, 1].map(i => {
    const pts = [];
    for (const f of res.frames) pts.push(f.p[i][0], 0.08, f.p[i][1]);
    const g = new LineGeometry();
    g.setPositions(pts.length >= 6 ? pts : pts.concat(pts));
    g.instanceCount = 0;
    const l = new Line2(g, trailMats[i]);
    scene.add(l);
    return l;
  });
  sim = { ...res, t: 0, trails, last: performance.now() };
  applySimCueAlpha();
  if (res.events.hitPos) {
    simContact.position.set(res.events.hitPos[0], R, res.events.hitPos[1]);
    simContact.scale.setScalar(CONTACT_SIZES[state.contactSize] * 0.2);   // 点として見える程度に小さく
  }
  const e = res.events;
  const fmt = (i, name) => e.pocket[i] !== null ? `${name}: ポケット` : `${name}: クッション ${e.cushions[i]} 回`;
  ui.simInfo.textContent = (e.firstHit === null ? '的球に当たりませんでした。' : '') +
    `${fmt(1, '的球')}　${fmt(0, '手球')}　（${res.duration.toFixed(1)} 秒）`;
}

const HIT_PAUSE = 0.5;   // 実時間 [s]

export function tickSim() {
  if (!sim) return;
  // 描画ループの時刻は VR 中は XR の時計になり、端末（Vision Pro など）によっては performance.now() と基準が違う。
  // 開始時刻と同じ時計で測り、タブ切り替えなどの大きな飛びは 0.25 秒で頭打ち
  const now = performance.now();
  const dt = THREE.MathUtils.clamp((now - sim.last) / 1000, 0, 0.25);
  sim.last = now;
  if (sim.pause > 0) { sim.pause -= dt; return; }
  const rate = +document.querySelector('input[name=simRate]:checked').value;
  const prevT = sim.t;
  sim.t = Math.min(sim.duration, sim.t + dt * rate);
  const hitT = sim.events.firstHit;
  // 衝突時刻をまたいだら、その瞬間の姿勢で止める
  if (state.simPause && hitT !== null && prevT < hitT && sim.t >= hitT) {
    sim.t = hitT;
    sim.pause = HIT_PAUSE;
  }
  if (sim.t >= sim.duration && state.simLoop) sim.t = 0;
  const fr = sim.frames;
  // 二分探索で現在フレーム
  let lo = 0, hi = fr.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (fr[m].t <= sim.t) lo = m; else hi = m - 1; }
  const f0 = fr[lo], f1 = fr[Math.min(lo + 1, fr.length - 1)];
  const k = f1.t > f0.t ? (sim.t - f0.t) / (f1.t - f0.t) : 0;
  [cueBall, obBall].forEach((mesh, i) => {
    const a = f0.p[i], b = f1.p[i];
    mesh.visible = !a[2];
    mesh.position.set(a[0] + (b[0] - a[0]) * k, R, a[1] + (b[1] - a[1]) * k);
    mesh.quaternion.slerpQuaternions(a[3], b[3], k);
  });
  sim.trails.forEach(l => { l.geometry.instanceCount = lo; });
  // 当たった瞬間から接点を表示（その場に残す）
  simContact.visible = hitT !== null && sim.t >= hitT;
}
