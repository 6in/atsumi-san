# CLAUDE.md

厚みさん３ — ビリヤードの厚み（ゴーストボール）練習用 3D ツール。Vite でビルド（`index.html` = HTML/CSS、`src/main.js` = JS）。
GitHub Pages で https://6in.github.io/atsumi-san/ に公開。main への push で `.github/workflows/pages.yml` が `dist/` をデプロイ
（Settings → Pages → Source は「GitHub Actions」）。`vite.config.js` は `base: './'`（Pages のサブパスと Capacitor の両方に対応）。

- `npm run dev` / `npm run build`（→ `dist/`）/ `npm run preview`

## 利用者について

- 回答は日本語でシンプルに。複数の確認事項は AskUserQuestion でまとめて聞く。
- UI の文言はすべて日本語。

## 技術構成

- Three.js r160（npm、`three/addons/...` で import）、OrbitControls、Line2/LineMaterial/LineGeometry
- Dexie.js 4.4.6（npm）。DB 名 `ghostBallTrainer`、`layouts`（名前付き保存）と `kv`（`last` に自動保存）
- 単位は **cm**（シミュレーションだけ m）。y が上、ラシャ面が y=0、X が台の長辺（TL=254）、Z が短辺（TW=127）。
- ポケット `POCKETS[0..5]` = A〜F。真上視点で A 左上 / B 上サイド / C 右上 / D 左下 / E 下サイド / F 右下（−Z が画面上）。

## index.html / src/main.js の構成（JS は `// ---------- xxx ----------` で区切り）

- HTML: 上部ツールバー `#bar`（`.tool` ボタン → プルダウン `.menu#mBall/mGuide/mThick/mArrow/mShot/mView/mSave`）、
  ショット/停止 `#actions`（`#bar` の外。`#bar` の backdrop-filter が fixed の基準になるため）、左下の数値表示 `#hud`。
  コントロールは ID でイベントを結んでいるので、配置を変えても ID は維持する。
- 定数: 球半径 `R`、台寸法、クッション/ジョー角（コーナー 142°、サイド 104°）、ポケット穴 `PC`/`PS`。
  切り欠き `GAP_C`/`GAP_S` は「台形クッションの奥の角がポケット穴の外周に接する」長さとして算出し、狙い点とシミュレーションも同じ値を使う。
- `state`: 全設定。永続化対象は `SNAPSHOT_KEYS`。新しい設定を足すときは state・SNAPSHOT_KEYS・`syncUI()`・イベントの 4 か所。
- table / grid / balls: `buildTable()`、`makeBallTexture()`（UV の各画素を球面方向に戻して模様を描く。1〜15 番・ストライプ対応）。
- update: `updateScene()` が表示全体の更新の入口（シミュレーション停止も兼ねる）。`ghostPos()`、`aimPoint()`（クッションを考慮した狙い点）。
- 厚み: 手球後方から見た接点ラインの横ずれ R·sinθ、縁〜接点ライン w = R(1−sinθ)、厚み = 2w。
  縦割り面は球中心から R(2sinθ−1)。手球とゴーストの縦割り面は同一平面で、的球はその面に接する（厚みの壁の終点）。
- throw: Alciatore TP A.14（μ(v_rel) = 0.00995 + 0.108·e^(−1.088·v_rel)）。
- views: `setView(kind)`（cue / behind / top / side）。cue・behind は撞く方向に沿った視点で、`applyEye()` が利き目（±3.2cm）を反映。
  behind はゴーストの真後ろ・球中心の高さから水平に見る。
- persistence: `snapshot()` / `applySnapshot()`（旧形式の読み替えもここ）/ `scheduleAutosave()`（400ms 間引き）。
- simulation: 2D 剛体（dt 0.5ms、最大 20 秒）。`runSimulation()` が位置と姿勢クォータニオン（角速度を積分）を記録し、
  `tickSim()` が補間再生。最初の衝突時刻 `events.firstHit` で 0.5 秒停止（オプション）。速さは 1〜10 段階 × 0.5 m/s。
- `index.html` 末尾の classic script: `setPointerCapture` の NotFoundError を無視するラッパーと、エラー表示（読み込み失敗は常時、実行時エラーは 6 秒で消す）。

## 動作確認

`npm run build` 後に `npx vite preview --port 4173` で `dist/` を配信し、Playwright で開く（CDN 依存はないのでルーティング不要）。

```js
// scratchpad で: npm i playwright@1
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto('http://localhost:4173/');
```

- 内部状態を触りたいときは、`src/main.js` の `renderer.setAnimationLoop(` の直前に一時的に
  `Object.assign(window, { __cam: camera, __ctl: controls, __state: state, __update: updateScene });` を差し込む（コミットしない）。
- PC（1280×800）とスマホ（390×844、360×740、横 844×390、`hasTouch/isMobile`）で確認する。
- UI の変更はスクリーンショットで目視確認してから報告する。

## Artifact

公開中: https://claude.ai/artifact/QKrF6MBY5uP7hAAUDfu6fH
更新は `npm run build` 後、`dist/index.html` を page、`dist/assets/*` を `files`（公開パス `assets/xxx.js`）として、Artifact ツールで `url` にこの URL を渡して publish（別会話からは先に read が必要）。古いハッシュ名のファイルは `null` で消す。

## 検討中の課題

- VR 対応（WebXR）: three.js の `renderer.xr` + VRButton。シーンを 1/100 して実物大、台の高さ約 80cm。
  VR 中は HTML メニューが出ないので、まずは「見る＋ショット」のみ。Artifact の埋め込みでは XR が許可されない可能性があり、Pages で試す。
- アプリ化（Capacitor）: Vite 導入済み（three/dexie は同梱）。次は `src/main.js` のファイル分割、その後 Capacitor で iOS/Android。
