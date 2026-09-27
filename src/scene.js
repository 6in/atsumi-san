import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const container = document.getElementById('view');
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.localClippingEnabled = true;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1e22);

export const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 3000);
export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.minDistance = 6;
controls.maxDistance = 600;
controls.maxPolarAngle = Math.PI / 2 - 0.01;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
controls.screenSpacePanning = false;   // パンは水平面内（注視点が台の下に潜らない）

// 視点が台の下に入らないよう、注視点とカメラの高さを制限する
const MIN_CAM_Y = 1.0;
export function clampView() {
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
