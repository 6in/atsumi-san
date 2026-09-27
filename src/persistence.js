import Dexie from 'dexie';
import { R } from './constants.js';
import { state, SNAPSHOT_KEYS } from './state.js';
import { $ } from './dom.js';
import { camera, controls, clampView } from './scene.js';
import { updateScene } from './update.js';
import { setView } from './views.js';
import { syncUI, syncArrowUI } from './ui.js';

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
export function scheduleAutosave() {
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

export async function saveLayout() {
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
}

async function loadLast() {
  if (!db) return;
  try {
    const last = await db.kv.get('last');
    if (last) { applySnapshot(last.value); applyView(last.value); }
    await renderSaveList();
  } catch (err) {
    $('saveMsg').textContent = '保存データを読めません: ' + err.message;
  }
}

// 起動時の復元。終わるまで自動保存しない
export function restoreLast() {
  return loadLast().finally(() => { restoring = false; });
}
