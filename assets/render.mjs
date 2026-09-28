import { chromium } from 'playwright';
import fs from 'fs';
// assets/icon.svg から @capacitor/assets 用の PNG を書き出す（playwright が必要: npm i -D playwright 等）
const A = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const svg = fs.readFileSync(`${A}/icon.svg`, 'utf8');
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
async function render(html, w, h, out, transparent = false) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:${transparent ? 'transparent' : '#000'}}svg{display:block}</style></head><body>${html}</body></html>`);
  await p.waitForTimeout(200);
  await p.screenshot({ path: out, omitBackground: transparent });
  await p.close();
}
// 前景を 1.25 倍（@capacitor/assets はアダプティブ前景を 16.7% インセットして見える範囲に収めるので、全面表示と同じ扱い）
const full = svg.replace('<g id="fg">', '<g id="fg" transform="translate(512 512) scale(1.25) translate(-512 -512)">');
const only = (keep) => full.replace(keep === 'fg' ? /<g id="bg">[\s\S]*?<\/g>/ : /<g id="fg"[^>]*>[\s\S]*<\/g>\s*(?=<\/svg>)/, '');
await render(full, 1024, 1024, `${A}/icon-only.png`);
await render(only('fg'), 1024, 1024, `${A}/icon-foreground.png`, true);
await render(only('bg'), 1024, 1024, `${A}/icon-background.png`);
// スプラッシュ: アプリ背景色の上に丸く切り抜いたアイコンと名前
const splash = bg => `<div style="width:2732px;height:2732px;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:90px">
  <div style="width:720px;height:720px;border-radius:50%;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45)">${full.replace('width="1024" height="1024"', 'width="720" height="720"')}</div>
  <div style="font:700 150px 'IPAGothic',sans-serif;color:#f2f2f2;letter-spacing:12px">厚みさん</div></div>`;
await render(splash('#1b1e22'), 2732, 2732, `${A}/splash.png`);
await render(splash('#1b1e22'), 2732, 2732, `${A}/splash-dark.png`);
await b.close();
