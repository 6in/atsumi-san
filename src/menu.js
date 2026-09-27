import { $ } from './dom.js';

// ツールバーのプルダウン。1 つだけ開き、外側タップ・Esc・同じボタンで閉じる
let openMenu = null;
function closeMenu() {
  if (!openMenu) return;
  openMenu.menu.hidden = true;
  openMenu.btn.setAttribute('aria-expanded', 'false');
  openMenu = null;
  document.body.classList.remove('menu-open');
}
function showMenu(btn) {
  const menu = $(btn.dataset.menu);
  closeMenu();
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.maxHeight = `${window.innerHeight - r.bottom - 14}px`;
  openMenu = { btn, menu };
  document.body.classList.add('menu-open');
}

export function initMenu() {
  const tools = [...document.querySelectorAll('.tool')];
  tools.forEach(btn => btn.addEventListener('click', () => {
    if (openMenu && openMenu.btn === btn) closeMenu(); else showMenu(btn);
  }));
  document.addEventListener('pointerdown', e => {
    if (openMenu && !openMenu.menu.contains(e.target) && !e.target.closest('.tool')) closeMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  // スマホのアドレスバー伸縮（高さだけの変化）では閉じない
  let menuVW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth !== menuVW) { menuVW = window.innerWidth; closeMenu(); }
    else if (openMenu) openMenu.menu.style.maxHeight = `${window.innerHeight - openMenu.btn.getBoundingClientRect().bottom - 14}px`;
  });
}
