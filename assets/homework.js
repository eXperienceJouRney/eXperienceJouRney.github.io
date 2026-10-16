/* ═══════════════════════════════════════════════════════════════
   作业页脚本 · homework.js
   渐进增强三件事，没有 JS 时页面与悬停显示答案都照常可用：
   1) 「始终显示答案」按钮（选择记进 localStorage）
   2) 带 #q2 直接打开时补一次定位（全站 html{scroll-behavior:smooth}
      会让浏览器跳过加载时的首次锚点滚动）
   3) 题目导航圆片跟着滚动高亮
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';

var KEY = 'hw-show-answers';
var root = document.documentElement;
var btn = document.getElementById('hwToggle');

/* ── 1) 始终显示 / 悬停显示 ─────────────────────────── */
function sync(on) {
  root.classList.toggle('hw-show', on);
  if (!btn) return;
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.title = on ? '当前：始终显示答案（点击改为悬停显示）'
                 : '当前：鼠标移入显示（点击改为始终显示）';
  var txt = btn.querySelector('.hw-toggle-txt');
  if (txt) txt.textContent = on ? '改为悬停显示' : '始终显示答案';
}

if (btn) {
  btn.addEventListener('click', function () {
    var on = !root.classList.contains('hw-show');
    sync(on);
    try {
      if (on) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch (e) { /* 隐私模式写不了，忽略 */ }
  });
}

/* 内联脚本已经在绘制前把 localStorage 里的状态抹上了，这里只对齐按钮文案 */
sync(root.classList.contains('hw-show'));

/* ── 2) 带锚点直接打开时补一次定位 ───────────────────── */
if (location.hash.length > 1) {
  var target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target) {
    var jump = function () {
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
    };
    window.addEventListener('load', function () { setTimeout(jump, 0); });
    setTimeout(jump, 300);
  }
}

/* ── 3) 题目导航：滚到哪一题，哪个圆片变色 ───────────── */
var chips = Array.prototype.slice.call(document.querySelectorAll('.hw-nav a'));
if (chips.length && 'IntersectionObserver' in window) {
  var targets = chips.map(function (a) {
    return document.querySelector(a.getAttribute('href'));
  }).filter(Boolean);

  var setActive = function (id) {
    chips.forEach(function (a) {
      var on = a.getAttribute('href') === '#' + id;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  };

  /* 判定带：工具条下方那一条横带，谁在里面谁是当前题 */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) setActive(en.target.id); });
  }, { rootMargin: '-140px 0px -60% 0px', threshold: 0 });
  targets.forEach(function (t) { io.observe(t); });
}

})();
