import * as THREE from 'three';
import Dexie from 'dexie';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

// 単位: cm。y が上方向、ラシャ面が y=0。X は台の長手方向、Z は短手方向。
const R = 5.715 / 2;             // ボール半径
const TL = 254, TW = 127;        // プレイエリア（9ft）
const CUSHION_H = 3.6, CUSHION_W = 5;
const RAIL_W = 14, RAIL_H = 4.4;
const CONTACT_SIZES = [0.25, 0.45, 0.75];
const PIERCE_WIDTHS = [1.2, 2, 3.5];   // 貫き線の太さ [px]（接点サイズに連動）
const PIERCE_TAIL = 6 * R;             // 手球背面からさらに後方へ伸ばす長さ
const ARROW_TOP_Y = 2 * R + 0.8;

// ポケットの穴: 中心の外側オフセット d と半径 r
const PC = { d: 3.4, r: 6.2 }, PS = { d: 4.2, r: 5.8 };
// ジョー角: コーナー 142°、サイド 104°（クッション面とジョー面のなす角）。
// クッション奥（レール側）での端のずれ = 奥行 / tan(180° − ジョー角)
const CUT_C = CUSHION_W / Math.tan(THREE.MathUtils.degToRad(180 - 142));
const CUT_S = CUSHION_W / Math.tan(THREE.MathUtils.degToRad(180 - 104));
// クッション切り欠き（コーナーは角から、サイドは中央から）。台形の奥の角が穴の外周に触れる長さにする
const GAP_C = CUT_C - PC.d + Math.sqrt(PC.r ** 2 - (CUSHION_W - PC.d) ** 2);
const GAP_S = CUT_S + Math.sqrt(PS.r ** 2 - (CUSHION_W - PS.d) ** 2);
const POCKETS = [
  [-TL / 2, -TW / 2], [0, -TW / 2 - 1.5], [TL / 2, -TW / 2],
  [-TL / 2,  TW / 2], [0,  TW / 2 + 1.5], [TL / 2,  TW / 2],
];

const state = {
  ob: new THREE.Vector3(40, R, -20),
  cb: new THREE.Vector3(-50, R, 20),
  cbLine: true,
  cpLine: false,
  thickOn: false,
  thickWallOn: false,
  triOn: false,
  tanOn: false,
  throwOn: false,
  shotSpeed: 3,      // 1〜10。手球の初速 = 0.5 m/s × 段階
  throwFollow: 0,    // -1 引き … 0 ストップ … +1 押し（自然転がり）
  throwSide: 0,      // -1 左ひねり … +1 右ひねり（撞点 R/2 相当）
  simLoop: false,
  simPause: true,
  obNumber: 1,
  eye: 'center',     // 撞く方向に沿った視点で使う目: left | center | right
  angle: 0,          // 的球の進行方向（度）。XZ 平面で +X から +Z 方向へ
  aim: '2',
  transparent: false,
  contactSize: 1,
  arrowOn: true,
  arrowCount: 1,
  arrowHeight: 'center',
  arrowStyle: 'line', // line | wall
  aimCushion: true,
  grid: 'off',       // off | point | half
};

// ---------- renderer / scene ----------
const container = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.localClippingEnabled = true;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1e22);

const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.minDistance = 6;
controls.maxDistance = 600;
controls.maxPolarAngle = Math.PI / 2 - 0.01;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
controls.screenSpacePanning = false;   // パンは水平面内（注視点が台の下に潜らない）

// 視点が台の下に入らないよう、注視点とカメラの高さを制限する
const MIN_CAM_Y = 1.0;
function clampView() {
  if (controls.target.y < 0) controls.target.y = 0;
  if (controls.target.y > 60) controls.target.y = 60;
  if (camera.position.y < MIN_CAM_Y) camera.position.y = MIN_CAM_Y;
}
controls.addEventListener('change', clampView);

scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(30, 200, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 90, bottom: -90, near: 50, far: 400 });
sun.shadow.bias = -0.0005;
scene.add(sun);

// ---------- table ----------
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
const gridMats = {
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
const gridPoint = makeGrid(8, 4, false, gridMats.point);
const gridHalf = makeGrid(16, 8, true, gridMats.half);

// ---------- balls ----------
const ballGeo = new THREE.SphereGeometry(R, 64, 32);

// 回転が見えるよう球面に模様を描く。SphereGeometry の UV（正距円筒）の各画素を球面上の方向に戻し、
// 円形マーク（中心方向と角半径）の内側を塗るので極付近でも歪まない。text はマーク面に正対して描く。
// stripe: { color, h } を渡すと |y| < h の帯を塗る（ストライプボール）
function makeBallTexture(base, marks, stripe = null) {
  const W = 1024, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const rgb = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const TS = 128;
  const prepared = marks.map(m => {
    const c = new THREE.Vector3(...m.dir).normalize();
    const e2 = Math.abs(c.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    e2.addScaledVector(c, -e2.dot(c)).normalize();
    const e1 = new THREE.Vector3().crossVectors(e2, c);
    let glyph = null;
    if (m.text) {
      const tc = document.createElement('canvas');
      tc.width = tc.height = TS;
      const t = tc.getContext('2d');
      t.fillStyle = '#000';
      t.font = `bold ${TS * (m.text.length > 1 ? 0.56 : 0.8)}px system-ui, sans-serif`;
      t.textAlign = 'center'; t.textBaseline = 'middle';
      t.fillText(m.text, TS / 2, TS * 0.54);
      glyph = t.getImageData(0, 0, TS, TS).data;
    }
    return { c, e1, e2, cosR: Math.cos(m.radius), tanR: Math.tan(m.radius), col: rgb(m.color), glyph };
  });
  const baseCol = rgb(base), bandCol = stripe && rgb(stripe.color), d = new THREE.Vector3();
  for (let py = 0; py < H; py++) {
    const th = ((py + 0.5) / H) * Math.PI;
    for (let px = 0; px < W; px++) {
      const ph = ((px + 0.5) / W) * Math.PI * 2;
      d.set(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th));
      let col = stripe && Math.abs(d.y) < stripe.h ? bandCol : baseCol;
      for (const m of prepared) {
        const cz = d.dot(m.c);
        if (cz < m.cosR) continue;
        col = m.col;
        if (m.glyph) {
          const u = d.dot(m.e1) / cz / m.tanR, v = d.dot(m.e2) / cz / m.tanR;
          const gx = Math.floor((u * 0.5 + 0.5) * TS), gy = Math.floor((0.5 - v * 0.5) * TS);
          if (gx >= 0 && gx < TS && gy >= 0 && gy < TS && m.glyph[(gy * TS + gx) * 4 + 3] > 128) col = [20, 20, 20];
        }
      }
      const i = (py * W + px) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
const ballMat = map => new THREE.MeshStandardMaterial({ map, roughness: 0.25, metalness: 0.05 });
const CUE_DOTS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  .map(dir => ({ dir, radius: 0.16, color: 0xd02828 }));
// 1〜8 の色。9〜15 は白地に n−8 の色の帯
const BALL_COLORS = [0xf5c400, 0x1f4fbf, 0xd0231f, 0x5b2a86, 0xf26a1b, 0x137a3a, 0x7a1f1f, 0x141414];
const ballColor = n => BALL_COLORS[(n - 1) % 8];
const obTextures = new Map();
function obTexture(n) {
  if (!obTextures.has(n)) {
    const marks = [[0, 0, 1], [0, 0, -1]].map(dir => ({ dir, radius: 0.38, color: 0xffffff, text: String(n) }));
    obTextures.set(n, n <= 8
      ? makeBallTexture(ballColor(n), marks)
      : makeBallTexture(0xf7f5ec, marks, { color: ballColor(n), h: 0.5 }));
  }
  return obTextures.get(n);
}

const obBall = new THREE.Mesh(ballGeo, ballMat(obTexture(1)));
obBall.castShadow = true;
scene.add(obBall);

const cueBall = new THREE.Mesh(ballGeo, ballMat(makeBallTexture(0xf7f5ec, CUE_DOTS)));
cueBall.castShadow = true;
scene.add(cueBall);

const cbLineMat = new LineMaterial({ color: 0xffffff, linewidth: 1.5, dashed: true, dashSize: 1.5, gapSize: 1, transparent: true, opacity: 0.8 });
const cbLine = new Line2(new LineGeometry(), cbLineMat);
cbLine.geometry.setPositions([0, 0, 0, 1, 0, 0]);
const cbBackDot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
scene.add(cbLine, cbBackDot);

// 接点ガイド: 手球上の接点（中心から的球の進行方向へ R）→ ゴーストと的球の接点
const cpLineMat = new LineMaterial({ color: 0x7dff6b, linewidth: 2 });
const cpLine = new Line2(new LineGeometry(), cpLineMat);
cpLine.geometry.setPositions([0, 0, 0, 1, 0, 0]);
const cpDotGeo = new THREE.SphereGeometry(1, 16, 12);
const cpDotMat = new THREE.MeshBasicMaterial({ color: 0x7dff6b });
const cpDots = [0, 1, 2].map(() => new THREE.Mesh(cpDotGeo, cpDotMat));
scene.add(cpLine, ...cpDots);

// 厚みの縦割り: 撞く方向に平行な鉛直面で球を切る。手球は縁から厚み 2w の位置で切って厚みの側を、
// ゴーストボールは同じ位置で切って的球と重ならない側を色付けする。
// 切り口の円は球越しに見えるよう depthTest なしで描く。
const thickSliceMat = new LineMaterial({ color: 0x7dff6b, linewidth: 2.5, depthTest: false, transparent: true });
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
function placeThickSplit(t, center, side, d, sign) {
  t.cap.position.copy(center);
  t.clip.set(side.clone().multiplyScalar(sign), -sign * (side.dot(center) + d));
  t.slice.position.copy(center).addScaledVector(side, d);
  t.slice.lookAt(t.slice.position.clone().add(side));
  t.slice.scale.setScalar(Math.max(Math.sqrt(Math.max(R * R - d * d, 0)), 1e-3));
}
const thickCue = makeThickSplit(0x7dff6b);
const thickGhost = makeThickSplit(0xff9f5a);
const thickParts = [thickCue, thickGhost].flatMap(t => [t.cap, t.slice]);
// 厚みの壁: 手球とゴーストの縦割り面は同一平面なので、その面に沿った薄い壁（+X 向き、原点が根元の下端）
const thickWall = (() => {
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
const TRI_Y = 0.05, ARC_N = 32;
const triMat = new LineMaterial({ color: 0x4fd1ff, linewidth: 2 });
const triThinMat = new LineMaterial({ color: 0x4fd1ff, linewidth: 1.5 });
function makeLine(n, mat) {
  const g = new LineGeometry();
  g.setPositions(new Array(n * 3).fill(0));
  const l = new Line2(g, mat);
  l.visible = false;
  scene.add(l);
  return l;
}
const triLine = makeLine(4, triMat);
const triRight = makeLine(3, triThinMat);
const triArc = makeLine(ARC_N + 1, triThinMat);
const TAN_MAX_PTS = 16;
const tanMat = new LineMaterial({ color: 0xff6bd6, linewidth: 2 });
const tanLine = makeLine(TAN_MAX_PTS, tanMat);
const tanEnd = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff6bd6 }));
tanEnd.visible = false;
scene.add(tanEnd);
// スロウ表示
const throwLineMat = new LineMaterial({ color: 0xff5a5a, linewidth: 2.5 });
const throwLine = makeLine(2, throwLineMat);
const compGhostMat = new THREE.MeshStandardMaterial({ color: 0x55ccff, roughness: 0.35, transparent: true, opacity: 0.4, depthWrite: false });
const compGhost = new THREE.Mesh(ballGeo, compGhostMat);
compGhost.renderOrder = 2;
compGhost.visible = false;
scene.add(compGhost);
const compAimLine = makeLine(2, new LineMaterial({ color: 0x55ccff, linewidth: 1.5, dashed: true, dashSize: 1.5, gapSize: 1 }));
const triLabelPos = new THREE.Vector3();
let triLabelVisible = false;

const ghostMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.35 });
const ghost = new THREE.Mesh(ballGeo, ghostMat);
ghost.castShadow = true;
scene.add(ghost);

// 透明時の補助表示
const ghostCenter = new THREE.Mesh(
  new THREE.SphereGeometry(0.22, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0x111111 })
);
scene.add(ghostCenter);

const outlineMat = new LineMaterial({ color: 0xf0f0f0, linewidth: 2 });
const outline = (() => {
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
const groundContact = new THREE.Mesh(unitSphere, new THREE.MeshBasicMaterial({ color: 0xff3b4e }));
const ballContact = new THREE.Mesh(unitSphere, new THREE.MeshBasicMaterial({ color: 0x2f8bff }));
scene.add(groundContact, ballContact);

// 接地点を中心とした半径 R の円（ボールの占有範囲をラシャ面に投影）
const groundRing = (() => {
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
const arrowGroup = new THREE.Group();
scene.add(arrowGroup);
const arrowMats = {
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
function makeWall(length, h, kind) {
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
function makeArrow(length, mat) {
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

function disposeGroup(group) {
  group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  group.clear();
}

// ---------- update ----------
const tmp = new THREE.Vector3();

function dirVec() {
  const a = THREE.MathUtils.degToRad(state.angle);
  return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
}

function ghostPos() {
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
function aimPoint(i) {
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

function updateScene() {
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
  groundContact.position.set(gp.x, 0, gp.z);
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
  $('tSpeedv').value = `${state.shotSpeed}（${shotSpeedMS().toFixed(1)}m/s）`;
  const f = state.throwFollow, sd = state.throwSide;
  $('tFollowv').value = f === 0 ? 'ストップ' : (f > 0 ? '押し' : '引き') + Math.abs(f);
  $('tSidev').value = sd === 0 ? 'なし' : (sd > 0 ? '右' : '左') + Math.abs(sd);

  scheduleAutosave();
}

function updateTriangle(gp, dir) {
  const on = state.triOn;
  triLine.visible = triRight.visible = triArc.visible = on;
  triLabelVisible = false;
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
  triLabelPos.set(G.x + Math.cos(mid) * lr, TRI_Y, G.z + Math.sin(mid) * lr);
  triLabelVisible = true;
  ui.triLabel.textContent = deg.toFixed(1) + '°';

  ui.triInfo.innerHTML = `ゴースト側の角 <b>${deg.toFixed(1)}°</b>　底辺 <b>${lenGF.toFixed(1)}cm</b>　高さ <b>${lenFC.toFixed(1)}cm</b>` +
    (t > 0 ? '（手球が的球側にあり、延長線の前方で交わります）' : '');
}

// 的球の移動距離: ポケット指定時は的球〜ポケット、手動時は的球〜クッション面
function obTravel(dir) {
  if (state.aim !== 'manual') {
    const [px, pz] = POCKETS[+state.aim];
    return Math.hypot(px - state.ob.x, pz - state.ob.z);
  }
  return rayToCushion(state.ob.x, state.ob.z, dir.x, dir.z).t;
}

// プレイエリア（クッション面から inset 内側）の矩形内から (dx,dz) 方向に進んだときに当たる壁
function rayToCushion(x, z, dx, dz, inset = 0) {
  const hx = TL / 2 - inset, hz = TW / 2 - inset;
  let t = Infinity, axis = null;
  if (dx > 1e-9) { const k = (hx - x) / dx; if (k < t) { t = k; axis = 'x'; } }
  if (dx < -1e-9) { const k = (-hx - x) / dx; if (k < t) { t = k; axis = 'x'; } }
  if (dz > 1e-9) { const k = (hz - z) / dz; if (k < t) { t = k; axis = 'z'; } }
  if (dz < -1e-9) { const k = (-hz - z) / dz; if (k < t) { t = k; axis = 'z'; } }
  return { t: Math.max(0, t), axis };
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

// ---------- throw (Alciatore TP A.14) ----------
// ボール間摩擦: μ(v_rel) = a + b·exp(−c·v_rel)  [m/s]
// スロウ角: θ = atan( min(μ·v·cosφ / v_rel, 1/7) · |接線方向の滑り| / (v·cosφ) )
const shotSpeedMS = () => 0.5 * state.shotSpeed;   // m/s
const R_M = R / 100;                           // ボール半径 [m]
const muBall = vr => 9.951e-3 + 0.108 * Math.exp(-1.088 * vr);

// 的球の進行方向 n（ゴースト→的球）と手球の進入方向 u に対するスロウ後の的球方向を返す
function throwResult(n, u) {
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

function approachDir(ghostX, ghostZ) {
  const u = new THREE.Vector3(ghostX - state.cb.x, 0, ghostZ - state.cb.z);
  return u.lengthSq() < 1e-9 ? null : u.normalize();
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
function updateTriLabel() {
  const el = ui.triLabel;
  if (!triLabelVisible) { el.hidden = true; return; }
  projV.copy(triLabelPos).project(camera);
  if (projV.z > 1 || projV.z < -1) { el.hidden = true; return; }
  el.hidden = false;
  el.style.left = ((projV.x + 1) / 2) * window.innerWidth + 'px';
  el.style.top = ((1 - projV.y) / 2) * window.innerHeight + 'px';
}

// 透視投影でのシルエット円（カメラから見た輪郭）を毎フレーム合わせる
function updateOutline() {
  if (!outline.visible) return;
  const c = ghost.position;
  tmp.subVectors(camera.position, c);
  const d = tmp.length();
  if (d <= R) { outline.visible = false; return; }
  tmp.normalize();
  const r = (R * Math.sqrt(d * d - R * R)) / d;
  outline.position.copy(c).addScaledVector(tmp, (R * R) / d);
  outline.scale.setScalar(r);
  outline.lookAt(camera.position);
}

// ---------- views ----------
const EYE_HALF_IPD = 3.2;   // cm
let currentView = null;
// 撞く方向 u（水平単位ベクトル）に対して、選んだ目の側へカメラをずらす
function applyEye(u) {
  const k = state.eye === 'left' ? -1 : state.eye === 'right' ? 1 : 0;
  camera.position.x += -u.z * EYE_HALF_IPD * k;
  camera.position.z += u.x * EYE_HALF_IPD * k;
}
function setView(kind) {
  currentView = kind;
  const dir = dirVec();
  const mid = ghostPos().add(state.ob).multiplyScalar(0.5);
  controls.target.copy(mid);
  if (kind === 'cue') {
    // 手球の真後ろからゴーストボール中心を見る。
    // 手球を見下ろす角 CAM_ELEV、ゴーストとの見下ろし角の差が VIEW_SPREAD 以内（画角 ±22.5° に収める）
    // になるよう後方距離を決める。最低でもボール4個分後方。
    const CAM_ELEV = THREE.MathUtils.degToRad(25), VIEW_SPREAD = THREE.MathUtils.degToRad(16);
    const gp = ghostPos();
    const u = new THREE.Vector3(gp.x - state.cb.x, 0, gp.z - state.cb.z);
    const D = u.length();
    if (D < 1e-6) u.copy(dir); else u.divideScalar(D);
    const tA = Math.tan(CAM_ELEV), tB = Math.tan(CAM_ELEV - VIEW_SPREAD);
    const back = Math.max(8 * R, (D * tB) / (tA - tB));
    controls.target.copy(gp);
    camera.position.copy(state.cb).addScaledVector(u, -back);
    camera.position.y = R + back * tA;
    applyEye(u);
  } else if (kind === 'top') {
    camera.position.set(mid.x, 90, mid.z + 0.01);
  } else if (kind === 'side') {
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    camera.position.copy(mid).addScaledVector(perp, 40);
    camera.position.y = R + 0.5;
  } else {
    // ゴーストボールの真後ろ（手球→ゴーストの延長線上）から、ボール中心の高さで水平に見る（厚みの確認用）。
    // 手球が視線をさえぎらないよう、手球が近いときはゴースト寄りにカメラを置く
    const gp = ghostPos();
    const u = new THREE.Vector3(gp.x - state.cb.x, 0, gp.z - state.cb.z);
    const D = u.length();
    if (D < 1e-6) u.copy(dir); else u.divideScalar(D);
    const back = Math.min(6 * R, Math.max(D - 1.3 * R, 1.5 * R));
    controls.target.copy(gp);
    camera.position.copy(gp).addScaledVector(u, -back);
    camera.position.y = R;
    applyEye(u);
  }
  controls.update();
  scheduleAutosave();
}

// ---------- UI ----------
const $ = id => document.getElementById(id);
const ui = {
  aim: $('aim'), ang: $('ang'), angv: $('angv'),
  cutInfo: $('cutInfo'),
  triInfo: $('triInfo'), triLabel: $('triLabel'), tanInfo: $('tanInfo'), throwInfo: $('throwInfo'), simInfo: $('simInfo'),
};

$('aimCushion').addEventListener('change', e => { state.aimCushion = e.target.checked; updateScene(); });
$('cbLine').addEventListener('change', e => { state.cbLine = e.target.checked; updateScene(); });
$('cpLine').addEventListener('change', e => { state.cpLine = e.target.checked; updateScene(); });
$('thickOn').addEventListener('change', e => { state.thickOn = e.target.checked; updateScene(); });
$('thickWallOn').addEventListener('change', e => { state.thickWallOn = e.target.checked; updateScene(); });
$('triOn').addEventListener('change', e => { state.triOn = e.target.checked; updateScene(); });
$('tanOn').addEventListener('change', e => { state.tanOn = e.target.checked; updateScene(); });
$('throwOn').addEventListener('change', e => { state.throwOn = e.target.checked; updateScene(); });
$('tSpeed').addEventListener('input', e => { state.shotSpeed = +e.target.value; updateScene(); });
$('tFollow').addEventListener('input', e => { state.throwFollow = +e.target.value; updateScene(); });
$('tSide').addEventListener('input', e => { state.throwSide = +e.target.value; updateScene(); });
ui.aim.addEventListener('change', () => { state.aim = ui.aim.value; updateScene(); });
$('obNum').addEventListener('change', e => { state.obNumber = +e.target.value; updateScene(); });
document.querySelectorAll('input[name=eye]').forEach(el => el.addEventListener('change', () => {
  state.eye = el.value;
  if (currentView === 'cue' || currentView === 'behind') setView(currentView); else scheduleAutosave();
}));
function setManualAngle(deg) {
  state.aim = 'manual';
  ui.aim.value = 'manual';
  state.angle = Math.round((((deg % 360) + 360) % 360) * 100) / 100 % 360;
  ui.ang.value = state.angle;
  updateScene();
}
ui.ang.addEventListener('input', () => setManualAngle(+ui.ang.value));
// ±0.01° 。押し続けると連続で変化
for (const [id, delta] of [['angDec', -0.01], ['angInc', 0.01]]) {
  const btn = $(id);
  let timer = 0;
  const stop = () => { clearTimeout(timer); clearInterval(timer); timer = 0; };
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    stop();
    setManualAngle(state.angle + delta);
    timer = setTimeout(() => { timer = setInterval(() => setManualAngle(state.angle + delta), 50); }, 400);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, stop));
  btn.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setManualAngle(state.angle + delta); }
  });
}
$('transparent').addEventListener('change', e => { state.transparent = e.target.checked; updateScene(); });
$('arrowOn').addEventListener('change', e => { state.arrowOn = e.target.checked; syncArrowUI(); updateScene(); });
document.querySelectorAll('input[name=csize]').forEach(el =>
  el.addEventListener('change', () => { state.contactSize = +el.value; updateScene(); }));
document.querySelectorAll('input[name=acount]').forEach(el =>
  el.addEventListener('change', () => { state.arrowCount = +el.value; updateScene(); }));
document.querySelectorAll('input[name=astyle]').forEach(el =>
  el.addEventListener('change', () => { state.arrowStyle = el.value; updateScene(); }));
document.querySelectorAll('input[name=aheight]').forEach(el =>
  el.addEventListener('change', () => { state.arrowHeight = el.value; updateScene(); }));
document.querySelectorAll('input[name=grid]').forEach(el =>
  el.addEventListener('change', () => { state.grid = el.value; updateScene(); }));
$('viewBehind').addEventListener('click', () => {
  setView('behind');
});
$('viewCue').addEventListener('click', () => {
  setView('cue');
});
controls.addEventListener('change', () => scheduleAutosave());
$('viewTop').addEventListener('click', () => {
  setView('top');
});
$('viewSide').addEventListener('click', () => {
  setView('side');
});

// ---------- drag ----------
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

// ---------- persistence (Dexie / IndexedDB) ----------
const SNAPSHOT_KEYS = ['obNumber', 'eye', 'aim', 'angle', 'transparent', 'contactSize', 'arrowOn', 'arrowCount', 'arrowHeight', 'arrowStyle', 'aimCushion', 'grid', 'cbLine', 'cpLine', 'thickOn', 'thickWallOn', 'triOn', 'tanOn', 'throwOn', 'shotSpeed', 'throwFollow', 'throwSide', 'simLoop', 'simPause'];

function snapshot() {
  const o = { ob: { x: state.ob.x, z: state.ob.z }, cb: { x: state.cb.x, z: state.cb.z } };
  for (const k of SNAPSHOT_KEYS) o[k] = state[k];
  o.view = { pos: camera.position.toArray(), target: controls.target.toArray() };
  return o;
}

// 保存された視点を復元。視点情報のない旧データは「ゴースト後方」
function applyView(o) {
  if (o?.view?.pos && o.view.target) {
    controls.target.fromArray(o.view.target);
    camera.position.fromArray(o.view.pos);
    clampView();
    controls.update();
  } else {
    setView('behind');
  }
}

function applySnapshot(o) {
  if (!o) return;
  if (o.ob) state.ob.set(o.ob.x, R, o.ob.z);
  if (o.cb) state.cb.set(o.cb.x, R, o.cb.z);
  for (const k of SNAPSHOT_KEYS) if (k in o) state[k] = o[k];
  // 旧形式（3 段階: 0 遅い / 1 中 / 2 速い）の読み替え
  if (!('shotSpeed' in o) && 'throwSpeed' in o) state.shotSpeed = [1, 3, 7][o.throwSpeed] ?? 3;
  syncUI();
  syncArrowUI();
  updateScene();
}

// state → フォーム
function syncUI() {
  ui.aim.value = state.aim; ui.ang.value = state.angle;
  $('obNum').value = state.obNumber;
  $('cbLine').checked = state.cbLine;
  $('cpLine').checked = state.cpLine;
  $('thickOn').checked = state.thickOn;
  $('thickWallOn').checked = state.thickWallOn;
  $('aimCushion').checked = state.aimCushion;
  $('triOn').checked = state.triOn;
  $('tanOn').checked = state.tanOn;
  $('throwOn').checked = state.throwOn;
  $('simLoop').checked = state.simLoop;
  $('simPause').checked = state.simPause;
  $('tFollow').value = state.throwFollow;
  $('tSide').value = state.throwSide;
  $('transparent').checked = state.transparent;
  $('arrowOn').checked = state.arrowOn;
  const radio = (name, val) => {
    const el = document.querySelector(`input[name=${name}][value="${val}"]`);
    if (el) el.checked = true;
  };
  radio('eye', state.eye);
  radio('csize', state.contactSize);
  radio('acount', state.arrowCount);
  radio('aheight', state.arrowHeight);
  radio('astyle', state.arrowStyle);
  $('tSpeed').value = state.shotSpeed;
  radio('grid', state.grid);
}

let db = null;
try {
  db = new Dexie('ghostBallTrainer');
  db.version(1).stores({
    layouts: '++id, &name, updatedAt',
    kv: 'key',
  });
} catch (err) {
  db = null;
  $('saveMsg').textContent = '保存は使えません: ' + err.message;
}

let autosaveTimer = 0;
let restoring = true;   // 起動時の復元が終わるまで自動保存しない
// 視点のダンピング中は change が毎フレーム来るので、debounce ではなく間引き（発火時点の状態を保存）
function scheduleAutosave() {
  if (!db || restoring || autosaveTimer) return;
  autosaveTimer = setTimeout(() => {
    autosaveTimer = 0;
    db.kv.put({ key: 'last', value: snapshot() }).catch(() => {});
  }, 400);
}

async function renderSaveList() {
  const list = $('saveList');
  list.textContent = '';
  if (!db) return;
  const rows = await db.layouts.orderBy('updatedAt').reverse().toArray();
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '保存した配置はまだありません';
    list.append(li);
    return;
  }
  for (const row of rows) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = row.name;
    name.title = new Date(row.updatedAt).toLocaleString();
    const load = document.createElement('button');
    load.type = 'button';
    load.textContent = '読込';
    load.addEventListener('click', () => {
      applySnapshot(row.data);
      applyView(row.data);
      $('saveName').value = row.name;
      $('saveMsg').textContent = `「${row.name}」を読み込みました`;
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '削除';
    del.addEventListener('click', async () => {
      if (del.dataset.armed !== '1') {
        del.dataset.armed = '1';
        del.textContent = '本当に削除';
        setTimeout(() => { del.dataset.armed = ''; del.textContent = '削除'; }, 3000);
        return;
      }
      await db.layouts.delete(row.id);
      $('saveMsg').textContent = `「${row.name}」を削除しました`;
      renderSaveList();
    });
    li.append(name, load, del);
    list.append(li);
  }
}

$('saveBtn').addEventListener('click', async () => {
  if (!db) return;
  const name = $('saveName').value.trim();
  if (!name) { $('saveMsg').textContent = '配置名を入力してください'; return; }
  try {
    const data = snapshot(), updatedAt = Date.now();
    const existing = await db.layouts.where('name').equals(name).first();
    if (existing) await db.layouts.update(existing.id, { data, updatedAt });
    else await db.layouts.add({ name, data, updatedAt });
    $('saveMsg').textContent = `「${name}」を${existing ? '上書き' : '保存'}しました`;
    renderSaveList();
  } catch (err) {
    $('saveMsg').textContent = '保存に失敗しました: ' + err.message;
  }
});

async function restoreLast() {
  if (!db) return;
  try {
    const last = await db.kv.get('last');
    if (last) { applySnapshot(last.value); applyView(last.value); }
    await renderSaveList();
  } catch (err) {
    $('saveMsg').textContent = '保存データを読めません: ' + err.message;
  }
}

function syncArrowUI() {
  document.querySelectorAll('input[name=acount], input[name=aheight], input[name=astyle]').forEach(el => { el.disabled = !state.arrowOn; });
}

// ---------- simulation ----------
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
  const events = { firstHit: null, cushions: [0, 0], pocket: [null, null] };
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
    if (collideBalls(cb, ob) && events.firstHit === null) events.firstHit = t;
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

const trailMats = [
  new LineMaterial({ color: 0xf7f5ec, linewidth: 2, transparent: true, opacity: 0.85 }),
  new LineMaterial({ color: 0xf5c400, linewidth: 2, transparent: true, opacity: 0.85 }),
];
let sim = null;   // { frames, events, duration, t, trails }

function stopSim() {
  if (!sim) return;
  sim.trails.forEach(l => { scene.remove(l); l.geometry.dispose(); });
  sim = null;
  cueBall.visible = obBall.visible = true;
  cueBall.quaternion.identity();
  obBall.quaternion.identity();
}

function startSim() {
  updateScene();   // 配置に戻してから
  const res = runSimulation();
  if (!res) { ui.simInfo.textContent = '手球とゴーストボールが重なっていて撞けません'; return; }
  // 補助表示を隠す
  [ghost, ghostCenter, outline, groundContact, groundRing, ballContact, arrowGroup, cbLine, cbBackDot, cpLine, ...cpDots, ...thickParts, thickWall, triLine, triRight, triArc,
   tanLine, tanEnd, throwLine, compGhost, compAimLine].forEach(o => { o.visible = false; });
  triLabelVisible = false;
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
  const e = res.events;
  const fmt = (i, name) => e.pocket[i] !== null ? `${name}: ポケット` : `${name}: クッション ${e.cushions[i]} 回`;
  ui.simInfo.textContent = (e.firstHit === null ? '的球に当たりませんでした。' : '') +
    `${fmt(1, '的球')}　${fmt(0, '手球')}　（${res.duration.toFixed(1)} 秒）`;
}


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
function updatePocketLabels() {
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

const HIT_PAUSE = 0.5;   // 実時間 [s]

function tickSim(now) {
  if (!sim) return;
  const dt = (now - sim.last) / 1000;
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
}

$('simShot').addEventListener('click', startSim);
$('simReset').addEventListener('click', () => { updateScene(); ui.simInfo.textContent = 'リセットしました'; });
$('simLoop').addEventListener('change', e => { state.simLoop = e.target.checked; scheduleAutosave(); });
$('simPause').addEventListener('change', e => { state.simPause = e.target.checked; scheduleAutosave(); });

// ツールバーのプルダウン。1 つだけ開き、外側タップ・Esc・同じボタンで閉じる
const tools = [...document.querySelectorAll('.tool')];
let openMenu = null;
function closeMenu() {
  if (!openMenu) return;
  openMenu.menu.hidden = true;
  openMenu.btn.setAttribute('aria-expanded', 'false');
  openMenu = null;
  document.body.classList.remove('menu-open');
}
function showMenu(btn) {
  const menu = $(btn.dataset.menu);
  closeMenu();
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.maxHeight = `${window.innerHeight - r.bottom - 14}px`;
  openMenu = { btn, menu };
  document.body.classList.add('menu-open');
}
tools.forEach(btn => btn.addEventListener('click', () => {
  if (openMenu && openMenu.btn === btn) closeMenu(); else showMenu(btn);
}));
document.addEventListener('pointerdown', e => {
  if (openMenu && !openMenu.menu.contains(e.target) && !e.target.closest('.tool')) closeMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
// スマホのアドレスバー伸縮（高さだけの変化）では閉じない
let menuVW = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth !== menuVW) { menuVW = window.innerWidth; closeMenu(); }
  else if (openMenu) openMenu.menu.style.maxHeight = `${window.innerHeight - openMenu.btn.getBoundingClientRect().bottom - 14}px`;
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  outlineMat.resolution.set(w, h);
  gridMats.point.resolution.set(w, h);
  gridMats.half.resolution.set(w, h);
  cbLineMat.resolution.set(w, h);
  cpLineMat.resolution.set(w, h);
  thickSliceMat.resolution.set(w, h);
  triMat.resolution.set(w, h);
  triThinMat.resolution.set(w, h);
  tanMat.resolution.set(w, h);
  throwLineMat.resolution.set(w, h);
  trailMats.forEach(m => m.resolution.set(w, h));
  compAimLine.material.resolution.set(w, h);
}
window.addEventListener('resize', resize);

resize();
syncArrowUI();
updateScene();
setView('behind');
restoreLast().finally(() => { restoring = false; });

renderer.setAnimationLoop(now => {
  tickSim(now);
  controls.update();
  updateOutline();
  updateTriLabel();
  updatePocketLabels();
  renderer.render(scene, camera);
});
