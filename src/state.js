import * as THREE from 'three';
import { R } from './constants.js';

export const state = {
  ob: new THREE.Vector3(40, R, -20),
  cb: new THREE.Vector3(-50, R, 20),
  cbLine: true,
  cpLine: false,
  thickOn: false,
  thickWallOn: false,
  triOn: false,
  tanOn: false,
  throwOn: false,
  shotSpeed: 3,      // 1〜10。10 で長辺を一往復する初速（throw.js の SPEED_MAX）
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

// 保存・復元の対象（新しい設定を足すときは state・SNAPSHOT_KEYS・syncUI()・イベントの 4 か所）
export const SNAPSHOT_KEYS = ['obNumber', 'eye', 'aim', 'angle', 'transparent', 'contactSize', 'arrowOn', 'arrowCount', 'arrowHeight', 'arrowStyle', 'aimCushion', 'grid', 'cbLine', 'cpLine', 'thickOn', 'thickWallOn', 'triOn', 'tanOn', 'throwOn', 'shotSpeed', 'throwFollow', 'throwSide', 'simLoop', 'simPause'];
