// ══════════════════════════════════════════════
// DATA (동적으로 채워짐)
// ══════════════════════════════════════════════
let LEFT_RAW = [], RIGHT_RAW = [], ORIGINAL_BUBBLES = [], ALL_WPS = [];
let LEFT_EDIT = [], RIGHT_EDIT = [];
let _dirHandle = null, _currentConv = null;
let _editTimeline = [], _editIdx = 0;

// ══════════════════════════════════════════════
const SIMPLE_RE = /^(네|예|어|음|아|에|응|네네|네 네|어 네|아 네|네 에|어 음|아 네 네|네 네 어|시죠 네|세시|분)$/;
function isSimple(t) { return SIMPLE_RE.test(t.trim()); }
function fmtTime(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}
function fmtTimeDetail(ms) {
  const total = ms / 1000;
  const m = Math.floor(total / 60), s = (total % 60).toFixed(2);
  return String(m).padStart(2,'0') + ':' + String(s).padStart(5,'0');
}
function getStart(s) { return s.word_pieces[0].start; }
function getEnd(s) { return s.word_pieces[s.word_pieces.length-1].end; }

// Build word-piece lookup: for each original bubble, find the matching word_pieces from JSON
function buildWpLookup() {
  // Flatten all word_pieces with channel
  const allWps = [];
  LEFT_RAW.forEach(s => s.word_pieces.forEach(wp => allWps.push({word: wp.word, start: wp.start, end: wp.end, ch:'left'})));
  RIGHT_RAW.forEach(s => s.word_pieces.forEach(wp => allWps.push({word: wp.word, start: wp.start, end: wp.end, ch:'right'})));
  allWps.sort((a,b) => a.start - b.start);
  return allWps;
}
// Find word_pieces that fall within a bubble's time range and channel
function findWpsForBubble(ch, startMs, endMs) {
  return ALL_WPS.filter(wp => wp.ch === ch && wp.start >= startMs - 50 && wp.end <= endMs + 50);
}

// ══════════════════════════════════════════════
// RENDER: Word-piece span with click-to-play
// ══════════════════════════════════════════════
function wpSpan(word, startMs, endMs) {
  return `<span class="wp" data-start="${startMs}" data-end="${endMs}" onclick="playWord(event,this)">${word}</span>`;
}

// ══════════════════════════════════════════════
// TAB 1: Word 단위 채널 전환 감지 버블
// ══════════════════════════════════════════════
function renderTab1() {
  const html = [];
  let curCh = null, curWps = [];

  function flushBubble() {
    if (curWps.length === 0) return;
    const start = curWps[0].start;
    const end   = curWps[curWps.length - 1].end;
    const textHtml = curWps.map(wp => wpSpan(wp.word, wp.start, wp.end)).join(' ');
    html.push(`<div class="message-row ${curCh}">
      <div class="bubble ${curCh}" data-start="${start}" data-end="${end}" onclick="clickBubbleArea(this)">
        <span class="text">${textHtml}</span>
        <span class="time">${fmtTimeDetail(start)}</span>
      </div>
    </div>`);
    curWps = [];
  }

  ALL_WPS.forEach(wp => {
    if (wp.ch !== curCh) { flushBubble(); curCh = wp.ch; }
    curWps.push(wp);
  });
  flushBubble();

  return html.join('\n');
}

// ══════════════════════════════════════════════
// TAB 6: Inline chip merge — word start 기준 끼어들기
// ══════════════════════════════════════════════
function makeChip(ch, text, startMs, endMs) {
  const speaker = ch === 'left' ? '고객' : '상담사';
  return `<div class="interjection-chip-row ${ch === 'right' ? 'from-right' : ''}">
    <div class="interjection-chip" data-start="${startMs}" data-end="${endMs}" onclick="playSegment(this)">
      <span class="chip-speaker">${speaker}</span>
      <span>${text}</span>
      <span class="chip-time">${fmtTime(startMs)}</span>
    </div>
  </div>`;
}

function renderTab6() {
  // 각 word 에 sentence 메타데이터 부착 후 word start 로 정렬
  const allWords = [];
  LEFT_RAW.forEach((s, si) => {
    const simple = isSimple(s.sentence);
    s.word_pieces.forEach(wp => allWords.push({
      word: wp.word, start: wp.start, end: wp.end, ch: 'left',
      sentKey: `L${si}`, sentText: s.sentence, sentSimple: simple,
      sentStart: getStart(s), sentEnd: getEnd(s)
    }));
  });
  RIGHT_RAW.forEach((s, si) => {
    const simple = isSimple(s.sentence);
    s.word_pieces.forEach(wp => allWords.push({
      word: wp.word, start: wp.start, end: wp.end, ch: 'right',
      sentKey: `R${si}`, sentText: s.sentence, sentSimple: simple,
      sentStart: getStart(s), sentEnd: getEnd(s)
    }));
  });
  allWords.sort((a, b) => a.start - b.start);

  const html = [];
  const done = new Set(); // 이미 처리된 sentKey
  let i = 0;

  while (i < allWords.length) {
    const cur = allWords[i];
    if (done.has(cur.sentKey)) { i++; continue; }

    // 추임새 → 독립 칩
    if (cur.sentSimple) {
      done.add(cur.sentKey);
      html.push(makeChip(cur.ch, cur.sentText, cur.sentStart, cur.sentEnd));
      i++;
      continue;
    }

    // 실질 발화 → 블록 시작
    const blockCh = cur.ch;
    done.add(cur.sentKey);
    const blockWords = [];
    let pendingChips = [];
    let j = i;

    while (j < allWords.length) {
      const w = allWords[j];

      // 이미 커밋된 sentence 의 word → 같은 채널이면 블록에 포함, 아니면 건너뜀
      if (done.has(w.sentKey)) {
        if (w.ch === blockCh) {
          // 이 word 앞에 보류 중인 칩이 있으면 먼저 인라인으로 삽입
          if (pendingChips.length > 0) {
            const label = pendingChips.map(c =>
              `${c.ch === 'left' ? '고객' : '상담사'}: ${c.text}`).join(' / ');
            blockWords.push({ raw: true, word: `<span class="inline-interject">[${label}]</span>`, start: -1, end: -1 });
            pendingChips = [];
          }
          blockWords.push(w);
        }
        j++; continue;
      }

      if (w.ch !== blockCh) {
        if (w.sentSimple) {
          // 상대 채널 추임새 → 칩으로 보류
          done.add(w.sentKey);
          pendingChips.push({ ch: w.ch, text: w.sentText, start: w.sentStart, end: w.sentEnd });
          j++; continue;
        } else {
          break; // 상대 채널 실질 발화 → 블록 종료
        }
      }

      // 같은 채널 새 sentence → 블록에 병합
      if (pendingChips.length > 0) {
        const label = pendingChips.map(c =>
          `${c.ch === 'left' ? '고객' : '상담사'}: ${c.text}`).join(' / ');
        blockWords.push({ raw: true, word: `<span class="inline-interject">[${label}]</span>`, start: -1, end: -1 });
        pendingChips = [];
      }
      done.add(w.sentKey);
      blockWords.push(w);
      j++;
    }

    const blockStart = blockWords.find(w => !w.raw)?.start ?? cur.start;
    const lastReal  = [...blockWords].reverse().find(w => !w.raw);
    const blockEnd  = lastReal?.end ?? blockStart;
    const textHtml  = blockWords.map(w => w.raw ? w.word : wpSpan(w.word, w.start, w.end)).join(' ');

    html.push(`<div class="message-row ${blockCh}">
      <div class="bubble ${blockCh}" data-start="${blockStart}" data-end="${blockEnd}" onclick="clickBubbleArea(this)">
        <span class="text">${textHtml}</span>
        <span class="time">${fmtTimeDetail(blockStart)}</span>
      </div>
    </div>`);

    pendingChips.forEach(c => html.push(makeChip(c.ch, c.text, c.start, c.end)));
    i = j;
  }
  return html.join('\n');
}

// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// LOAD CONVERSATION
// ══════════════════════════════════════════════
function buildOriginalBubbles() {
  const items = [];
  LEFT_RAW.forEach(s => items.push({
    ch: 'left', start: getStart(s), end: getEnd(s),
    text: s.sentence, time: fmtTimeDetail(getStart(s))
  }));
  RIGHT_RAW.forEach(s => items.push({
    ch: 'right', start: getStart(s), end: getEnd(s),
    text: s.sentence, time: fmtTimeDetail(getStart(s))
  }));
  items.sort((a, b) => a.start - b.start);
  return items;
}

function loadConversation(leftRaw, rightRaw, leftEdit, rightEdit, wavUrl, title, wavName) {
  LEFT_RAW = leftRaw;
  RIGHT_RAW = rightRaw;
  LEFT_EDIT = leftEdit;
  RIGHT_EDIT = rightEdit;
  ORIGINAL_BUBBLES = buildOriginalBubbles();
  ALL_WPS = buildWpLookup();
  _editTimeline = buildEditTimeline();
  _editIdx = 0;
  updateEditCount();

  document.getElementById('conv-title').textContent = title;
  document.getElementById('audio-label').textContent = wavName;
  audio.pause();
  audio.src = wavUrl;
  audio.load();
  playBtn.textContent = '▶';
  progressFill.style.width = '0%';
  audioTime.textContent = '00:00 / --:--';

  // 탭 초기화
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.chat-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-tab="wordpiece"]').classList.add('active');
  document.getElementById('panel-wordpiece').classList.add('active');

  document.getElementById('panel-wordpiece').innerHTML = renderTab1();
  document.getElementById('panel-inline-chip').innerHTML = renderTab6();
  document.getElementById('panel-edit').innerHTML = renderEditTab();

  document.getElementById('placeholder').classList.add('hidden');
}

// ══════════════════════════════════════════════
// PICKER
// ══════════════════════════════════════════════
let _conversations = [];

function _idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('stt-viewer', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
    req.onsuccess = e => res(e.target.result);
    req.onerror = rej;
  });
}
async function _idbSaveDir(handle) {
  const db = await _idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'lastDir');
    tx.oncomplete = res; tx.onerror = rej;
  });
}
async function _idbLoadDir() {
  try {
    const db = await _idbOpen();
    return await new Promise((res, rej) => {
      const tx = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get('lastDir');
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  } catch { return null; }
}

async function openFolderPicker() {
  const lastHandle = await _idbLoadDir();
  try {
    _dirHandle = await showDirectoryPicker({ mode: 'readwrite', ...(lastHandle ? { startIn: lastHandle } : {}) });
  } catch { return; }
  await _idbSaveDir(_dirHandle);

  const groups = {};
  for await (const [name, handle] of _dirHandle.entries()) {
    if (handle.kind !== 'file') continue;
    if (name.endsWith('_left_edit.json') || name.endsWith('_right_edit.json')) continue;
    if (name.endsWith('_left.json')) {
      const base = name.slice(0, -10);
      (groups[base] = groups[base] || {}).leftHandle = handle;
    } else if (name.endsWith('_right.json')) {
      const base = name.slice(0, -11);
      (groups[base] = groups[base] || {}).rightHandle = handle;
    } else if (name.toLowerCase().endsWith('.wav')) {
      const base = name.slice(0, -4);
      (groups[base] = groups[base] || {}).wavHandle = handle;
    }
  }

  _conversations = Object.entries(groups)
    .filter(([, g]) => g.leftHandle && g.rightHandle && g.wavHandle)
    .map(([id, g]) => ({ id, ...g }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const list = document.getElementById('conv-list');
  if (_conversations.length === 0) {
    list.innerHTML = '<p class="no-conv">wav + _left.json + _right.json 세트를 찾을 수 없습니다.</p>';
    return;
  }
  list.innerHTML = _conversations.map((c, i) =>
    `<div class="conv-item" data-idx="${i}" onclick="selectConv(${i})">${c.id}</div>`
  ).join('');
}

async function selectConv(idx) {
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.conv-item[data-idx="${idx}"]`).classList.add('active');
  const c = _conversations[idx];
  _currentConv = c;

  const [leftRaw, rightRaw] = await Promise.all([
    readHandleAsJson(c.leftHandle),
    readHandleAsJson(c.rightHandle),
  ]);
  const [leftEdit, rightEdit] = await Promise.all([
    getOrCreateEditJson(c.id, 'left', leftRaw),
    getOrCreateEditJson(c.id, 'right', rightRaw),
  ]);
  const wavFile = await c.wavHandle.getFile();
  const wavUrl = URL.createObjectURL(wavFile);
  loadConversation(leftRaw, rightRaw, leftEdit, rightEdit, wavUrl, c.id, wavFile.name);
}

async function readHandleAsJson(handle) {
  const file = await handle.getFile();
  const text = await file.text();
  return JSON.parse(text);
}

async function getOrCreateEditJson(id, side, originalData) {
  const name = `${id}_${side}_edit.json`;
  try {
    const handle = await _dirHandle.getFileHandle(name);
    return await readHandleAsJson(handle);
  } catch {
    const copy = JSON.parse(JSON.stringify(originalData));
    const handle = await _dirHandle.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(copy, null, 2));
    await writable.close();
    return copy;
  }
}

async function writeEditFile(side) {
  const data = side === 'left' ? LEFT_EDIT : RIGHT_EDIT;
  const name = `${_currentConv.id}_${side}_edit.json`;
  const handle = await _dirHandle.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}


// ══════════════════════════════════════════════
// EDIT TAB
// ══════════════════════════════════════════════
function updateEditCount() {
  const count = _editTimeline.filter(item => item.edited !== item.original).length;
  const el = document.getElementById('edit-count');
  if (!_editTimeline.length) { el.style.display = 'none'; return; }
  el.style.display = 'inline';
  el.textContent = `수정 ${count}개`;
  el.className = count > 0 ? 'has-edits' : '';
}

function buildEditTimeline() {
  const items = [];
  LEFT_RAW.forEach((s, si) => {
    s.word_pieces.forEach((wp, wi) => items.push({
      ch: 'left', sentIdx: si, wpIdx: wi,
      original: wp.word,
      edited: LEFT_EDIT[si]?.word_pieces[wi]?.word ?? wp.word,
      start: wp.start, end: wp.end,
    }));
  });
  RIGHT_RAW.forEach((s, si) => {
    s.word_pieces.forEach((wp, wi) => items.push({
      ch: 'right', sentIdx: si, wpIdx: wi,
      original: wp.word,
      edited: RIGHT_EDIT[si]?.word_pieces[wi]?.word ?? wp.word,
      start: wp.start, end: wp.end,
    }));
  });
  items.sort((a, b) => a.start - b.start);
  return items;
}

function renderEditTab() {
  const html = [];
  let curCh = null, curWords = [];

  function flushBubble() {
    if (!curWords.length) return;
    const start = curWords[0].item.start;
    const end = curWords[curWords.length - 1].item.end;
    const wordsHtml = curWords.map(({ item, ti }) => {
      const modified = item.edited !== item.original;
      return `<span class="edit-word${modified ? ' modified' : ''}" data-ti="${ti}" data-start="${item.start}" data-end="${item.end}" onclick="clickEditWord(event,${ti})" ondblclick="dblEditWord(event,${ti})">${item.edited}</span>`;
    }).join(' ');
    html.push(`<div class="edit-bubble-row ${curCh}">
      <div class="edit-bubble ${curCh}" data-start="${start}" data-end="${end}" onclick="clickBubbleArea(this)">
        <span class="text">${wordsHtml}</span>
        <span class="edit-time">${fmtTimeDetail(start)}</span>
      </div>
    </div>`);
    curWords = [];
  }

  _editTimeline.forEach((item, ti) => {
    if (item.ch !== curCh) { flushBubble(); curCh = item.ch; }
    curWords.push({ item, ti });
  });
  flushBubble();
  return html.join('\n');
}

function focusEditWord(ti) {
  document.querySelectorAll('.edit-word.focused').forEach(el => el.classList.remove('focused'));
  const el = document.querySelector(`.edit-word[data-ti="${ti}"]`);
  if (!el) return;
  el.classList.add('focused');
  const panel = document.getElementById('panel-edit');
  const panelRect = panel.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  if (elRect.bottom > panelRect.bottom - 80) {
    panel.scrollBy({ top: elRect.bottom - panelRect.bottom + 80, behavior: 'smooth' });
  } else if (elRect.top < panelRect.top + 80) {
    panel.scrollBy({ top: elRect.top - panelRect.top - 80, behavior: 'smooth' });
  }
}

function clickBubbleArea(el) {
  const startMs = parseFloat(el.dataset.start);
  if (isNaN(startMs)) return;
  audio.currentTime = startMs / 1000;
  _navIdx = null;
}

function dblEditWord(e, ti) {
  e.stopPropagation();
  clickEditWord(e, ti);
  openEditBubble();
}

function clickEditWord(e, ti) {
  e.stopPropagation();
  if (document.querySelector('.edit-word.editing')) cancelEditBubble();
  _editIdx = ti;
  focusEditWord(ti);
  const item = _editTimeline[ti];
  audio.currentTime = item.start / 1000;
  _navIdx = null;
}

function openEditBubble() {
  const el = document.querySelector(`.edit-word[data-ti="${_editIdx}"]`);
  if (!el || el.classList.contains('editing')) return;
  el.classList.add('editing');
  const current = el.textContent;
  el.innerHTML = `<input class="edit-word-input" type="text" value="${current.replace(/"/g, '&quot;')}">`;
  const inp = el.querySelector('input');
  inp.size = Math.max(inp.value.length + 2, 3);
  inp.focus();
  inp.select();
}

async function saveEditBubble() {
  const el = document.querySelector(`.edit-word.editing[data-ti="${_editIdx}"]`);
  if (!el) return;
  const inp = el.querySelector('input');
  const newText = inp ? inp.value.trim() : '';
  const ti = parseInt(el.dataset.ti);
  const item = _editTimeline[ti];

  el.classList.remove('editing');
  el.textContent = newText;
  el.className = 'edit-word' + (newText !== item.original ? ' modified' : '') + ' focused';
  _editTimeline[ti].edited = newText;

  if (item.ch === 'left') LEFT_EDIT[item.sentIdx].word_pieces[item.wpIdx].word = newText;
  else RIGHT_EDIT[item.sentIdx].word_pieces[item.wpIdx].word = newText;
  await writeEditFile(item.ch);
  updateEditCount();
}

function cancelEditBubble() {
  const el = document.querySelector(`.edit-word.editing[data-ti="${_editIdx}"]`);
  if (!el) return;
  const ti = parseInt(el.dataset.ti);
  el.classList.remove('editing');
  el.textContent = _editTimeline[ti].edited;
}

// ══════════════════════════════════════════════
// TAB SWITCHING
// ══════════════════════════════════════════════
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.querySelectorAll('.chat-panel').forEach(p => p.classList.remove('active'));
    const panelId = tab === 'wordpiece' ? 'panel-wordpiece' : tab === 'inline-chip' ? 'panel-inline-chip' : 'panel-edit';
    document.getElementById(panelId).classList.add('active');
    if (tab === 'edit') focusEditWord(_editIdx);
  });
});

// ══════════════════════════════════════════════
// AUDIO PLAYBACK
// ══════════════════════════════════════════════
const audio = document.getElementById('audio-player');
let _navIdx = null; // 화살표 키 word 단위 탐색 인덱스
let _navTs  = 0;   // 마지막 화살표 키 입력 시각
const playBtn = document.getElementById('play-btn');
const progressFill = document.getElementById('progress-fill');
const audioTime = document.getElementById('audio-time');

function togglePlay() {
  if (audio.paused) { audio.play(); playBtn.textContent = '⏸'; }
  else { audio.pause(); playBtn.textContent = '▶'; }
}

function seekAudio(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  audio.currentTime = pct * audio.duration;
  _navIdx = null;
}

// 글자(word) 클릭 시 해당 위치 재생
function playWord(e, el) {
  e.stopPropagation();
  const startMs = parseFloat(el.dataset.start);
  if (isNaN(startMs) || startMs < 0) return;
  _navIdx = null;
  audio.currentTime = startMs / 1000;
  if (!audio.paused) {
    audio.play();
    playBtn.textContent = '⏸';
  } else {
    updateHighlight(startMs);
  }
}

// 칩 클릭 시 재생
function playSegment(el) {
  const startMs = parseFloat(el.dataset.start);
  _navIdx = null;
  audio.currentTime = startMs / 1000;
  audio.play();
  playBtn.textContent = '⏸';
}

// ── 재생 위치에 따라 하이라이트 ──
function updateHighlight(forceMs) {
  const ms = forceMs !== undefined ? forceMs
    : (_navIdx !== null && ALL_WPS[_navIdx]) ? ALL_WPS[_navIdx].start
    : audio.currentTime * 1000;

  document.querySelectorAll('.bubble.playing').forEach(el => el.classList.remove('playing'));
  document.querySelectorAll('.wp.wp-playing').forEach(el => el.classList.remove('wp-playing'));
  document.querySelectorAll('.interjection-chip.playing').forEach(el => el.classList.remove('playing'));
  document.querySelectorAll('.edit-word.ew-playing').forEach(el => el.classList.remove('ew-playing'));

  const activePanel = document.querySelector('.chat-panel.active');
  if (!activePanel) return;

  let foundWp = false;
  let scrollTarget = null;
  const allWpEls = activePanel.querySelectorAll('.wp[data-start]');

  // navIdx 가 설정돼 있거나 forceMs 가 주어지면 exact 매칭, 아니면 범위 매칭
  const useExact = forceMs !== undefined || _navIdx !== null;

  if (useExact) {
    for (const wpEl of allWpEls) {
      if (parseFloat(wpEl.dataset.start) === ms) {
        wpEl.classList.add('wp-playing');
        const parentBubble = wpEl.closest('.bubble');
        if (parentBubble) { parentBubble.classList.add('playing'); scrollTarget = parentBubble; }
        foundWp = true;
        break;
      }
    }
  }

  if (!foundWp) {
    for (const wpEl of allWpEls) {
      const s = parseFloat(wpEl.dataset.start);
      const e = parseFloat(wpEl.dataset.end);
      if (ms >= s && ms <= e + 200) {
        wpEl.classList.add('wp-playing');
        const parentBubble = wpEl.closest('.bubble');
        if (parentBubble) { parentBubble.classList.add('playing'); scrollTarget = parentBubble; }
        foundWp = true;
        break;
      }
    }
  }

  if (!foundWp) {
    const chipEls = activePanel.querySelectorAll('.interjection-chip[data-start]');
    for (const chipEl of chipEls) {
      const s = parseFloat(chipEl.dataset.start);
      const e = parseFloat(chipEl.dataset.end);
      if (ms >= s && ms <= e + 200) {
        chipEl.classList.add('playing');
        scrollTarget = chipEl;
        break;
      }
    }
  }

  // 편집 탭 단어 하이라이트
  if (activePanel.id === 'panel-edit') {
    const editMs = audio.currentTime * 1000;
    const ewEls = activePanel.querySelectorAll('.edit-word[data-start]');
    for (const ewEl of ewEls) {
      if (ewEl.classList.contains('editing')) continue;
      const s = parseFloat(ewEl.dataset.start);
      const e = parseFloat(ewEl.dataset.end);
      if (editMs >= s && editMs <= e + 200) {
        ewEl.classList.add('ew-playing');
        if (!scrollTarget) scrollTarget = ewEl;
        break;
      }
    }
  }

  if (scrollTarget) {
    const panelRect  = activePanel.getBoundingClientRect();
    const targetRect = scrollTarget.getBoundingClientRect();
    const margin = 80;
    if (targetRect.bottom > panelRect.bottom - margin) {
      activePanel.scrollBy({ top: targetRect.bottom - panelRect.bottom + margin, behavior: 'smooth' });
    } else if (targetRect.top < panelRect.top + margin) {
      activePanel.scrollBy({ top: targetRect.top - panelRect.top - margin, behavior: 'smooth' });
    }
  }
}

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  if (_navIdx !== null && !audio.paused && Date.now() - _navTs > 800) {
    _navIdx = null;
  }
  const pct = (audio.currentTime / audio.duration) * 100;
  progressFill.style.width = pct + '%';
  audioTime.textContent = `${fmtTime(audio.currentTime * 1000)} / ${fmtTime(audio.duration * 1000)}`;
  updateHighlight();
});

audio.addEventListener('ended', () => { playBtn.textContent = '▶'; });

// ── DEBUG OVERLAY ──
// const _dbg = document.createElement('div');
// _dbg.style.cssText = 'position:fixed;bottom:8px;right:8px;background:rgba(0,0,0,0.8);color:#0f0;font:11px monospace;padding:8px 12px;border-radius:6px;z-index:9999;line-height:1.8;pointer-events:none';
// document.body.appendChild(_dbg);
// audio.addEventListener('timeupdate', () => {
//   const ms = audio.currentTime * 1000;
//   const cur = ALL_WPS[_navIdx];
//   const calc = (() => {
//     let idx = -1;
//     for (let i = 0; i < ALL_WPS.length; i++) {
//       if (ALL_WPS[i].start <= ms) idx = i; else break;
//     }
//     return idx;
//   })();
//   const hlMs = (_navIdx !== null && ALL_WPS[_navIdx]) ? ALL_WPS[_navIdx].start : ms;
//   const mode = _navIdx !== null ? 'exact' : 'range';
//   _dbg.innerHTML =
//     `currentTime: ${ms.toFixed(1)} ms<br>` +
//     `_navIdx: ${_navIdx} / total: ${ALL_WPS.length}<br>` +
//     `nav word: ${cur ? `[${cur.ch}] "${cur.word}" @${cur.start}` : '-'}<br>` +
//     `calc idx: ${calc} → "${ALL_WPS[calc]?.word ?? '-'}" @${ALL_WPS[calc]?.start ?? '-'}<br>` +
//     `highlight: ${mode} @ ${hlMs}`;
// });

document.addEventListener('keydown', e => {
  if (e.key === 'F5' || (e.ctrlKey && e.key === 'r') || (e.metaKey && e.key === 'r')) {
    e.preventDefault();
  }
  if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    togglePlay();
  }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'edit') {
      if (document.querySelector('.edit-word.editing')) return;
      if (e.key === 'ArrowRight') _editIdx = Math.min(_editTimeline.length - 1, _editIdx + 1);
      else _editIdx = Math.max(0, _editIdx - 1);
      focusEditWord(_editIdx);
      const item = _editTimeline[_editIdx];
      audio.currentTime = item.start / 1000;
      _navIdx = null;
      return;
    }
    if (!ALL_WPS.length) return;
    const ms = audio.currentTime * 1000;
    if (_navIdx === null) {
      _navIdx = -1;
      for (let i = 0; i < ALL_WPS.length; i++) {
        if (ALL_WPS[i].start <= ms) _navIdx = i; else break;
      }
    }
    if (e.key === 'ArrowRight') {
      _navIdx = Math.min(ALL_WPS.length - 1, _navIdx + 1);
    } else {
      _navIdx = Math.max(0, _navIdx - 1);
    }
    audio.currentTime = ALL_WPS[_navIdx].start / 1000;
    _navTs = Date.now();
    updateHighlight(ALL_WPS[_navIdx].start);
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'edit') {
      if (document.querySelector('.edit-word.editing')) return;
      const curEl = document.querySelector(`.edit-word[data-ti="${_editIdx}"]`);
      if (!curEl) return;
      const curRect = curEl.getBoundingClientRect();
      const curCenterX = curRect.left + curRect.width / 2;
      const panel = document.getElementById('panel-edit');
      const allWords = [...panel.querySelectorAll('.edit-word[data-ti]')];
      let candidates;
      if (e.key === 'ArrowDown') {
        candidates = allWords.filter(el => el.getBoundingClientRect().top > curRect.bottom - 2);
        if (!candidates.length) return;
        const minTop = Math.min(...candidates.map(el => el.getBoundingClientRect().top));
        candidates = candidates.filter(el => el.getBoundingClientRect().top <= minTop + curRect.height);
      } else {
        candidates = allWords.filter(el => el.getBoundingClientRect().bottom < curRect.top + 2);
        if (!candidates.length) return;
        const maxBottom = Math.max(...candidates.map(el => el.getBoundingClientRect().bottom));
        candidates = candidates.filter(el => el.getBoundingClientRect().bottom >= maxBottom - curRect.height);
      }
      const target = candidates.reduce((best, el) => {
        const cx = el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2;
        const bestCx = best.getBoundingClientRect().left + best.getBoundingClientRect().width / 2;
        return Math.abs(cx - curCenterX) < Math.abs(bestCx - curCenterX) ? el : best;
      });
      _editIdx = parseInt(target.dataset.ti);
      focusEditWord(_editIdx);
      const item = _editTimeline[_editIdx];
      audio.currentTime = item.start / 1000;
      _navIdx = null;
      return;
    }
    if (!ALL_WPS.length) return;
    const activePanel = document.querySelector('.chat-panel.active');
    if (!activePanel) return;
    const curEl = activePanel.querySelector('.wp.wp-playing')
      || (() => {
        if (_navIdx === null) return null;
        const ms = ALL_WPS[_navIdx].start;
        return [...activePanel.querySelectorAll('.wp[data-start]')]
          .find(el => parseFloat(el.dataset.start) === ms) || null;
      })();
    if (!curEl) return;
    const curRect = curEl.getBoundingClientRect();
    const curCenterX = curRect.left + curRect.width / 2;
    const allWpEls = [...activePanel.querySelectorAll('.wp[data-start]')];
    let candidates;
    if (e.key === 'ArrowDown') {
      candidates = allWpEls.filter(el => el.getBoundingClientRect().top > curRect.bottom - 2);
      if (!candidates.length) return;
      const minTop = Math.min(...candidates.map(el => el.getBoundingClientRect().top));
      candidates = candidates.filter(el => el.getBoundingClientRect().top <= minTop + curRect.height);
    } else {
      candidates = allWpEls.filter(el => el.getBoundingClientRect().bottom < curRect.top + 2);
      if (!candidates.length) return;
      const maxBottom = Math.max(...candidates.map(el => el.getBoundingClientRect().bottom));
      candidates = candidates.filter(el => el.getBoundingClientRect().bottom >= maxBottom - curRect.height);
    }
    const target = candidates.reduce((best, el) => {
      const cx = el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2;
      const bestCx = best.getBoundingClientRect().left + best.getBoundingClientRect().width / 2;
      return Math.abs(cx - curCenterX) < Math.abs(bestCx - curCenterX) ? el : best;
    });
    const targetStart = parseFloat(target.dataset.start);
    const idx = ALL_WPS.findIndex(wp => wp.start === targetStart);
    if (idx === -1) return;
    _navIdx = idx;
    audio.currentTime = ALL_WPS[_navIdx].start / 1000;
    _navTs = Date.now();
    updateHighlight(ALL_WPS[_navIdx].start);
  }
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'edit') {
      e.preventDefault();
      const editing = document.querySelector(`.edit-word.editing[data-ti="${_editIdx}"]`);
      if (editing) saveEditBubble();
      else openEditBubble();
    }
  }
  if (e.key === 'Escape') {
    cancelEditBubble();
  }
});
