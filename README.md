# atsumi-san

厚みさん３ — ビリヤードの厚み（ゴーストボール）練習用 3D ツール。

Vite でビルドします（Three.js / Dexie.js は npm から同梱）。

```sh
npm ci
npm run dev      # 開発サーバー
npm run build    # dist/ に出力
```

main への push で GitHub Actions が GitHub Pages にデプロイします。

- 的球・手球は台上でドラッグして配置
- ゴーストボール、接点、厚みの縦割り・壁、タンジェントライン、スロウ表示
- ショットのシミュレーションと再生（回転の表示付き）
- 配置と表示設定は IndexedDB に保存
