import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { TL, TW, CUSHION_H, CUSHION_W, RAIL_W, RAIL_H, PC, PS, CUT_C, CUT_S, GAP_C, GAP_S, POCKETS } from './constants.js';
import { scene } from './scene.js';

function box(w, h, d, color, x, y, z, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.8 })
  );
  m.position.set(x, y, z);
  m.receiveShadow = true;
  m.castShadow = !!opts.cast;
  scene.add(m);
  return m;
}

function buildTable() {
  const cloth = 0x1f6e44, cushion = 0x1a5e3a, wood = 0x5a3620;
  const outerL = TL + 2 * (CUSHION_W + RAIL_W), outerW = TW + 2 * (CUSHION_W + RAIL_W);

  box(TL + 2 * CUSHION_W, 2, TW + 2 * CUSHION_W, cloth, 0, -1, 0, { roughness: 0.95 });
  box(outerL, 18, outerW, wood, 0, -11, 0, { roughness: 0.6 });

  // クッション（ポケット側の端はジョーとして斜めにカット）
  const CW = CUSHION_W, cutC = CUT_C, cutS = CUT_S;
  const cushionMat = new THREE.MeshStandardMaterial({ color: cushion, roughness: 0.8 });
  // 上から見た (x, z) の多角形を高さ CUSHION_H の柱にする
  const prism = pts => {
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: CUSHION_H, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, cushionMat);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  };
  for (const sz of [-1, 1]) {
    const zn = sz * TW / 2, zb = sz * (TW / 2 + CW);
    for (const sx of [-1, 1]) {
      prism([
        [sx * GAP_S, zn], [sx * (TL / 2 - GAP_C), zn],
        [sx * (TL / 2 - GAP_C + cutC), zb], [sx * (GAP_S - cutS), zb],
      ]);
    }
  }
  for (const sx of [-1, 1]) {
    const xn = sx * TL / 2, xb = sx * (TL / 2 + CW);
    const zn = TW / 2 - GAP_C, zb = TW / 2 - GAP_C + cutC;
    prism([[xn, -zn], [xn, zn], [xb, zb], [xb, -zb]]);
  }

  // レール（ポケット部分を円弧でくり抜いた枠）とポケットの穴
  const rOff = CUSHION_W + RAIL_W / 2;
  const X = TL / 2 + CW, Z = TW / 2 + CW;                   // クッション奥の線
  // 円弧: pIn → pOut を、中心から mid 方向を通る側で結ぶ
  const arc = (cx, cz, r, pIn, pOut, midA, n = 24) => {
    const a0 = Math.atan2(pIn[1] - cz, pIn[0] - cx), a1 = Math.atan2(pOut[1] - cz, pOut[0] - cx);
    const TAU = Math.PI * 2, mod = v => ((v % TAU) + TAU) % TAU;
    let span = mod(a1 - a0);
    if (mod(midA - a0) > span) span -= TAU;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (span * i) / n;
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    return pts;
  };
  const cornerArc = (sx, sz, horizontalFirst) => {
    const c = TL / 2 + PC.d, cz = TW / 2 + PC.d, r = PC.r;
    const pH = [sx * (c - Math.sqrt(r * r - (Z - cz) ** 2)), sz * Z];
    const pV = [sx * X, sz * (cz - Math.sqrt(r * r - (X - c) ** 2))];
    const [pIn, pOut] = horizontalFirst ? [pH, pV] : [pV, pH];
    return arc(sx * c, sz * cz, r, pIn, pOut, Math.atan2(sz, sx));
  };
  const sideArc = (sz, leftToRight) => {
    const cz = TW / 2 + PS.d, r = PS.r, w = Math.sqrt(r * r - (Z - cz) ** 2);
    const [pIn, pOut] = leftToRight ? [[-w, sz * Z], [w, sz * Z]] : [[w, sz * Z], [-w, sz * Z]];
    return arc(0, sz * cz, r, pIn, pOut, Math.atan2(sz, 0));
  };
  const inner = [
    ...cornerArc(-1, -1, false), ...sideArc(-1, true), ...cornerArc(1, -1, true),
    ...cornerArc(1, 1, false), ...sideArc(1, false), ...cornerArc(-1, 1, true),
  ];
  const OX = X + RAIL_W, OZ = Z + RAIL_W;
  const railShape = new THREE.Shape([[-OX, -OZ], [OX, -OZ], [OX, OZ], [-OX, OZ]].map(([x, z]) => new THREE.Vector2(x, -z)));
  railShape.holes.push(new THREE.Path(inner.map(([x, z]) => new THREE.Vector2(x, -z))));
  const railGeo = new THREE.ExtrudeGeometry(railShape, { depth: RAIL_H, bevelEnabled: false, curveSegments: 1 });
  railGeo.rotateX(-Math.PI / 2);
  // グループ 0: 上下面（木）、1: 側面（ポケットの内壁は黒いライナー風）
  const rail = new THREE.Mesh(railGeo, [
    new THREE.MeshStandardMaterial({ color: wood, roughness: 0.6 }),
    new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.9 }),
  ]);
  rail.castShadow = rail.receiveShadow = true;
  scene.add(rail);

  // ポケットの穴: ラシャ面の高さまでの黒い円柱
  const pocketMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const holeDepth = 10;
  for (const [px, pz] of POCKETS) {
    const side = px === 0, P = side ? PS : PC;
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(P.r, P.r, holeDepth, 40), pocketMat);
    hole.position.set(side ? 0 : Math.sign(px) * (TL / 2 + P.d), 0.03 - holeDepth / 2, Math.sign(pz) * (TW / 2 + P.d));
    scene.add(hole);
  }

  // ダイヤモンド
  const diaMat = new THREE.MeshBasicMaterial({ color: 0xf2efe6 });
  const diaGeo = new THREE.CircleGeometry(0.8, 16);
  const addDia = (x, z) => {
    const d = new THREE.Mesh(diaGeo, diaMat);
    d.rotation.x = -Math.PI / 2;
    d.position.set(x, RAIL_H + 0.02, z);
    scene.add(d);
  };
  for (let i = 1; i < 8; i++) {
    if (i === 4) continue;
    const x = -TL / 2 + (TL / 8) * i;
    addDia(x, -(TW / 2 + rOff));
    addDia(x, TW / 2 + rOff);
  }
  for (let i = 1; i < 4; i++) {
    const z = -TW / 2 + (TW / 4) * i;
    addDia(-(TL / 2 + rOff), z);
    addDia(TL / 2 + rOff, z);
  }
}
buildTable();

// ---------- grid ----------
// ポイント（ダイヤモンド）間隔: 長辺 TL/8、短辺 TW/4。ハーフはその半分。
export const gridMats = {
  point: new LineMaterial({ color: 0xffffff, linewidth: 1.5, transparent: true, opacity: 0.55, depthWrite: false }),
  half: new LineMaterial({ color: 0xffffff, linewidth: 1, transparent: true, opacity: 0.25, depthWrite: false }),
};

function makeGrid(divX, divZ, skip, mat) {
  const y = 0.03, pos = [];
  for (let i = 1; i < divX; i++) {
    if (skip && i % 2 === 0) continue;
    const x = -TL / 2 + (TL / divX) * i;
    pos.push(x, y, -TW / 2, x, y, TW / 2);
  }
  for (let i = 1; i < divZ; i++) {
    if (skip && i % 2 === 0) continue;
    const z = -TW / 2 + (TW / divZ) * i;
    pos.push(-TL / 2, y, z, TL / 2, y, z);
  }
  const g = new LineSegmentsGeometry();
  g.setPositions(pos);
  const l = new LineSegments2(g, mat);
  l.visible = false;
  scene.add(l);
  return l;
}
export const gridPoint = makeGrid(8, 4, false, gridMats.point);
export const gridHalf = makeGrid(16, 8, true, gridMats.half);
