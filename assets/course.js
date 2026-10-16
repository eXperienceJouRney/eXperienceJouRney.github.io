/* ═══════════════════════════════════════════════════════════════
   讲义页脚本 · course.js
   只做两件渐进增强的事：没有 JS，正文、配图、目录链接全都照常能用。
   1) 点配图放大看原图
   2) 把左侧目录里当前这一节滚进视野
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ── 1) 点图放大 ─────────────────────────────────────── */
var figs = Array.prototype.slice.call(document.querySelectorAll('.fig img'));
if (figs.length) {
  var box = document.createElement('div');
  box.className = 'lightbox';
  box.hidden = true;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', '放大的配图');
  var big = document.createElement('img');
  box.appendChild(big);
  document.body.appendChild(box);

  var close = function () {
    box.hidden = true;
    big.removeAttribute('src');
  };
  var open = function (img) {
    big.src = img.currentSrc || img.src;
    box.hidden = false;
  };

  figs.forEach(function (img) {
    var link = img.closest('a');
    if (link) {
      /* 保留新标签页打开原图的能力，同时接管左键点击 */
      link.addEventListener('click', function (ev) {
        ev.preventDefault();
        open(img);
      });
    } else {
      img.addEventListener('click', function () { open(img); });
    }
  });

  box.addEventListener('click', close);
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !box.hidden) close();
  });
}

/* ── 2) 当前小节滚进目录视野 ─────────────────────────── */
var pane = document.querySelector('.doc-toc');
var here = document.querySelector('.toc-list a[aria-current="page"]');
if (pane && here) {
  /* 只调目录自己的滚动位置，不然整页会被带下去 */
  pane.scrollTop = Math.max(0, here.offsetTop - pane.clientHeight / 2 + here.offsetHeight / 2);
}

/* ── 3) 窄屏：目录默认收起 ───────────────────────────── */
/* 目录有 67 条，小屏上摊开两千多像素高，正文会被推到三屏之后。
   open 写在 HTML 里（没有 JS 也能用），这里只在小屏把它收起来。 */
var fold = document.querySelector('.toc-fold');
if (fold && window.matchMedia) {
  var narrow = window.matchMedia('(max-width:980px)');
  var syncFold = function () {
    if (narrow.matches) fold.removeAttribute('open');
    else fold.setAttribute('open', '');
  };
  syncFold();
  if (narrow.addEventListener) narrow.addEventListener('change', syncFold);
}

})();
