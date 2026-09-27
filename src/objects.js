import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { R } from './constants.js';
import { scene } from './scene.js';
import { ballMat, obTexture, makeBallTexture, CUE_DOTS } from './textures.js';

const ballGeo = new THREE.SphereGeometry(R, 64, 32);

export const obBall = new THREE.Mesh(ballGeo, ballMat(obTexture(1)));
obBall.castShadow = true;
scene.add(obBall);

export const cueBall = new THREE.Mesh(ballGeo, ballMat(makeBallTexture(0xf7f5ec, CUE_DOTS)));
cueBall.castShadow = true;
scene.add(cueBall);

export const cbLineMat = new LineMaterial({ color: 0xffffff, linewidth: 1.5, dashed: true, dashSize: 1.5, gapSize: 1, transparent: true, opacity: 0.8 });
export const cbLine = new Line2(new LineGeometry(), cbLineMat);
cbLine.geometry.setPositions([0, 0, 0, 1, 0, 0]);
export const cbBackDot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
scene.add(cbLine, cbBackDot);

// 接点ガイド: 手球上の接点（中心から的球の進行方向へ R）→ ゴーストと的球の接点
export const cpLineMat = new LineMaterial({ color: 0x7dff6b, linewidth: 2 });
export const cpLine = new Line2(new LineGeometry(), cpLineMat);
cpLine.geometry.setPositions([0, 0, 0, 1, 0, 0]);
const cpDotGeo = new THREE.SphereGeometry(1, 16, 12);
const cpDotMat = new THREE.MeshBasicMaterial({ color: 0x7dff6b });
export const cpDots = [0, 1, 2].map(() => new THREE.Mesh(cpDotGeo, cpDotMat));
scene.add(cpLine, ...cpDots);

// 厚みの縦割り: 撞く方向に平行な鉛直面で球を切る。手球は縁から厚み 2w の位置で切って厚みの側を、
// ゴーストボールは同じ位置で切って的球と重ならない側を色付けする。
// 切り口の円は球越しに見えるよう depthTest なしで描く。
export const thickSliceMat = new LineMaterial({ color: 0x7dff6b, linewidth: 2.5, depthTest: false, transparent: true });
const unitRing = (() => {
  const pts = [];
  for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push(Math.cos(a), Math.sin(a), 0); }
  const g = new LineGeometry();
  g.setPositions(pts);
  return g;
})();
function makeThickSplit(color) {
  const clip = new THREE.Plane();
  const cap = new THREE.Mesh(new THREE.SphereGeometry(R * 1.01, 48, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, clippingPlanes: [clip] }));
  const slice = new THREE.Group();
  slice.add(
    new THREE.Mesh(new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthTest: false, depthWrite: false })),
    new Line2(unitRing, thickSliceMat),
  );
  slice.traverse(o => { o.renderOrder = 10; });
  scene.add(cap, slice);
  return { clip, cap, slice };
}
// center の球を、中心から side 方向に d の面で切り、sign 側（+1: side 側、−1: 反対側）を色付け
export function placeThickSplit(t, center, side, d, sign) {
  t.cap.position.copy(center);
  t.clip.set(side.clone().multiplyScalar(sign), -sign * (side.dot(center) + d));
  t.slice.position.copy(center).addScaledVector(side, d);
  t.slice.lookAt(t.slice.position.clone().add(side));
  t.slice.scale.setScalar(Math.max(Math.sqrt(Math.max(R * R - d * d, 0)), 1e-3));
}
export const thickCue = makeThickSplit(0x7dff6b);
export const thickGhost = makeThickSplit(0xff9f5a);
export const thickParts = [thickCue, thickGhost].flatMap(t => [t.cap, t.slice]);
// 厚みの壁: 手球とゴーストの縦割り面は同一平面なので、その面に沿った薄い壁（+X 向き、原点が根元の下端）
export const thickWall = (() => {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0.5, 0.5, 0);
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x7dff6b, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  m.renderOrder = 3;
  g.add(m, new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x7dff6b })));
  scene.add(g);
  return g;
})();

// 直角三角形: G(ゴースト中心) - F(手球から的球ライン延長への垂線の足) - C(手球中心)。ラシャ面上に描く。
export const TRI_Y = 0.05, ARC_N = 32;
export const triMat = new LineMaterial({ color: 0x4fd1ff, linewidth: 2 });
export const triThinMat = new LineMaterial({ color: 0x4fd1ff, linewidth: 1.5 });
function makeLine(n, mat) {
  const g = new LineGeometry();
  g.setPositions(new Array(n * 3).fill(0));
  const l = new Line2(g, mat);
  l.visible = false;
  scene.add(l);
  return l;
}
export const triLine = makeLine(4, triMat);
export const triRight = makeLine(3, triThinMat);
export const triArc = makeLine(ARC_N + 1, triThinMat);
export const TAN_MAX_PTS = 16;
export const tanMat = new LineMaterial({ color: 0xff6bd6, linewidth: 2 });
export const tanLine = makeLine(TAN_MAX_PTS, tanMat);
export const tanEnd = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff6bd6 }));
tanEnd.visible = false;
scene.add(tanEnd);
// スロウ表示
export const throwLineMat = new LineMaterial({ color: 0xff5a5a, linewidth: 2.5 });
export const throwLine = makeLine(2, throwLineMat);
const compGhostMat = new THREE.MeshStandardMaterial({ color: 0x55ccff, roughness: 0.35, transparent: true, opacity: 0.4, depthWrite: false });
export const compGhost = new THREE.Mesh(ballGeo, compGhostMat);
compGhost.renderOrder = 2;
compGhost.visible = false;
scene.add(compGhost);
export const compAimLine = makeLine(2, new LineMaterial({ color: 0x55ccff, linewidth: 1.5, dashed: true, dashSize: 1.5, gapSize: 1 }));

export const ghostMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.35 });
export const ghost = new THREE.Mesh(ballGeo, ghostMat);
ghost.castShadow = true;
scene.add(ghost);

// 透明時の補助表示
export const ghostCenter = new THREE.Mesh(
  new THREE.SphereGeometry(0.22, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0x111111 })
);
scene.add(ghostCenter);

export const outlineMat = new LineMaterial({ color: 0xf0f0f0, linewidth: 2 });
export const outline = (() => {
  const pts = [];
  const N = 128;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    pts.push(Math.cos(t), Math.sin(t), 0);
  }
  const g = new LineGeometry();
  g.setPositions(pts);
  return new Line2(g, outlineMat);
})();
scene.add(outline);

const unitSphere = new THREE.SphereGeometry(1, 24, 16);
export const groundContact = new THREE.Mesh(unitSphere, new THREE.MeshBasicMaterial({ color: 0xff3b4e }));
export const ballContact = new THREE.Mesh(unitSphere, new THREE.MeshBasicMaterial({ color: 0x2f8bff }));
scene.add(groundContact, ballContact);

// 接地点を中心とした半径 R の円（ボールの占有範囲をラシャ面に投影）
export const groundRing = (() => {
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push(Math.cos(a) * R, 0.06, Math.sin(a) * R);
  }
  const g = new LineGeometry();
  g.setPositions(pts);
  return new Line2(g, outlineMat);
})();
scene.add(groundRing);

// ---------- arrows ----------
export const arrowGroup = new THREE.Group();
scene.add(arrowGroup);
export const arrowMats = {
  center: new THREE.MeshStandardMaterial({ color: 0xff8a00, roughness: 0.4, emissive: 0x552a00 }),
  side: new THREE.MeshStandardMaterial({ color: 0xffe08a, roughness: 0.4, emissive: 0x3a3000 }),
};

const wallMats = {
  center: new THREE.MeshBasicMaterial({ color: 0xff8a00, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
  side: new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }),
};
const wallEdgeMats = {
  center: new THREE.LineBasicMaterial({ color: 0xff8a00 }),
  side: new THREE.LineBasicMaterial({ color: 0xffe08a }),
};

// +X 方向に伸びる垂直な薄い壁（原点が根元、ラシャ面から高さ h）
export function makeWall(length, h, kind) {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(length, h);
  geo.translate(length / 2, h / 2, 0);
  const m = new THREE.Mesh(geo, wallMats[kind]);
  m.renderOrder = 3;
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), wallEdgeMats[kind]);
  g.add(m, e);
  return g;
}

// +X 方向を向いた矢印（原点が根元）
export function makeArrow(length, mat) {
  const g = new THREE.Group();
  const shaftR = 0.18, headR = 0.65, headL = 2.6;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftR, shaftR, length - headL, 12), mat);
  shaft.rotation.z = -Math.PI / 2;
  shaft.position.x = (length - headL) / 2;
  const head = new THREE.Mesh(new THREE.ConeGeometry(headR, headL, 20), mat);
  head.rotation.z = -Math.PI / 2;
  head.position.x = length - headL / 2;
  shaft.castShadow = head.castShadow = true;
  g.add(shaft, head);
  return g;
}

export function disposeGroup(group) {
  group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  group.clear();
}
