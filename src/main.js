import { renderer, scene, camera, controls } from './scene.js';
import { gridMats } from './table.js';
import {
  outlineMat, cbLineMat, cpLineMat, thickSliceMat, triMat, triThinMat, tanMat, throwLineMat, compAimLine,
} from './objects.js';
import { updateScene, updateTriLabel, updateOutline } from './update.js';
import { setView } from './views.js';
import { initUI, syncArrowUI } from './ui.js';
import { initMenu } from './menu.js';
import { initDrag } from './drag.js';
import { restoreLast } from './persistence.js';
import { trailMats, tickSim } from './simulation.js';
import { updatePocketLabels } from './labels.js';

initUI();
initDrag();
initMenu();

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
restoreLast();

renderer.setAnimationLoop(now => {
  tickSim(now);
  controls.update();
  updateOutline();
  updateTriLabel();
  updatePocketLabels();
  renderer.render(scene, camera);
});
