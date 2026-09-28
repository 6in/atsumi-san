# CLAUDE.md

厚みさん — ビリヤードの厚み（ゴーストボール）練習用 3D ツール。Vite でビルド（`index.html` = HTML/CSS、`src/*.js` = ES modules）。
GitHub Pages で https://6in.github.io/atsumi-san/ に公開。main への push で `.github/workflows/pages.yml` が `dist/` をデプロイ
（Settings → Pages → Source は「GitHub Actions」）。`vite.config.js` は `base: './'`（Pages のサブパスと Capacitor の両方に対応）。

- `npm run dev` / `npm run build`（→ `dist/`）/ `npm run preview`
- アプリ: Capacitor 8（`capacitor.config.json`、appId `io.github.sixin.atsumisan`、アプリ名「厚みさん」、webDir `dist`）。
  `android/`・`ios/`（iOS は SPM、CocoaPods なし）をコミット。Web を変えたら `npm run cap:sync`（build + `cap sync`）。
  `npm run cap:android` / `cap:ios` で Android Studio / Xcode を開く。
  `.github/workflows/android.yml` が push ごとに debug APK をビルドし、Actions の成果物 `app-debug` に置く。
  main では Releases の `latest`（https://github.com/6in/atsumi-san/releases/download/latest/atsumi-san-debug.apk）を毎回作り直す。
  debug 署名は `android/app/debug.keystore`（コミット済みの debug 専用鍵）で固定し、上書きインストールできるようにしている。
  このコンテナは Google Maven / Gradle 配布元に届かないので Android のビルドは Actions で確認する。iOS のビルドは Mac の Xcode で。
- アイコン・スプラッシュ: 原本は `assets/icon.svg`（`#bg` ラシャの緑、`#fg` 的球・ゴースト・接点・ライン）。
  `node assets/render.mjs`（playwright。`CHROMIUM=/opt/pw-browsers/chromium`）で `assets/*.png` を書き出し、
  `npx @capacitor/assets generate --android --ios --iconBackgroundColor '#1f6e44' --iconBackgroundColorDark '#1f6e44' --splashBackgroundColor '#1b1e22' --splashBackgroundColorDark '#1b1e22'`
  で `android/`・`ios/` の各サイズを生成。前景は 1.25 倍で描画（アダプティブも @capacitor/assets が 16.7% インセットで見える範囲に収める）。
  Android 12 以降のシステムスプラッシュ背景は `styles.xml` の `windowSplashScreenBackground`。Web 用は `public/favicon.png`・`apple-touch-icon.png`（`assets/icon-only.png` を縮小）。

## 利用者について

- 回答は日本語でシンプルに。複数の確認事項は AskUserQuestion でまとめて聞く。
- UI の文言はすべて日本語。

## 技術構成

- Three.js r160（npm、`three/addons/...` で import）、OrbitControls、Line2/LineMaterial/LineGeometry
- Dexie.js 4.4.6（npm）。DB 名 `ghostBallTrainer`、`layouts`（名前付き保存）と `kv`（`last` に自動保存）
- 単位は **cm**（シミュレーションだけ m）。y が上、ラシャ面が y=0、X が台の長辺（TL=254）、Z が短辺（TW=127）。
- ポケット `POCKETS[0..5]` = A〜F。真上視点で A 左上 / B 上サイド / C 右上 / D 左下 / E 下サイド / F 右下（−Z が画面上）。

## 構成

- `index.html`: 上部ツールバー `#bar`（`.tool` ボタン → プルダウン `.menu#mBall/mGuide/mThick/mArrow/mShot/mView/mSave`）、
  ショット/停止 `#actions`（`#bar` の外。`#bar` の backdrop-filter が fixed の基準になるため）、左下の数値表示 `#hud`。
  コントロールは ID でイベントを結んでいるので、配置を変えても ID は維持する。
  末尾の classic script: `setPointerCapture` の NotFoundError を無視するラッパーと、エラー表示（読み込み失敗は常時、実行時エラーは 6 秒で消す）。

`src/`（3D オブジェクトと DOM 要素は import 時に生成、イベント登録は `init*()` を `main.js` から呼ぶ。
モジュールは循環 import しているので、他モジュールの `const` をトップレベルで参照しない。別モジュールから書き換える値はオブジェクトか関数で渡す）

- `main.js`: 初期化順序、`resize()`（LineMaterial の resolution 更新。Line 系マテリアルを足したらここにも追加）、描画ループ。
- `constants.js`: 球半径 `R`、台寸法、クッション/ジョー角（コーナー 142°、サイド 104°）、ポケット穴 `PC`/`PS`。
  切り欠き `GAP_C`/`GAP_S` は「台形クッションの奥の角がポケット穴の外周に接する」長さとして算出し、狙い点とシミュレーションも同じ値を使う。
- `state.js`: `state`（全設定）と `SNAPSHOT_KEYS`（永続化対象）。新しい設定を足すときは state・SNAPSHOT_KEYS・`syncUI()`・`initUI()` のイベントの 4 か所。
- `dom.js`: `$()`、`ui`（よく使う要素）。
- `scene.js`: renderer / scene / camera / OrbitControls / ライト、`clampView()`。
- `table.js`: `buildTable()`（クッション・レール・ポケット・ダイヤモンド）とグリッド。
- `textures.js`: `makeBallTexture()`（UV の各画素を球面方向に戻して模様を描く。1〜15 番・ストライプ対応）、`obTexture()`。
- `objects.js`: ボール・ゴースト・各ガイド（ライン、厚みの縦割り/壁、三角形、タンジェント、スロウ、矢印）の Mesh/Line。
- `aim.js`: `dirVec()`、`ghostPos()`、`aimPoint()`（クッションを考慮した狙い点）、`rayToCushion()`、`obTravel()`、`approachDir()`。
- `update.js`: `updateScene()` が表示全体の更新の入口（シミュレーション停止も兼ねる）。三角形・タンジェント・スロウの表示、毎フレームの `updateOutline()` / `updateTriLabel()`。
  厚み: 手球後方から見た接点ラインの横ずれ R·sinθ、縁〜接点ライン w = R(1−sinθ)、厚み = 2w。
  縦割り面は球中心から R(2sinθ−1)。手球とゴーストの縦割り面は同一平面で、的球はその面に接する（厚みの壁の終点）。
- `throw.js`: Alciatore TP A.14（μ(v_rel) = 0.00995 + 0.108·e^(−1.088·v_rel)）。`throwResult()`、`shotSpeedMS()`、`R_M`。
- `views.js`: `setView(kind)`（cue / behind / top / side）。cue・behind は撞く方向に沿った視点で、`applyEye()` が利き目（±3.2cm）を反映。
  behind はゴーストの真後ろ・球中心の高さから水平に見る。
- `ui.js`: `initUI()`（フォーム・ボタンのイベント）、`syncUI()`（state → フォーム）、`syncArrowUI()`。
- `menu.js`: ツールバーのプルダウン開閉。 `drag.js`: ボールのドラッグ。 `labels.js`: ポケットラベル A〜F。
- `persistence.js`: `snapshot()` / `applySnapshot()`（旧形式の読み替えもここ）/ `scheduleAutosave()`（400ms 間引き）/ `saveLayout()` / `restoreLast()`。
- `xr.js`: VR（WebXR `immersive-vr`、Quest / Vision Pro 想定）。対応端末でだけ `#vrBtn` を表示。
  シーンは cm のまま、カメラとコントローラーを 100 倍したリグに入れて実物大（床からラシャ面 70cm、台の +Z 側の長辺の横に立つ）。
  `local-floor` を優先し、使えなければ `local`。XR の near/far はメートル（開始時に 0.02 / 50 にし、終了時に戻す）。
  リグ拡大で three.js の両目まとめた視錐台がずれて近くの物体が消えるので、VR 中は毎フレーム `frustumCulled = false`。
  操作は select で統一（Quest のトリガー / Vision Pro の視線＋ピンチ）。入力は 4 つまで受ける（hand-tracking を要求すると Vision Pro の
  視線＋ピンチが 3 番目以降になるため要求しない）: ボールに当てて押している間ドラッグ（`drag.js` の `placeBall()` を共用）、
  浮いているパネル（キャンバス描画、カット角・結果表示）の「ショット」「停止」ボタン。Quest のグリップでもショット。
  パネルの「手前」「奥」「手球の後ろ」で立ち位置を切り替える（`applyStance()`。今の頭の位置・向きを打ち消してリグを動かし、パネルも付いてくる）。
  Vision Pro は開始位置から歩いて離れると現実の風景が重なる（OS の安全機能で止められない）ので、歩かずに移動できるようにしている。
- `simulation.js`: 2D 剛体（dt 0.5ms、最大 20 秒）。`runSimulation()` が位置と姿勢クォータニオン（角速度を積分）を記録し、
  `tickSim()` が補間再生。最初の衝突時刻 `events.firstHit` で 0.5 秒停止（オプション）。
  衝突位置 `events.hitPos`（中心の中点）に接点 `simContact` を当たった瞬間から表示（色は的球の色の明るさで青か白を自動選択）。再生中は手球を `simCueAlpha`（%）だけ透過（`applySimCueAlpha()`）。速さは 1〜10 段階で、10 は長辺を二往復する初速 8.31 m/s（`throw.js` の `SPEED_MAX`、中央撞点で頭側クッションから撞いて頭側クッションで止まる速さをシミュレーションのモデルで逆算）。

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

- 内部状態を触りたいときは、`src/main.js` の `renderer.setAnimationLoop(` の直前に一時的に（必要な名前を import して）
  `Object.assign(window, { __cam: camera, __ctl: controls, __state: state, __update: updateScene });` を差し込む（コミットしない）。
- PC（1280×800）とスマホ（390×844、360×740、横 844×390、`hasTouch/isMobile`）で確認する。
- UI の変更はスクリーンショットで目視確認してから報告する。

## Artifact

公開中: https://claude.ai/artifact/QKrF6MBY5uP7hAAUDfu6fH
更新は `npm run build` 後、`dist/index.html` を page、`dist/assets/*` を `files`（公開パス `assets/xxx.js`）として、Artifact ツールで `url` にこの URL を渡して publish（別会話からは先に read が必要）。古いハッシュ名のファイルは `null` で消す。

## 検討中の課題

- VR 対応（WebXR）: 見る・ショット・配置まで実装（`xr.js`）。Quest 3 エミュレーター（npm の `iwer`、`installRuntime({ forceInstall: true })`
  を esbuild で IIFE にして Playwright の `addInitScript` で注入）で動作確認済み。
  Vision Pro 実機で配置・ショット・再生を確認済み。次の候補: ガイド表示の切り替え、撞点・速さの調整、MR（パススルー）。
- アプリ化（Capacitor）: 導入済み。Android は Releases の debug APK で実機確認済み（表示・保存・タッチ操作とも問題なし）。
  iOS の実機確認、リリース署名（Play App Signing 用アップロード鍵）とストア公開が残り。
  Google Play は新規の個人アカウントだとクローズドテスト（テスター 12 人・14 日間）が必要。
