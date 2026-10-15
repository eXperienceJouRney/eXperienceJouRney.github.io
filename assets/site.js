/* ═══════════════════════════════════════════════════════════════
   个人主页脚本 · site.js
   只做渐进增强：没有 JS 时页面内容照常可读、链接照常可用。
   1) 主题切换（跟随系统 / 日间 / 夜间）
   2) 滚动入场动画
   3) 回到顶部按钮
   4) 页脚年份
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';

var root = document.documentElement;
var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── 1) 主题 ─────────────────────────────────────────── */
var KEY = 'site-theme';
var ORDER = ['auto', 'light', 'dark'];
var LABEL = { auto: '跟随系统', light: '日间', dark: '夜间' };
var GLYPH = { auto: '◐', light: '☀', dark: '☾' };

var themeBtn = document.getElementById('themeBtn');
var themeIcon = document.getElementById('themeIcon');

function readMode() {
  try {
    var v = localStorage.getItem(KEY);
    return (v === 'light' || v === 'dark') ? v : 'auto';
  } catch (e) { return 'auto'; }
}

/* 顶栏毛玻璃下面透出的颜色，让手机浏览器地址栏跟着变 */
function paintMeta() {
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  var bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (bg) meta.setAttribute('content', bg);
}

function applyMode(mode, persist) {
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);

  if (themeIcon) themeIcon.textContent = GLYPH[mode];
  if (themeBtn) {
    themeBtn.title = '主题：' + LABEL[mode] + '（点击切换）';
    themeBtn.setAttribute('aria-label', themeBtn.title);
  }
  if (persist) {
    try {
      if (mode === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch (e) { /* 隐私模式下写不了，忽略 */ }
  }
  paintMeta();
}

/* 页面顶部的内联脚本已经先把 data-theme 抹上，避免闪白；
   这里只把按钮的图标和标题对齐到当前状态。 */
var mode = readMode();
applyMode(mode, false);   // 不写回：内联脚本已经读过了

if (themeBtn) {
  themeBtn.addEventListener('click', function () {
    mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    applyMode(mode, true);
  });
}

/* 系统配色变了而用户没手动指定时，刷新一下 theme-color */
if (window.matchMedia) {
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var onSysChange = function () { if (readMode() === 'auto') paintMeta(); };
  if (mq.addEventListener) mq.addEventListener('change', onSysChange);
  else if (mq.addListener) mq.addListener(onSysChange);
}

/* ── 2) 入场动画 ─────────────────────────────────────── */
var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

function showAll() {
  for (var i = 0; i < reveals.length; i++) reveals[i].classList.add('in');
}

if (reduce || !('IntersectionObserver' in window)) {
  showAll();
} else {
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      io.unobserve(en.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  reveals.forEach(function (el) { io.observe(el); });
  /* 兜底：万一观察器没触发，1.5 秒后全部显示，绝不让内容卡在隐藏状态 */
  setTimeout(showAll, 1500);
}

/* ── 3) 回到顶部 ─────────────────────────────────────── */
var backtop = document.getElementById('backtop');
if (backtop) {
  var ticking = false;
  var sync = function () {
    backtop.hidden = window.scrollY < 520;
    ticking = false;
  };
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(sync);
  }, { passive: true });
  sync();

  backtop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });
}

/* ── 4) 年份 ─────────────────────────────────────────── */
var yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

})();
