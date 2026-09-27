import * as THREE from 'three';

// 単位: cm。y が上方向、ラシャ面が y=0。X は台の長手方向、Z は短手方向。
export const R = 5.715 / 2;             // ボール半径
export const TL = 254, TW = 127;        // プレイエリア（9ft）
export const CUSHION_H = 3.6, CUSHION_W = 5;
export const RAIL_W = 14, RAIL_H = 4.4;
export const CONTACT_SIZES = [0.25, 0.45, 0.75];
export const PIERCE_WIDTHS = [1.2, 2, 3.5];   // 貫き線の太さ [px]（接点サイズに連動）
export const PIERCE_TAIL = 6 * R;             // 手球背面からさらに後方へ伸ばす長さ
export const ARROW_TOP_Y = 2 * R + 0.8;

// ポケットの穴: 中心の外側オフセット d と半径 r
export const PC = { d: 3.4, r: 6.2 }, PS = { d: 4.2, r: 5.8 };
// ジョー角: コーナー 142°、サイド 104°（クッション面とジョー面のなす角）。
// クッション奥（レール側）での端のずれ = 奥行 / tan(180° − ジョー角)
export const CUT_C = CUSHION_W / Math.tan(THREE.MathUtils.degToRad(180 - 142));
export const CUT_S = CUSHION_W / Math.tan(THREE.MathUtils.degToRad(180 - 104));
// クッション切り欠き（コーナーは角から、サイドは中央から）。台形の奥の角が穴の外周に触れる長さにする
export const GAP_C = CUT_C - PC.d + Math.sqrt(PC.r ** 2 - (CUSHION_W - PC.d) ** 2);
export const GAP_S = CUT_S + Math.sqrt(PS.r ** 2 - (CUSHION_W - PS.d) ** 2);
export const POCKETS = [
  [-TL / 2, -TW / 2], [0, -TW / 2 - 1.5], [TL / 2, -TW / 2],
  [-TL / 2,  TW / 2], [0,  TW / 2 + 1.5], [TL / 2,  TW / 2],
];
