const pages = [...document.querySelectorAll('.page')];
const navLinks = [...document.querySelectorAll('[data-page-link]')];
const presets = {
  brutalist: { label: 'BRUTALIST / 01', background: '#245bff', color: '#ffffff', font: 'sans', weight: '900', spacing: '-.09em', lineHeight: '.83', transform: 'uppercase', tilt: 0 },
  editorial: { label: 'EDITORIAL / 02', background: '#eae7df', color: '#171714', font: 'serif', weight: '500', spacing: '-.075em', lineHeight: '.98', transform: 'none', tilt: 10 },
  playful: { label: 'PLAYFUL / 03', background: '#191a17', color: '#245bff', font: 'sans', weight: '900', spacing: '-.08em', lineHeight: '.82', transform: 'uppercase', tilt: 5 },
  mono: { label: 'MONO GRID / 04', background: '#eceee8', color: '#20211d', font: 'mono', weight: '500', spacing: '-.075em', lineHeight: '.98', transform: 'uppercase', tilt: 0 }
};

const artboard = document.querySelector('#artboard');
const textObject = document.querySelector('#text-object');
const artboardText = document.querySelector('#artboard-text');
const selectionBox = document.querySelector('#selection-box');
const rotateHandle = document.querySelector('#rotate-handle');
const textInput = document.querySelector('#text-input');
const sizeInput = document.querySelector('#size-input');
const sizeValue = document.querySelector('#size-value');
const textColorInput = document.querySelector('#text-color-input');
const bgColorInput = document.querySelector('#bg-color-input');
const fontInput = document.querySelector('#font-input');
const letterSpacingInput = document.querySelector('#letter-spacing-input');
const letterSpacingValue = document.querySelector('#letter-spacing-value');
const lineHeightInput = document.querySelector('#line-height-input');
const lineHeightValue = document.querySelector('#line-height-value');
const tiltInput = document.querySelector('#tilt-input');
const tiltValue = document.querySelector('#tilt-value');
const saveStyleButton = document.querySelector('#save-style');
const styleDialog = document.querySelector('#style-dialog');
const styleForm = document.querySelector('#style-form');
const styleNameInput = document.querySelector('#style-name-input');
const cancelStyleButton = document.querySelector('#cancel-style');
const fontFamilies = {
  sans: 'var(--sans)',
  serif: 'var(--serif)',
  mono: 'var(--mono)',
  display: "Impact, 'Arial Black', sans-serif"
};
const savedWorksKey = 'font-playground.gallery-works.v1';
const legacySavedWorkKey = 'font-playground.saved-work.v1';
const customStylesKey = 'font-playground.custom-styles.v1';
let selectedPreset = 'brutalist';
let savedWorks = [];
let customStyles = [];
let positionX = 0;
let positionY = 0;
let objectRotation = 0;
let isTextSelected = false;
let pointerAction = null;

function showPage(pageName) {
  pages.forEach((page) => {
    const isActive = page.id === pageName;
    page.hidden = !isActive;
    page.classList.toggle('active', isActive);
  });
  document.querySelectorAll('.nav-link').forEach((link) => {
    const isActive = link.dataset.pageLink === pageName;
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateText() {
  artboardText.textContent = textInput.value;
  requestAnimationFrame(updateSelectionBox);
}

function updateSize() {
  const progress = ((sizeInput.value - sizeInput.min) / (sizeInput.max - sizeInput.min)) * 100;
  sizeValue.value = sizeInput.value;
  sizeInput.style.setProperty('--range-progress', `${progress}%`);
  artboard.style.setProperty('--canvas-size', `${sizeInput.value}px`);
  requestAnimationFrame(updateSelectionBox);
}

function updateLetterSpacing() {
  const value = Number(letterSpacingInput.value) / 100;
  letterSpacingValue.value = value.toFixed(2);
  artboardText.style.letterSpacing = `${value}em`;
  requestAnimationFrame(updateSelectionBox);
}

function updateLineHeight() {
  lineHeightValue.value = lineHeightInput.value;
  artboardText.style.lineHeight = Number(lineHeightInput.value) / 100;
  requestAnimationFrame(updateSelectionBox);
}

function updateTilt() {
  tiltValue.value = tiltInput.value;
  const angle = Number(tiltInput.value);
  artboardText.style.fontStyle = angle ? `oblique ${angle}deg` : 'normal';
  requestAnimationFrame(updateSelectionBox);
}

function updateFont() {
  artboardText.style.fontFamily = fontFamilies[fontInput.value];
  requestAnimationFrame(updateSelectionBox);
}

function updateTextObjectTransform() {
  textObject.style.left = `calc(8% + ${positionX}%)`;
  textObject.style.top = `calc(50% + ${positionY}%)`;
  textObject.style.setProperty('--object-rotation', `${objectRotation}deg`);
  requestAnimationFrame(updateSelectionBox);
}

function updateSelectionBox() {
  if (!isTextSelected) return;
  const range = document.createRange();
  range.selectNodeContents(artboardText);
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
  if (!rects.length) {
    selectionBox.hidden = true;
    return;
  }
  const bounds = rects.reduce((result, rect) => ({
    left: Math.min(result.left, rect.left),
    top: Math.min(result.top, rect.top),
    right: Math.max(result.right, rect.right),
    bottom: Math.max(result.bottom, rect.bottom)
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const board = artboard.getBoundingClientRect();
  selectionBox.hidden = false;
  selectionBox.style.left = `${bounds.left - board.left - 5}px`;
  selectionBox.style.top = `${bounds.top - board.top - 5}px`;
  selectionBox.style.width = `${bounds.right - bounds.left + 10}px`;
  selectionBox.style.height = `${bounds.bottom - bounds.top + 10}px`;
}

function selectText() {
  isTextSelected = true;
  textObject.setAttribute('aria-pressed', 'true');
  updateSelectionBox();
}

function deselectText() {
  isTextSelected = false;
  selectionBox.hidden = true;
  textObject.setAttribute('aria-pressed', 'false');
}

function isPointOnText(x, y) {
  const range = document.createRange();
  range.selectNodeContents(artboardText);
  return [...range.getClientRects()].some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
}

function beginMove(event) {
  if (!isPointOnText(event.clientX, event.clientY)) return;
  selectText();
  pointerAction = {
    type: 'move',
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    positionX,
    positionY
  };
  textObject.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function beginRotate(event) {
  const bounds = textObject.getBoundingClientRect();
  pointerAction = {
    type: 'rotate',
    pointerId: event.pointerId,
    centerX: bounds.left + bounds.width / 2,
    centerY: bounds.top + bounds.height / 2,
    startAngle: Math.atan2(event.clientY - (bounds.top + bounds.height / 2), event.clientX - (bounds.left + bounds.width / 2)),
    rotation: objectRotation
  };
  rotateHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}

function movePointer(event) {
  if (!pointerAction || pointerAction.pointerId !== event.pointerId) return;
  if (pointerAction.type === 'move') {
    const bounds = artboard.getBoundingClientRect();
    positionX = Math.max(-42, Math.min(42, pointerAction.positionX + (event.clientX - pointerAction.startX) / bounds.width * 100));
    positionY = Math.max(-42, Math.min(42, pointerAction.positionY + (event.clientY - pointerAction.startY) / bounds.height * 100));
  } else {
    const angle = Math.atan2(event.clientY - pointerAction.centerY, event.clientX - pointerAction.centerX);
    const delta = (angle - pointerAction.startAngle) * 180 / Math.PI;
    objectRotation = ((pointerAction.rotation + delta + 180) % 360 + 360) % 360 - 180;
  }
  updateTextObjectTransform();
}

function endPointer(event) {
  if (pointerAction?.pointerId === event.pointerId) pointerAction = null;
}

function getWorkState() {
  return {
    text: textInput.value,
    preset: selectedPreset,
    font: fontInput.value,
    size: sizeInput.value,
    letterSpacing: letterSpacingInput.value,
    lineHeight: lineHeightInput.value,
    tilt: tiltInput.value,
    positionX,
    positionY,
    rotation: objectRotation,
    alignment: document.querySelector('[data-align].selected')?.dataset.align || 'left',
    textColor: textColorInput.value,
    backgroundColor: bgColorInput.value
  };
}

function restoreWorkState(state) {
  if (!state || !presets[state.preset]) return false;
  textInput.value = typeof state.text === 'string' ? state.text : textInput.value;
  setPreset(state.preset);
  if (fontFamilies[state.font]) fontInput.value = state.font;
  if (state.size) sizeInput.value = state.size;
  if (state.letterSpacing) letterSpacingInput.value = state.letterSpacing;
  if (state.lineHeight) lineHeightInput.value = state.lineHeight;
  if (state.tilt !== undefined) tiltInput.value = state.tilt;
  positionX = Number(state.positionX) || 0;
  positionY = Number(state.positionY) || 0;
  objectRotation = Number(state.rotation) || 0;
  updateFont();
  updateSize();
  updateLetterSpacing();
  updateLineHeight();
  updateTilt();
  updateTextObjectTransform();
  if (/^#[\da-f]{6}$/i.test(state.textColor || '')) textColorInput.value = state.textColor;
  if (/^#[\da-f]{6}$/i.test(state.backgroundColor || '')) bgColorInput.value = state.backgroundColor;
  artboard.style.setProperty('--canvas-ink', textColorInput.value);
  artboard.style.setProperty('--canvas-bg', bgColorInput.value);
  document.querySelector('#text-color-dot').style.background = textColorInput.value;
  document.querySelector('#bg-color-dot').style.background = bgColorInput.value;
  const alignmentButton = document.querySelector(`[data-align="${state.alignment}"]`);
  if (alignmentButton) alignmentButton.click();
  updateText();
  return true;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeSavedWork(state) {
  const title = (state.text || '').replace(/\s+/g, ' ').trim().slice(0, 36) || 'Untitled Study';
  return {
    ...state,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    savedAt: new Date().toISOString()
  };
}

function migrateSavedWork(work) {
  let migrated = work;
  if (work.rotation === undefined) {
    migrated = {
      ...migrated,
      rotation: -(Number(work.tilt) || 0),
      tilt: work.italic ? 10 : 0
    };
  }
  if (String(migrated.backgroundColor || '').toLowerCase() === '#d8ff3f') {
    migrated = {
      ...migrated,
      backgroundColor: '#245bff',
      textColor: String(migrated.textColor || '').toLowerCase() === '#10110e' ? '#ffffff' : migrated.textColor
    };
  }
  if (String(migrated.textColor || '').toLowerCase() === '#d8ff3f') {
    migrated = { ...migrated, textColor: '#245bff' };
  }
  return migrated;
}

function readSavedWorks() {
  try {
    const storedWorks = JSON.parse(localStorage.getItem(savedWorksKey) || 'null');
    if (Array.isArray(storedWorks)) {
      const validWorks = storedWorks.filter((work) => work && presets[work.preset]);
      const migratedWorks = validWorks.map(migrateSavedWork);
      if (migratedWorks.some((work, index) => work !== validWorks[index])) {
        try {
          localStorage.setItem(savedWorksKey, JSON.stringify(migratedWorks));
        } catch {}
      }
      return migratedWorks;
    }
    const legacyWork = JSON.parse(localStorage.getItem(legacySavedWorkKey) || 'null');
    if (legacyWork && presets[legacyWork.preset]) {
      const migratedWorks = [makeSavedWork(migrateSavedWork(legacyWork))];
      localStorage.setItem(savedWorksKey, JSON.stringify(migratedWorks));
      return migratedWorks;
    }
  } catch {
    return [];
  }
  return [];
}

function createWorkPreview(work, text = work.text || work.sampleText || '') {
  const preset = presets[work.preset] || presets.brutalist;
  const preview = document.createElement('div');
  preview.className = 'saved-work-preview';
  preview.style.background = /^#[\da-f]{6}$/i.test(work.backgroundColor || '') ? work.backgroundColor : preset.background;
  preview.style.color = /^#[\da-f]{6}$/i.test(work.textColor || '') ? work.textColor : preset.color;
  const previewText = document.createElement('div');
  previewText.className = 'saved-work-preview-text';
  previewText.textContent = text;
  previewText.style.fontFamily = fontFamilies[work.font] || fontFamilies.sans;
  previewText.style.fontSize = `${Math.min(43, Math.max(22, (Number(work.size) || 96) * 0.36))}px`;
  previewText.style.fontWeight = preset.weight;
  previewText.style.letterSpacing = `${Number(work.letterSpacing || 0) / 100}em`;
  previewText.style.lineHeight = Number(work.lineHeight || 90) / 100;
  previewText.style.textTransform = preset.transform;
  const tilt = Number(work.tilt) || 0;
  previewText.style.fontStyle = tilt ? `oblique ${tilt}deg` : 'normal';
  previewText.style.left = `calc(20px + ${Number(work.positionX) || 0}%)`;
  previewText.style.top = `calc(50% + ${Number(work.positionY) || 0}%)`;
  previewText.style.transform = `translateY(-50%) rotate(${Number(work.rotation) || 0}deg)`;
  previewText.style.textAlign = ['left', 'center', 'right'].includes(work.alignment) ? work.alignment : 'left';
  preview.append(previewText);
  return preview;
}

function renderSavedWorks() {
  const grid = document.querySelector('#saved-works-grid');
  const emptyMessage = document.querySelector('#saved-works-empty');
  grid.replaceChildren();
  document.querySelector('#saved-work-count').textContent = `${savedWorks.length} SAVED`;
  emptyMessage.hidden = savedWorks.length > 0;

  savedWorks.forEach((work) => {
    const preset = presets[work.preset] || presets.brutalist;
    const card = document.createElement('article');
    card.className = 'saved-work-card';
    const preview = createWorkPreview(work);

    const info = document.createElement('div');
    info.className = 'saved-work-info';
    const title = document.createElement('b');
    title.textContent = work.title || 'Untitled Study';
    const date = document.createElement('span');
    const savedDate = new Date(work.savedAt);
    date.textContent = Number.isNaN(savedDate.getTime()) ? preset.label : savedDate.toLocaleDateString('zh-CN');
    info.append(title, date);

    const actions = document.createElement('div');
    actions.className = 'saved-work-actions';
    const editButton = document.createElement('button');
    editButton.className = 'saved-work-action';
    editButton.type = 'button';
    editButton.textContent = '继续编辑';
    editButton.addEventListener('click', () => {
      if (restoreWorkState(work)) showPage('create');
    });
    const downloadButton = document.createElement('button');
    downloadButton.className = 'saved-work-action primary';
    downloadButton.type = 'button';
    downloadButton.textContent = '下载 PNG';
    downloadButton.addEventListener('click', () => downloadArtwork(work));
    const deleteButton = document.createElement('button');
    deleteButton.className = 'saved-work-action';
    deleteButton.type = 'button';
    deleteButton.textContent = '删除';
    deleteButton.addEventListener('click', () => deleteSavedWork(work));
    actions.append(editButton, downloadButton, deleteButton);
    card.append(preview, info, actions);
    grid.append(card);
  });
}

function readCustomStyles() {
  try {
    const storedStyles = JSON.parse(localStorage.getItem(customStylesKey) || '[]');
    if (Array.isArray(storedStyles)) {
      return storedStyles.filter((style) => style && style.id && typeof style.name === 'string' && presets[style.preset]);
    }
  } catch {}
  return [];
}

function renderCustomStyles() {
  const grid = document.querySelector('#custom-styles-grid');
  const emptyMessage = document.querySelector('#custom-styles-empty');
  grid.replaceChildren();
  document.querySelector('#custom-style-count').textContent = `${customStyles.length} STYLES`;
  emptyMessage.hidden = customStyles.length > 0;

  customStyles.forEach((style) => {
    const preset = presets[style.preset] || presets.brutalist;
    const card = document.createElement('article');
    card.className = 'saved-work-card';
    const preview = createWorkPreview(style, style.sampleText || 'YOUR STYLE');
    const info = document.createElement('div');
    info.className = 'saved-work-info';
    const title = document.createElement('b');
    title.textContent = style.name;
    const label = document.createElement('span');
    label.textContent = preset.label.split('/')[0].trim();
    info.append(title, label);

    const actions = document.createElement('div');
    actions.className = 'saved-work-actions';
    const applyButton = document.createElement('button');
    applyButton.className = 'saved-work-action primary';
    applyButton.type = 'button';
    applyButton.textContent = '应用风格';
    applyButton.addEventListener('click', () => applyCustomStyle(style));
    const deleteButton = document.createElement('button');
    deleteButton.className = 'saved-work-action';
    deleteButton.type = 'button';
    deleteButton.textContent = '删除';
    deleteButton.addEventListener('click', () => deleteCustomStyle(style));
    actions.append(applyButton, deleteButton);
    card.append(preview, info, actions);
    grid.append(card);
  });
}

function applyCustomStyle(style) {
  if (!restoreWorkState({ ...style, text: textInput.value })) return;
  showPage('create');
  document.querySelector('#save-status').textContent = `已应用「${style.name}」；当前文字已保留，可以继续编辑。`;
}

function openStyleDialog() {
  styleNameInput.value = `MY STYLE ${String(customStyles.length + 1).padStart(2, '0')}`;
  styleNameInput.setCustomValidity('');
  styleDialog.showModal();
  styleNameInput.focus();
  styleNameInput.select();
}

function saveCustomStyle(event) {
  event.preventDefault();
  const name = styleNameInput.value.trim();
  if (!name) {
    styleNameInput.setCustomValidity('请填写风格名称。');
    styleNameInput.reportValidity();
    return;
  }
  const { text: sampleText, ...styleState } = getWorkState();
  const style = {
    ...styleState,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    sampleText,
    savedAt: new Date().toISOString()
  };
  customStyles.unshift(style);
  renderCustomStyles();
  styleDialog.close();
  try {
    localStorage.setItem(customStylesKey, JSON.stringify(customStyles));
    document.querySelector('#save-status').textContent = `已将「${name}」保存到 Gallery → 我的风格。`;
  } catch {
    document.querySelector('#save-status').textContent = `「${name}」已加入当前 Gallery；浏览器暂不能持久保存，刷新后可能消失。`;
  }
}

function deleteCustomStyle(style) {
  if (!window.confirm(`确定删除风格「${style.name}」吗？`)) return;
  customStyles = customStyles.filter((item) => item.id !== style.id);
  renderCustomStyles();
  try {
    localStorage.setItem(customStylesKey, JSON.stringify(customStyles));
  } catch {}
}

function deleteSavedWork(work) {
  const title = work.title || 'Untitled Study';
  if (!window.confirm(`确定删除作品「${title}」吗？删除后无法恢复。`)) return;
  savedWorks = savedWorks.filter((item) => item !== work);
  renderSavedWorks();
  try {
    localStorage.setItem(savedWorksKey, JSON.stringify(savedWorks));
  } catch {
    window.alert('作品已从当前 Gallery 移除，但浏览器无法保存此更改；刷新后可能重新出现。');
  }
}

function saveWork() {
  const work = makeSavedWork(getWorkState());
  savedWorks.unshift(work);
  renderSavedWorks();
  const status = document.querySelector('#save-status');
  try {
    localStorage.setItem(savedWorksKey, JSON.stringify(savedWorks));
    status.textContent = '已加入 Gallery，可随时回来编辑或下载。';
  } catch {
    downloadBlob(new Blob([JSON.stringify(work, null, 2)], { type: 'application/json' }), 'font-playground-work.json');
    status.textContent = '已加入当前 Gallery；浏览器无法持久保存，已下载数据备份。';
  }
}

function downloadArtwork(work = getWorkState()) {
  const canvas = document.createElement('canvas');
  const scale = 2;
  const width = 720;
  const height = 450;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.scale(scale, scale);

  const preset = presets[work.preset] || presets.brutalist;
  const textColor = /^#[\da-f]{6}$/i.test(work.textColor || '') ? work.textColor : preset.color;
  const backgroundColor = /^#[\da-f]{6}$/i.test(work.backgroundColor || '') ? work.backgroundColor : preset.background;
  const fontKey = fontFamilies[work.font] ? work.font : 'sans';
  const exportFamilies = { sans: 'Arial, Helvetica, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'monospace', display: 'Impact, "Arial Black", sans-serif' };
  const fontSize = Math.min(144, Math.max(36, Number(work.size) || 96));
  const letterSpacing = (Number(work.letterSpacing) || 0) / 100 * fontSize;
  const lineHeight = (Number(work.lineHeight) || 90) / 100 * fontSize;
  const fontTilt = Math.min(20, Math.max(0, Number(work.tilt) || 0)) * Math.PI / 180;
  const rotation = (Number(work.rotation) || 0) * Math.PI / 180;
  const moveX = (Number(work.positionX) || 0) / 100 * width;
  const moveY = (Number(work.positionY) || 0) / 100 * height;
  const textAlign = ['left', 'center', 'right'].includes(work.alignment) ? work.alignment : 'left';
  const padding = width * 0.08;
  const contentWidth = width - padding * 2;
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, width, height);
  context.fillStyle = textColor;
  context.globalAlpha = 0.7;
  context.font = '8px monospace';
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.fillText('FONT PLAYGROUND', 20, 17);
  context.textAlign = 'right';
  context.fillText(preset.label, width - 20, 17);
  context.globalAlpha = 1;

  context.font = `${preset.weight} ${fontSize}px ${exportFamilies[fontKey]}`;
  context.fillStyle = textColor;
  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
  const lines = String(work.text || '').split('\n').map((line) => preset.transform === 'uppercase' ? line.toLocaleUpperCase() : line);
  const firstBaseline = (height - lines.length * lineHeight) / 2 + fontSize * 0.85;
  context.save();
  context.translate(width / 2 + moveX, height / 2 + moveY);
  context.rotate(rotation);
  lines.forEach((line, index) => {
    const characters = Array.from(line);
    const measuredWidth = characters.reduce((sum, character) => sum + context.measureText(character).width + letterSpacing, 0) - (characters.length ? letterSpacing : 0);
    const startX = textAlign === 'center' ? padding + (contentWidth - measuredWidth) / 2 : textAlign === 'right' ? width - padding - measuredWidth : padding;
    context.save();
    context.translate(startX - width / 2, firstBaseline + index * lineHeight - height / 2);
    context.transform(1, 0, -Math.tan(fontTilt), 1, 0, 0);
    let cursor = 0;
    characters.forEach((character) => {
      context.fillText(character, cursor, 0);
      cursor += context.measureText(character).width + letterSpacing;
    });
    context.restore();
  });
  context.restore();

  context.fillStyle = textColor;
  context.globalAlpha = 0.7;
  context.font = '9px monospace';
  context.textAlign = 'right';
  context.textBaseline = 'alphabetic';
  context.fillText('FONT PLAYGROUND  /  01', width - 20, height - 17);
  context.globalAlpha = 1;
  const filename = (work.title || 'font-playground').replace(/[\\/:*?"<>|]/g, '-').slice(0, 48);
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `${filename}.png`);
  }, 'image/png');
}

function setPreset(name) {
  const preset = presets[name];
  if (!preset) return;
  selectedPreset = name;
  fontInput.value = preset.font;
  letterSpacingInput.value = Number.parseFloat(preset.spacing) * 100;
  lineHeightInput.value = Number.parseFloat(preset.lineHeight) * 100;
  tiltInput.value = preset.tilt;
  positionX = 0;
  positionY = 0;
  objectRotation = 0;
  deselectText();
  updateTextObjectTransform();
  artboard.style.setProperty('--canvas-bg', bgColorInput.value = preset.background);
  artboard.style.setProperty('--canvas-ink', textColorInput.value = preset.color);
  updateFont();
  artboardText.style.fontWeight = preset.weight;
  updateLetterSpacing();
  updateLineHeight();
  updateTilt();
  artboardText.style.textTransform = preset.transform;
  document.querySelector('#canvas-preset-label').textContent = preset.label;
  document.querySelector('#text-color-dot').style.background = preset.color;
  document.querySelector('#bg-color-dot').style.background = preset.background;
  document.querySelectorAll('[data-preset]').forEach((button) => {
    const isSelected = button.dataset.preset === name;
    button.classList.toggle('selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  });
  updateText();
}

function openPreset(name, sample) {
  if (sample) textInput.value = sample.replace(/\\n/g, '\n');
  setPreset(name);
  showPage('create');
}

navLinks.forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  showPage(link.dataset.pageLink);
}));

document.querySelectorAll('[data-preset]').forEach((button) => {
  button.addEventListener('click', () => setPreset(button.dataset.preset));
});

document.querySelectorAll('[data-open-preset]').forEach((card) => {
  card.addEventListener('click', () => openPreset(card.dataset.openPreset, card.dataset.sample));
});

textInput.addEventListener('input', updateText);
fontInput.addEventListener('change', updateFont);
sizeInput.addEventListener('input', () => {
  updateSize();
});
letterSpacingInput.addEventListener('input', updateLetterSpacing);
lineHeightInput.addEventListener('input', updateLineHeight);
tiltInput.addEventListener('input', updateTilt);
textObject.addEventListener('pointerdown', beginMove);
artboard.addEventListener('pointermove', movePointer);
artboard.addEventListener('pointerup', endPointer);
artboard.addEventListener('pointercancel', endPointer);
artboard.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('#text-object, #selection-box')) deselectText();
});
textObject.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    selectText();
  }
});
rotateHandle.addEventListener('pointerdown', beginRotate);

document.querySelectorAll('[data-align]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-align]').forEach((option) => {
      const isSelected = option === button;
      option.classList.toggle('selected', isSelected);
      option.setAttribute('aria-pressed', String(isSelected));
    });
    artboardText.style.textAlign = button.dataset.align;
    requestAnimationFrame(updateSelectionBox);
  });
});

textColorInput.addEventListener('input', () => {
  artboard.style.setProperty('--canvas-ink', textColorInput.value);
  document.querySelector('#text-color-dot').style.background = textColorInput.value;
});
bgColorInput.addEventListener('input', () => {
  artboard.style.setProperty('--canvas-bg', bgColorInput.value);
  document.querySelector('#bg-color-dot').style.background = bgColorInput.value;
});
document.querySelector('#save-work').addEventListener('click', saveWork);
document.querySelector('#download-work').addEventListener('click', downloadArtwork);
saveStyleButton.addEventListener('click', openStyleDialog);
styleForm.addEventListener('submit', saveCustomStyle);
cancelStyleButton.addEventListener('click', () => styleDialog.close());
styleNameInput.addEventListener('input', () => styleNameInput.setCustomValidity(''));

document.querySelectorAll('[data-preset], [data-align]').forEach((button) => button.setAttribute('aria-pressed', String(button.classList.contains('selected'))));
savedWorks = readSavedWorks();
customStyles = readCustomStyles();
renderSavedWorks();
renderCustomStyles();
setPreset(selectedPreset);
updateSize();
