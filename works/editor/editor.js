/* HTML 编辑器 — 载入重排好的 HTML 文档，支持阅读标注 / 直接改字 / 批注 / 导出
 * 全部在浏览器本地完成，不上传任何数据。
 */
(function () {
'use strict';

var $  = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

/* 注入到文档里的样式：批注脚标 + 插图放大层 + 定位高亮
   颜色不能写 var(--…)：这段 CSS 注入进的是 iframe 里那个 document，它不一定有主题令牌 */
var INJECT_CSS = [
  '[data-ed-note]::after{content:"\u270E";font-size:.62em;color:#0071e3;vertical-align:super;margin-left:.28em;opacity:.9}',
  '#lb.ed-open{display:flex !important;position:fixed;inset:0;background:rgba(0,0,0,.84);align-items:center;justify-content:center;z-index:9999;cursor:zoom-out}',
  '#lb.ed-open img{max-width:94vw;max-height:94vh;object-fit:contain;background:#fff}',
  '.__ed-hit{outline:2px solid #0071e3;outline-offset:3px;border-radius:3px}'
].join('\n');

var S = {
  baseDir: '',        // 文档的 HTML 所在目录，用于解析 assets/ 相对路径
  title: 'untitled',
  blobs: [],          // 已创建的 objectURL，导出后统一回收
  original: new Map(),// data-i -> 载入时的原始文本
  changed: new Set(), // 已被改动的 data-i（由 refreshChanges 重算）
  origKids: new Set(),// 载入时 <main> 的直接子元素，用来识别新插入的块
  added: [],          // 编辑时回车拆出来的新块（没有 data-i）
  notes: new Map(),   // data-i -> {p, note, excerpt}
  lastBlock: null,    // 最后点过的块，加批注时的兜底目标
  awaitLoad: false,   // true = 下一次 iframe 重载是我们主动发起的
  mode: 'read',
  size: 18,
  theme: 'light',
  ready: false
};

var frame     = $('#book');
var drop      = $('#drop');
var fab       = $('#fab');
var panel     = $('#panel');
var panelBody = $('#panelBody');
var modal     = $('#modal');
var toastEl   = $('#toast');
var tab       = 'notes';

/* ══ 通用 ══════════════════════════════════════════════ */

function toast(msg, ms) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(function () { toastEl.hidden = true; }, ms || 2600);
}

function download(name, text, mime) {
  var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}

/* 规范化相对路径：折叠 ./ ../ 与重复斜杠 */
function norm(p) {
  var out = [];
  String(p).split('/').forEach(function (seg) {
    if (!seg || seg === '.') return;
    if (seg === '..') out.pop();
    else out.push(seg);
  });
  return out.join('/');
}

function dirOf(p) {
  var i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

function frameDoc() { return frame.contentDocument; }
function frameWin() { return frame.contentWindow; }

/* ══ 载入 ══════════════════════════════════════════════ */

/* 把选择/拖入的文件整理成 [{file, path}] */
function fromInput(fileList) {
  return Array.prototype.map.call(fileList, function (f) {
    return { file: f, path: f.webkitRelativePath || f.name };
  });
}

/* 拖入文件夹：递归读取 FileSystemEntry */
function readEntry(entry, prefix, out) {
  return new Promise(function (resolve) {
    if (!entry) return resolve();
    if (entry.isFile) {
      entry.file(function (f) {
        out.push({ file: f, path: prefix + entry.name });
        resolve();
      }, function () { resolve(); });
      return;
    }
    if (entry.isDirectory) {
      var reader = entry.createReader();
      var all = [];
      (function readMore() {
        reader.readEntries(function (batch) {
          if (!batch.length) {
            Promise.all(all.map(function (e) {
              return readEntry(e, prefix + entry.name + '/', out);
            })).then(resolve);
            return;
          }
          all = all.concat(batch);
          readMore();
        }, function () { resolve(); });
      })();
      return;
    }
    resolve();
  });
}

function fromDataTransfer(dt) {
  var entries = [];
  if (dt.items && dt.items.length) {
    for (var i = 0; i < dt.items.length; i++) {
      var it = dt.items[i];
      var e = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
      if (e) entries.push(e);
    }
  }
  if (!entries.length) return Promise.resolve(fromInput(dt.files || []));
  var out = [];
  return Promise.all(entries.map(function (e) { return readEntry(e, '', out); }))
    .then(function () { return out; });
}

/* 在文件清单里挑出主 HTML 文档。
   注意：目录页 books/index.html 只有 8KB，正文页却有几百 KB~1MB，
   所以同为 index.html 时取最大的那个，才不会误选目录页。 */
function pickHtml(entries) {
  var htmls = entries.filter(function (e) { return /\.html?$/i.test(e.path); });
  if (!htmls.length) return null;
  var idx = htmls.filter(function (e) { return /(^|\/)index\.html?$/i.test(e.path); });
  var pool = idx.length ? idx : htmls;
  pool.sort(function (a, b) { return (b.file.size || 0) - (a.file.size || 0); });
  return pool[0];
}

/* 组装可直接渲染的 Document：去掉脚本、重写插图路径、注入样式 */
function buildDoc(htmlText, entries, baseDir) {
  var assets = new Map();
  entries.forEach(function (e) {
    if (!/\.html?$/i.test(e.path)) assets.set(norm(e.path), e.file);
  });

  var doc = new DOMParser().parseFromString(htmlText, 'text/html');

  // 文档自带的脚本会和编辑器冲突（它绑定自己的按钮、选中浮标），一律去掉；
  // 目录锚点、夜间、字号这些由编辑器接管。
  $$('script', doc).forEach(function (n) { n.remove(); });

  // 内联事件属性（onclick 等）不属于 <script>，不会随上面一起删掉。
  // 文档里目录的「第N章」链接就带着 onclick="event.stopPropagation()"：
  // 它把点击截在冒泡阶段，下面挂在 document 上的委托处理收不到事件，
  // preventDefault 没机会执行，浏览器转而做原生锚点导航 ——
  // 而 srcdoc 里的原生锚点导航可能整个重载文档，把改动和批注全冲掉。
  var allEls = doc.querySelectorAll('*');
  for (var ai = 0; ai < allEls.length; ai++) {
    var el2 = allEls[ai], attrs2 = el2.attributes;
    for (var aj = attrs2.length - 1; aj >= 0; aj--) {
      if (/^on/i.test(attrs2[aj].name)) el2.removeAttribute(attrs2[aj].name);
    }
  }

  // 把相对路径的插图换成 objectURL，同时记下原始路径，导出时还原
  function rewrite(el, attr) {
    var raw = el.getAttribute(attr);
    if (!raw || /^(https?:|data:|blob:|\/\/)/i.test(raw)) return;
    var f = assets.get(norm((baseDir ? baseDir + '/' : '') + raw));
    if (!f) return;
    el.setAttribute('data-ed-origattr', attr);
    el.setAttribute('data-ed-origsrc', raw);
    var u = URL.createObjectURL(f);
    S.blobs.push(u);
    el.setAttribute(attr, u);
  }
  $$('img[src]', doc).forEach(function (el) { rewrite(el, 'src'); });
  $$('[data-src]', doc).forEach(function (el) { rewrite(el, 'data-src'); });

  var st = doc.createElement('style');
  st.id = '__ed-style';
  st.textContent = INJECT_CSS;
  (doc.head || doc.documentElement).appendChild(st);

  var t = doc.querySelector('title');
  S.title = (t && t.textContent.trim()) || 'untitled';
  return doc;
}

function load(entries) {
  if (!entries || !entries.length) { toast('没有读到文件'); return; }
  var main = pickHtml(entries);
  if (!main) { toast('这个目录里没有 .html 文件'); return; }

  S.baseDir = dirOf(norm(main.path));
  main.file.text().then(function (text) {
    // 回收上一本的 objectURL
    S.blobs.forEach(function (u) { URL.revokeObjectURL(u); });
    S.blobs = [];
    S.original.clear();
    S.changed.clear();
    S.notes.clear();
    S.lastBlock = null;
    S.awaitLoad = true;          // 这一次 iframe 重载是我们主动发起的
    S.size = 18;
    S.theme = 'light';

    var doc = buildDoc(text, entries, S.baseDir);
    S.doc = doc;
    S.ready = false;

    var short = main.path.split('/').slice(-2).join('/');
    $('#fileName').textContent = short;
    showDrop(false);
    fab.hidden = true;
    panel.hidden = true;
    closeModal();

    frame.onload = onFrameLoad;
    frame.srcdoc = '<!doctype html>\n' + doc.documentElement.outerHTML;
  }).catch(function (e) {
    toast('读取失败：' + e.message);
  });
}

/* ══ iframe 就绪 ═══════════════════════════════════════ */

function onFrameLoad() {
  var d = frameDoc(), w = frameWin();
  if (!d) return;

  // 不是我们主动载入 → iframe 被导航/重载了，DOM 上的标注和改动已经没了。
  // 出现这条提示就说明还有没堵住的导航路径，别让它悄悄发生。
  if (S.awaitLoad) {
    S.awaitLoad = false;
  } else {
    toast('⚠️ 页面被重新载入了，未保存的标注和改动可能已丢失。请重新打开 HTML。', 7000);
  }

  // 快照每一块的原文，用于后面 diff
  S.original.clear();
  $$('[data-i]', d).forEach(function (el) {
    S.original.set(el.getAttribute('data-i'), el.textContent);
  });
  // 快照 <main> 的直接子元素，用来识别「回车拆出的新块」
  var mainEl = d.querySelector('main') || d.body;
  S.origKids = new Set(mainEl ? Array.prototype.slice.call(mainEl.children) : []);
  S.added = [];

  // 链接和图片默认都可以拖 —— 点目录或插图时手一抖就变成拖拽，
  // 而拖图片时浏览器还会把它当成「文件」，触发拖放逻辑。一律禁掉。
  $$('a, img', d).forEach(function (el) { el.setAttribute('draggable', 'false'); });

  // 文档自带的「回到顶部」按钮还在，但脚本被移除了，这里把它接回来
  var topBtn = d.getElementById('top');
  if (topBtn) {
    topBtn.style.cursor = 'pointer';
    topBtn.onclick = function () { d.documentElement.scrollTop = 0; d.body.scrollTop = 0; };
  }

  // 记住最后点过的块：没有选中文字时也能对「当前这一段」加批注
  d.addEventListener('mousedown', function (e) {
    var b = e.target.closest ? e.target.closest('[data-i]') : null;
    if (b) S.lastBlock = b.getAttribute('data-i');
  });

  // 插图放大 + 目录跳转 + 点批注块编辑。
  // 用「捕获阶段」：文档里残留的内联 onclick 在冒泡阶段会把事件截住，
  // 捕获阶段才能保证我们先拿到事件、先 preventDefault。
  d.addEventListener('click', function (e) {
    if (!e.target.closest) return;

    // 1) 锚点链接：自己滚动，不让 iframe 去做锚点导航
    var a = e.target.closest('a[href^="#"]');
    if (a) {
      e.preventDefault();          // 同时也会取消 <summary> 的展开/收起
      var id = (a.getAttribute('href') || '').slice(1);
      var t = id ? d.getElementById(id) : null;
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else d.documentElement.scrollTop = 0;
      return;
    }

    // 2) 放大层开着时，点任意处关闭
    var lb = d.getElementById('lb');
    if (lb && lb.classList.contains('ed-open')) {
      lb.classList.remove('ed-open');
      return;
    }
    var cell = e.target.closest('.fig-cell');
    if (cell && S.mode === 'read') {
      var img = lb && lb.querySelector('img');
      var src = cell.getAttribute('data-src');
      if (img && src) { img.src = src; lb.classList.add('ed-open'); }
      return;
    }

    // 3) 阅读模式下点带批注的块 → 直接打开这条批注来改
    if (S.mode === 'read') {
      var nb = e.target.closest('[data-ed-note]');
      var sel = w.getSelection();
      if (nb && (!sel || sel.isCollapsed)) openNoteByKey(nb.getAttribute('data-i'));
    }
  }, true);

  // 编辑模式记录改动。
  // 关键：contenteditable 的 input 事件目标是「编辑宿主」(<main>)，不是被改的那个块，
  // 所以 e.target 永远找不到 [data-i]；改成停止输入后做一次全量比对，
  // 用防抖避免每敲一个字都扫近万块。
  d.addEventListener('input', scheduleRescan);
  d.addEventListener('blur', onEditSettled, true);

  // 选区浮标
  d.addEventListener('mouseup', function () { setTimeout(showFab, 10); });
  d.addEventListener('keyup', function () { setTimeout(showFab, 10); });

  // 焦点在文档里时，快捷键也要生效（iframe 内的按键不会冒泡到外层）
  d.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) {
      if (e.key !== 'Escape') return;
    }
    if (e.key === 'e') setMode('edit');
    else if (e.key === 'r') setMode('read');
    else if (e.key === 'Escape') fab.hidden = true;
  });

  applyTheme();
  applySize();
  setMode(S.mode, true);
  S.ready = true;
  syncButtons();
  renderPanel();
  toast('已载入：《' + S.title + '》，共 ' + S.original.size + ' 块');
}

/* ══ 模式 ══════════════════════════════════════════════ */

function setMode(mode, silent) {
  S.mode = mode;
  $$('.seg-b').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === mode); });

  var d = frameDoc();
  if (d) {
    var main = d.querySelector('main') || d.body;
    if (main) {
      // 阅读模式下直接移除属性，而不是设成 "false"（避免产生编辑宿主边界）
      if (mode === 'edit') main.setAttribute('contenteditable', 'true');
      else main.removeAttribute('contenteditable');
      main.style.outline = 'none';
    }
    if (mode === 'edit') d.body.style.cursor = 'text';
    else d.body.style.cursor = '';
  }
  if (mode !== 'read') fab.hidden = true;
  if (!silent) toast(mode === 'edit' ? '编辑模式：点任意文字直接改' : '阅读模式：选中文字可高亮 / 加粗');
}

/* ══ 标注 ══════════════════════════════════════════════ */

function showFab() {
  if (!S.ready || S.mode !== 'read') { fab.hidden = true; return; }
  var w = frameWin(), d = frameDoc();
  var sel = w.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) { fab.hidden = true; return; }
  var range = sel.getRangeAt(0);
  if (!d.body.contains(range.commonAncestorContainer)) { fab.hidden = true; return; }

  var r = range.getBoundingClientRect();
  if (!r || (!r.width && !r.height)) { fab.hidden = true; return; }
  var box = frame.getBoundingClientRect();
  fab.hidden = false;

  // 按钮显示「已套用」状态 —— 一眼就能看出再点一次是取消
  var st = annotState(d, range);
  $$('#fab button').forEach(function (b) {
    var t = b.dataset.tag;
    if (t === 'mark' || t === 'strong' || t === 'u' || t === 's') {
      b.classList.toggle('on', !!st[t]);
    }
  });

  var top = box.top + r.top - fab.offsetHeight - 8;
  if (top < box.top + 4) top = box.top + r.bottom + 8;   // 上方放不下就放下面
  var left = box.left + r.left + r.width / 2 - fab.offsetWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - fab.offsetWidth - 8));
  fab.style.top = top + 'px';
  fab.style.left = left + 'px';
}

/* ── 标注：开关式 ──────────────────────────────────────
   自己的标注统一打 data-ed-annot="<标签名>"，
   这样「取消」时只拆自己加的，不会误删文档本身就有的加粗/下划线。 */

function unwrapEl(el) {
  var p = el.parentNode;
  if (!p) return null;
  var first = el.firstChild, last = el.lastChild;
  while (el.firstChild) p.insertBefore(el.firstChild, el);
  p.removeChild(el);
  // 不做 normalize()：合并文本节点会让刚记录的节点引用失效
  return (first && last) ? { first: first, last: last } : null;
}

/* 找出与选区相交的、自己加的某类标注 */
function hitsInRange(d, range, tagName) {
  var out = [];
  var list = d.querySelectorAll('[data-ed-annot="' + tagName + '"]');
  for (var i = 0; i < list.length; i++) {
    if (range.intersectsNode(list[i])) out.push(list[i]);
  }
  return out;
}

function setSel(d, w, first, last, onlyContentsOf) {
  try {
    var r = d.createRange();
    if (onlyContentsOf) r.selectNodeContents(onlyContentsOf);
    else { r.setStartBefore(first); r.setEndAfter(last); }
    var s = w.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  } catch (e) { /* 位置已失效就放弃重新选中，不影响内容 */ }
}

/* 点一次加上，再点一次取消；操作后保持选中，方便连续切换 */
function toggleTag(tagName) {
  var w = frameWin(), d = frameDoc();
  var sel = w.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return false;
  var range = sel.getRangeAt(0);

  var hits = hitsInRange(d, range, tagName);
  if (hits.length) {
    // 已套用 → 取消
    var firstInfo = null, lastInfo = null;
    hits.forEach(function (el) {
      var info = unwrapEl(el);
      if (!info) return;
      if (!firstInfo) firstInfo = info;
      lastInfo = info;
    });
    if (firstInfo && lastInfo) {
      setSel(d, w, firstInfo.first, lastInfo.last, null);
    } else {
      sel.removeAllRanges();
    }
  } else {
    // 没套用 → 加上
    var el = d.createElement(tagName);
    el.setAttribute('data-ed-annot', tagName);
    try {
      range.surroundContents(el);
    } catch (err) {
      // 选区跨了多个块：抽出来整体包一层
      var frag = range.extractContents();
      el.appendChild(frag);
      range.insertNode(el);
    }
    setSel(d, w, null, null, el);
  }

  showFab();      // 刷新工具条位置和「按下」状态
  return true;
}

/* 一键清掉选区里所有自己加的标注 */
function clearFormat() {
  var w = frameWin(), d = frameDoc();
  var sel = w.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return false;
  var range = sel.getRangeAt(0);
  var hits = [];
  var list = d.querySelectorAll('[data-ed-annot]');
  for (var i = 0; i < list.length; i++) {
    if (range.intersectsNode(list[i])) hits.push(list[i]);
  }
  if (!hits.length) return false;
  var info = null;
  hits.forEach(function (el) { var r = unwrapEl(el); if (r) info = r; });
  if (info) setSel(d, w, info.first, info.last, null);
  showFab();
  return true;
}

/* 当前选区已经套了哪些标注 —— 用来让工具条上的按钮显示按下状态 */
function annotState(d, range) {
  var st = {};
  ['mark', 'strong', 'u', 's'].forEach(function (t) {
    st[t] = hitsInRange(d, range, t).length > 0;
  });
  return st;
}

/* ── 字号 ────────────────────────────────────────────── */

var SIZE_STEPS = [85, 100, 115, 130, 150, 175, 200];

function nearestStep(v) {
  var best = 1, diff = Infinity;
  SIZE_STEPS.forEach(function (s, i) {
    var dd = Math.abs(s - v);
    if (dd < diff) { diff = dd; best = i; }
  });
  return best;
}

/* 放大 / 缩小选中文字；降回 100% 就把外层 span 整个拆掉 */
function bumpSize(dir) {
  var w = frameWin(), d = frameDoc();
  var sel = w.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) { toast('先选中一段文字，再调字号'); return; }
  var range = sel.getRangeAt(0);

  var hits = hitsInRange(d, range, 'size');
  var cur = hits.length ? parseInt(hits[0].getAttribute('data-ed-size') || '100', 10) : 100;
  var idx = Math.max(0, Math.min(SIZE_STEPS.length - 1, nearestStep(cur) + dir));
  var next = SIZE_STEPS[idx];

  if (hits.length) {
    if (next === 100) {
      // 回到默认字号 → 去掉这层
      var info = null;
      hits.forEach(function (el) { var r = unwrapEl(el); if (r) info = r; });
      if (info) setSel(d, w, info.first, info.last, null);
    } else {
      hits.forEach(function (el) {
        el.setAttribute('data-ed-size', String(next));
        el.style.fontSize = next + '%';
      });
    }
  } else if (next === 100) {
    toast('已经是默认字号了');
    return;
  } else {
    var el = d.createElement('span');
    el.setAttribute('data-ed-annot', 'size');
    el.setAttribute('data-ed-size', String(next));
    el.style.fontSize = next + '%';
    try { range.surroundContents(el); }
    catch (e) { var frag = range.extractContents(); el.appendChild(frag); range.insertNode(el); }
    setSel(d, w, null, null, el);
  }
  saveRange();
  showFab();
}

/* ── 文字颜色 ────────────────────────────────────────── */

/* 点原生色板会让 iframe 丢掉选区，所以先把它存下来 */
var savedRange = null;
function saveRange() {
  var win = frameWin();
  var sel = win && win.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) savedRange = sel.getRangeAt(0).cloneRange();
}
function restoreRange() {
  if (!savedRange) return false;
  var s = frameWin().getSelection();
  s.removeAllRanges();
  try { s.addRange(savedRange); } catch (e) { return false; }
  return true;
}

function applyColor(hex) {
  var w = frameWin(), d = frameDoc();
  var sel = w.getSelection();

  if (!sel || !sel.rangeCount || sel.isCollapsed) {
    if (!restoreRange()) { toast('先选中一段文字，再改颜色'); return; }
    sel = w.getSelection();
  }
  var range = sel.getRangeAt(0);

  var hits = hitsInRange(d, range, 'color');
  if (hits.length) {
    hits.forEach(function (el) { el.style.color = hex; });
    setSel(d, w, hits[0], hits[hits.length - 1], null);
  } else {
    var el = d.createElement('span');
    el.setAttribute('data-ed-annot', 'color');
    el.style.color = hex;
    try { range.surroundContents(el); }
    catch (e) { var frag = range.extractContents(); el.appendChild(frag); range.insertNode(el); }
    setSel(d, w, null, null, el);
  }
  saveRange();
  showFab();
}

function currentBlock() {
  var d = frameDoc();
  var sel = frameWin().getSelection();
  if (sel && sel.rangeCount) {
    var node = sel.getRangeAt(0).startContainer;
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    var blk = el && el.closest ? el.closest('[data-i]') : null;
    if (blk) return blk;
  }
  // 没有选区，或光标不在正文里 → 退回「最后点过的那一块」
  if (S.lastBlock && d) {
    return d.querySelector('[data-i="' + CSS.escape(S.lastBlock) + '"]');
  }
  return null;
}

/* ══ 批注 ══════════════════════════════════════════════ */

var editingKey = null;

/* 按块号打开批注（编辑已有批注的唯一入口） */
function openNoteByKey(key) {
  var d = frameDoc();
  var blk = d && d.querySelector('[data-i="' + CSS.escape(key) + '"]');
  if (!blk) { toast('找不到这一块'); return; }
  var old = S.notes.get(key);
  editingKey = key;

  $('#mTitle').textContent = old ? '编辑批注' : '给这一块加批注';
  $('#mCtx').textContent = (blk.textContent || '').trim().slice(0, 220);
  $('#mText').value = old ? old.note : '';
  $('#mDel').hidden = !old;
  modal.hidden = false;
  setTimeout(function () { $('#mText').focus(); }, 30);
}

function openNote() {
  var blk = currentBlock();
  if (!blk) { toast('先点一下正文，或选中一段文字，再加批注'); return; }
  openNoteByKey(blk.getAttribute('data-i'));
}

function closeModal() { modal.hidden = true; editingKey = null; }

function saveNote() {
  if (!editingKey) return;
  var d = frameDoc();
  var blk = d.querySelector('[data-i="' + CSS.escape(editingKey) + '"]');
  var txt = $('#mText').value.trim();

  if (!txt) {
    S.notes.delete(editingKey);
    if (blk) blk.removeAttribute('data-ed-note');
  } else {
    S.notes.set(editingKey, {
      p: (blk && blk.getAttribute('data-p')) || '',
      note: txt,
      excerpt: (blk ? blk.textContent : '').trim().slice(0, 120)
    });
    if (blk) blk.setAttribute('data-ed-note', '1');
  }
  closeModal();
  syncButtons();
  renderPanel();
}

function deleteNote(key) {
  var d = frameDoc();
  var blk = d && d.querySelector('[data-i="' + CSS.escape(key) + '"]');
  if (blk) blk.removeAttribute('data-ed-note');
  S.notes.delete(key);
  if (editingKey === key) closeModal();
  syncButtons();
  renderPanel();
}

function delNote() {
  if (!editingKey) return;
  deleteNote(editingKey);
}

/* ══ 改动统计 / 侧栏 ═══════════════════════════════════ */

/* 全量比对，重算 S.changed / S.added。不做渲染，避免和 renderPanel 互相调用。 */
function refreshChanges() {
  var d = frameDoc();
  if (!d) return;
  S.changed.clear();
  $$('[data-i]', d).forEach(function (el) {
    var key = el.getAttribute('data-i');
    var orig = S.original.get(key);
    if (orig === undefined) return;
    if (el.textContent !== orig) S.changed.add(key);
  });

  // 编辑时按回车会把一段拆成两块，新块没有 data-i，单独统计
  S.added = [];
  var mainEl = d.querySelector('main') || d.body;
  if (mainEl) {
    Array.prototype.forEach.call(mainEl.children, function (el) {
      if (S.origKids.has(el)) return;
      var t = (el.textContent || '').trim();
      if (t) S.added.push({ tag: el.tagName.toLowerCase(), text: t });
    });
  }
}

var rescanTimer = null;
function scheduleRescan() {
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(onEditSettled, 400);
}

function onEditSettled() {
  clearTimeout(rescanTimer);
  refreshChanges();
  var n = S.changed.size + S.added.length;
  $('#chgN').textContent = n;
  $('#tChgN').textContent = n;
  if (!panel.hidden && tab === 'changes') renderPanel();
}

/* 导出 / 展示时读改动；先重算一次，保证即改即导出也不丢 */
function collectChanges() {
  refreshChanges();
  var d = frameDoc();
  var out = [];
  S.changed.forEach(function (key) {
    var el = d && d.querySelector('[data-i="' + CSS.escape(key) + '"]');
    if (!el) return;
    out.push({
      i: key,
      p: el.getAttribute('data-p') || '',
      old: S.original.get(key),
      new: el.textContent
    });
  });
  out.sort(function (a, b) { return parseInt(a.i, 10) - parseInt(b.i, 10); });
  return out;
}

function countChanges() {
  var n = S.changed.size + S.added.length;
  $('#chgN').textContent = n;
  $('#tChgN').textContent = n;
  return n;
}

function syncButtons() {
  var off = !S.ready;
  ['#noteBtn', '#panelBtn', '#chgBtn', '#exportHtml', '#exportLog'].forEach(function (s) {
    $(s).classList.toggle('off', off);
  });
  $('#noteN').textContent = S.notes.size;
  $('#tNoteN').textContent = S.notes.size;
  countChanges();
}

/* 导入引导层只在「还没载入文档」时出现。
   一旦载入了 HTML 就绝不再显示 —— 否则它会盖住正文，
   导致点击正文（比如点带 ✎ 的段落改批注）全部落在浮层上，像是「点了没反应」。 */
function showDrop(on) {
  if (on && S.ready) return;
  drop.classList.toggle('gone', !on);
  if (!on) drop.classList.remove('over');
}

/* 还没载入文档就点了按钮 → 告诉他怎么开始，而不是毫无反应 */
function needBook() {
  if (S.ready) return true;
  toast('还没有载入 HTML —— 点左上角「打开 HTML」，选含 index.html 的文件夹', 3600);
  showDrop(true);
  return false;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function jumpTo(key) {
  var d = frameDoc();
  var el = d && d.querySelector('[data-i="' + CSS.escape(key) + '"]');
  if (!el) return;
  $$('.__ed-hit', d).forEach(function (n) { n.classList.remove('__ed-hit'); });
  el.classList.add('__ed-hit');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(function () { el.classList.remove('__ed-hit'); }, 2200);
}

function renderPanel() {
  if (panel.hidden) return;
  var h = '';

  if (tab === 'notes') {
    if (!S.notes.size) {
      h = '<div class="empty">还没有批注。<br>在阅读模式下选中一段文字，<br>点工具条上的 ✎ 就能加。</div>';
    } else {
      S.notes.forEach(function (v, k) {
        h += '<div class="item" data-jump="' + esc(k) + '">' +
               '<div class="meta">' +
                 (v.p ? '<span class="pg">第 ' + esc(v.p) + ' 页</span>' : '') +
                 '<span>#' + esc(k) + '</span>' +
                 '<span class="sp"></span>' +
                 '<button class="mini" data-edit="' + esc(k) + '">编辑</button>' +
                 '<button class="mini danger" data-del="' + esc(k) + '">删除</button>' +
               '</div>' +
               '<div class="note">' + esc(v.note) + '</div>' +
               (v.excerpt ? '<div class="exc">' + esc(v.excerpt) + '…</div>' : '') +
             '</div>';
      });
    }
  } else {
    var ch = collectChanges();
    if (!ch.length && !S.added.length) {
      h = '<div class="empty">还没有改动。<br>切到「编辑」模式，<br>点任意文字直接改。</div>';
    } else {
      ch.forEach(function (c) {
        h += '<div class="item" data-jump="' + esc(c.i) + '">' +
               '<div class="meta">' +
                 (c.p ? '<span class="pg">第 ' + esc(c.p) + ' 页</span>' : '') +
                 '<span>#' + esc(c.i) + '</span>' +
               '</div>' +
               '<div class="diff"><span class="lbl">原</span><span class="o">' + esc(c.old.slice(0, 160)) + '</span></div>' +
               '<div class="diff"><span class="lbl">改</span><span class="n">' + esc(c.new.slice(0, 160)) + '</span></div>' +
             '</div>';
      });
      S.added.forEach(function (a) {
        h += '<div class="item">' +
               '<div class="meta"><span class="pg">新增块</span><span>' + esc(a.tag) + '</span></div>' +
               '<div class="diff"><span class="n">' + esc(a.text.slice(0, 160)) + '</span></div>' +
             '</div>';
      });
    }
  }

  panelBody.innerHTML = h;
  $$('.item', panelBody).forEach(function (el) {
    el.onclick = function (e) {
      if ((e.target.closest && e.target.closest('[data-edit]')) ||
          (e.target.closest && e.target.closest('[data-del]'))) return;
      if (el.dataset.jump) jumpTo(el.dataset.jump);
    };
  });
  $$('[data-edit]', panelBody).forEach(function (b) {
    b.onclick = function (e) { e.stopPropagation(); openNoteByKey(b.dataset.edit); };
  });
  $$('[data-del]', panelBody).forEach(function (b) {
    b.onclick = function (e) { e.stopPropagation(); deleteNote(b.dataset.del); };
  });
}

/* ══ 导出 ══════════════════════════════════════════════ */

/* 把 objectURL 还原成原始相对路径，导出文件可直接放回 web/ 覆盖 */
function restoreSrcs(root) {
  $$('[data-ed-origsrc]', root).forEach(function (el) {
    var attr = el.getAttribute('data-ed-origattr');
    var orig = el.getAttribute('data-ed-origsrc');
    if (attr && orig) el.setAttribute(attr, orig);
    el.removeAttribute('data-ed-origattr');
    el.removeAttribute('data-ed-origsrc');
  });
}

function exportHtml() {
  var d = frameDoc();
  if (!d) return;
  var clone = d.documentElement.cloneNode(true);
  $$('.__ed-hit', clone).forEach(function (n) { n.classList.remove('__ed-hit'); });
  restoreSrcs(clone);
  var lb = clone.querySelector('#lb');
  if (lb) lb.classList.remove('ed-open');

  var html = '<!doctype html>\n' + clone.outerHTML;
  download(S.title.replace(/[\\/:*?"<>|]/g, '_') + '.html', html, 'text/html');
  toast('已导出 HTML，放回原来的 web/ 目录覆盖原文件即可（插图路径已还原）', 4200);
}

function exportLog() {
  var ch = collectChanges();          // 内部会重算 S.added
  var L = [];
  L.push('# 改动与批注记录');
  L.push('# 文档：' + S.title);
  L.push('# 导出时间：' + new Date().toLocaleString());
  L.push('# 改动 ' + ch.length + ' 处，新增块 ' + S.added.length + ' 个，批注 ' + S.notes.size + ' 条');
  L.push('');
  L.push('════════ 一、改动（按块） ════════');
  L.push('');
  if (!ch.length) L.push('（无）');
  ch.forEach(function (c, n) {
    L.push('[' + (n + 1) + '] 第 ' + (c.p || '?') + ' 页  #' + c.i);
    L.push('  原：' + c.old);
    L.push('  改：' + c.new);
    L.push('');
  });
  if (S.added.length) {
    L.push('════════ 一之二、编辑时新增的块（原文档没有对应块号） ════════');
    L.push('');
    S.added.forEach(function (a, n) {
      L.push('[' + (n + 1) + '] <' + a.tag + '>');
      L.push('  ' + a.text);
      L.push('');
    });
  }
  L.push('════════ 二、批注 ════════');
  L.push('');
  if (!S.notes.size) L.push('（无）');
  S.notes.forEach(function (v, k) {
    L.push('· 第 ' + (v.p || '?') + ' 页  #' + k);
    L.push('  原文：' + v.excerpt);
    L.push('  批注：' + v.note);
    L.push('');
  });
  L.push('════════ 三、fixes.txt 格式（如需重跑 rebuild.py） ════════');
  L.push('');
  L.push('# 整块重写，一行一条： @set 旧的一小段 = 新的完整一段');
  L.push('# 若只需要改错字，可自行精简成： 错字 => 正确文字');
  L.push('');
  ch.forEach(function (c) {
    L.push('@set ' + c.old.replace(/\s+/g, ' ').trim() + ' = ' + c.new.replace(/\s+/g, ' ').trim());
  });
  download(S.title.replace(/[\\/:*?"<>|]/g, '_') + '.改动与批注.txt', L.join('\n'));
  toast('已导出记录（含 fixes.txt 格式）');
}

/* ══ 显示设置 ══════════════════════════════════════════ */

function applyTheme() {
  var d = frameDoc();
  if (d) d.documentElement.setAttribute('data-theme', S.theme);
  $('#theme').textContent = S.theme === 'dark' ? '日间' : '夜间';
}

function applySize() {
  var d = frameDoc();
  if (d) d.documentElement.style.setProperty('--size', S.size + 'px');
}

/* ══ 事件绑定 ══════════════════════════════════════════ */

$('#dirInput').addEventListener('change', function (e) {
  load(fromInput(e.target.files));
  e.target.value = '';
});

/* 拖放：只有在真的拖进来「文件」时才接管。
   否则拖动链接/选中文字也会触发 dragenter，把导入浮层弹出来。 */
function hasFiles(e) {
  var dt = e.dataTransfer;
  if (!dt || !dt.types) return false;
  for (var i = 0; i < dt.types.length; i++) {
    if (dt.types[i] === 'Files') return true;
  }
  return false;
}

var dragDepth = 0;
window.addEventListener('dragenter', function (e) {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  if (!S.ready) { showDrop(true); drop.classList.add('over'); }
});
window.addEventListener('dragover', function (e) {
  if (!hasFiles(e)) return;
  e.preventDefault();
});
window.addEventListener('dragleave', function (e) {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (--dragDepth <= 0) {
    dragDepth = 0;
    drop.classList.remove('over');
    if (S.ready) showDrop(false);
  }
});
window.addEventListener('drop', function (e) {
  if (!hasFiles(e)) return;   // 拖链接 / 选中文字：交回浏览器默认行为
  e.preventDefault();
  dragDepth = 0;
  showDrop(false);            // 无论成败先收掉，绝不让它盖在正文上
  fromDataTransfer(e.dataTransfer).then(function (entries) {
    if (!entries.length) { toast('没读到文件，试试点左上角「打开 HTML」'); return; }
    if (!pickHtml(entries)) { toast('拖进来的内容里找不到 .html —— 请拖含 index.html 的文件夹（通常是 web/）'); return; }
    load(entries);
  });
});

/* 模式 */
$$('.seg-b').forEach(function (b) {
  b.onclick = function () { if (S.ready) setMode(b.dataset.mode); };
});

/* 标注工具条 */
$$('#fab button').forEach(function (b) {
  b.onmousedown = function (e) { e.preventDefault(); };  // 别让选区丢掉
  b.onclick = function () {
    var tag = b.dataset.tag;
    if (tag === 'note') { openNote(); fab.hidden = true; return; }
    if (tag === 'clear') { clearFormat(); return; }   // 内部会刷新工具条
    if (tag === 'size+') { bumpSize(1); return; }
    if (tag === 'size-') { bumpSize(-1); return; }
    toggleTag(tag);                                   // 开关式：已套用就取消
  };
});

/* 文字颜色：点色板前先存下选区，选完再套上去 */
var colorInput = $('#fabColor');
colorInput.addEventListener('mousedown', saveRange);
colorInput.addEventListener('input', function () { applyColor(colorInput.value); });

/* 批注 */
$('#noteBtn').onclick = function () { if (needBook()) openNote(); };
$('#mCancel').onclick = closeModal;
$('#mOk').onclick = saveNote;
$('#mDel').onclick = delNote;
modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

/* 侧栏 */
$('#panelBtn').onclick = function () {
  if (!needBook()) return;
  panel.hidden = !panel.hidden;
  renderPanel();
};
$('#chgBtn').onclick = function () {
  if (!needBook()) return;
  panel.hidden = false;
  tab = 'changes';
  $$('.tab').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === 'changes'); });
  renderPanel();
};
$('#panelClose').onclick = function () { panel.hidden = true; };
$$('.tab').forEach(function (t) {
  t.onclick = function () {
    tab = t.dataset.tab;
    $$('.tab').forEach(function (x) { x.classList.toggle('on', x === t); });
    renderPanel();
  };
});

/* 导出 */
$('#exportHtml').onclick = function () { if (needBook()) exportHtml(); };
$('#exportLog').onclick = function () { if (needBook()) exportLog(); };

/* 显示设置 */
$('#plus').onclick  = function () { S.size = Math.min(30, S.size + 1); applySize(); };
$('#minus').onclick = function () { S.size = Math.max(13, S.size - 1); applySize(); };
$('#theme').onclick = function () { S.theme = S.theme === 'dark' ? 'light' : 'dark'; applyTheme(); };

/* 顶栏在窄窗口会自动折行，把真实高度写进 --bar，
   右侧栏和浮动工具条才能贴着它、不会压到按钮上 */
function syncBar() {
  var b = document.querySelector('.bar');
  if (b) document.documentElement.style.setProperty('--bar', b.offsetHeight + 'px');
}
window.addEventListener('resize', syncBar);

/* 初始状态：还没载入 HTML，动作按钮弱化但仍可点（点了给提示） */
syncButtons();
syncBar();

/* 快捷键：载入 HTML 之后按 e / r 切模式 */
window.addEventListener('keydown', function (e) {
  if (!S.ready) return;
  if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'e') setMode('edit');
  if (e.key === 'r') setMode('read');
  if (e.key === 'Escape') {
    if (!modal.hidden) closeModal();
    else if (!panel.hidden) panel.hidden = true;
    else fab.hidden = true;
  }
});

})();
