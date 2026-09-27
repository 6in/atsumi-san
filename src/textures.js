import * as THREE from 'three';

// 回転が見えるよう球面に模様を描く。SphereGeometry の UV（正距円筒）の各画素を球面上の方向に戻し、
// 円形マーク（中心方向と角半径）の内側を塗るので極付近でも歪まない。text はマーク面に正対して描く。
// stripe: { color, h } を渡すと |y| < h の帯を塗る（ストライプボール）
export function makeBallTexture(base, marks, stripe = null) {
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
export const ballMat = map => new THREE.MeshStandardMaterial({ map, roughness: 0.25, metalness: 0.05 });
export const CUE_DOTS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  .map(dir => ({ dir, radius: 0.16, color: 0xd02828 }));
// 1〜8 の色。9〜15 は白地に n−8 の色の帯
const BALL_COLORS = [0xf5c400, 0x1f4fbf, 0xd0231f, 0x5b2a86, 0xf26a1b, 0x137a3a, 0x7a1f1f, 0x141414];
export const ballColor = n => BALL_COLORS[(n - 1) % 8];
const obTextures = new Map();
export function obTexture(n) {
  if (!obTextures.has(n)) {
    const marks = [[0, 0, 1], [0, 0, -1]].map(dir => ({ dir, radius: 0.38, color: 0xffffff, text: String(n) }));
    obTextures.set(n, n <= 8
      ? makeBallTexture(ballColor(n), marks)
      : makeBallTexture(0xf7f5ec, marks, { color: ballColor(n), h: 0.5 }));
  }
  return obTextures.get(n);
}
